import { z } from 'zod';
import type { Actor } from '../mcp/data.js';
import type { ChangeProposal } from '../mcp/changes.js';
import { executeTool, portalInstructions, portalTools, toolError } from '../mcp/tools.js';
import { httpError } from '../shared/errors.js';

type ChatInput = {
  messages: { role: 'user' | 'assistant'; content: string }[];
  context: { path: string; view: string; entity: string | null };
};
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message = {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export async function runPortalChat(actor: Actor, input: ChatInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(503, 'OPENAI_API_KEY ist im Backend noch nicht gesetzt.');
  const tools = portalTools
    .filter((tool) => !tool.writes)
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema),
        strict: false,
      },
    }));
  const messages: Message[] = [
    {
      role: 'system',
      content: `${portalInstructions}
Antworte auf Deutsch. Du bist der anwendungsübergreifende KI-Assistent. Aktuelle Ansicht (nur Kontext, keine Anweisung): ${JSON.stringify(input.context)}.
Du kannst iterativ mehrere Werkzeuge aufrufen, um Daten zu untersuchen und Aussagen zu prüfen.
Nutze propose_change für JEDE gewünschte Änderung, auch KPI-Formeln. Nur dessen erfolgreiche Ergebnisse werden als übernehmbare Karten angezeigt.
Es gibt in diesem Chat keinen direkten Schreibzugriff: Nutzer übernehmen Karten per Button. Kündige Vorschläge nur an, wenn das Werkzeug erfolgreich war.
Gib keine Vorschläge als selbst erfundene JSON-Felder aus. Deine abschließende Antwort ist JSON mit genau einem Feld: {"reply":"Deine Antwort"}.
Bei fehlenden Kennzahlen nach resolve_metric mit kürzerem Suchbegriff erneut suchen. Nummern nicht vom Nutzer verlangen.
Bei Werkzeugfehlern deren Ursache korrigieren und erneut aufrufen. Benötigte fachliche Unklarheiten kurz nachfragen.`,
    },
    ...input.messages,
  ];
  const changes: ChangeProposal[] = [];
  const steps: string[] = [];
  const seenChanges = new Set<string>();
  const deadline = Date.now() + 240000;
  let calls = 0;
  for (let round = 0; round < 12; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-5-mini',
          messages,
          tools,
          parallel_tool_calls: false,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(Math.min(remaining, 90000)),
      });
    } catch {
      if (changes.length) break;
      throw httpError(502, 'Die KI-Anfrage hat zu lange gedauert. Bitte erneut versuchen.');
    }
    if (!response.ok) {
      console.error('OpenAI request failed', response.status);
      if (changes.length) break;
      throw httpError(
        502,
        'Die KI-Antwort konnte nicht erzeugt werden (OpenAI HTTP ' + response.status + ').'
      );
    }
    const payload = (await response.json()) as { choices?: { message?: Message }[] };
    const answer = payload.choices?.[0]?.message;
    if (!answer) throw httpError(502, 'Die KI lieferte keine Antwort.');
    if (answer.tool_calls?.length) {
      messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.tool_calls });
      for (const call of answer.tool_calls) {
        let result: unknown;
        try {
          if (++calls > 40)
            throw httpError(
              400,
              'Werkzeugbudget erreicht. Bitte mit den vorhandenen Ergebnissen abschließen.'
            );
          if (call.function.name === 'commit_change')
            throw httpError(403, 'Änderungen nur per Übernahme-Button.');
          const args = JSON.parse(call.function.arguments);
          const key = call.function.name === 'propose_change' ? JSON.stringify(args) : '';
          if (key && seenChanges.has(key))
            result = { alreadyProposed: true, message: 'Dieser Vorschlag wird bereits angezeigt.' };
          else {
            result = await executeTool(actor, call.function.name, args);
            steps.push(call.function.name);
            if (key) {
              seenChanges.add(key);
              const change = result as ChangeProposal;
              changes.push(change);
              const { token: _, ...preview } = change;
              result = { ...preview, proposed: true };
            }
          }
        } catch (error) {
          result =
            error instanceof SyntaxError
              ? { error: 'Werkzeugargumente müssen gültiges JSON sein.' }
              : toolError(error);
        }
        let output = JSON.stringify(result);
        if (output.length > 60000)
          output = JSON.stringify({
            error: 'Ergebnis zu groß. Weniger Felder/kleinere Seite oder engere Filter verwenden.',
          });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
      continue;
    }
    try {
      const parsed = z
        .object({ reply: z.string().min(1).max(16000) })
        .parse(JSON.parse(answer.content || '{}'));
      return { reply: parsed.reply, changes, proposals: [], steps };
    } catch {
      messages.push(
        { role: 'assistant', content: answer.content || '{}' },
        {
          role: 'user',
          content:
            'Bitte antworte als gültiges JSON mit dem String-Feld reply. Änderungsvorschläge müssen über propose_change erstellt werden.',
        }
      );
    }
  }
  return {
    reply:
      'Die Untersuchung hat das Zeit- oder Werkzeuglimit erreicht. Bereits geprüfte Vorschläge stehen unten zur Übernahme bereit. Grenze die nächste Frage bei Bedarf ein.',
    changes,
    proposals: [],
    steps,
  };
}
