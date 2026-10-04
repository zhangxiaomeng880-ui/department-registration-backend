import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { runV22ProductionPreflight } from '../scripts/preflight-v22-production.mjs';

const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

assert.ok(config.host && config.user && config.password && config.database);

const baseMigrations = [
  '001_runtime_persistence.sql',
  '002_knowledge_contexts.sql',
  '002_knowledge_source_adapter.sql',
  '003_knowledge_retrieval_provenance.sql',
  '004_runtime_observability.sql',
  '005_policy_router_v2.sql',
  '006_cost_ledger.sql',
];

const db = await mysql.createConnection({
  ...config,
  multipleStatements: true,
  charset: 'utf8mb4',
  timezone: 'Z',
});

await db.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    file_name VARCHAR(255) PRIMARY KEY,
    content_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`);

for (const fileName of baseMigrations) {
  const sql = await fs.readFile(path.resolve('migrations', fileName), 'utf8');
  await db.query(sql);
  const hash = createHash('sha256').update(sql).digest('hex');
  await db.execute(
    'INSERT INTO schema_migrations (file_name, content_sha256) VALUES (?, ?)',
    [fileName, hash]
  );
}

const projectId = randomUUID();
const runId = randomUUID();
const providerKey = 'preflight-provider';
const modelKey = 'preflight-model';

await db.execute(
  'INSERT INTO projects (id,project_key,name,project_type) VALUES (?,?,?,?)',
  [projectId, 'preflight-project', 'Preflight Project', 'SOFTWARE']
);
await db.execute(
  'INSERT INTO runs (id,project_id,status,trigger_source) VALUES (?,?,?,?)',
  [runId, projectId, 'PASS', 'CI']
);
await db.execute(
  'INSERT INTO provider_registry (provider_key,provider_type,display_name,adapter_key) VALUES (?,?,?,?)',
  [providerKey, 'TEST', 'Preflight Provider', 'preflight-adapter']
);
await db.execute(
  'INSERT INTO model_registry (provider_key,model_key,display_name) VALUES (?,?,?)',
  [providerKey, modelKey, 'Preflight Model']
);
await db.execute(
  `INSERT INTO pricing_versions
    (id,provider_key,model_key,currency,input_rate_per_million,output_rate_per_million,effective_from,source_label)
   VALUES (?,?,?,?,?,?,?,?)`,
  [randomUUID(), providerKey, modelKey, 'USD', 1, 5, '2026-01-01T00:00:00.000Z', 'PREFLIGHT_TEST']
);

await db.end();

const before = await runV22ProductionPreflight({ config });
assert.equal(before.status, 'PASS');
assert.deepEqual(before.appliedV22Migrations, []);
assert.equal(before.pendingV22Migrations.length, 5);
assert.equal(before.rowCounts.projects, 1);
assert.equal(before.rowCounts.runs, 1);
assert.equal(before.rowCounts.pricing_versions, 1);

const partialDb = await mysql.createConnection({ ...config, multipleStatements: true });
await partialDb.query(`
  CREATE TABLE tenants (
    id CHAR(36) PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`);
await partialDb.end();

let partialFailed = false;
try {
  await runV22ProductionPreflight({ config });
} catch (error) {
  partialFailed = true;
  assert.equal(error.code, 'PREFLIGHT_M008_PARTIAL_TABLE');
}
assert.equal(partialFailed, true);

const cleanupDb = await mysql.createConnection(config);
await cleanupDb.query('DROP TABLE tenants');
await cleanupDb.end();

const migration = spawnSync(
  process.execPath,
  ['scripts/migrate-runtime.mjs'],
  {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
  }
);
if (migration.status !== 0) {
  process.stderr.write(migration.stdout || '');
  process.stderr.write(migration.stderr || '');
}
assert.equal(migration.status, 0);
assert.match(migration.stdout, /RUNTIME_MIGRATIONS_PASS/);

const after = await runV22ProductionPreflight({ config });
assert.equal(after.status, 'PASS');
assert.equal(after.appliedV22Migrations.length, 5);
assert.deepEqual(after.pendingV22Migrations, []);

console.log('G22_PRODUCTION_PREFLIGHT_PASS');
