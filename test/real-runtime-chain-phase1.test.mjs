import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const statePath = process.env.REAL_CHAIN_STATE_PATH || '/tmp/ai-native-real-chain.json';
const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
};

const suffix = Date.now().toString(36);
const query = '读取《你好，那年夏天》CURRENT事实与电影版当前进度，对SC042–SC050进行连续性冷读，只输出真实问题和证据，不修改已PASS内容。';

let r = await request('POST','/api/runtime/projects',{
  projectKey:`hello-summer-real-chain-${suffix}`,
  name:'你好，那年夏天｜真实Runtime链验证',
  projectType:'AIGC_CONTENT',
  status:'ACTIVE',
  currentWorkflowVersion:'g-runtime-01-hybrid-v1'
});
assert.equal(r.status,201);
const projectId = r.body.data.id;

r = await request('POST','/api/runtime/runs',{
  projectId,
  runType:'WORKFLOW',
  triggerSource:'CHATGPT_HYBRID',
  input:{query,scope:'SC042-SC050'},
  workflowVersion:'g-runtime-01-hybrid-v1',
  routerVersion:'router-p86-v1',
  status:'RUNNING'
});
assert.equal(r.status,201);
const runId = r.body.data.id;

r = await request('POST','/api/runtime/tasks',{
  runId,
  stageKey:'SCRIPT',
  taskKey:'sc042-sc050-continuity-read',
  taskType:'SCRIPT_CONTINUITY',
  sequenceNo:1,
  input:{query,scope:'SC042-SC050'},
  dependencies:{knowledgeSource:'chatgpt-library'}
});
assert.equal(r.status,201);
const taskId = r.body.data.id;

r = await request('POST','/api/runtime/routes',{
  runId,
  taskId,
  projectType:'AIGC_CONTENT',
  taskType:'SCRIPT_CONTINUITY',
  query,
  executionMode:'HYBRID_EXTERNAL_CHATGPT_AGENT'
});
assert.equal(r.status,201);
assert.equal(r.body.data.matched,true);
assert.equal(r.body.data.routeRuleKey,'P86');
assert.equal(r.body.data.agentKey,'Script Agent');
assert.equal(r.body.data.skillKey,'script-storyboard');
assert.equal(r.body.data.toolKey,'ChatGPT Library');
const routeExecutionId = r.body.data.id;

const sourceKey = `chatgpt-library-hello-summer-${suffix}`;
r = await request('POST','/api/runtime/knowledge/sources',{
  sourceKey,
  provider:'chatgpt_library',
  sourceType:'LIBRARY',
  transportMode:'CHATGPT_TOOL',
  rootScope:'/你好那年夏天'
});
assert.equal(r.status,201);

r = await request('POST','/api/runtime/knowledge/sync-metadata',{
  sourceKey,
  provider:'chatgpt_library',
  documents:[
    {
      file_id:'file_00000000296481fd8f40c269f7576440',
      library_file_id:'libfile_59bd07808dc88191b3b5ce23070ee336',
      library_path:'/你好那年夏天/电影版/01_电影版剧本/你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
      name:'你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
      mime_type:'text/markdown',
      file_provider:'native',
      modified_at:'2026-10-04T03:38:55.846172Z',
      source_status:'CURRENT',
      default_retrieval:true,
      metadata:{versionFallback:'file_id+modified_at+content_sha256'}
    },
    {
      file_id:'file_0000000087708230991c6f9decf97c40',
      library_file_id:'libfile_ee8710915ee08191abfd9268a433fb8c',
      version_id:'53',
      library_path:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      name:'你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      mime_type:'text/markdown',
      file_provider:'native',
      modified_at:'2026-10-02T05:17:57.928212Z',
      source_status:'CURRENT',
      default_retrieval:true
    }
  ]
});
assert.equal(r.status,200);

