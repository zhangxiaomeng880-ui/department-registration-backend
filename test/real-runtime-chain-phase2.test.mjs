import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const statePath = process.env.REAL_CHAIN_STATE_PATH || '/tmp/ai-native-real-chain.json';
const state = JSON.parse(await readFile(statePath,'utf8'));

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

let r = await request('GET',`/api/runtime/runs/${state.runId}/checkpoints/latest`);
assert.equal(r.status,200);
assert.equal(r.body.data.id,state.checkpointId);
assert.equal(r.body.data.resumeFromTaskKey,'resolve-sc049-or-accept-film-compression');

r = await request('POST',`/api/runtime/runs/${state.runId}/resume`,{
  workflowVersion:'g-runtime-01-hybrid-v1',
  routerVersion:'router-p86-v1',
  dependencyFingerprint:state.knowledgeFingerprint
});
assert.equal(r.status,200);
assert.equal(r.body.data.resumeFromTaskKey,'resolve-sc049-or-accept-film-compression');

const db = await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

const [[taskCount]] = await db.execute(
  'SELECT COUNT(*) AS count FROM tasks WHERE run_id = ? AND task_key = ?',
  [state.runId,'sc042-sc050-continuity-read']
);
assert.equal(Number(taskCount.count),1);

const [[routeCount]] = await db.execute(
  'SELECT COUNT(*) AS count FROM route_executions WHERE run_id = ? AND route_rule_key = ? AND matched = TRUE',
  [state.runId,'P86']
);
assert.equal(Number(routeCount.count),1);

const [[checkpointCount]] = await db.execute(
  'SELECT COUNT(*) AS count FROM checkpoints WHERE run_id = ? AND status = ?',
  [state.runId,'VALID']
);
assert.equal(Number(checkpointCount.count),1);

const [[bodyColumn]] = await db.execute(
  `SELECT COUNT(*) AS count
   FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'knowledge_contexts'
     AND column_name = 'content_json'`
);
assert.equal(Number(bodyColumn.count),0);

const [[qaCount]] = await db.execute(
  'SELECT COUNT(*) AS count FROM qa_evidence WHERE run_id = ? AND status = ?',
  [state.runId,'PASS']
);
assert.equal(Number(qaCount.count),1);

await db.end();

console.log('REAL_CHAIN_RESUME_PASS');
console.log(JSON.stringify({
  runId:state.runId,
  resumedFrom:'resolve-sc049-or-accept-film-compression',
  passedTaskRerunCount:0,
  routeExecutions:1,
  checkpoints:1,
  sourceBodyPersisted:false
}));
