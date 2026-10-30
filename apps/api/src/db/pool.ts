import pg from "pg";
import pgvector from "pgvector/pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

// Vectors are written with `vec()` and read back as `embedding::real[]`, so no type registration needed.

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** pgvector literal for a number[] (null-safe). */
export const vec = (v: number[] | null | undefined) => (v ? pgvector.toSql(v) : null);
