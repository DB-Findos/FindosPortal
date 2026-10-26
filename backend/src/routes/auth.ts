import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { production, jwtSecret } from '../config.js';
import { pool } from '../db.js';
import { authenticate, permissions } from '../middleware/auth.js';
export const authRouter = Router();
const cookie = { httpOnly: true, secure: production, sameSite: 'strict' as const, path: '/' };
authRouter.post(
  '/login',
  rateLimit({ windowMs: 900000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }),
  async (req, res) => {
    const { email, password } = z
      .object({ email: z.email(), password: z.string().min(1).max(72) })
      .parse(req.body);
    const user = (
      await pool.query(
        'SELECT "objectId",password_hash,active FROM portal.users WHERE email=$1 AND "archivedAt" IS NULL',
        [email.toLowerCase()]
      )
    ).rows[0];
    const valid = await bcrypt.compare(
      password,
      user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW'
    );
    if (!user?.active || !valid)
      return void res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });
    const token = jwt.sign({}, jwtSecret(), {
      subject: user.objectId,
      expiresIn: '8h',
      algorithm: 'HS256',
      issuer: 'findos-portal',
      audience: 'findos-web',
    });
    res.cookie('session', token, { ...cookie, maxAge: 28800000 }).json({ ok: true });
  }
);
authRouter.post('/logout', (_req, res) => res.clearCookie('session', cookie).json({ ok: true }));
authRouter.get('/me', authenticate, async (req, res) => {
  const user = (
    await pool.query(
      'SELECT u."objectId" AS id,u.email,c.first_name,c.last_name FROM portal.users u JOIN portal.contacts c ON c."objectId"=u.contact_id AND c."archivedAt" IS NULL WHERE u."objectId"=$1 AND u."archivedAt" IS NULL',
      [req.userId]
    )
  ).rows[0];
  res.json({ ...user, permissions: await permissions(req.userId!) });
});
