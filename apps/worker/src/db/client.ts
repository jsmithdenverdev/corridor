import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database client setup for Supabase
 *
 * Note: When using Supabase's connection pooler in Transaction mode,
 * we must set `prepare: false` to disable prepared statements.
 */
function createClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const client = postgres(databaseUrl, {
    prepare: false, // Required for Supabase Transaction pooler
    max: 1, // Worker runs serially, single connection is sufficient
    idle_timeout: 20, // Close idle connections after 20 seconds
    connect_timeout: 10, // 10 second connection timeout
  });

  return drizzle(client, { schema });
}

// Lazy initialization - only create connection when needed
let _db: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!_db) {
    _db = createClient();
  }
  return _db;
}

// Alias for convenience
export const db = {
  get instance() {
    return getDb();
  },
};
