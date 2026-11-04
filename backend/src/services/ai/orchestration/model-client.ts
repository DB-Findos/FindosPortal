import { z } from 'zod';
import { httpError } from '../../../shared/errors.js';
import { RunBudget, RunCancelled } from './budget.js';
import type { ModelOptions } from './types.js';
import { evidencePreview } from './evidence.js';

export type ModelMessage = Record<string, unknown>;
type OutputItem = Record<string, unknown> & {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: { type: string; text?: string }[];
};
export class ModelSession {
  constructor(
    private client: ModelClient,
    readonly input: ModelMessage[]
  ) {}
  async next(options: ModelOptions) {
    const outputs = this.input.filter(
      (item) => item.type === 'function_call_output' && typeof item.output === 'string'
    );
    if (outputs.reduce((size, item) => size + String(item.output).length, 0) > 160000) {
      for (const item of outputs.slice(0, -2)) {
        try {
          const parsed = JSON.parse(String(item.output));
          item.output = JSON.stringify({
            source_id: parsed.source_id,
            data: evidencePreview(parsed.data ?? parsed, 3000),
            context_compacted: true,
            hint: 'Die vollständigen Daten bleiben mit read_tool_result abrufbar.',
          });
        } catch {}
      }
    }
    const response = await this.client.request(this.input, options);
    // Preserve opaque reasoning/function-call items for the next tool turn; never publish them.
    this.input.push(...response.output);
    return response;
  }
}

export class ModelClient {
  constructor(
    private apiKey: string,
    readonly model: string,
    private effort: string | null,
    private budget: RunBudget
  ) {}
  session(input: ModelMessage[]) {
    return new ModelSession(this, input);
  }
  summaryClient() {
    return new ModelClient(this.apiKey, this.model, this.effort ? 'low' : null, this.budget);
  }
  async structured<T>(
    system: string,
    data: unknown,
    options: ModelOptions,
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await this.request(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: options.images?.length
            ? [
                { type: 'input_text', text: JSON.stringify(data) },
                ...options.images.flatMap((image) => [
                  { type: 'input_text', text: 'Aktuell sichtbares Diagramm: ' + image.title },
                  { type: 'input_image', image_url: image.url, detail: 'auto' },
                ]),
              ]
            : JSON.stringify(data),
        },
      ],
      options
    );
    if (response.calls.length)
      throw httpError(502, 'Ein Prüfschritt lieferte einen unerwarteten Werkzeugaufruf.');
    try {
      return schema.parse(JSON.parse(response.text));
    } catch {
      throw httpError(
        502,
        `Der Modellschritt „${options.name}“ lieferte kein gültiges strukturiertes Ergebnis.`
      );
    }
  }
  async request(input: ModelMessage[], options: ModelOptions) {
    this.budget.model();
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.min(180000, this.budget.deadline - Date.now()))
    );
    const signal = this.budget.signal ? AbortSignal.any([timeout, this.budget.signal]) : timeout;
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input,
          store: false,
          ...(this.effort ? { reasoning: { effort: this.effort } } : {}),
          text: {
            format: {
              type: 'json_schema',
              name: options.name,
              strict: true,
              schema: z.toJSONSchema(options.schema),
            },
          },
          max_output_tokens: Math.max(
            options.outputTokens || 5000,
            this.effort === 'max'
              ? 24000
              : this.effort === 'xhigh'
                ? 20000
                : this.effort === 'high'
                  ? 16000
                  : this.effort === 'medium'
                    ? 10000
                    : 6000
          ),
          ...(options.tools?.length
            ? {
                tools: options.tools,
                parallel_tool_calls: !options.tools.some((tool) =>
                  ['propose_change', 'propose_custom_report', 'create_document'].includes(tool.name)
                ),
                tool_choice: options.requireTool ? 'required' : 'auto',
                include: ['reasoning.encrypted_content'],
              }
            : {}),
        }),
      });
    } catch {
      if (this.budget.signal?.aborted)
        throw new RunCancelled('Bearbeitung vom Nutzer abgebrochen.');
      throw httpError(
        504,
        `Der Modellschritt „${options.name}“ konnte innerhalb seines Zeitrahmens nicht abgeschlossen werden.`
      );
    }
    if (!response.ok) {
      console.warn('Chat model phase failed', {
        phase: options.name,
        model: this.model,
        status: response.status,
      });
      throw httpError(
        response.status === 429 ? 503 : 502,
        `Der Modellschritt „${options.name}“ ist technisch fehlgeschlagen (OpenAI HTTP ${response.status}).`
      );
    }
    let payload: {
      status: string;
      output?: OutputItem[];
      incomplete_details?: { reason?: string };
    };
    try {
      payload = await response.json();
    } catch {
      this.budget.assertActive();
      throw httpError(502, `Der Modellschritt „${options.name}“ lieferte keine lesbare Antwort.`);
    }
    if (this.budget.signal?.aborted) throw new RunCancelled('Bearbeitung vom Nutzer abgebrochen.');
    if (payload.status !== 'completed' || !payload.output?.length)
      throw httpError(
        502,
        `Der Modellschritt „${options.name}“ wurde nicht vollständig abgeschlossen${payload.incomplete_details?.reason === 'max_output_tokens' ? ' (Ausgabelimit)' : ''}.`
      );
    return {
      output: payload.output,
      text: payload.output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content || [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text || '')
        .join(''),
      calls: payload.output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({ id: item.call_id!, name: item.name!, arguments: item.arguments! })),
    };
  }
}
