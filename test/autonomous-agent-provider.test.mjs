import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const request = async (method,path,body) => {
  const response = await fetch(baseUrl + path,{
    method,
    headers:{'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json()};
};

const suffix = Date.now().toString(36);
let r = await request('POST','/api/runtime/projects',{
  projectKey:`autonomous-agent-ci-${suffix}`,
  name:'Autonomous Agent CI',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'autonomous-agent-v1'
});
assert.equal(r.status,201);
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CI',
  input:{task:'autonomous provider validation'},
  workflowVersion:'autonomous-agent-v1',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'SCRIPT',
  taskKey:'autonomous-sc042-sc050',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,
  input:{scope:'SC042-SC050'}
});
assert.equal(r.status,201);
const taskId=r.body.data.id;

r=await request('POST','/api/runtime/routes',{
  runId,
  taskId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  query:'检查SC042-SC050连续性',
  executionMode:'AUTONOMOUS_MODEL_PROVIDER'
});
assert.equal(r.status,201);
assert.equal(r.body.data.routeRuleKey,'P86');
const routeExecutionId=r.body.data.id;

r=await request('POST','/api/runtime/agent-executions',{
  runId,
  taskId,
  routeExecutionId,
  routeRuleKey:'P86',
  query:'检查SC042-SC050连续性，只输出真实问题和证据。',
  scope:'SC042-SC050',
  contextPacket:{
    precedence:['STORY_FACTS','MOVIE_CURRENT'],
    items:[
      {
        sourceFileId:'fact-file',
        sourceVersion:'53',
        sourcePath:'/你好那年夏天/剧情事实_CURRENT.md',
        lineStart:331,
        lineEnd:343,
        sourceText:'LIBRARY_SENTINEL_SOURCE_TEXT SC049 hard lock: call mother first, then Lin.'
      },
      {
        sourceFileId:'movie-file',
        sourceVersion:null,
        sourcePath:'/你好那年夏天/电影版_CURRENT.md',
        lineStart:7528,
        lineEnd:7556,
        sourceText:'SC049 current movie text: returns to 62㎡ and calls Lin directly.'
      }
    ]
  }
});
assert.equal(r.status,200);
assert.equal(r.body.data.executionMode,'AUTONOMOUS_MODEL_PROVIDER');
assert.equal(r.body.data.provider,'openai-responses');
assert.equal(r.body.data.providerResponseId,'resp_mock_autonomous_001');
assert.equal(r.body.data.output.findingCount,1);
assert.equal(r.body.data.output.findings[0].code,'SC049_MOTHER_CALL_SEQUENCE_OMITTED');
assert.equal(r.body.data.sourceBodyPersisted,false);
assert.match(r.body.data.contextHash,/^[a-f0-9]{64}$/);
const toolExecutionId=r.body.data.toolExecutionId;

const db=await mysql.createConnection({
  host:process.env.DB_HOST,
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,
  database:process.env.DB_NAME
});

const [[toolRow]]=await db.execute(
  'SELECT input_json, output_json, token_input, token_output, model_key FROM tool_executions WHERE id = ?',
  [toolExecutionId]
);
assert.equal(toolRow.model_key,'test-model');
assert.equal(Number(toolRow.token_input),321);
assert.equal(Number(toolRow.token_output),87);
const persistedInput=JSON.stringify(toolRow.input_json);
assert.equal(persistedInput.includes('LIBRARY_SENTINEL_SOURCE_TEXT'),false);
assert.equal(persistedInput.includes('sourceText'),false);
assert.equal(JSON.stringify(toolRow.output_json).includes('SC049_MOTHER_CALL_SEQUENCE_OMITTED'),true);

const [[contextColumn]]=await db.execute(
  `SELECT COUNT(*) AS count
   FROM information_schema.columns
   WHERE table_schema=DATABASE()
     AND table_name='knowledge_contexts'
     AND column_name='content_json'`
);
assert.equal(Number(contextColumn.count),0);

await db.end();
console.log('AUTONOMOUS_AGENT_PROVIDER_BRIDGE_PASS');
