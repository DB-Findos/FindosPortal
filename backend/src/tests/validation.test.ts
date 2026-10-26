import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { errorHandler } from '../middleware/errors.js';
import { fieldError } from '../shared/errors.js';

function respond(error: unknown, url = '/api/data/users') {
  let status = 0;
  let body: any;
  const response = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
    },
  };
  errorHandler(error, { originalUrl: url } as any, response as any, () => {});
  return { status, body };
}
test('validation returns each invalid field, including nested fields', () => {
  const result = z
    .object({
      email: z.email(),
      colors: z.object({ primary: z.string().regex(/^#[a-f0-9]{6}$/i) }),
    })
    .safeParse({ email: 'invalid', colors: { primary: 'red' } });
  assert.equal(result.success, false);
  if (result.success) return;
  const { status, body } = respond(result.error);
  assert.equal(status, 400);
  assert.deepEqual(Object.keys(body.fieldErrors), ['email', 'colors.primary']);
  assert.match(body.fieldErrors.email, /E-Mail/);
});
test('duplicate errors identify the input without exposing database values', () => {
  const { status, body } = respond({
    code: '23505',
    detail: 'Key (email)=(private@example.com) already exists.',
  });
  assert.equal(status, 409);
  assert.deepEqual(Object.keys(body.fieldErrors), ['email']);
  assert.equal(JSON.stringify(body).includes('private@example.com'), false);
});
test('internal columns are never exposed as editable field errors', () => {
  assert.deepEqual(
    respond({ code: '23505', detail: 'Key (id)=(secret) already exists.' }).body.fieldErrors,
    {}
  );
});
test('invalid references retain the exact field', () => {
  const { status, body } = respond(
    fieldError(409, 'fund_id', 'Bitte einen anderen Fund auswählen.'),
    '/api/data/companies'
  );
  assert.equal(status, 409);
  assert.deepEqual(Object.keys(body.fieldErrors), ['fund_id']);
});
