import { Pool } from "pg";

/** Shared Postgres pool. Connection string from DATABASE_URL (see .env.example). */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://icemarkets:icemarkets@localhost:5432/icemarkets",
  max: 10,
});

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = unknown>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
