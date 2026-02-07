import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './backend/trpc/app-router';
import { createContext } from './backend/trpc/create-context';
import { join } from 'path';
import { db, employees, uploadedPhotos } from './backend/db';
import { sql, eq } from 'drizzle-orm';
import { startNotificationScheduler } from './backend/services/notification-scheduler.service';

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

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_PHOTOS_PER_REQUEST = 10;

app.post('/api/photos/upload', async (c) => {
  try {
    const body = await c.req.json();
    const { photos, uploadedBy, entityType, entityId } = body;

    if (!uploadedBy) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const [uploader] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, uploadedBy));
    if (!uploader) {
      return c.json({ error: 'Invalid user' }, 401);
    }

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return c.json({ error: 'No photos provided' }, 400);
    }

    if (photos.length > MAX_PHOTOS_PER_REQUEST) {
      return c.json({ error: `Maximum ${MAX_PHOTOS_PER_REQUEST} photos per upload` }, 400);
    }

    const results = [];
    for (const photo of photos) {
      if (!photo.base64 || !photo.mimeType) {
        continue;
      }

      if (!ALLOWED_MIME_TYPES.includes(photo.mimeType)) {
        continue;
      }

      const fileSize = Math.ceil(photo.base64.length * 0.75);
      if (fileSize > MAX_PHOTO_SIZE) {
        continue;
      }

      const [inserted] = await db.insert(uploadedPhotos).values({
        fileName: photo.fileName || `photo_${Date.now()}.jpg`,
        mimeType: photo.mimeType,
        fileSize,
        data: photo.base64,
        uploadedBy: uploadedBy,
        entityType: entityType || null,
        entityId: entityId || null,
        latitude: photo.latitude || null,
        longitude: photo.longitude || null,
      }).returning({ id: uploadedPhotos.id });

      results.push({
        id: inserted.id,
        url: `/api/photos/${inserted.id}`,
        latitude: photo.latitude,
        longitude: photo.longitude,
      });
    }

    return c.json({ photos: results });
  } catch (error: any) {
    console.error('Photo upload error:', error);
    return c.json({ error: 'Failed to upload photos' }, 500);
  }
});

app.get('/api/photos/:id', async (c) => {
  try {
    const photoId = c.req.param('id');

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(photoId)) {
      return c.json({ error: 'Invalid photo ID' }, 400);
    }

    const [photo] = await db.select({
      data: uploadedPhotos.data,
      mimeType: uploadedPhotos.mimeType,
      fileName: uploadedPhotos.fileName,
    }).from(uploadedPhotos).where(eq(uploadedPhotos.id, photoId));

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const binaryData = Buffer.from(photo.data, 'base64');
    return new Response(binaryData, {
      headers: {
        'Content-Type': photo.mimeType,
        'Content-Disposition': `inline; filename="${photo.fileName}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Photo serve error:', error);
    return c.json({ error: 'Failed to load photo' }, 500);
  }
});

app.use(
  '/api/trpc/*',
  trpcServer({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      console.error(`tRPC error on path '${path}':`, error.message);
      if (error.cause) {
        console.error('Error cause:', error.cause);
      }
    },
  }),
);

const port = 5000;
console.log(`Starting BSNL Sales & Event App on port ${port}...`);
console.log('Database connection initialized');

Bun.serve({
  port,
  hostname: '0.0.0.0',
  idleTimeout: 255,  // ← Added this line (255 seconds = 4+ minutes)
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

// Start notification scheduler (checks SLA and deadlines every 15 minutes)
startNotificationScheduler(15);

// Debug: Check outstanding dues data at startup
(async () => {
  try {
    const ftthResult = await db.execute(sql`
      SELECT COUNT(*) as count, COALESCE(SUM(CAST(outstanding_ftth AS NUMERIC)), 0) as total
      FROM employees
      WHERE outstanding_ftth IS NOT NULL AND CAST(outstanding_ftth AS NUMERIC) > 0
    `);
    const lcResult = await db.execute(sql`
      SELECT COUNT(*) as count, COALESCE(SUM(CAST(outstanding_lc AS NUMERIC)), 0) as total
      FROM employees
      WHERE outstanding_lc IS NOT NULL AND CAST(outstanding_lc AS NUMERIC) > 0
    `);
    console.log("=== OUTSTANDING DUES DATA CHECK ===");
    console.log("FTTH Outstanding:", ftthResult);
    console.log("LC Outstanding:", lcResult);
    
    // Also check management role users
    const mgmtResult = await db.execute(sql`
      SELECT role, COUNT(*) as count FROM employees 
      WHERE role IN ('GM', 'CGM', 'DGM', 'AGM')
      GROUP BY role
    `);
    console.log("Management users:", mgmtResult);
  } catch (error) {
    console.error("Debug query error:", error);
  }
})();
