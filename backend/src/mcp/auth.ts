import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { jwtSecret } from '../config.js';
import { pool } from '../db.js';
import { httpError } from '../shared/errors.js';

declare global {
  namespace Express {
    interface Request {
      mcpWrite?: boolean;
    }
  }
}
export const authenticateMcp: RequestHandler = async (req, res, next) => {
  try {
    const token = req.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw httpError(401, 'MCP Bearer Token erforderlich.');
    const payload = jwt.verify(token, jwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'findos-portal',
      audience: 'findos-mcp',
    });
    if (typeof payload === 'string' || !payload.exp) throw httpError(401, 'Ungültiges MCP Token.');
    const id = z.uuid().parse(payload.sub);
    if (!Array.isArray(payload.scopes) || !payload.scopes.includes('read'))
      throw httpError(401, 'Leseberechtigung fehlt.');
    if (
      !(
        await pool.query(
          'SELECT 1 FROM portal.users WHERE "objectId"=$1 AND active=true AND "archivedAt" IS NULL',
          [id]
        )
      ).rowCount
    )
      throw httpError(401, 'MCP Nutzer nicht aktiv.');
    req.userId = id;
    req.mcpWrite = payload.scopes.includes('write');
    next();
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof z.ZodError ||
      (error as { status?: number }).status === 401
    ) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="findos-mcp"');
      return void res
        .status(401)
        .json({ error: 'MCP Token fehlt, ist abgelaufen oder der Nutzer ist deaktiviert.' });
    }
    next(error);
  }
};
