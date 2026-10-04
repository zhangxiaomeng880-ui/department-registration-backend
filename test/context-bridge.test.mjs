import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type':'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

const suffix = Date.now().toString(36);

let r = await request('POST','/api/runtime/projects',{
  projectKey:`context-bridge-ci-${suffix}`,
  name:'Context Bridge CI',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'context-bridge-v1'
});
assert.equal(r.status,201);
const projectId = r.body.data.id;

r = await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CI',
  input:{task:'context bridge validation'},
  workflowVersion:'context-bridge-v1',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId = r.body.data.id;

r = await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'SCRIPT',
  taskKey:'context-bridge-sc049',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,
  input:{scope:'SC049'}
});
assert.equal(r.status,201);
const taskId = r.body.data.id;

r = await request('POST','/api/runtime/routes',{
  runId,
  taskId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  query:'检查SC049连续性',
  executionMode:'AUTONOMOUS_CONTEXT_BRIDGE'
});
assert.equal(r.status,201);
assert.equal(r.body.data.routeRuleKey,'P86');
const routeExecutionId = r.body.data.id;

r = await request('POST','/api/runtime/context-packets',{
  query:'历史版本不应进入默认Agent上下文',
  scope:'SC049',
  items:[{
    sourceFileId:'historical-file',
    sourceVersion:'old-v1',
    sourceStatus:'HISTORICAL',
    sourceText:'This stale content must not enter default execution.'
  }]
});
assert.equal(r.status,409);
assert.equal(r.body.error,'CONTEXT_SOURCE_STATUS_NOT_ALLOWED');

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
      sourcePath:'/你好那年夏天/02_故事资产/剧情事实_CURRENT.md',
      lineStart:331,
      lineEnd:343,
      sourceText:'LIBRARY_CONTEXT_SENTINEL SC049 hard lock: Chen Mo must call his mother first, then call Lin Xia.'
    },
    {
      sourceFileId:'movie-file',
      sourceLibraryFileId:'movie-lib',
      sourceVersion:'mtime:2026-10-04',
      sourcePath:'/你好那年夏天/电影版/电影版_CURRENT.md',
      lineStart:7528,
      lineEnd:7556,
      sourceText:'SC049 current movie: Chen Mo returns to 62㎡ and calls Lin Xia directly; the mother call is omitted.'
    }
  ]
});
assert.equal(r.status,201);
assert.equal(r.body.data.itemCount,2);
assert.match(r.body.data.contextHash,/^[a-f0-9]{64}$/);
assert.equal(Object.hasOwn(r.body.data,'items'),false);
const packetId = r.body.data.id;

r = await request('GET',`/api/runtime/context-packets/${packetId}/metadata`);
assert.equal(r.status,200);
assert.equal(r.body.data.itemCount,2);
assert.equal(Object.hasOwn(r.body.data,'items'),false);

r = await request('POST',`/api/runtime/context-packets/${packetId}/execute`,{
  runId,
  taskId,
  routeExecutionId,
  routeRuleKey:'P86'
});
assert.equal(r.status,200);
assert.equal(r.body.data.executionMode,'AUTONOMOUS_MODEL_PROVIDER');
assert.equal(r.body.data.contextPacketConsumed,true);
assert.equal(r.body.data.output.findingCount,1);
assert.equal(r.body.data.output.findings[0].code,'SC049_MOTHER_CALL_SEQUENCE_OMITTED');

r = await request('GET',`/api/runtime/context-packets/${packetId}/metadata`);
assert.equal(r.status,404);
assert.equal(r.body.error,'CONTEXT_PACKET_NOT_FOUND');

const db = await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

const [toolRows] = await db.execute(
  'SELECT input_json, output_json FROM tool_executions WHERE run_id = ? ORDER BY created_at DESC',
  [runId]
);
assert.ok(toolRows.length >= 1);
const persisted = JSON.stringify(toolRows);
assert.equal(persisted.includes('LIBRARY_CONTEXT_SENTINEL'),false);
assert.equal(persisted.includes('sourceText'),false);

const [tables] = await db.execute(
  `SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('context_packets','context_packet_items')`
);
assert.equal(tables.length,0);

await db.end();

console.log('EPHEMERAL_CONTEXT_BRIDGE_PASS');
