import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { jwtSecret, production } from '../config.js';
import {
  entraConfig,
  exchangeEntraCode,
  newEntraFlow,
  resolveEntraUser,
} from '../services/auth/entra.js';
import { establishSession } from '../services/auth/session.js';

export const entraRouter = Router();
const flowCookie = {
  httpOnly: true,
  secure: production,
  sameSite: 'lax' as const,
  path: '/api/auth/entra',
};
entraRouter.get('/config', (_req, res) => {
  try {
    const config = entraConfig();
    res.json({ enabled: Boolean(config), startUrl: config?.startUrl || null });
  } catch {
    res.json({ enabled: false, startUrl: null });
  }
});
entraRouter.use(
  rateLimit({ windowMs: 900000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false })
);
entraRouter.get('/start', (_req, res) => {
  const config = entraConfig();
  if (!config)
    return void res.status(503).json({ error: 'Microsoft Login ist nicht konfiguriert.' });
  const { state, nonce, verifier, challenge } = newEntraFlow();
  const token = jwt.sign({ state, nonce, verifier }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '10m',
    issuer: 'findos-portal',
    audience: 'findos-entra-flow',
  });
  res.cookie('entra_flow', token, { ...flowCookie, maxAge: 600000 });
  const target = new URL(`${config.authority}/oauth2/v2.0/authorize`);
  target.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid profile email',
    prompt: 'select_account',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(target.href);
});
entraRouter.get('/callback', async (req, res) => {
  const config = entraConfig();
  if (!config)
    return void res.status(503).json({ error: 'Microsoft Login ist nicht konfiguriert.' });
  res.clearCookie('entra_flow', flowCookie);
  res.setHeader('Referrer-Policy', 'no-referrer');
  const login = new URL('/login', config.frontendOrigin);
  try {
    const flow = jwt.verify(req.cookies?.entra_flow || '', jwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'findos-portal',
      audience: 'findos-entra-flow',
    });
    const saved = z
      .object({ state: z.string(), nonce: z.string(), verifier: z.string() })
      .parse(flow);
    if (typeof req.query.state !== 'string' || req.query.state !== saved.state)
      throw Error('Entra state mismatch');
    if (req.query.error) {
      login.searchParams.set('microsoft_error', 'cancelled');
      return void res.redirect(login.href);
    }
    const code = z.string().min(1).max(16000).parse(req.query.code);
    const identity = await exchangeEntraCode(config, code, saved.verifier, saved.nonce);
    const userId = await resolveEntraUser(identity);
    establishSession(res, userId);
    res.redirect(new URL('/', config.frontendOrigin).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = (error as { status?: number }).status;
    // Never log authorization codes, tokens, client secrets or provider response bodies.
    console.warn(
      'Microsoft login failed:',
      status === 409
        ? 'email conflict'
        : status === 403
          ? 'account disabled'
          : 'authentication or registration failed'
    );
    login.searchParams.set(
      'microsoft_error',
      message === 'email_conflict' ? 'email_conflict' : status === 403 ? 'disabled' : 'failed'
    );
    res.redirect(login.href);
  }
});
