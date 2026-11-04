// Focused offline checks: no database mutation and no paid model requests.
import '../config.js';
import assert from 'node:assert/strict';
import { definitions } from '../entities.js';
import { modelHistory } from '../services/chat-history.js';
import { getDataModel, compileAggregate } from '../mcp/research.js';
import { budgetFor, RunBudget } from '../services/ai/orchestration/budget.js';
import { ToolSession } from '../services/ai/orchestration/tools.js';
import { evidencePreview } from '../services/ai/orchestration/evidence.js';
import { runTask } from '../services/ai/orchestration/task-runner.js';
import { synthesize } from '../services/ai/orchestration/synthesis.js';
import type { ModelClient } from '../services/ai/orchestration/model-client.js';
import type { ChatInput, Plan, Task, TaskDraft } from '../services/ai/orchestration/types.js';

const actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  canCommit: false,
  rights: Object.fromEntries(
    Object.keys(definitions).map((entity) => [entity, { can_read: true }])
  ),
};
const input: ChatInput = {
  messages: [{ role: 'user', content: 'Bitte die benötigten Werte finden.' }],
  context: { path: '/', view: 'Test', entity: null },
};
const task: Task = {
  id: 'research',
  title: 'Werte recherchieren',
  instruction: 'Notwendige Quellen abrufen und beantworten.',
  criteria: ['Benötigte Werte belegen.'],
  depends_on: [],
  tools: [],
  data_requirements: ['Passende Datensätze und Werte'],
};
const plan: Plan = {
  objective: 'Werte beantworten',
  intent: 'analysis',
  scope: ['Werte'],
  criteria: task.criteria,
  direct_reply: null,
  tasks: [task],
  data_requirements: task.data_requirements,
};
const budget = new RunBudget(budgetFor('medium'));
const tools = new ToolSession(actor, input, budget, () => {});
const model = getDataModel(actor);
assert.equal(model.entities.length, Object.keys(definitions).length);
assert.ok(
  model.entities
    .find((entity) => entity.entity === 'metric_data')
    ?.fields.some((field) => field.name === 'value')
);
assert.ok(
  !model.entities
    .find((entity) => entity.entity === 'users')
    ?.fields.some((field) => field.name === 'password')
);
const allowed = tools.definitions(task, 'analysis').map((tool) => tool.name);
for (const name of [
  'get_data_model',
  'search_database',
  'aggregate_entities',
  'query_entities',
  'read_tool_result',
  'get_company_report',
  'evaluate_kpi',
])
  assert.ok(allowed.includes(name));
assert.ok(!allowed.includes('commit_change') && !allowed.includes('create_document'));
const large = {
  rows: Array.from({ length: 500 }, (_, index) => ({
    index,
    text: 'Details '.repeat(70),
    value: index,
  })),
};
const preview = evidencePreview(large, 4000);
assert.ok(JSON.stringify(preview).length < 65000);
assert.equal((preview as { truncated: boolean }).truncated, true);
tools.evidence.push({
  id: 1,
  tool: 'query_entities',
  arguments: {},
  data: large,
  output: JSON.stringify(preview),
});
const read = JSON.parse(
  (
    await tools.execute(
      'read_tool_result',
      JSON.stringify({ source_id: 1, path: ['rows'], offset: 499, limit: 1 }),
      task,
      tools.definitions(task, 'analysis')
    )
  ).output
);
assert.equal(read.data[0].value, 499);
assert.equal(read.nextOffset, null);
assert.equal(budget.usage.tools, 0);
const history = modelHistory([
  {
    objectId: actor.userId,
    conversation_id: actor.userId,
    role: 'user',
    content: 'Ursprünglicher vollständiger Nutzertext.',
    metadata: {
      view_context: {
        ...input.context,
        content: {
          text: 'Historische Tabellen '.repeat(30000),
          controls: [],
          sources: [{ name: 'Daten', data: large }],
        },
      },
    },
  },
]);
assert.ok(history[0].content.startsWith('Ursprünglicher vollständiger Nutzertext.'));
assert.ok(
  history[0].content.length < 10000,
  'Historical snapshots must not drown the next research request.'
);
assert.ok(history[0].content.includes('include_context=true'));

