import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const globalDb = globalThis as typeof globalThis & { outreachDb?: PrismaClient };
export const db = globalDb.outreachDb ?? new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./outreach.db" }),
});
if (process.env.NODE_ENV !== "production") globalDb.outreachDb = db;
