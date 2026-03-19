import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/server/db/schema";

const dataDirectory = path.join(process.cwd(), "data");
const dbPath = path.join(dataDirectory, "trax.db");

declare global {
  var __traxDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
  var __traxSqlite: InstanceType<typeof Database> | undefined;
}

function ensureDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!globalThis.__traxSqlite) {
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    globalThis.__traxSqlite = sqlite;
  }

  if (!globalThis.__traxDb) {
    globalThis.__traxDb = drizzle(globalThis.__traxSqlite, { schema });
    migrate(globalThis.__traxDb, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  }

  return globalThis.__traxDb;
}

export const db = ensureDatabase();
