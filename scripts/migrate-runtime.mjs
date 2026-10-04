import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { importPricingCatalog } from './import-pricing-catalog.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

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
  : process.env.DB_HOST
    ? {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
    : {
        host: process.env.MYSQLHOST,
        port: Number(process.env.MYSQLPORT || 3306),
        user: process.env.MYSQLUSER,
        password: process.env.MYSQLPASSWORD,
        database: process.env.MYSQLDATABASE,
      };

if (!config.host || !config.user || !config.password || !config.database) {
  console.error('RUNTIME_MIGRATIONS_FAIL database configuration is incomplete');
  process.exit(2);
}

const migrationsDir = path.resolve('migrations');
const files = (await fs.readdir(migrationsDir))
  .filter(name => name.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('RUNTIME_MIGRATIONS_FAIL no migration files found');
  process.exit(3);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const connectWithRetry = async () => {
  const maxAttempts = Number(process.env.DB_MIGRATION_CONNECT_ATTEMPTS || 30);
  const delayMs = Number(process.env.DB_MIGRATION_CONNECT_DELAY_MS || 2000);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const connection = await mysql.createConnection({
        ...config,
        multipleStatements: true,
        charset: 'utf8mb4',
        timezone: 'Z',
        connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
      });
      if (attempt > 1) {
        console.log(`DATABASE_CONNECT_RECOVERED attempt=${attempt}`);
      }
      return connection;
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','PROTOCOL_CONNECTION_LOST'].includes(error.code);
      if (!retryable || attempt === maxAttempts) throw error;
      console.log(`DATABASE_CONNECT_RETRY attempt=${attempt} code=${error.code}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
};

const db = await connectWithRetry();

let applied = 0;
let skipped = 0;

try {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      file_name VARCHAR(255) PRIMARY KEY,
      content_sha256 CHAR(64) NOT NULL,
      applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  for (const fileName of files) {
    const fullPath = path.join(migrationsDir, fileName);
    const sql = await fs.readFile(fullPath, 'utf8');
    const hash = sha256(sql);

    const [rows] = await db.execute(
      'SELECT content_sha256 FROM schema_migrations WHERE file_name = ?',
      [fileName]
    );

    if (rows.length) {
      if (rows[0].content_sha256 !== hash) {
        const error = new Error(`Applied migration changed: ${fileName}`);
        error.code = 'MIGRATION_HASH_MISMATCH';
        throw error;
      }
      console.log(`Skipping already applied migration: ${fileName}`);
      skipped += 1;
      continue;
    }

    console.log(`Applying migration: ${fileName}`);
    await db.query(sql);
    await db.execute(
      'INSERT INTO schema_migrations (file_name, content_sha256) VALUES (?, ?)',
      [fileName, hash]
    );
    applied += 1;
  }

  const pricingImport = await importPricingCatalog({ db });
  if (pricingImport.targetCount === 0) {
    console.log(`PRICING_CATALOG_SKIP model_not_registered=${pricingImport.modelKey}`);
  }
  console.log(`PRICING_CATALOG_IMPORT_PASS model=${pricingImport.modelKey} targets=${pricingImport.targetCount} inserted=${pricingImport.inserted} skipped=${pricingImport.skipped}`);
  console.log(`RUNTIME_MIGRATIONS_PASS applied=${applied} skipped=${skipped} total=${files.length}`);
} catch (error) {
  console.error(`RUNTIME_MIGRATIONS_FAIL ${error.code || 'MIGRATION_ERROR'}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
