import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config.js';
import { pool } from '../db.js';
import { httpError } from '../shared/errors.js';
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const payload = jwt.verify(req.cookies?.session || '', jwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'findos-portal',
      audience: 'findos-web',
    });
    if (typeof payload === 'string' || !payload.sub) throw httpError(401, 'Bitte anmelden.');
    const result = await pool.query(
      'SELECT 1 FROM portal.users WHERE "objectId"=$1 AND active=true AND "archivedAt" IS NULL',
      [payload.sub]
    );
    if (!result.rowCount) throw httpError(401, 'Bitte anmelden.');
    req.userId = payload.sub;
    next();
  } catch (error) {
    next(error instanceof jwt.JsonWebTokenError ? httpError(401, 'Bitte anmelden.') : error);
  }
};
export async function permissions(userId: string) {
  const result = await pool.query(
    `SELECT e.name,bool_or(p.can_create) AS can_create,bool_or(p.can_read) AS can_read,bool_or(p.can_update) AS can_update,bool_or(p.can_delete) AS can_delete
 FROM portal.permissions p JOIN portal.entities e ON e."objectId"=p.entity_id AND e."archivedAt" IS NULL
 JOIN portal.user_group_memberships m ON m.group_id=p.group_id AND m."archivedAt" IS NULL
 JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL
 WHERE m.user_id=$1 AND p."archivedAt" IS NULL GROUP BY e.name`,
    [userId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.name, row]));
}
export async function requirePermission(userId: string, entity: string, action: string) {
  if (!(await permissions(userId))[entity]?.['can_' + action])
    throw httpError(403, 'Keine Berechtigung.');
}
