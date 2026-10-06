import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m255-platform-token';
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const sourceKey=`m255-library-${suffix}`;
const sourceFileId=`file-m255-${suffix}`;
const sourceVersion='v1';
const sourceSentinel='M255_PRIVATE_LIBRARY_SOURCE_SENTINEL';
const generatedFact='Approved product decision: preserve the stage-agent capability contract.';

let r=await request('POST','/api/runtime/knowledge/sources',{
  sourceKey,provider:'chatgpt_library',sourceType:'LIBRARY',transportMode:'CHATGPT_TOOL',
  rootScope:`/M25.5/${suffix}`
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/knowledge/sync-metadata',{
  sourceKey,provider:'chatgpt_library',
  documents:[{
    file_id:sourceFileId,
    library_file_id:`lib-${sourceFileId}`,
    version_id:sourceVersion,
    current_version_number:1,
    library_path:`/M25.5/${suffix}/source.md`,
    name:'M25.5 Source',
    source_status:'CURRENT',
    default_retrieval:true,
    content_fingerprint:'metadata-only-fingerprint'
  }]
});
assert.equal(r.status,200,JSON.stringify(r.body));

const agentKey=`AGENT:M255:${suffix}`;
const toolKey=`TOOL:M255:${suffix}`;
for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'M25.5 Knowledge Agent',adapterKey:'agent-runtime'},
  {capabilityKey:toolKey,capabilityType:'TOOL',displayName:'M25.5 Knowledge Tool',adapterKey:'internal-test'}
]){
  r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'KNOWLEDGE_STAGE_OWNER',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/agent-capability-grants',{
  agentCapabilityKey:agentKey,childCapabilityKey:toolKey,requirementMode:'ALLOWED',priority:10
});
assert.equal(r.status,201,JSON.stringify(r.body));
for(const [capabilityKey,bindingMode,priority] of [[agentKey,'DEFAULT',1],[toolKey,'DEFAULT',2]]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey,bindingMode,priority
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`m255-${suffix}`,
  version:'1.0.0',displayName:'M25.5 Knowledge Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'M1_KNOWLEDGE',displayName:'Knowledge',sequenceNo:1,acceptance:{gate:'G-KNOWLEDGE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestoneId,stageKey:'KNOWLEDGE',displayName:'Knowledge',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-KNOWLEDGE',
  config:{maxRetries:0,onRetryExhausted:'ESCALATE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const stageId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,{
  requirementKey:'EXECUTE',capabilityType:'TOOL',capabilityKey:toolKey,
  routingMode:'FIXED',requirementMode:'REQUIRED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/knowledge-policies`,{
  policyKey:'PROJECT_CURRENT',
  sourceKey,
  queryTemplate:'Retrieve the current project decision and constraints.',
  contextRole:'PROJECT_CONTEXT',
  required:true,
  maxItems:4,
  allowedStatuses:['CURRENT','FACT','RULE'],
  injectionMode:'APPEND_CONTEXT',
  writebackMode:'PROPOSE',
  writebackTargetPath:`/M25.5/${suffix}/decisions.md`
});
assert.equal(r.status,201,JSON.stringify(r.body));
const knowledgePolicyId=r.body.data.id;

r=await request('POST',`/api/runtime/workflow-stages/${stageId}/knowledge-policies`,{
  policyKey:'BAD_STATUS',sourceKey,queryTemplate:'bad',allowedStatuses:['PENDING']
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'KNOWLEDGE_POLICY_STATUS_NOT_EXECUTABLE');

r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.stages[0].knowledgePolicies.length,1);
assert.equal(r.body.data.stages[0].knowledgePolicies[0].policyKey,'PROJECT_CURRENT');
assert.match(r.body.data.definitionSha256,/^[a-f0-9]{64}$/);

