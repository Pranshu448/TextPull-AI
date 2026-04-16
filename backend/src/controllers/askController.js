import { answerRequest } from '../services/aiService.js';

export async function handleAsk(req, res, next) {
  try {
    const result = await answerRequest(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
