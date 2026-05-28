import express, { type NextFunction, type Request, type Response } from 'express';
import { timelineRouter } from './routes/timeline.js';
import { childrenRouter } from './routes/children.js';
import { iterationsRouter } from './routes/iterations.js';
import { graphRouter } from './routes/graph.js';

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(timelineRouter);
app.use(childrenRouter);
app.use(iterationsRouter);
app.use(graphRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`event-graph API listening on :${port}`);
});
