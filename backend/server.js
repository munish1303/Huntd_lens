import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import profileRouter from './routes/profile.js';
import aiAnalyseRouter from './routes/aiAnalyse.js';
import { logger } from './utils/logger.js';

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/health', healthRouter);
app.use('/api/profile', profileRouter);
app.use('/api/ai-analyse', aiAnalyseRouter);

app.use((err, _req, res, _next) => {
  logger.error('Unhandled backend error', {
    message: err.message,
    stack: err.stack
  });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  logger.info(`Huntd Lens backend running on port ${port}`);
});
