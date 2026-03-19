import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/server/db/schema";

export type AppDatabase = NeonHttpDatabase<typeof schema>;

declare global {
  var __traxlyDb: Promise<AppDatabase> | undefined;
  var __traxlyDbKey: string | undefined;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set before the server starts.");
  }

  return databaseUrl;
}

async function createTestDatabase(databaseUrl: string) {
  const dataDir = databaseUrl === "pglite://memory" ? undefined : databaseUrl.replace(/^pglite:\/\//, "");
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dataDir);
  const database = drizzle(client, { schema });

  await migrate(database, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });

  return database as unknown as AppDatabase;
}

async function createDatabase(databaseUrl: string) {
  if (databaseUrl.startsWith("pglite://")) {
    return createTestDatabase(databaseUrl);
  }

  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}

export async function getDb() {
  const databaseUrl = getDatabaseUrl();

  if (!globalThis.__traxlyDb || globalThis.__traxlyDbKey !== databaseUrl) {
    globalThis.__traxlyDbKey = databaseUrl;
    globalThis.__traxlyDb = createDatabase(databaseUrl);
  }

  return globalThis.__traxlyDb;
}
