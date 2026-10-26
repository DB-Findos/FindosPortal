// Offline protocol check: no OpenAI requests or database changes.
import assert from 'node:assert/strict';
import { runPortalChat } from '../services/ai-chat.js';
import { validateChatModel } from '../services/chat-models.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'offline-test';
try {
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    validateChatModel(model, 'max');
    let rounds = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, model);
      assert.equal(body.reasoning.effort, 'max');
      assert.equal(body.store, false);
      assert(body.tools.every((tool: { name?: string }) => tool.name));
      if (++rounds === 1) return Response.json({ status: 'completed', output: [
        { type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'opaque' },
        { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'commit_change', arguments: '{}' },
      ] });
      assert(body.input.some((item: { encrypted_content?: string }) => item.encrypted_content === 'opaque'));
      const output = body.input.find((item: { type: string }) => item.type === 'function_call_output');
      assert.equal(output.call_id, 'call_test');
      assert.match(output.output, /Übernahme-Button/);
      return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"reply":"OK"}' }] }] });
    };
    const result = await runPortalChat({ userId: 'offline', rights: {}, canCommit: false }, {
      model, reasoning_effort: 'max', messages: [{ role: 'user', content: 'Hallo' }],
      context: { path: '/', view: 'Main', entity: null },
    });
    assert.equal(result.reply, 'OK');
    assert.equal(rounds, 2);
    assert.equal(result.changes.length, 0);
  }
  assert.throws(() => validateChatModel('gpt-6-astra', 'none'));
  assert.throws(() => validateChatModel('gpt-6.1-sol', 'none'));
  console.log('PASS: 7 models, Responses tool roundtrip, reasoning continuity, commit guard.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
}
