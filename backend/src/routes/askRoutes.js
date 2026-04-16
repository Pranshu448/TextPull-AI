import { Router } from 'express';
import { handleAsk } from '../controllers/askController.js';

export const askRouter = Router();

askRouter.post('/', handleAsk);
