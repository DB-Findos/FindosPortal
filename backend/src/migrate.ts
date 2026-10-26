import './config.js';
import { createDatabasePool } from './database/connection.js';
import bcrypt from 'bcryptjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
const url =
  process.env.MIGRATION_DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL;
if (!url) throw Error('Missing database connection');
const direct = new URL(url);
direct.hostname = direct.hostname.replace('-pooler.', '.');
direct.searchParams.set('sslmode', 'verify-full');
const pool = createDatabasePool(direct.toString(), 1);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-migrations'))");
  await client.query(
    'CREATE SCHEMA IF NOT EXISTS portal; CREATE TABLE IF NOT EXISTS portal.schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())'
  );
  const applied = new Set(
    (await client.query('SELECT name FROM portal.schema_migrations')).rows.map((r) => r.name)
  );
  if (!applied.has('001-baseline')) {
    const baseline = (await readFile(path.join(projectRoot, 'backend/schema.sql'), 'utf8'))
      .replace(/^BEGIN;\s*/, '')
      .replace(/COMMIT;\s*$/, '');
    await client.query(baseline);
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('001-baseline')");
  }
  if (!applied.has('002-versioning')) {
    if (!(await client.query('SELECT 1 FROM portal.users LIMIT 1')).rowCount) {
      if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
        throw Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before first migration');
      const c = await client.query(
        "INSERT INTO portal.contacts(first_name,last_name,email) VALUES ('Portal','Administrator',$1) RETURNING id",
        [process.env.ADMIN_EMAIL]
      );
      const u = await client.query(
        'INSERT INTO portal.users(email,password_hash,contact_id) VALUES ($1,$2,$3) RETURNING id',
        [
          process.env.ADMIN_EMAIL.toLowerCase(),
          await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
          c.rows[0].id,
        ]
      );
      const g = await client.query(
        "INSERT INTO portal.user_groups(name) VALUES ('Administrators') RETURNING id"
      );
      await client.query(
        'UPDATE portal.permissions SET can_create=true,can_read=true,can_update=true,can_delete=true WHERE group_id=$1',
        [g.rows[0].id]
      );
      await client.query(
        'INSERT INTO portal.user_group_memberships(user_id,group_id) VALUES ($1,$2)',
        [u.rows[0].id, g.rows[0].id]
      );
    }
    if (!process.argv.includes('--preview')) {
      const backup: Record<string, unknown> = {};
      for (const table of [
        'contacts',
        'users',
        'user_groups',
        'user_group_memberships',
        'entities',
        'permissions',
        'funds',
        'companies',
        'metrics',
        'metric_data',
        'index_rates',
      ])
        backup[table] = (await client.query(`SELECT * FROM portal.${table}`)).rows;
      const folder = path.join(projectRoot, '.imports/backups');
      await mkdir(folder, { recursive: true });
      await writeFile(
        path.join(folder, `pre-versioning-${Date.now()}.json`),
        JSON.stringify(backup)
      );
    }
    await client.query(
      await readFile(path.join(projectRoot, 'backend/migrations/002-versioning.sql'), 'utf8')
    );
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('002-versioning')");
    console.log('Applied 002-versioning: 13 entities, stable identities, immutable history.');
  }
  if (!applied.has('003-metric-data-source-values')) {
    await client.query(
      await readFile(
        path.join(projectRoot, 'backend/migrations/003-metric-data-source-values.sql'),
        'utf8'
      )
    );
    await client.query(
      "INSERT INTO portal.schema_migrations(name) VALUES ('003-metric-data-source-values')"
    );
    console.log(
      'Applied 003-metric-data-source-values: exact decimals, empty values, plan scenario.'
    );
  }
  if (!applied.has('004-advanced-search')) {
    await beginAuditedImport(client);
    await client.query(
      await readFile(path.join(projectRoot, 'backend/migrations/004-advanced-search.sql'), 'utf8')
    );
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('004-advanced-search')");
    console.log(
      'Applied 004-advanced-search: Dimension, MetricData details and versioned search views.'
    );
  }
  if (!applied.has('005-kpi-reporting')) {
    await beginAuditedImport(client);
    await client.query(
      await readFile(path.join(projectRoot, 'backend/migrations/005-kpi-reporting.sql'), 'utf8')
    );
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('005-kpi-reporting')");
    console.log('Applied 005-kpi-reporting: versioned formulas, VariableMap and reports.');
  }
  if (!applied.has('006-kpi-integrity')) {
    await client.query(
      await readFile(path.join(projectRoot, 'backend/migrations/006-kpi-integrity.sql'), 'utf8')
    );
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('006-kpi-integrity')");
    console.log(
      'Applied 006-kpi-integrity: exact formula-version binding and validated variable sources.'
    );
  }
  if (!applied.has('007-deal-data')) {
    await beginAuditedImport(client);
    await client.query(
      await readFile(path.join(projectRoot, 'backend/migrations/007-deal-data.sql'), 'utf8')
    );
    await client.query("INSERT INTO portal.schema_migrations(name) VALUES ('007-deal-data')");
    console.log('Applied 007-deal-data: versioned DealType and DealData entities.');
  }
  if (!applied.has('008-deal-catalog-permissions')) {
    await beginAuditedImport(client);
    await client.query(
      await readFile(
        path.join(projectRoot, 'backend/migrations/008-deal-catalog-permissions.sql'),
        'utf8'
      )
    );
    await client.query(
      "INSERT INTO portal.schema_migrations(name) VALUES ('008-deal-catalog-permissions')"
    );
    console.log(
      'Applied 008-deal-catalog-permissions: Deal entities are visible to administrators.'
    );
  }
  if (!applied.has('009-kpi-variable-filters')) {
    await client.query(
      await readFile(
        path.join(projectRoot, 'backend/migrations/009-kpi-variable-filters.sql'),
        'utf8'
      )
    );
    await client.query(
      "INSERT INTO portal.schema_migrations(name) VALUES ('009-kpi-variable-filters')"
    );
    console.log('Applied 009-kpi-variable-filters: context-aware fixed-variable filters.');
  }
  if (!applied.has('010-kpi-context-fixed-variables')) {
    await client.query(
      await readFile(
        path.join(projectRoot, 'backend/migrations/010-kpi-context-fixed-variables.sql'),
        'utf8'
      )
    );
    await client.query(
      "INSERT INTO portal.schema_migrations(name) VALUES ('010-kpi-context-fixed-variables')"
    );
    console.log('Applied 010-kpi-context-fixed-variables: fixed variables use report context.');
  }
  await client.query(process.argv.includes('--preview') ? 'ROLLBACK' : 'COMMIT');
  console.log(
    process.argv.includes('--preview')
      ? 'Migration preview passed (rolled back).'
      : 'Database migrations completed.'
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
