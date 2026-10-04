import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';

const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

assert.ok(config.host && config.user && config.password && config.database);

const migrate = spawnSync(
  process.execPath,
  ['scripts/migrate-runtime.mjs'],
  { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' }
);
if (migrate.status !== 0) {
  process.stderr.write(migrate.stdout || '');
  process.stderr.write(migrate.stderr || '');
}
assert.equal(migrate.status, 0);
assert.match(migrate.stdout, /RUNTIME_MIGRATIONS_PASS/);

const db = await mysql.createConnection({ ...config, multipleStatements: true });

const legacyTenantId = '00000000-0000-4000-8000-000000000101';
const legacyWorkspaceId = '00000000-0000-4000-8000-000000000102';

const legacyProjectId = randomUUID();
await db.execute(
  `INSERT INTO projects (
    id, project_key, name, project_type, status,
    current_workflow_version, current_knowledge_commit_sha
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [legacyProjectId, 'v21-rollback-project', 'V2.1 Rollback Project', 'SOFTWARE', 'ACTIVE', null, null]
);
const [[legacyProject]] = await db.execute(
  'SELECT tenant_id, workspace_id FROM projects WHERE id=?',
  [legacyProjectId]
);
assert.equal(legacyProject.tenant_id, legacyTenantId);
assert.equal(legacyProject.workspace_id, legacyWorkspaceId);

const rollbackRunId = randomUUID();
await db.execute(
  `INSERT INTO runs (
    id, correlation_id, project_id, parent_run_id, run_type, status, trigger_source,
    input_json, runtime_commit_sha, knowledge_commit_sha,
    workflow_version, router_version, rag_index_version, started_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
  [rollbackRunId, randomUUID(), legacyProjectId, null, 'WORKFLOW', 'RUNNING', 'USER', null, null, null, null, null, null]
);
const [[rollbackRun]] = await db.execute(
  'SELECT tenant_id, workspace_id FROM runs WHERE id=?',
  [rollbackRunId]
);
assert.equal(rollbackRun.tenant_id, legacyTenantId);
assert.equal(rollbackRun.workspace_id, legacyWorkspaceId);

const toolId = randomUUID();
await db.execute(
  'INSERT INTO tool_executions (id,run_id,tool_type,tool_key,status) VALUES (?,?,?,?,?)',
  [toolId, rollbackRunId, 'TEST', 'rollback-tool', 'PASS']
);

const usageId = randomUUID();
await db.execute(
  'INSERT INTO usage_ledger (id,project_id,run_id,tool_execution_id,status) VALUES (?,?,?,?,?)',
  [usageId, legacyProjectId, rollbackRunId, toolId, 'PASS']
);
const [[rollbackUsage]] = await db.execute(
  'SELECT tenant_id, workspace_id FROM usage_ledger WHERE id=?',
  [usageId]
);
assert.equal(rollbackUsage.tenant_id, legacyTenantId);
assert.equal(rollbackUsage.workspace_id, legacyWorkspaceId);

await db.end();

console.log('G22_V21_ROLLBACK_COMPATIBILITY_PASS');
