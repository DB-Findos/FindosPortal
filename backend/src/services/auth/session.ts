import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret, production } from '../../config.js';

export const sessionCookie = {
  httpOnly: true,
  secure: production,
  sameSite: 'strict' as const,
  path: '/',
};

export function establishSession(res: Response, userId: string) {
  const token = jwt.sign({}, jwtSecret(), {
    subject: userId,
    expiresIn: '8h',
    algorithm: 'HS256',
    issuer: 'findos-portal',
    audience: 'findos-web',
  });
  res.cookie('session', token, { ...sessionCookie, maxAge: 28800000 });
}
