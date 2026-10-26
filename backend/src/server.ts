import { app } from './app.js';
import { pool } from './db.js';
import { jwtSecret } from './config.js';
jwtSecret();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, (error?: Error) => {
  if (error) {
    console.error('API startup failed:', error.message);
    process.exitCode = 1;
    void pool.end();
    return;
  }
  console.log(`Findos API + MCP: http://${host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    })
  );
