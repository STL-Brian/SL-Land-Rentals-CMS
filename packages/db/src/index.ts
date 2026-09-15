import pg from "pg";
const { Pool } = pg;
let singleton: pg.Pool | undefined;
export function pool(): pg.Pool { if (!singleton) singleton = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 2_000, query_timeout: 2_000 }); return singleton; }
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> { return pool().query<T>(text, values); }
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> { const client = await pool().connect(); try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
export async function closePool(): Promise<void> { if (singleton) { await singleton.end(); singleton = undefined; } }
export async function ready(): Promise<boolean> { try { await query("SELECT 1"); return true; } catch { return false; } }
