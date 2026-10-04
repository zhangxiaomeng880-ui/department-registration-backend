import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers:{'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json()};
};

const suffix = Date.now().toString(36);

let r = await request('POST','/api/runtime/projects',{
  projectKey:`orchestrator-ci-${suffix}`,
  name:'Runtime Orchestrator CI',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'context-orchestrator-v1'
});
assert.equal(r.status,201);
const projectId = r.body.data.id;

r = await request('POST','/api/runtime/context-packets',{
  query:'检查SC049连续性，只输出真实问题和证据。',
  scope:'SC049',
  ttlSeconds:300,
  precedence:['STORY_FACTS','MOVIE_CURRENT'],
  items:[
    {
      sourceFileId:'fact-file',
      sourceLibraryFileId:'fact-lib',
      sourceVersion:'53',
      sourceStatus:'CURRENT',
      sourcePath:'/你好那年夏天/02_故事资产/剧情事实_CURRENT.md',
      lineStart:331,
      lineEnd:343,
      sourceText:'LIBRARY_CONTEXT_SENTINEL SC049 hard lock: Chen Mo must call his mother first, then call Lin Xia.'
    },
    {
      sourceFileId:'movie-file',
      sourceLibraryFileId:'movie-lib',
      sourceVersion:null,
      sourceStatus:'CURRENT',
      sourcePath:'/你好那年夏天/电影版/电影版_CURRENT.md',
      lineStart:7528,
      lineEnd:7556,
      sourceText:'SC049 current movie: Chen Mo returns to 62㎡ and calls Lin Xia directly; the mother call is omitted.'
    }
  ]
});
assert.equal(r.status,201);
const contextPacketId = r.body.data.id;
const contextHash = r.body.data.contextHash;

r = await request('POST','/api/runtime/orchestrate',{
  projectId,
  contextPacketId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  stageKey:'SCRIPT',
  taskKey:'sc049-autonomous-continuity',
  nextTaskKey:'resolve-sc049-or-accept-film-compression'
});
assert.equal(r.status,200);
assert.equal(r.body.data.executionMode,'AUTONOMOUS_CONTEXT_ORCHESTRATOR');
assert.equal(r.body.data.routeRuleKey,'P86');
assert.equal(r.body.data.contextPacketConsumed,true);
assert.equal(r.body.data.sourceBodyPersisted,false);
assert.equal(r.body.data.contextHash,contextHash);
assert.equal(r.body.data.findingCount,1);
assert.equal(r.body.data.findings[0].code,'SC049_MOTHER_CALL_SEQUENCE_OMITTED');
assert.ok(r.body.data.runId);
assert.ok(r.body.data.taskId);
assert.ok(r.body.data.gateResultId);
assert.ok(r.body.data.qaEvidenceId);
assert.ok(r.body.data.checkpointId);
assert.equal(r.body.data.resumeFromTaskKey,'resolve-sc049-or-accept-film-compression');

const runId = r.body.data.runId;

r = await request('GET',`/api/runtime/context-packets/${contextPacketId}/metadata`);
assert.equal(r.status,404);
assert.equal(r.body.error,'CONTEXT_PACKET_NOT_FOUND');

const db = await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

for (const [table, expected] of [
  ['tasks',1],
  ['route_executions',1],
  ['tool_executions',1],
  ['gate_results',1],
  ['qa_evidence',1],
  ['checkpoints',1]
]) {
  const [[row]] = await db.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`,[runId]);
  assert.equal(Number(row.count),expected,`${table} count`);
}

const [[gate]] = await db.execute(
  'SELECT status FROM gate_results WHERE run_id = ? LIMIT 1',
  [runId]
);
assert.equal(gate.status,'PASS');

const [[qa]] = await db.execute(
  'SELECT status FROM qa_evidence WHERE run_id = ? LIMIT 1',
  [runId]
);
assert.equal(qa.status,'PASS');

const [[checkpoint]] = await db.execute(
  'SELECT status, dependency_fingerprint, resume_from_task_key FROM checkpoints WHERE run_id = ? LIMIT 1',
  [runId]
);
assert.equal(checkpoint.status,'VALID');
assert.equal(checkpoint.dependency_fingerprint,contextHash);
assert.equal(checkpoint.resume_from_task_key,'resolve-sc049-or-accept-film-compression');

const [toolRows] = await db.execute(
  'SELECT input_json, output_json FROM tool_executions WHERE run_id = ?',
  [runId]
);
const persistedTool = JSON.stringify(toolRows);
assert.equal(persistedTool.includes('LIBRARY_CONTEXT_SENTINEL'),false);
assert.equal(persistedTool.includes('sourceText'),false);

const [[contextTables]] = await db.execute(
  `SELECT COUNT(*) AS count
   FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('context_packets','context_packet_items')`
);
assert.equal(Number(contextTables.count),0);

await db.end();

console.log('AUTONOMOUS_RUNTIME_ORCHESTRATOR_PASS');