r=await request('POST',`/api/runtime/workflow-stages/${stageId}/knowledge-policies`,{
  policyKey:'LATE',sourceKey,queryTemplate:'late'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'WORKFLOW_TEMPLATE_IMMUTABLE');

r=await request('POST','/api/runtime/projects',{
  projectKey:`m255-success-${suffix}`,name:'M25.5 Success Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

const orchestrationBody={
  idempotencyKey:`m255-success-${suffix}`,
  stageInputs:{
    KNOWLEDGE:{
      EXECUTE:{
        payload:{
          task:'use current project knowledge',
          knowledgeWriteback:{
            policyKey:'PROJECT_CURRENT',
            payload:{type:'DECISION',status:'CURRENT',text:generatedFact},
            expectedSourceVersion:sourceVersion
          }
        }
      }
    }
  },
  knowledgePackets:{
    KNOWLEDGE:{
      PROJECT_CURRENT:{
        query:'Retrieve current project decision and constraints.',
        items:[{
          sourceFileId,
          sourceLibraryFileId:`lib-${sourceFileId}`,
          sourceVersion,
          sourcePath:`/M25.5/${suffix}/source.md`,
          sourceStatus:'CURRENT',
          lineStart:10,lineEnd:12,
          sourceText:`Current project rule. ${sourceSentinel}`
        }]
      }
    }
  }
};

r=await request('POST',`/api/runtime/projects/${projectId}/orchestrations`,orchestrationBody);
assert.equal(r.status,201,JSON.stringify(r.body));
const session=r.body.data;
assert.equal(session.status,'PASS');
assert.equal(session.attempts.length,1);
assert.equal(session.attempts[0].knowledgeContextCount,1);
assert.match(session.attempts[0].contextHash,/^[a-f0-9]{64}$/);
assert.equal(session.attempts[0].writebackCount,1);
assert.ok(!JSON.stringify(session).includes(sourceSentinel));

r=await request('GET',`/api/runtime/projects/${projectId}/knowledge-writebacks?status=PENDING`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
const writeback=r.body.data[0];
assert.equal(writeback.policyKey,'PROJECT_CURRENT');
assert.equal(writeback.sourceKey,sourceKey);
assert.equal(writeback.status,'PENDING');
assert.equal(writeback.payload.text,generatedFact);
assert.match(writeback.contentSha256,/^[a-f0-9]{64}$/);

r=await request('POST',`/api/runtime/knowledge-writebacks/${writeback.id}/decision`,{
  action:'APPLY',appliedSourceVersion:'v2'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'KNOWLEDGE_WRITEBACK_EXTERNAL_CONFIRMATION_REQUIRED');

r=await request('POST',`/api/runtime/knowledge-writebacks/${writeback.id}/decision`,{
  action:'APPLY',
  externalWriteId:`external-write-${suffix}`,
  appliedSourceVersion:'v2',
  decision:{connector:'library',verified:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'APPLIED');
assert.equal(r.body.data.externalWriteId,`external-write-${suffix}`);
assert.equal(r.body.data.appliedSourceVersion,'v2');

r=await request('GET',`/api/runtime/knowledge-writebacks/${writeback.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'APPLIED');

// Missing required knowledge must stop before any capability invocation.
r=await request('POST','/api/runtime/projects',{
  projectKey:`m255-missing-${suffix}`,name:'M25.5 Missing Context Project',
  projectType:'PRODUCT_DEVELOPMENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const missingProjectId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${missingProjectId}/orchestrations`,{
  idempotencyKey:`m255-missing-${suffix}`,
  stageInputs:{KNOWLEDGE:{EXECUTE:{payload:{task:'must not execute'}}}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCKED');
assert.equal(r.body.data.stageAttempts,1);
assert.equal(r.body.data.capabilityInvocationCount,0);
assert.equal(r.body.data.attempts[0].transitionType,'ESCALATE');
assert.equal(r.body.data.attempts[0].gateStatus,'HOLD');
assert.equal(r.body.data.attempts[0].decision.reasonCode,'REQUIRED_KNOWLEDGE_CONTEXT_MISSING');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

const [[contexts]]=await db.execute(
  `SELECT COUNT(*) AS count,MIN(source_status) AS source_status,MIN(content_sha256) AS content_sha256
     FROM knowledge_contexts WHERE run_id=?`,
  [session.runId]
);
assert.equal(Number(contexts.count),1);
assert.equal(contexts.source_status,'CURRENT');
assert.match(contexts.content_sha256,/^[a-f0-9]{64}$/);

const [[retrievals]]=await db.execute(
  `SELECT COUNT(*) AS count,MIN(context_hash) AS context_hash
     FROM knowledge_retrievals WHERE run_id=?`,
  [session.runId]
);
assert.equal(Number(retrievals.count),1);
assert.match(retrievals.context_hash,/^[a-f0-9]{64}$/);

const [[policyRow]]=await db.execute(
  'SELECT COUNT(*) AS count FROM stage_knowledge_policies WHERE id=?',[knowledgePolicyId]
);
assert.equal(Number(policyRow.count),1);

const [[sourceLeak]]=await db.execute(
  `SELECT
     (SELECT COUNT(*) FROM knowledge_contexts
       WHERE run_id=? AND CONCAT_WS('|',source_file_id,source_path,context_role) LIKE ?) +
     (SELECT COUNT(*) FROM knowledge_retrievals
       WHERE run_id=? AND CONCAT_WS('|',query_text,policy_json) LIKE ?) +
     (SELECT COUNT(*) FROM workflow_orchestration_stage_attempts a
       JOIN workflow_orchestration_sessions s ON s.id=a.session_id
       WHERE s.id=? AND CAST(a.decision_json AS CHAR) LIKE ?) +
     (SELECT COUNT(*) FROM capability_invocations ci
       WHERE ci.run_id=? AND (
         CAST(ci.decision_json AS CHAR) LIKE ? OR
         CAST(ci.output_evidence_json AS CHAR) LIKE ?
       )) AS count`,
  [
    session.runId,`%${sourceSentinel}%`,
    session.runId,`%${sourceSentinel}%`,
    session.id,`%${sourceSentinel}%`,
    session.runId,`%${sourceSentinel}%`,`%${sourceSentinel}%`
  ]
);
assert.equal(Number(sourceLeak.count),0);

await db.end();

console.log('G25_5_KNOWLEDGE_CONTEXT_BACKWRITE_PASS');
