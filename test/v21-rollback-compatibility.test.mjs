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
assert.equal(legacyProject.tenant_id, '00000000-0000-4000-8000-000000000101');
assert.equal(legacyProject.workspace_id, '00000000-0000-4000-8000-000000000102');

const tenantId = randomUUID();
const workspaceId = randomUUID();
const scopedProjectId = randomUUID();
await db.execute(
  'INSERT INTO tenants (id,tenant_key,name,status) VALUES (?,?,?,?)',
  [tenantId, 'rollback-tenant', 'Rollback Tenant', 'ACTIVE']
);
await db.execute(
  'INSERT INTO workspaces (id,tenant_id,workspace_key,name,status) VALUES (?,?,?,?,?)',
  [workspaceId, tenantId, 'rollback-workspace', 'Rollback Workspace', 'ACTIVE']
);
await db.execute(
  'INSERT INTO projects (id,tenant_id,workspace_id,project_key,name,project_type,status) VALUES (?,?,?,?,?,?,?)',
  [scopedProjectId, tenantId, workspaceId, 'rollback-scoped-project', 'Rollback Scoped Project', 'SOFTWARE', 'ACTIVE']
);

const rollbackRunId = randomUUID();
await db.execute(
  `INSERT INTO runs (
    id, correlation_id, project_id, parent_run_id, run_type, status, trigger_source,
    input_json, runtime_commit_sha, knowledge_commit_sha,
    workflow_version, router_version, rag_index_version, started_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
  [rollbackRunId, randomUUID(), scopedProjectId, null, 'WORKFLOW', 'RUNNING', 'USER', null, null, null, null, null, null]
);
const [[rollbackRun]] = await db.execute(
  'SELECT tenant_id, workspace_id FROM runs WHERE id=?',
  [rollbackRunId]
);
assert.equal(rollbackRun.tenant_id, tenantId);
assert.equal(rollbackRun.workspace_id, workspaceId);

const toolId = randomUUID();
await db.execute(
  'INSERT INTO tool_executions (id,run_id,tool_type,tool_key,status) VALUES (?,?,?,?,?)',
  [toolId, rollbackRunId, 'TEST', 'rollback-tool', 'PASS']
);

const usageId = randomUUID();
await db.execute(
  'INSERT INTO usage_ledger (id,project_id,run_id,tool_execution_id,status) VALUES (?,?,?,?,?)',
  [usageId, scopedProjectId, rollbackRunId, toolId, 'PASS']
);
const [[rollbackUsage]] = await db.execute(
  'SELECT tenant_id, workspace_id FROM usage_ledger WHERE id=?',
  [usageId]
);
assert.equal(rollbackUsage.tenant_id, tenantId);
assert.equal(rollbackUsage.workspace_id, workspaceId);

await db.end();

console.log('G22_V21_ROLLBACK_COMPATIBILITY_PASS');
