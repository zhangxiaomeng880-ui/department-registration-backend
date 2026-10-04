import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const parseDatabaseUrl = value => {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
};

const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || null;
const config = databaseUrl
  ? parseDatabaseUrl(databaseUrl)
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };

for (const [key, value] of Object.entries(config)) {
  if (value == null || value === '') {
    throw new Error(`Missing database configuration: ${key}`);
  }
}

const migrationsDir = path.resolve('migrations');
const files = (await fs.readdir(migrationsDir))
  .filter(name => name.endsWith('.sql'))
  .sort();

if (!files.length) throw new Error('No SQL migrations found');

const connection = await mysql.createConnection({
  ...config,
  multipleStatements: true,
  timezone: 'Z',
  charset: 'utf8mb4',
});

try {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  for (const filename of files) {
    const [rows] = await connection.execute(
      'SELECT filename FROM schema_migrations WHERE filename = ? LIMIT 1',
      [filename]
    );
    if (rows.length) {
      console.log(`SKIP ${filename}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    console.log(`APPLY ${filename}`);
    await connection.query(sql);
    await connection.execute(
      'INSERT INTO schema_migrations (filename) VALUES (?)',
      [filename]
    );
  }

  const [required] = await connection.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN (
        'projects','runs','tasks','checkpoints','stage_snapshots',
        'route_executions','tool_executions','gate_results','qa_evidence',
        'audit_logs','knowledge_contexts','knowledge_sources',
        'knowledge_documents','knowledge_sync_runs','knowledge_retrievals',
        'knowledge_retrieval_items'
      )
  `);

  if (required.length !== 16) {
    throw new Error(`Migration verification failed: expected 16 required tables, found ${required.length}`);
  }

  console.log('RAILWAY_MIGRATIONS_PASS');
} finally {
  await connection.end();
}
