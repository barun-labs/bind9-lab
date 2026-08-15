import { buildApp } from './app';
import { openDb } from './db';

const dbPath = process.env.BIND9_DB ?? 'bind9.db';
const port = Number(process.env.PORT ?? 8080);
const host = '0.0.0.0';

const db = openDb(dbPath);
const app = buildApp(db);

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