r = await request('POST','/api/runtime/knowledge/retrievals',{
  runId,
  taskId,
  sourceKey,
  query,
  retrievalMode:'LIBRARY_SEARCH_FIND_READ',
  contextHash:'99f842c92de75c6d1e8e21d3f4acd1f32990f9fbc5f8443d0df7992efed25b7c',
  policy:{
    defaultRetrievalOnly:true,
    precedence:['AUTHOR_LATEST','STORY_FACTS','MASTER_OR_MOVIE_CURRENT','TIMELINE','SPECIAL_CURRENT']
  },
  items:[
    {
      externalFileId:'file_0000000087708230991c6f9decf97c40',
      libraryFileId:'libfile_ee8710915ee08191abfd9268a433fb8c',
      versionId:'53',
      sourcePath:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      rankNo:1,
      selected:true,
      lineStart:331,
      lineEnd:343,
      contentHash:'7cc7f291136a92a0caf1d440f791633edff14cf0ed4bc9a1d735fa73ff958c8c'
    },
    {
      externalFileId:'file_00000000296481fd8f40c269f7576440',
      libraryFileId:'libfile_59bd07808dc88191b3b5ce23070ee336',
      versionId:null,
      sourcePath:'/你好那年夏天/电影版/01_电影版剧本/你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
      rankNo:2,
      selected:true,
      lineStart:7528,
      lineEnd:7556,
      contentHash:'7f141f31bf681402bf9940fe38f6d3614c5b37ca5fdf13eba353b1376034f6ac',
      metadata:{
        sourceModifiedAt:'2026-10-04T03:38:55.846172Z',
        versionFallback:'file_id+modified_at+content_sha256'
      }
    }
  ]
});
assert.equal(r.status,201);
const retrievalId = r.body.data.id;

for (const item of [
  {
    sourceFileId:'file_0000000087708230991c6f9decf97c40',
    sourceLibraryFileId:'libfile_ee8710915ee08191abfd9268a433fb8c',
    sourceVersion:'53',
    sourcePath:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
    sourceName:'你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
    sourceModifiedAt:'2026-10-02T05:17:57.928212Z',
    sourceStatus:'CURRENT',
    precedenceRank:1,
    contextRole:'STORY_FACTS',
    sourceLineStart:331,
    sourceLineEnd:343,
    contentSha256:'7cc7f291136a92a0caf1d440f791633edff14cf0ed4bc9a1d735fa73ff958c8c'
  },
  {
    sourceFileId:'file_00000000296481fd8f40c269f7576440',
    sourceLibraryFileId:'libfile_59bd07808dc88191b3b5ce23070ee336',
    sourceVersion:'mtime:2026-10-04T03:38:55.846172Z',
    sourcePath:'/你好那年夏天/电影版/01_电影版剧本/你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
    sourceName:'你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
    sourceModifiedAt:'2026-10-04T03:38:55.846172Z',
    sourceStatus:'CURRENT',
    precedenceRank:2,
    contextRole:'MOVIE_CURRENT',
    sourceLineStart:7528,
    sourceLineEnd:7556,
    contentSha256:'7f141f31bf681402bf9940fe38f6d3614c5b37ca5fdf13eba353b1376034f6ac'
  }
]) {
  item.taskId = taskId;
  item.sourceProvider = 'CHATGPT_LIBRARY';
  item.retrievalQuery = query;
  item.retrievalMode = 'search+find+read';
}

r = await request('POST',`/api/runtime/runs/${runId}/knowledge-contexts`,{
  items:[
    {
      taskId,
      sourceProvider:'CHATGPT_LIBRARY',
      sourceFileId:'file_0000000087708230991c6f9decf97c40',
      sourceLibraryFileId:'libfile_ee8710915ee08191abfd9268a433fb8c',
      sourceVersion:'53',
      sourcePath:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      sourceName:'你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      sourceModifiedAt:'2026-10-02T05:17:57.928212Z',
      sourceStatus:'CURRENT',
      precedenceRank:1,
      retrievalQuery:query,
      retrievalMode:'search+find+read',
      contextRole:'STORY_FACTS',
      sourceLineStart:331,
      sourceLineEnd:343,
      contentSha256:'7cc7f291136a92a0caf1d440f791633edff14cf0ed4bc9a1d735fa73ff958c8c'
    },
    {
      taskId,
      sourceProvider:'CHATGPT_LIBRARY',
      sourceFileId:'file_00000000296481fd8f40c269f7576440',
      sourceLibraryFileId:'libfile_59bd07808dc88191b3b5ce23070ee336',
      sourceVersion:'mtime:2026-10-04T03:38:55.846172Z',
      sourcePath:'/你好那年夏天/电影版/01_电影版剧本/你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
      sourceName:'你好那年夏天_电影版正式剧本_V0.2_CURRENT_20261004.md',
      sourceModifiedAt:'2026-10-04T03:38:55.846172Z',
      sourceStatus:'CURRENT',
      precedenceRank:2,
      retrievalQuery:query,
      retrievalMode:'search+find+read',
      contextRole:'MOVIE_CURRENT',
      sourceLineStart:7528,
      sourceLineEnd:7556,
      contentSha256:'7f141f31bf681402bf9940fe38f6d3614c5b37ca5fdf13eba353b1376034f6ac'
    }
  ]
});
assert.equal(r.status,201);

r = await request('GET',`/api/runtime/runs/${runId}/knowledge-contexts`);
assert.equal(r.status,200);
const knowledgeFingerprint = r.body.data.fingerprint;
assert.match(knowledgeFingerprint,/^[a-f0-9]{64}$/);

