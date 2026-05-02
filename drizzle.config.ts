import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './backend/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: (process.env.BSNL_DATABASE_URL || process.env.DATABASE_URL)!,
  },
});
