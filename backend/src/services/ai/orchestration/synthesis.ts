import type { ChatInput, Check, Emit, Plan, TaskDraft, TaskResult } from './types.js';
import { answerSchema } from './schemas.js';
import { ModelClient } from './model-client.js';
import { RunBudget, RunCancelled } from './budget.js';
import { assistantRules } from './context.js';
import { textViewContext } from '../../chat-context.js';
import { ToolSession } from './tools.js';
import { checkResult } from './reviewer.js';
import { checkDetails } from './task-runner.js';

export function partialAnswer(results: TaskResult[], reason: string) {
  const parts = results
    .filter((result) => result.draft.answer.trim() && result.check.verdict !== 'revise')
    .map((result) => `**${result.task.title}**\n\n${result.draft.answer}`);
  const open = results
    .filter((result) => result.status !== 'accepted')
    .map(
      (result) =>
        `- ${result.task.title}: ${result.check.issues.map((issue) => issue.problem).join('; ') || result.check.summary}`
    );
  return [...parts, ...(open.length ? ['Noch offen:\n' + open.join('\n')] : []), reason]
    .filter(Boolean)
    .join('\n\n');
}
export async function synthesize(
  input: ChatInput,
  plan: Plan,
  results: TaskResult[],
  worker: ModelClient,
  reviewer: ModelClient,
  tools: ToolSession,
  budget: RunBudget,
  emit: Emit
) {
  const sourceIds = [...new Set(results.flatMap((result) => result.draft.source_ids))];
  const materials = results.map((result) => ({
    task: result.task.title,
    status: result.status,
    answer: result.draft.answer,
    limitations: result.draft.limitations,
    checks: result.check,
  }));
  let reply = plan.direct_reply || '';
  let feedback: Check | null = null;
  for (let attempt = 0; attempt <= budget.policy.synthesisRepairs; attempt++) {
    if (!reply || attempt > 0) {
      emit({
        stage: 'synthesis',
        summary: attempt
          ? 'Antwort anhand des konkreten Abschlussprüfpunkts korrigieren.'
          : 'Geprüfte Teilergebnisse zur Antwort zusammenführen.',
        status: 'running',
        ...(feedback
          ? { reason: feedback.issues[0]?.problem, details: checkDetails(feedback) }
          : {}),
      });
      const composed = await worker.structured(
        `${assistantRules}
Erstelle ausschließlich die abschließende Antwort für den Nutzer. Nutze sowohl die Teilergebnisse als auch die tatsächlich geladenen sources. Darin enthaltene Engine-Ergebnisse und Rohwerte bleiben verfügbar, auch wenn eine Teilaufgabe wegen eines technischen Limits oder einer ausgefallenen Zwischenprüfung status=unverified hat. Überprüfe solche Angaben direkt anhand ihrer Quellen statt sie pauschal zu verwerfen. Keine neue Recherche und keine erfundenen Berechnungen; bereits erfolgte Engine-Auswertung ist die Zahlenbasis. Belegte Grenzen konkret mit Company/Datum/Feld beschreiben, nie pauschal zusätzliche Daten vom Nutzer verlangen. Falls eine Berechnung technisch nicht fertig wurde, dies als technischen Bearbeitungsstand bezeichnen, nicht als fehlende Daten. Vorschläge sind noch nicht gespeichert. Keine Werkzeug-IDs, internen Prüfanweisungen oder Schrittprotokolle im Antworttext. Die Frage angemessen knapp oder ausführlich beantworten.
Gib die Antwort als sauber gegliedertes Markdown im Feld reply zurück: echte Zeilenumbrüche, Absätze, Leerzeilen vor Listen/Tabellen, Tabellen mit Kopf- und Trennzeile, Einheiten und Bezugsdatum direkt bei Zahlen. Kein JSON im reply, kein HTML und kein umschließender Markdown-Codeblock.`,
        {
          question: input.messages.at(-1)?.content,
          history: input.messages,
          view: textViewContext(input.context),
          plan,
          results: materials,
          sources: tools.reviewData(sourceIds),
          proposals: tools.changes.map(({ token: _, ...change }) => change),
          ...(feedback ? { previous_answer: reply, required_correction: feedback.issues } : {}),
        },
        { schema: answerSchema, name: 'compose_answer', outputTokens: 6000 },
        answerSchema
      );
      reply = composed.reply;
    }
    if (!budget.hasRoom(1)) return { reply, verified: false };
    emit({
      stage: 'review',
      summary: 'Gesamtantwort gegen den ursprünglichen Auftrag prüfen.',
      status: 'checking',
    });
    const draft: TaskDraft = { answer: reply, source_ids: sourceIds, limitations: [] };
    let check: Check;
    try {
      check = await checkResult(input, reviewer, tools, {
        title: 'Gesamtantwort',
        instruction: plan.objective,
        criteria: plan.criteria,
        draft,
        plan,
        final: true,
        precedingResults: materials,
      });
    } catch (error) {
      if (budget.signal?.aborted) throw new RunCancelled('Bearbeitung vom Nutzer abgebrochen.');
      emit({
        stage: 'review',
        summary:
          'Die Antwort aus den geladenen Quellen ist erstellt; die separate Abschlussprüfung ist technisch nicht verfügbar.',
        status: 'blocked',
      });
      return { reply, verified: false };
    }
    if (check.verdict !== 'revise') {
      emit({
        stage: 'review',
        summary: check.summary || 'Die Gesamtantwort erfüllt den festgelegten Umfang.',
        status: check.verdict === 'accepted' ? 'accepted' : 'blocked',
        details: checkDetails(check),
      });
      return { reply, verified: check.verdict === 'accepted' };
    }
    feedback = check;
    emit({
      stage: 'retry',
      summary: `Abschlussprüfung: ${check.issues[0].criterion}`,
      status: 'running',
      reason: check.issues[0].problem,
      details: checkDetails(check),
    });
    if (attempt >= budget.policy.synthesisRepairs || !budget.hasRoom(2)) break;
  }
  return {
    reply: partialAnswer(
      results,
      'Die abschließende Antwortprüfung ist noch offen: ' +
        (feedback?.issues.map((issue) => `${issue.criterion}: ${issue.problem}`).join('; ') ||
          'Abschluss nicht vollständig geprüft.')
    ),
    verified: false,
  };
}
