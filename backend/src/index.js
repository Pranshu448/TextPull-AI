import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import { askRouter } from './routes/askRoutes.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(cors({
  origin(origin, callback) {
    const isChromeExtension = typeof origin === 'string' && origin.startsWith('chrome-extension://');

    if (
      !origin ||
      isChromeExtension ||
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin)
    ) {
      callback(null, true);
      return;
    }

    const error = new Error(`Origin not allowed: ${origin}`);
    error.status = 403;
    callback(error);
  }
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'textpull-backend' });
});

app.use('/ask', apiRateLimiter, askRouter);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  logger.info({ port }, 'TextPull backend listening');
});
