import { logger } from '../utils/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  logger.error({ err: error.message, status }, 'Request failed');
  const exposeMessage = process.env.NODE_ENV !== 'production' || status < 500;
  res.status(status).json({
    error: exposeMessage ? error.message : 'Internal server error.'
  });
}
