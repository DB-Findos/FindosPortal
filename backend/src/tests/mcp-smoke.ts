// Small read-only smoke check. No database changes, no OpenAI requests.
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { app } from '../app.js';
import { pool } from '../db.js';
import { jwtSecret } from '../config.js';
import { z } from 'zod';
import { portalTools } from '../mcp/tools.js';

const server = app.listen(0, '127.0.0.1');
const client = new Client({ name: 'findos-smoke', version: '1.0.0' });
try {
  if (!server.listening)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const unauthenticated = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthenticated.status, 401);
  const blockedOrigin = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.invalid' },
    body: '{}',
  });
  assert.equal(blockedOrigin.status, 403);
  console.log('PASS: MCP requires bearer authentication and rejects untrusted origins');
  const user = (
    await pool.query(
      'SELECT "objectId" FROM portal.users WHERE lower(email)=lower($1) AND active=true AND "archivedAt" IS NULL',
      [process.env.ADMIN_EMAIL]
    )
  ).rows[0];
  assert(user, 'ADMIN_EMAIL must identify an existing active user for this read-only smoke test.');
  const token = jwt.sign({ scopes: ['read'] }, jwtSecret(), {
    algorithm: 'HS256',
    issuer: 'findos-portal',
    audience: 'findos-mcp',
    subject: user.objectId,
    expiresIn: 120,
  });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  const { tools } = await client.listTools();
  assert(tools.some((tool) => tool.name === 'resolve_metric'));
  assert(!tools.some((tool) => tool.name === 'commit_change'));
  for (const tool of portalTools) assert.equal(z.toJSONSchema(tool.schema).type, 'object');
  console.log(
    `PASS: MCP initialize + tools/list (${tools.length} tools, write tool hidden for read token)`
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    const content = result.content as { type: string; text?: string }[];
    return JSON.parse(content.find((part) => part.type === 'text')!.text!);
  };
  const entities = await call('list_entities', {});
  assert(entities.some((entity: { entity: string }) => entity.entity === 'deal_data'));
  const schema = await call('describe_entity', { entity: 'metric_data' });
  assert(
    schema.databaseColumns.some((column: { column_name: string }) => column.column_name === 'value')
  );
  const metrics = await call('resolve_metric', { name: 'Net Debt (Broad Definition)' });
  assert(metrics.matches.length > 0, 'Known metric must resolve by name');
  const number = metrics.matches[0].metric_number;
  const proposal = await call('propose_change', {
    change: {
      kind: 'formula',
      formula: {
        name: 'Read-only MCP smoke preview',
        description: 'Not saved',
        unit: 'EUR',
        decimals: 2,
        TextEditor: 'A',
        variables: [
          {
            identifier: 'A',
            entity: 'metric_data',
            field: 'value',
            aggregation: 'MONTH',
            metric_number: number,
          },
        ],
      },
    },
  });
  assert.equal(proposal.operation, 'create');
  assert(proposal.preview.TextDisplay.includes('Net Debt'));
  console.log(
    `PASS: Neon schema + metric-name lookup + validated KPI preview (${entities.length} entities); no writes`
  );
  const denied = await client.callTool({
    name: 'commit_change',
    arguments: { token: proposal.token },
  });
  assert(denied.isError);
  console.log('PASS: read-only MCP cannot commit');
} finally {
  await client.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await pool.end();
}
