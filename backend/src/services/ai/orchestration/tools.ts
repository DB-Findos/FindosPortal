import { z } from 'zod';
import type { Actor } from '../../../mcp/data.js';
import type { ChangeProposal } from '../../../mcp/changes.js';
import { portalTools, executeTool, toolError } from '../../../mcp/tools.js';
import { getDataModel, inspectDataModel } from '../../../mcp/research.js';
import { evidencePreview } from './evidence.js';
import { toolActivity, toolOutcome } from '../../chat-progress.js';
import { textViewContext } from '../../chat-context.js';
import { RunBudget, BudgetEnded, RunCancelled } from './budget.js';
import type { ChatInput, Emit, Evidence, FunctionTool, Task } from './types.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'undefined';
}
const readResultSchema = z
  .object({
    source_id: z.number().int().min(0),
    path: z.array(z.string().max(100)).max(12).default([]),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
const resultReader = {
  type: 'function' as const,
  name: 'read_tool_result',
  description:
    'Read a complete previously retrieved source by source_id. path selects nested object keys or array indices (e.g. ["rows"] or ["bridge","effects"]). Arrays/strings paginate with offset/limit; no additional database query. Use when a source preview was truncated, not repeated database calls.',
  parameters: z.toJSONSchema(readResultSchema),
  strict: false as const,
};
export class ToolSession {
  readonly changes: ChangeProposal[] = [];
  readonly documentIds: string[] = [];
  readonly steps: string[] = [];
  readonly evidence: Evidence[];
  private cache = new Map<string, Evidence>();
  private failures = new Map<string, number>();
  private proposals = new Map<string, Evidence>();
  private modelSnapshot?: ReturnType<typeof getDataModel>;
  constructor(
    private actor: Actor,
    input: ChatInput,
    private budget: RunBudget,
    private emit: Emit
  ) {
    const data = textViewContext(input.context);
    this.evidence = [
      { id: 0, tool: 'visible_view', arguments: {}, data, output: JSON.stringify(data) },
    ];
  }
  catalog() {
    return portalTools
      .filter((tool) => !tool.writes || (tool.chatFile && this.actor.conversationId))
      .map((tool) => ({ name: tool.name, description: tool.description }))
      .concat([{ name: resultReader.name, description: resultReader.description }]);
  }
  dataModel() {
    return this.modelSnapshot || getDataModel(this.actor);
  }
  async prepareDataModel() {
    this.modelSnapshot = await inspectDataModel(this.actor);
  }
  readDefinitions() {
    return portalTools
      .filter(
        (tool) => !tool.writes && !['propose_change', 'propose_custom_report'].includes(tool.name)
      )
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema),
      }))
      .concat([
        {
          name: resultReader.name,
          description: resultReader.description,
          parameters: resultReader.parameters,
        },
      ]);
  }
  definitions(task: Task, intent: string): FunctionTool[] {
    // The planner recommends tools but cannot fence off part of the accessible data model.
    void task;
    return portalTools
      .filter(
        (tool) =>
          !tool.writes &&
          (!['propose_change', 'propose_custom_report'].includes(tool.name) || intent === 'change')
      )
      .concat(
        intent === 'document' && this.actor.conversationId
          ? portalTools.filter((tool) => tool.name === 'create_document')
          : []
      )
      .map((tool) => ({
        type: 'function' as const,
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema),
        strict: false as const,
      }))
      .concat([resultReader]);
  }
  reviewData(ids?: number[]) {
    const sources = ids?.length
      ? this.evidence.filter((source) => source.id === 0 || ids.includes(source.id))
      : this.evidence;
    const allowance = Math.max(2000, Math.floor(140000 / Math.max(1, sources.length)));
    return sources.map(({ output, ...source }) => ({
      ...source,
      data: evidencePreview(source.data, allowance),
    }));
  }
  private readResult(raw: unknown) {
    const input = readResultSchema.parse(raw),
      source = this.evidence[input.source_id];
    if (!source)
      throw Error(
        'Diese source_id existiert nicht. Vorhandene Quellen: ' +
          this.evidence.map((item) => item.id).join(', ')
      );
    let value: unknown = source.data;
    for (const key of input.path) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
        throw Error('Pfad nicht vorhanden: ' + input.path.join('.'));
      value = (value as Record<string, unknown>)[key];
    }
    const total = Array.isArray(value) || typeof value === 'string' ? value.length : null;
    const end =
      typeof value === 'string' ? input.offset + input.limit * 1000 : input.offset + input.limit;
    const data =
      Array.isArray(value) || typeof value === 'string' ? value.slice(input.offset, end) : value;
    this.budget.usage.cacheHits++;
    return {
      evidence: source,
      fresh: false,
      output: JSON.stringify({
        source_id: source.id,
        path: input.path,
        data: evidencePreview(data),
        total,
        nextOffset: total !== null && end < total ? end : null,
      }),
    };
  }
  async execute(name: string, raw: string, task: Task, allowed: FunctionTool[]) {
    this.budget.assertActive();
    const detail = { taskId: task.id, taskTitle: task.title };
    let args: unknown;
    let result: unknown;
    let key = '';
    const source =
      name === resultReader.name
        ? { schema: readResultSchema, writes: false }
        : portalTools.find((tool) => tool.name === name);
    try {
      if (!allowed.some((tool) => tool.name === name) || !source)
        throw Error('Dieses Werkzeug gehört nicht zum erlaubten Teilauftrag.');
      const unparsed = JSON.parse(raw);
      if (name === 'get_company_report' && typeof unparsed?.date === 'string')
        unparsed.date = unparsed.date.slice(0, 7);
      args = source.schema.parse(unparsed);
      if (name === resultReader.name) return this.readResult(args);
      if (
        name === 'get_company_report' &&
        args &&
        typeof args === 'object' &&
        'date' in args &&
        typeof args.date === 'string'
      )
        args.date = args.date.slice(0, 7);
      key = name + ':' + canonical(args);
      const cached = this.cache.get(key) || this.proposals.get(key);
      if (cached) {
        this.budget.usage.cacheHits++;
        this.emit({
          stage: 'tool',
          summary: toolActivity(name) + ': vorhandenes Ergebnis wiederverwendet.',
          status: 'info',
          ...detail,
          details: [`Quelle ${cached.id}; die Datenbank wurde nicht erneut abgefragt.`],
        });
        return {
          evidence: cached,
          fresh: false,
          output: JSON.stringify({
            source_id: cached.id,
            reused: true,
            data: JSON.parse(cached.output),
          }),
        };
      }
      this.budget.tool();
      if ((this.failures.get(key) || 0) >= 2)
        throw Error(
          'Dieser Aufruf ist bereits zweimal fehlgeschlagen. Parameter oder Datenquelle müssen korrigiert werden.'
        );
      const params = args as Record<string, any>;
      const descriptions =
        name === 'query_entities'
          ? [
              'Entity: ' + params.definition.entity,
              'Felder: ' +
                params.definition.fields
                  .map((field: { alias: string; field: string }) => `${field.alias}.${field.field}`)
                  .join(', '),
              ...(params.definition.filters || []).map(
                (filter: { field: string; op: string; value: unknown }) =>
                  `${filter.field} ${filter.op} ${String(filter.value ?? '').slice(0, 160)}`
              ),
            ]
          : ['entity', 'name', 'date', 'dimension', 'currency', 'aggregation', 'report', 'context']
              .filter((field) => params[field] !== undefined)
              .map(
                (field) =>
                  `${field}: ${typeof params[field] === 'object' ? JSON.stringify(params[field]) : String(params[field])}`
              );
      this.emit({
        stage: 'tool',
        summary: toolActivity(name) + ' …',
        status: 'running',
        ...detail,
        details: descriptions.map((item) => item.slice(0, 800)),
      });
      result = await executeTool(this.actor, name, args);
      if (name === 'propose_change' || name === 'propose_custom_report') {
        const change = result as ChangeProposal;
        const index = this.changes.push(change) - 1;
        const { token: _, ...preview } = change;
        result = { ...preview, proposed: true, proposal_index: index };
      }
      if (name === 'create_document')
        this.documentIds.push((result as { objectId: string }).objectId);
      this.steps.push(name);
    } catch (error) {
      if (error instanceof BudgetEnded || error instanceof RunCancelled) throw error;
      if (key) this.failures.set(key, (this.failures.get(key) || 0) + 1);
      result =
        error instanceof SyntaxError
          ? { error: 'Die Werkzeugargumente sind kein gültiges JSON.' }
          : source
            ? toolError(error)
            : { error: 'Unbekanntes Werkzeug.' };
    }
    const output = JSON.stringify(evidencePreview(result, 65000)) || '{}';
    const evidence: Evidence = {
      id: this.evidence.length,
      tool: name,
      arguments: args ?? raw,
      data: result,
      output,
    };
    this.evidence.push(evidence);
    if (key && !(result as { error?: unknown } | null)?.error && output.length <= 70000) {
      if (name === 'propose_change' || name === 'propose_custom_report')
        this.proposals.set(key, evidence);
      else if (!source?.writes) this.cache.set(key, evidence);
    }
    const error = (result as { error?: unknown } | null)?.error;
    this.emit({
      stage: 'tool',
      summary: toolOutcome(name, JSON.parse(output)),
      status: error ? 'failed' : 'info',
      ...detail,
      ...(error ? { reason: String(error).slice(0, 500) } : {}),
    });
    return {
      evidence,
      fresh: true,
      output: JSON.stringify({ source_id: evidence.id, data: JSON.parse(output) }),
    };
  }
}
