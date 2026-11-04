import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db.js';
import { portfolioRouter } from '../routes/portfolio.js';
import { dataRouter } from '../routes/data.js';
import { definitions } from '../entities.js';

const companyId = '00000000-0000-4000-8000-000000000001';
const contactId = '00000000-0000-4000-8000-000000000002';
const handler = portfolioRouter.stack.find(
  (layer: any) => layer.route?.path === '/companies/:companyId/details'
)!.route!.stack[0].handle;

test('company details enforce read rights before fetching optional contact and fund data', async () => {
  for (const grants of [
    [],
    ['companies'],
    ['companies', 'company_contacts'],
    ['companies', 'contacts'],
    ['companies', 'contacts', 'company_contacts', 'funds'],
  ]) {
    const queries: string[] = [];
    let result: any;
    mock.method(pool, 'query', async () => ({
      rows: grants.map((name) => ({ name, can_read: true })),
    }));
    mock.method(pool, 'connect', async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM portal.companies'))
          return { rows: [{ objectId: companyId, fund_id: contactId, name: 'Test Company' }] };
        if (sql.includes('FROM portal.funds')) return { rows: [{ name: 'Test Fund' }] };
        if (sql.includes('FROM portal.company_contacts'))
          return { rows: [{ assignment: { role: 'CFO' }, contact: { first_name: 'Test' } }] };
        return { rows: [] };
      },
      release() {},
    }));
    try {
      const invoke = () =>
        handler(
          { userId: contactId, params: { companyId } } as any,
          {
            json: (value: unknown) => {
              result = value;
            },
          } as any,
          () => {}
        );
      if (!grants.includes('companies')) {
        await assert.rejects(async () => invoke(), { status: 403 });
        assert.equal(queries.length, 0);
      } else {
        await invoke();
        const mayReadContacts = grants.includes('contacts') && grants.includes('company_contacts');
        assert.equal(result.contacts !== null, mayReadContacts);
        assert.equal(
          queries.some((sql) => sql.includes('FROM portal.company_contacts')),
          mayReadContacts
        );
        assert.equal(result.fund !== null, grants.includes('funds'));
        assert.equal(result.company.objectId, companyId);
      }
    } finally {
      mock.restoreAll();
    }
  }
});

test('generic API rejects unauthorized assignment writes for each operation', async () => {
  const guard = dataRouter.stack.filter(
    (layer: any) => !layer.route && layer.handle.constructor.name === 'AsyncFunction'
  )[1]!.handle;
  mock.method(pool, 'query', async () => ({
    rows: [
      {
        name: 'company_contacts',
        can_read: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      },
    ],
  }));
  try {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      await assert.rejects(
        async () =>
          guard(
            { userId: contactId, params: { entity: 'company_contacts' }, method } as any,
            {} as any,
            () => assert.fail('Write guard bypassed')
          ),
        { status: 403 }
      );
    }
  } finally {
    mock.restoreAll();
  }
});

test('assignment validation rejects missing roles, invalid identities and unknown categories', () => {
  const valid = {
    company_id: companyId,
    contact_id: contactId,
    category: 'findos',
    role: 'Investment Manager',
  };
  assert.equal(definitions.company_contacts.schema.safeParse(valid).success, true);
  for (const patch of [{ role: ' ' }, { contact_id: 'invalid' }, { category: 'other' }]) {
    assert.equal(
      definitions.company_contacts.schema.safeParse({ ...valid, ...patch }).success,
      false
    );
  }
  assert.equal(
    definitions.companies.schema.partial().safeParse({ postal_code: '01234', email: 'invalid' })
      .success,
    false
  );
  assert.equal(
    definitions.companies.schema.partial().parse({ postal_code: '01234' }).postal_code,
    '01234'
  );
});
