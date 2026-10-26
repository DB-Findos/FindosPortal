import pg from 'pg';
import { Pool as NeonPool, neonConfig, types as neonTypes } from '@neondatabase/serverless';

export interface DatabaseResult<Row extends Record<string, any> = any> {
  rows: Row[];
  rowCount: number | null;
}
export interface DatabaseClient {
  query<Row extends Record<string, any> = any>(
    text: string,
    values?: any[]
  ): Promise<DatabaseResult<Row>>;
  release(): void;
}
export interface DatabasePool {
  query<Row extends Record<string, any> = any>(
    text: string,
    values?: any[]
  ): Promise<DatabaseResult<Row>>;
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

pg.types.setTypeParser(1082, (value) => value);
neonTypes.setTypeParser(1082, (value) => value);
neonConfig.webSocketConstructor = WebSocket;
neonConfig.useSecureWebSocket = true;

export function createDatabasePool(connectionString: string, max = 10): DatabasePool {
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  const transport =
    process.env.DB_TRANSPORT || (url.hostname.endsWith('.neon.tech') ? 'websocket' : 'tcp');
  const options = { connectionString: url.toString(), max, connectionTimeoutMillis: 15000 };
  if (transport === 'websocket') return new NeonPool(options);
  if (transport === 'tcp') return new pg.Pool(options);
  throw new Error('DB_TRANSPORT must be websocket or tcp');
}