const aggregate = compileAggregate(actor, {
  definition: { entity: 'documents', fields: [{ alias: 'root', field: 'size_bytes' }] },
  measures: [{ name: 'total', op: 'sum', field: 'root.size_bytes' }],
});
assert.ok(aggregate.sql.includes("visibility='shared'"));
assert.ok(aggregate.sql.indexOf('LIMIT') > aggregate.sql.lastIndexOf(') source'));
assert.throws(() =>
  compileAggregate(
    { ...actor, rights: {} },
    {
      definition: { entity: 'documents', fields: [{ alias: 'root', field: 'size_bytes' }] },
      measures: [{ name: 'total', op: 'sum', field: 'root.size_bytes' }],
    }
  )
);
assert.throws(() =>
  compileAggregate(actor, {
    definition: { entity: 'documents', fields: [{ alias: 'root', field: 'name' }] },
    measures: [{ name: 'total', op: 'sum', field: 'root.name' }],
  })
);

let turns = 0;
const draft: TaskDraft = {
  answer: 'Die geladenen Werte sind verfügbar.',
  source_ids: [1],
  limitations: [],
};
const worker = {
  session: () => ({
    input: [] as Record<string, unknown>[],
    next: async () => {
      budget.model();
      const turn = turns++;
      return turn < 6
        ? {
            calls: [
              {
                id: String(turn),
                name: 'read_tool_result',
                arguments: JSON.stringify({ source_id: 1, path: ['rows'], offset: turn, limit: 1 }),
              },
            ],
            text: '',
          }
        : { calls: [], text: JSON.stringify(draft) };
    },
  }),
} as unknown as ModelClient;
const reviewer = {
  structured: async () => ({
    verdict: 'accepted',
    summary: 'Quellen vorhanden.',
    issues: [],
    research: [],
  }),
} as unknown as ModelClient;
const result = await runTask(input, plan, task, [], worker, reviewer, tools, budget, () => {});
assert.equal(
  turns,
  7,
  'A valid six-tool-turn investigation must not terminate at the old five-round limit.'
);
assert.equal(result.status, 'accepted');

let composerSawSources = false;
const composer = {
  structured: async (_prompt: string, data: { sources: unknown[] }) => {
    composerSawSources = data.sources.length > 0;
    return { reply: '**Ergebnis**\n\nDie geladenen Werte sind verfügbar.' };
  },
} as unknown as ModelClient;
const failingReviewer = {
  structured: async () => {
    throw Error('simulated review outage');
  },
} as unknown as ModelClient;
const final = await synthesize(
  input,
  plan,
  [result],
  composer,
  failingReviewer,
  tools,
  budget,
  () => {}
);
assert.equal(composerSawSources, true);
assert.ok(final.reply.startsWith('**Ergebnis**'));
assert.equal(final.verified, false);
const finishingBudget = new RunBudget(budgetFor('low'));
const deadlineReviewer = {
  structured: async () => {
    Object.defineProperty(finishingBudget, 'deadline', { value: Date.now() - 1 });
    throw Error('simulated review deadline');
  },
} as unknown as ModelClient;
const afterDeadline = await synthesize(
  input,
  plan,
  [result],
  composer,
  deadlineReviewer,
  tools,
  finishingBudget,
  () => {}
);
assert.ok(
  afterDeadline.reply.startsWith('**Ergebnis**'),
  'A completed answer must survive a review deadline.'
);
console.log(
  JSON.stringify({
    mode: 'offline, no model calls or DB mutations',
    fullReadCatalog: 'ok',
    largeResultsRecoverable: 'ok',
    aggregatePermissions: 'ok',
    investigationBeyondFiveRounds: 'ok',
    rawSourcesReachComposer: 'ok',
    reviewOutagePreservesAnswer: 'ok',
  })
);
