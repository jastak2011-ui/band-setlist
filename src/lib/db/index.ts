import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { bootstrapSchema } from "./bootstrap";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "setlist.db");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;
  ensureDataDir();
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  bootstrapSchema(_sqlite);
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getSqlite(): Database.Database {
  getDb();
  if (!_sqlite) throw new Error("SQLite not initialized");
  return _sqlite;
}

export { schema };
