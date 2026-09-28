import { Pool, type PoolClient } from 'pg';
import { getServerSetting, getServerNumber } from '@/lib/api/server-config';

const globalDb = globalThis as unknown as { tarotPool?: Pool; tarotDatabaseUrl?: string };

export function database(): Pool {
  const connectionString = getServerSetting('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL 未配置');
  const options = {
    connectionString,
    max: getServerNumber('DATABASE_POOL_MAX'),
    connectionTimeoutMillis: getServerNumber('DATABASE_CONNECT_TIMEOUT_MS'),
    idleTimeoutMillis: getServerNumber('DATABASE_IDLE_TIMEOUT_MS'),
  };
  const signature = JSON.stringify(options);
  if (!globalDb.tarotPool || globalDb.tarotDatabaseUrl !== signature) {
    if (globalDb.tarotPool) void globalDb.tarotPool.end().catch(() => {});
    globalDb.tarotPool = new Pool(options);
    globalDb.tarotPool.on('error', () => console.error('[database] 数据库连接中断'));
    globalDb.tarotDatabaseUrl = signature;
  }
  return globalDb.tarotPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
