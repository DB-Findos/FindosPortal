import type { Actor } from '../../../mcp/data.js';
import { validateChatModel } from '../../chat-models.js';
import { httpError } from '../../../shared/errors.js';
import type { ChatProgress } from '../../chat-progress.js';
import type { ChatInput, ChatResult, Emit, Plan, TaskResult } from './types.js';
import { budgetFor, RunBudget, RunCancelled } from './budget.js';
import { ModelClient } from './model-client.js';
import { ToolSession } from './tools.js';
import { createPlan } from './planner.js';
import { runTask } from './task-runner.js';
import { synthesize, partialAnswer } from './synthesis.js';
import { safeError } from './context.js';

export async function runChatWorkflow(
  actor: Actor,
  input: ChatInput,
  onProgress?: (event: ChatProgress) => void,
  signal?: AbortSignal
): Promise<ChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(503, 'OPENAI_API_KEY ist im Backend nicht gesetzt.');
  const selection = validateChatModel(
    input.model || process.env.OPENAI_MODEL || 'gpt-5-mini',
    input.reasoning_effort || 'medium'
  );
  const budget = new RunBudget(budgetFor(selection.effort), signal);
  const progress: ChatProgress[] = [];
  const emit: Emit = (event) => {
    const item = {
      ...event,
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - budget.startedAt,
    };
    progress.push(item);
    onProgress?.(item);
  };
  const tools = new ToolSession(actor, input, budget, emit);
  const reviewModel = process.env.OPENAI_REVIEW_MODEL?.trim() || 'gpt-5-mini';
  const plannerModel = process.env.OPENAI_PLANNER_MODEL?.trim() || reviewModel;
  const reviewer = new ModelClient(
    apiKey,
    reviewModel,
    /^gpt-[56]/.test(reviewModel) ? 'low' : null,
    budget
  );
  const planner = new ModelClient(
    apiKey,
    plannerModel,
    /^gpt-[56]/.test(plannerModel) ? 'low' : null,
    budget
  );
  const worker = new ModelClient(
    apiKey,
    selection.model,
    selection.reasoning ? selection.effort : null,
    budget
  );
  const summarizer = worker.summaryClient();
  const results: TaskResult[] = [];
  let plan: Plan = {
    objective: input.messages.at(-1)?.content.slice(0, 250) || 'Nutzerfrage beantworten',
    intent: 'analysis',
    scope: [],
    criteria: [],
    data_requirements: [],
    direct_reply: null,
    tasks: [],
  };
  let reply = '';
  let status = 'incomplete';
  emit({
    stage: 'context',
    summary: `Aktuelle Ansicht bereit: ${input.context.view}.`,
    status: 'info',
    details: [
      'Company, Datum, Währung, Filter, sichtbare Zahlen und Diagramme werden als Kontext berücksichtigt.',
    ],
  });
  try {
    plan = await createPlan(input, planner, tools, budget, emit);
    if (plan.direct_reply) {
      reply = plan.direct_reply;
      status = 'complete';
    }
    for (const task of plan.tasks) {
      budget.assertActive();
      if (!budget.hasRoom(3)) {
        const reason =
          'Der festgelegte Zeit-/Aufrufrahmen reicht nicht für einen weiteren vollständigen Bearbeitungs- und Prüfschritt.';
        results.push({
          task,
          status: 'unverified',
          attempts: 0,
          draft: { answer: '', source_ids: [], limitations: [] },
          check: { verdict: 'blocked', summary: reason, issues: [], research: [] },
        });
        emit({
          stage: 'task',
          taskId: task.id,
          taskTitle: task.title,
          summary: reason,
          status: 'blocked',
        });
        continue;
      }
      results.push(
        await runTask(input, plan, task, results, worker, reviewer, tools, budget, emit, summarizer)
      );
    }
    budget.assertActive();
    if (!plan.direct_reply && budget.hasRoom(1)) {
      const final = await synthesize(
        input,
        plan,
        results,
        summarizer,
        reviewer,
        tools,
        budget,
        emit
      );
      reply = final.reply;
      status = final.verified ? 'complete' : 'partial';
    } else if (!plan.direct_reply) {
      reply = partialAnswer(
        results,
        'Der zu Beginn festgelegte Bearbeitungsrahmen ist erreicht; die Abschlussprüfung konnte nicht vollständig durchgeführt werden.'
      );
      status = 'partial';
    }
  } catch (error) {
    const reason = safeError(error);
    status = error instanceof RunCancelled ? 'cancelled' : 'incomplete';
    reply = partialAnswer(results, reason);
    emit({ stage: 'warning', summary: reason, status: 'blocked' });
  }
  if (!reply.trim())
    reply =
      'Der Auftrag konnte nicht abschließend bearbeitet werden. Die konkreten Gründe stehen im Bearbeitungsverlauf.';
  emit({
    stage: status === 'complete' ? 'complete' : 'warning',
    status: status === 'complete' ? 'accepted' : 'blocked',
    summary:
      status === 'complete'
        ? 'Auftrag innerhalb des festgelegten Umfangs abgeschlossen.'
        : status === 'cancelled'
          ? 'Bearbeitung abgebrochen; erreichte Ergebnisse bleiben gespeichert.'
          : 'Bearbeitung abgeschlossen; konkret offene Punkte sind in den Aufgaben ausgewiesen.',
  });
  return {
    reply,
    changes: tools.changes,
    proposals: [],
    steps: tools.steps,
    document_ids: tools.documentIds,
    progress,
    review: {
      status,
      model: reviewModel,
      passes: progress.filter((event) => event.stage === 'review' && event.status === 'checking')
        .length,
    },
    orchestration: { plan, budget: budget.policy, usage: budget.usage, tasks: results },
  };
}
