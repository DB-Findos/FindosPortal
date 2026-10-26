import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { databaseFieldErrors, validationFieldErrors } from '../shared/validation.js';
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (
    [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EAI_AGAIN',
      '57P01',
      '57P03',
      '53300',
    ].includes(error.code) ||
    /connection.*(timeout|terminated)|timeout.*connection/i.test(error.message || '')
  ) {
    console.error('Database unavailable:', error.code || error.message);
    return void res.status(503).json({
      error:
        'Die Datenbank ist vorübergehend nicht erreichbar. Bitte kurz warten und erneut versuchen.',
    });
  }
  if (error instanceof ZodError)
    return void res.status(400).json({
      error: 'Ungültige Eingabe.',
      details: error.issues,
      fieldErrors: validationFieldErrors(error),
    });
  if (error.code === '23505')
    return void res.status(409).json({
      error: 'Dieser Datensatz existiert bereits.',
      fieldErrors: databaseFieldErrors(
        error,
        req.originalUrl || '',
        'Dieser Wert bzw. diese Kombination wird bereits verwendet.'
      ),
    });
  if (['23503', '23001'].includes(error.code))
    return void res.status(409).json({
      error: 'Referenz fehlt oder wird noch verwendet.',
      fieldErrors: databaseFieldErrors(
        error,
        req.originalUrl || '',
        'Bitte einen gültigen Eintrag auswählen.'
      ),
    });
  if (['23514', '22001', '22003'].includes(error.code))
    return void res.status(400).json({
      error: 'Ungültige Daten oder Datenbankregel verletzt.',
      fieldErrors: databaseFieldErrors(
        error,
        req.originalUrl || '',
        'Bitte einen gültigen Wert eingeben.'
      ),
    });
  if (error.code === '40P01')
    return void res.status(409).json({ error: 'Gleichzeitige Änderung. Bitte erneut versuchen.' });
  if (error.status && error.status < 500)
    return void res.status(error.status).json({
      error: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    });
  console.error(error.message);
  res.status(500).json({ error: 'Interner Serverfehler.' });
};
