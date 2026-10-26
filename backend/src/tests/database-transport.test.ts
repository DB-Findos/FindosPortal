import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { Pool as NeonPool, types as neonTypes } from '@neondatabase/serverless';
import type { Request, Response } from 'express';
import { createDatabasePool } from '../database/connection.js';
import { errorHandler } from '../middleware/errors.js';

test('Neon defaults to the secure-WebSocket pool; other Postgres hosts keep TCP', async () => {
  const previous = process.env.DB_TRANSPORT;
  delete process.env.DB_TRANSPORT;
  try {
    const neon = createDatabasePool('postgresql://test:test@example.neon.tech/test');
    const postgres = createDatabasePool('postgresql://test:test@localhost/test');
    assert.ok(neon instanceof NeonPool);
    assert.ok(postgres instanceof pg.Pool);
    await neon.end();
    await postgres.end();
    process.env.DB_TRANSPORT = 'tcp';
    const explicit = createDatabasePool('postgresql://test:test@example.neon.tech/test');
    assert.ok(explicit instanceof pg.Pool);
    await explicit.end();
    process.env.DB_TRANSPORT = 'invalid';
    assert.throws(
      () => createDatabasePool('postgresql://test:test@localhost/test'),
      /DB_TRANSPORT/
    );
  } finally {
    if (previous === undefined) delete process.env.DB_TRANSPORT;
    else process.env.DB_TRANSPORT = previous;
  }
});

test('Both transports preserve date-only values', () => {
  for (const types of [pg.types, neonTypes])
    assert.equal(types.getTypeParser(1082)('2026-10-19'), '2026-10-19');
});

test('Database network failures return a useful 503 response without exposing connection details', (context) => {
  context.mock.method(console, 'error', () => {});
  for (const error of [
    Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' }),
    new Error('Connection terminated due to connection timeout'),
  ]) {
    let status = 0;
    let body: any;
    const response = {
      status(code: number) {
        status = code;
        return response;
      },
      json(data: unknown) {
        body = data;
        return response;
      },
    };
    errorHandler(error, {} as Request, response as Response, () => {});
    assert.equal(status, 503);
    assert.match(body.error, /Datenbank/);
    assert.ok(!body.error.includes('postgresql://'));
  }
});
