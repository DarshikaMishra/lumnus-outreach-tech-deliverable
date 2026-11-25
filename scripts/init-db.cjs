require("dotenv").config({ quiet: true });
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const Database = require("better-sqlite3");

const url = process.env.DATABASE_URL ?? "file:./outreach.db";
if (!url.startsWith("file:") || !url.slice(5)) throw new Error("Set DATABASE_URL to a local SQLite file.");
const filename = resolve(decodeURIComponent(url.slice(5)));
const db = new Database(filename);
try {
  const sql = readFileSync(resolve(__dirname, "../prisma/migrations/20261125000000_init/migration.sql"), "utf8");
  db.transaction(() => db.exec(sql))();
  console.log("SQLite schema ready.");
} finally {
  db.close();
}
