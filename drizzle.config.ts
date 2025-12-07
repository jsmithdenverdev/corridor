import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './apps/worker/src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Supabase-specific: use their role management
  entities: {
    roles: {
      provider: 'supabase',
    },
  },
  verbose: true,
  strict: true,
});
