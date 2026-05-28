import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { timelineRouter } from './routes/timeline.js';
import { childrenRouter } from './routes/children.js';
import { iterationsRouter } from './routes/iterations.js';
import { graphRouter } from './routes/graph.js';
import { workflowsRouter } from './routes/workflows.js';
import { orgsRouter } from './routes/orgs.js';

const app = express();

app.get('/api/v1/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(orgsRouter);
app.use(workflowsRouter);
app.use(timelineRouter);
app.use(childrenRouter);
app.use(iterationsRouter);
app.use(graphRouter);

// Serve the built SPA when it exists. In dev the user hits the Vite server
// directly on :5173 (which proxies /api/* back here), so this is a no-op.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`event-graph API listening on :${port}`);
});
