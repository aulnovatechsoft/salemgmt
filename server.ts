import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './backend/trpc/app-router';
import { createContext } from './backend/trpc/create-context';
import { join } from 'path';

const distDir = join(import.meta.dir, 'dist');

const app = new Hono();

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    return origin;
  },
  credentials: true,
}));

app.get('/api', (c) => {
  return c.json({ status: 'ok', message: 'BSNL Event & Sales API v1.0.5' });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', version: '1.0.5', timestamp: new Date().toISOString() });
});

app.use(
  '/api/trpc/*',
  trpcServer({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      console.error(`tRPC error on path '${path}':`, error.message);
    },
  }),
);

const port = 5000;
console.log(`Starting BSNL Sales & Event App on port ${port}...`);
console.log('Database connection initialized');

Bun.serve({
  port,
  hostname: 'localhost',
  async fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/health')) {
      return app.fetch(req);
    }
    
    let filePath = url.pathname;
    if (filePath === '/') {
      filePath = '/index.html';
    }
    
    const fullPath = join(distDir, filePath);
    const file = Bun.file(fullPath);
    
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
    }
    
    const indexFile = Bun.file(join(distDir, 'index.html'));
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
        },
      });
    }
    
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Server running at http://0.0.0.0:${port}`);
