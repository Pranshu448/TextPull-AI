import rateLimit from 'express-rate-limit';

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests right now. Please try again in a minute.'
  }
});