r = await request('POST','/api/runtime/tool-executions',{
  runId,
  taskId,
  routeExecutionId,
  toolType:'CHATGPT_CONNECTOR',
  toolKey:'ChatGPT Library',
  status:'PASS',
  input:{query,scope:'/你好那年夏天'},
  output:{retrievalId,selectedSources:2,sourceBodyPersisted:false}
});
assert.equal(r.status,201);
const toolExecutionId = r.body.data.id;

const agentResult = {
  executionMode:'HYBRID_EXTERNAL_CHATGPT_AGENT',
  agentKey:'Script Agent',
  skillKey:'script-storyboard',
  scope:'SC042-SC050',
  findingCount:1,
  findings:[
    {
      code:'SC049_MOTHER_CALL_SEQUENCE_OMITTED',
      severity:'P1_CONTINUITY',
      scene:'SC049',
      summary:'电影CURRENT在陈默回到62㎡后直接进入给林夏打电话；剧情事实基线锁定为先致电母亲澄清婚恋预期，再打给林夏。',
      movieEvidence:{fileId:'file_00000000296481fd8f40c269f7576440',lines:[7528,7556]},
      factEvidence:{fileId:'file_0000000087708230991c6f9decf97c40',versionId:'53',lines:[331,343]}
    }
  ],
  noOtherHardConflicts:true,
  outputSha256:'32a33c0605628dbaa02745e4ce903f2cd0ee6accc0f61a8bdd4f23fa5f0df19c'
};

r = await request('PATCH',`/api/runtime/tasks/${taskId}`,{
  status:'PASS',
  output:agentResult,
  finished:true
});
assert.equal(r.status,200);

r = await request('POST','/api/runtime/gate-results',{
  runId,
  taskId,
  stageKey:'SCRIPT',
  gateKey:'G-RUNTIME-01-HYBRID',
  status:'PASS',
  criteria:{
    routerMatched:true,
    libraryRetrieved:true,
    agentProducedEvidence:true,
    sourceBodyPersisted:false,
    qaRecorded:true,
    checkpointRequired:true
  },
  evidence:{
    routeExecutionId,
    toolExecutionId,
    retrievalId,
    agentOutputSha256:agentResult.outputSha256,
    findingCount:1
  },
  decidedBy:'CHATGPT_HYBRID_RUNTIME'
});
assert.equal(r.status,201);
const gateResultId = r.body.data.id;

r = await request('POST','/api/runtime/qa-evidence',{
  runId,
  taskId,
  gateResultId,
  qaCaseKey:'QA-REAL-CHAIN-SC042-SC050-001',
  status:'PASS',
  evidenceType:'CURRENT_LIBRARY_CROSSCHECK',
  evidence:{
    findingCount:1,
    noOtherHardConflicts:true,
    movieFileId:'file_00000000296481fd8f40c269f7576440',
    factFileId:'file_0000000087708230991c6f9decf97c40',
    factVersionId:'53'
  },
  issueSeverity:'P1_CONTINUITY',
  issueSummary:'SC049 omits the locked mother-call-before-Lin-call action.',
  verifiedBy:'CHATGPT_SCRIPT_AGENT'
});
assert.equal(r.status,201);
const qaEvidenceId = r.body.data.id;

r = await request('POST',`/api/runtime/runs/${runId}/checkpoints`,{
  taskId,
  stageKey:'SCRIPT',
  stepKey:'sc042-sc050-continuity-read-complete',
  state:{
    taskStatus:'PASS',
    routeRuleKey:'P86',
    findingCount:1,
    gateResultId,
    qaEvidenceId
  },
  completedTaskKeys:['sc042-sc050-continuity-read'],
  pendingTaskKeys:['resolve-sc049-or-accept-film-compression'],
  blockedTaskKeys:[],
  dependencyFingerprint:knowledgeFingerprint,
  workflowVersion:'g-runtime-01-hybrid-v1',
  routerVersion:'router-p86-v1',
  resumeFromTaskKey:'resolve-sc049-or-accept-film-compression',
  createdBy:'CHATGPT_HYBRID_RUNTIME'
});
assert.equal(r.status,201);
const checkpointId = r.body.data.id;

await writeFile(statePath, JSON.stringify({
  projectId,runId,taskId,routeExecutionId,toolExecutionId,retrievalId,
  gateResultId,qaEvidenceId,checkpointId,knowledgeFingerprint
}, null, 2));

console.log('REAL_CHAIN_PHASE1_PASS');
console.log(JSON.stringify({runId,taskId,routeRuleKey:'P86',findingCount:1,checkpointId}));
