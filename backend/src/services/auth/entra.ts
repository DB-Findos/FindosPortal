import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { production } from '../../config.js';
import { createRecord, transaction } from '../../repositories/entities.js';
import { httpError } from '../../shared/errors.js';

export function entraConfig() {
  const tenantId = process.env.ENTRA_TENANT_ID?.trim();
  const clientId = process.env.ENTRA_CLIENT_ID?.trim();
  const clientSecret = process.env.ENTRA_CLIENT_SECRET || process.env.ENTRA_VALUE;
  const redirectUri = process.env.ENTRA_REDIRECT_URI?.trim();
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  z.uuid().parse(tenantId);
  z.uuid().parse(clientId);
  const redirect = new URL(redirectUri);
  if (
    redirect.pathname !== '/api/auth/entra/callback' ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (production
      ? redirect.protocol !== 'https:'
      : !['http:', 'https:'].includes(redirect.protocol)) ||
    (!production && !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))
  )
    throw Error('Invalid ENTRA_REDIRECT_URI');
  const frontend = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:5173');
  if (production && frontend.origin !== redirect.origin)
    throw Error('ENTRA_REDIRECT_URI must use the APP_ORIGIN origin in production');
  // Cookies are host scoped: localhost callbacks must return to a localhost frontend too.
  if (!production) frontend.hostname = redirect.hostname;
  return {
    tenantId: tenantId.toLowerCase(),
    clientId,
    clientSecret,
    redirectUri,
    startUrl: new URL('/api/auth/entra/start', redirect).href,
    frontendOrigin: frontend.origin,
    authority: `https://login.microsoftonline.com/${tenantId.toLowerCase()}`,
  };
}

export function newEntraFlow() {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  return {
    state,
    nonce,
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function exchangeEntraCode(
  config: NonNullable<ReturnType<typeof entraConfig>>,
  code: string,
  verifier: string,
  nonce: string
) {
  const response = await fetch(`${config.authority}/oauth2/v2.0/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });
  const result = (await response.json()) as { id_token?: string; error?: string };
  if (!response.ok || !result.id_token) throw Error('Entra token exchange failed');
  let jwks = keys.get(config.tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.authority}/discovery/v2.0/keys`), {
      timeoutDuration: 10000,
    });
    keys.set(config.tenantId, jwks);
  }
  const { payload } = await jwtVerify(result.id_token, jwks, {
    issuer: `${config.authority}/v2.0`,
    audience: config.clientId,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'oid', 'tid'],
    clockTolerance: 5,
  });
  if (payload.nonce !== nonce || payload.tid !== config.tenantId)
    throw Error('Entra identity context mismatch');
  const objectId = z.uuid().parse(payload.oid).toLowerCase();
  const email = z
    .email()
    .parse(payload.email || payload.preferred_username)
    .toLowerCase();
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 500) : email;
  return { tenantId: config.tenantId, objectId, email, name };
}

export async function resolveEntraUser(identity: Awaited<ReturnType<typeof exchangeEntraCode>>) {
  const userId = randomUUID();
  // Every new object's audit actor is the authenticated Entra user being registered.
  // Deferred audit references resolve once the user is inserted in this transaction.
  return transaction(userId, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('portal-entra-registration'))");
    const existing = (
      await db.query(
        `SELECT "objectId",active FROM portal.users
       WHERE entra_tenant_id=$1 AND entra_object_id=$2 AND "archivedAt" IS NULL`,
        [identity.tenantId, identity.objectId]
      )
    ).rows[0];
    if (existing) {
      if (!existing.active) throw httpError(403, 'Dieses Benutzerkonto ist deaktiviert.');
      return existing.objectId as string;
    }
    const collision = await db.query(
      'SELECT 1 FROM portal.users WHERE lower(email)=$1 AND "archivedAt" IS NULL',
      [identity.email]
    );
    if (collision.rowCount) throw httpError(409, 'email_conflict');
    const group = (
      await db.query(
        `SELECT "objectId" FROM portal.user_groups WHERE name='Inactive' AND "archivedAt" IS NULL`
      )
    ).rows[0];
    if (!group) throw Error('Inactive group missing; run database migrations');
    const names = identity.name.split(/\s+/);
    const contact = await createRecord(db, 'contacts', {
      first_name: names.shift() || identity.email,
      last_name: names.join(' ') || '—',
      email: identity.email,
    });
    const user = await createRecord(db, 'users', {
      objectId: userId,
      email: identity.email,
      contact_id: contact.objectId,
      active: true,
      password_hash: await bcrypt.hash(randomBytes(48).toString('base64url'), 12),
      entra_tenant_id: identity.tenantId,
      entra_object_id: identity.objectId,
    });
    await createRecord(db, 'user_group_memberships', {
      user_id: user.objectId,
      group_id: group.objectId,
    });
    return user.objectId as string;
  });
}
