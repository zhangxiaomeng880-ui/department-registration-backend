import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { readdir } from 'node:fs/promises';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3200';
const token = process.env.RUNTIME_API_TOKEN || 'railway-ci-token';

const request = async (method, path, body, authToken) => {
  const headers = {'content-type':'application/json'};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  return {status:response.status, body:await response.json()};
};

let r = await request('GET','/ready');
assert.equal(r.status,200);
assert.ok(['ready','degraded'].includes(r.body.status));
assert.equal(r.body.components.database.ready,true);
assert.equal(r.body.components.runtimeAuth.required,true);
assert.equal(r.body.components.runtimeAuth.ready,true);

r = await request('POST','/api/runtime/projects',{
  projectKey:'railway-unauthorized',
  name:'Railway Unauthorized',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,401);

const projectKey = `railway-ci-${Date.now().toString(36)}`;
r = await request('POST','/api/runtime/projects',{
  projectKey,
  name:'Railway CI',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'context-orchestrator-v1'
},token);
assert.equal(r.status,201);
assert.equal(r.body.data.projectKey,projectKey);

const db = await mysql.createConnection(process.env.MYSQL_URL);
const [[migrationCount]] = await db.query('SELECT COUNT(*) AS count FROM schema_migrations');
const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url)))
  .filter(name => name.endsWith('.sql'));
assert.equal(Number(migrationCount.count),migrationFiles.length);

const required = [
  'projects','runs','tasks','checkpoints','stage_snapshots',
  'route_executions','tool_executions','usage_ledger','gate_results','qa_evidence','audit_logs',
  'provider_registry','model_registry','provider_health_events','pricing_versions','project_budget_policies',
  'tenants','workspaces','quota_policies','quota_evaluations',
  'plans','plan_entitlements','entitlement_evaluations','rate_limit_policies','rate_limit_buckets','rate_limit_decisions','usage_reservations',
  'identities','rbac_roles','rbac_role_permissions','tenant_memberships','workspace_memberships','api_credentials','authorization_decisions',
  'plan_billing_terms','subscriptions','billing_cycles','invoices','invoice_items','billing_usage_settlements','credit_ledger','invoice_payments',
  'knowledge_contexts','knowledge_sources','knowledge_documents','knowledge_sync_runs',
  'knowledge_retrievals','knowledge_retrieval_items'
];

for (const table of required) {
  const [[row]] = await db.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  assert.equal(Number(row.count),1,`missing ${table}`);
}

const [[forbidden]] = await db.query(
  "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('context_packets','context_packet_items')"
);
assert.equal(Number(forbidden.count),0);

await db.end();

console.log('RAILWAY_RUNTIME_COMPATIBILITY_PASS');
