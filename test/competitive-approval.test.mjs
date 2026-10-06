import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m263-platform-token';
const request=async(method,path,body,auth=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${auth}`;
  const response=await fetch(baseUrl+path,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);

let r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m263-${suffix}`,name:'M26.3 Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'M26.3 Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m263-project-${suffix}`,name:'M26.3 Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'AI_APPLICATION'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

// ---------- Benchmark dimensions: all three formal benchmark classes ----------
for(const d of [
  {benchmarkType:'PRODUCT_MARKET',dimensionKey:'CORE_FLOW',displayName:'Core Flow'},
  {benchmarkType:'CREATIVE_CONTENT',dimensionKey:'HOOK_PATTERN',displayName:'Hook Pattern'},
  {benchmarkType:'AI_CAPABILITY',dimensionKey:'QUALITY',displayName:'Quality'}
]){
  r=await request('POST','/api/runtime/benchmark-dimensions',{workspaceId,...d});
  assert.equal(r.status,201,JSON.stringify(r.body));
}

// ---------- Product / Market competitor ----------
r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'PRODUCT_MARKET',
  subjectKey:`PRODUCT-${suffix}`,name:'Comparable Product',
  externalReference:{homepage:'https://example.invalid/product'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productSubjectId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-subjects/${productSubjectId}/snapshots`,{
  snapshotKey:'2026-10-01',
  sourceProvider:'OFFICIAL_SITE',
  sourceRef:'https://example.invalid/product/changelog',
  observedAt:'2026-10-01T10:00:00Z',
  asOfDate:'2026-10-01',
  region:'US',planKey:'PRO',versionLabel:'2026.10',
  freshnessDays:5,
  evidence:{capture:'official-product-page'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productSnapshot1=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-snapshots/${productSnapshot1}/observations`,{
  dimensionKey:'CORE_FLOW',observationType:'FACT',
  statement:'Official source exposes a guided workflow.',
  value:{guidedWorkflow:true},confidence:'HIGH',
  evidence:{source:'official-page'},sourceLocator:{section:'workflow'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productFactId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-snapshots/${productSnapshot1}/observations`,{
  dimensionKey:'CORE_FLOW',observationType:'INFERENCE',
  statement:'The guided workflow may reduce setup friction.',
  value:{hypothesis:'lower-friction'},confidence:'MEDIUM',
  evidence:{derivedFrom:productFactId}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/benchmark-snapshots/${productSnapshot1}/observations`,{
  dimensionKey:'UNREGISTERED',observationType:'FACT',
  statement:'Must fail.',confidence:'HIGH',evidence:{source:'none'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'BENCHMARK_DIMENSION_NOT_REGISTERED');

r=await request('POST',`/api/runtime/benchmark-subjects/${productSubjectId}/snapshots`,{
  snapshotKey:'2026-10-06',
  sourceProvider:'OFFICIAL_SITE',
  sourceRef:'https://example.invalid/product/changelog-2',
  observedAt:'2026-10-06T10:00:00Z',
  asOfDate:'2026-10-06',
  region:'US',planKey:'PRO',versionLabel:'2026.10.2',
  freshnessDays:7,
  evidence:{capture:'official-changelog'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productSnapshot2=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-snapshots/${productSnapshot2}/observations`,{
  dimensionKey:'CORE_FLOW',observationType:'FACT',
  statement:'Official changelog adds approval queue support.',
  value:{approvalQueue:true},confidence:'HIGH',
  evidence:{source:'official-changelog'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/benchmark-subjects/${productSubjectId}/change-events`,{
  fromSnapshotId:productSnapshot1,toSnapshotId:productSnapshot2,
  changeType:'FEATURE_ADDED',severity:'MEDIUM',
  summary:'Approval queue introduced.',
  evidence:{source:'official-changelog'},detectedAt:'2026-10-06T11:00:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const changeEventId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/decisions`,{
  decisionKey:`D-COMP-${suffix}`,title:'Keep approval queue in M26',
  context:{benchmarkSubjectId:productSubjectId},
  options:['ignore','retain'],decision:{selected:'retain'},
  impact:{scope:'M26.3'},evidence:{source:'benchmark'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectDecisionId=r.body.data.id;

r=await request('POST','/api/runtime/benchmark-decision-links',{
  projectId,decisionId:projectDecisionId,subjectId:productSubjectId,
  snapshotId:productSnapshot2,changeEventId,
  linkRole:'INFORMS',rationale:'Competitor change is evidence, not an automatic requirement.'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/benchmark-subjects/${productSubjectId}/intelligence?asOf=2026-10-20T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.currentSnapshot.id,productSnapshot2);
assert.equal(r.body.data.currentSnapshot.stale,true);
assert.ok(r.body.data.observations.every(x=>['FACT','INFERENCE'].includes(x.observationType)));
assert.equal(r.body.data.changes.length,1);
assert.equal(r.body.data.decisionLinks.length,1);

// ---------- Creative / Content benchmark governance ----------
r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'CREATIVE_CONTENT',
  subjectKey:`CREATIVE-BAD-${suffix}`,name:'Ungoverned Creative Reference'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'CREATIVE_REFERENCE_GOVERNANCE_REQUIRED');

r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'CREATIVE_CONTENT',
  subjectKey:`CREATIVE-${suffix}`,name:'Creative Reference',
  creativeUsageRole:'STYLE_BENCHMARK',rightsStatus:'REFERENCE_ONLY',forbiddenCopying:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
const creativeSubjectId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-subjects/${creativeSubjectId}/snapshots`,{
  snapshotKey:'creative-2026-10-06',
  sourceProvider:'PUBLIC_REFERENCE',sourceRef:'https://example.invalid/creative',
  observedAt:'2026-10-06T09:00:00Z',asOfDate:'2026-10-06',freshnessDays:30,
  evidence:{source:'public-reference'},
  referenceScope:{allowed:['rhythm-analysis'],forbidden:['shot-copy']}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const creativeSnapshotId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-snapshots/${creativeSnapshotId}/observations`,{
  dimensionKey:'HOOK_PATTERN',observationType:'FACT',
  statement:'Reference opens with a character action before exposition.',
  confidence:'HIGH',evidence:{source:'public-reference',timecode:'00:00-00:05'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

// ---------- AI Capability benchmark ----------
const capabilityKey=`TOOL:M263:${suffix}`;
r=await request('POST','/api/runtime/capabilities',{
  capabilityKey,capabilityType:'TOOL',displayName:'M26.3 Benchmark Tool',
  adapterKey:'internal-test',routable:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'AI_CAPABILITY',
  subjectKey:`CAP-${suffix}`,name:'M26.3 Benchmark Tool',capabilityKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const capabilitySubjectId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-subjects/${capabilitySubjectId}/snapshots`,{
  snapshotKey:'cap-2026-10-06',
  sourceProvider:'INTERNAL_EVAL',sourceRef:`eval://m263/${suffix}`,
  observedAt:'2026-10-06T08:00:00Z',asOfDate:'2026-10-06',
  versionLabel:'internal-test-v1',freshnessDays:14,
  evidence:{suite:'M26.3'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const capabilitySnapshotId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-snapshots/${capabilitySnapshotId}/observations`,{
  dimensionKey:'QUALITY',observationType:'FACT',statement:'Quality score measured by test suite.',
  value:{score:0.92},confidence:'HIGH',evidence:{suite:'M26.3'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/benchmark-subjects/${capabilitySubjectId}/capability-runs`,{
  snapshotId:capabilitySnapshotId,qualityScore:0.92,latencyMs:240,
  costAmount:0.012,costCurrency:'USD',reliabilityScore:0.99,
  referenceSupport:{images:true},rightsTerms:{commercialUse:true},
  evidence:{suite:'M26.3',run:'capability-benchmark'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

// ---------- Market signal ----------
r=await request('POST','/api/runtime/market-signals',{
  workspaceId,projectId,subjectId:productSubjectId,
  signalKey:`SIG-${suffix}`,signalType:'MARKET_CHANGE',
  summary:'Approval workflows are becoming more visible in comparable products.',
  sourceProvider:'PUBLIC_RESEARCH',sourceRef:'https://example.invalid/signal',
  observedAt:'2026-10-06T12:00:00Z',asOfDate:'2026-10-06',
  confidence:'MEDIUM',freshnessDays:3,evidence:{source:'research-note'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/projects/${projectId}/competitive-intelligence?asOf=2026-10-10T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.deepEqual(
  new Set(r.body.data.subjects.map(x=>x.subject.benchmarkType)),
  new Set(['PRODUCT_MARKET','CREATIVE_CONTENT','AI_CAPABILITY'])
);
assert.equal(r.body.data.signals.length,1);
assert.equal(r.body.data.signals[0].stale,true);

const creativeIntel=r.body.data.subjects.find(x=>x.subject.id===creativeSubjectId);
assert.equal(creativeIntel.subject.forbiddenCopying,true);
assert.equal(creativeIntel.creativeReferences[0].rightsStatus,'REFERENCE_ONLY');
assert.equal(creativeIntel.creativeReferences[0].forbiddenCopying,true);

const capIntel=r.body.data.subjects.find(x=>x.subject.id===capabilitySubjectId);
assert.equal(capIntel.capabilityRuns.length,1);
assert.equal(capIntel.capabilityRuns[0].qualityScore,0.92);
assert.equal(capIntel.capabilityRuns[0].reliabilityScore,0.99);

// ---------- Scoped users / approval SoT ----------
for(const [key,name] of [
  [`approver-${suffix}`,'Approver'],
  [`intruder-${suffix}`,'Other Reviewer']
]){
  r=await request('POST','/api/runtime/identities',{identityKey:key,displayName:name});
  assert.equal(r.status,201,JSON.stringify(r.body));
  if(name==='Approver') globalThis.approverId=r.body.data.id;
  else globalThis.intruderId=r.body.data.id;
}
const approverId=globalThis.approverId,intruderId=globalThis.intruderId;

for(const identityId of [approverId,intruderId]){
  r=await request('POST','/api/runtime/workspace-memberships',{
    workspaceId,identityId,roleKey:'OPERATOR'
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST','/api/runtime/api-credentials',{
  identityId:approverId,tenantId,workspaceId,name:'Approver Key',
  allowedPermissions:['workspace:read','project:read','project:write','run:read','run:write']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const approverToken=r.body.data.token;

r=await request('POST','/api/runtime/api-credentials',{
  identityId:intruderId,tenantId,workspaceId,name:'Other Reviewer Key',
  allowedPermissions:['workspace:read','project:read','project:write','run:read','run:write']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const intruderToken=r.body.data.token;

r=await request('POST','/api/runtime/approval-requests',{
  workspaceId,projectId,requestKey:`APP-${suffix}`,
  targetType:'PROJECT_VERSION',targetId:'candidate-v1',
  requiredRole:'REVIEWER',approverIdentityId:approverId,
  requestedAction:'Approve candidate release',riskLevel:'HIGH',
  evidence:{qa:'PASS'},dueAt:'2026-10-08T00:00:00Z',
  effectiveObjectType:'PROJECT_VERSION',effectiveObjectId:'candidate-v1',effectiveVersion:'v1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const approvalId=r.body.data.id;
assert.equal(r.body.data.status,'PENDING');

r=await request('GET',`/api/runtime/approval-inbox?workspaceId=${workspaceId}&projectId=${projectId}&status=PENDING`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.id===approvalId));

r=await request('GET',`/api/runtime/notifications?workspaceId=${workspaceId}&projectId=${projectId}&status=UNREAD`);
assert.equal(r.status,200,JSON.stringify(r.body));
const pendingNotification=r.body.data.find(x=>x.sourceId===approvalId&&x.notificationType==='PENDING_APPROVAL');
assert.ok(pendingNotification);

r=await request('PATCH',`/api/runtime/notifications/${pendingNotification.id}`,{status:'READ'},approverToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'READ');

r=await request('GET',`/api/runtime/approval-inbox?workspaceId=${workspaceId}&projectId=${projectId}&status=PENDING`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.id===approvalId));

r=await request('POST',`/api/runtime/approval-requests/${approvalId}/decisions`,{
  decision:'APPROVE',reason:'Not assigned reviewer',evidence:{attempt:true}
},intruderToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'APPROVER_MISMATCH');

r=await request('POST',`/api/runtime/approval-requests/${approvalId}/decisions`,{
  decision:'APPROVE',reason:'Evidence is sufficient',evidence:{review:'PASS'}
},approverToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'APPROVED');

r=await request('POST',`/api/runtime/approval-requests/${approvalId}/decisions`,{
  decision:'REJECT',reason:'Second decision must fail',evidence:{review:'FAIL'}
},approverToken);
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'APPROVAL_ALREADY_DECIDED');

// Deadline expiry.
r=await request('POST','/api/runtime/approval-requests',{
  workspaceId,projectId,requestKey:`EXPIRE-${suffix}`,
  targetType:'MILESTONE',targetId:'M26.3',requestedAction:'Approve expired request',
  riskLevel:'MEDIUM',evidence:{qa:'PASS'},dueAt:'2026-10-05T00:00:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const expiringApprovalId=r.body.data.id;
r=await request('POST','/api/runtime/approval-deadlines/refresh',{
  workspaceId,asOf:'2026-10-06T12:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.approvalId===expiringApprovalId&&x.status==='EXPIRED'));

// Escalation notification must be deduped across refreshes.
r=await request('POST','/api/runtime/approval-requests',{
  workspaceId,projectId,requestKey:`ESC-${suffix}`,
  targetType:'MILESTONE',targetId:'M26.3',requestedAction:'Review escalated request',
  riskLevel:'HIGH',evidence:{qa:'PASS'},
  dueAt:'2026-10-20T00:00:00Z',escalationAt:'2026-10-05T00:00:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const escalationApprovalId=r.body.data.id;
for(let i=0;i<2;i++){
  r=await request('POST','/api/runtime/approval-deadlines/refresh',{
    workspaceId,asOf:'2026-10-06T12:00:00Z'
  });
  assert.equal(r.status,200,JSON.stringify(r.body));
}
r=await request('GET',`/api/runtime/notifications?workspaceId=${workspaceId}&projectId=${projectId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(
  r.body.data.filter(x=>x.sourceId===escalationApprovalId&&x.notificationType==='APPROVAL_ESCALATION').length,
  1
);

// ---------- Human Gate -> durable Approval Request ----------
const agentKey=`AGENT:M263:${suffix}`;
const toolKey=`TOOL:M263:HUMAN:${suffix}`;
for(const cap of [
  {capabilityKey:agentKey,capabilityType:'AGENT',displayName:'M26.3 Human Gate Agent',adapterKey:'agent-runtime',routable:false},
  {capabilityKey:toolKey,capabilityType:'TOOL',displayName:'M26.3 Human Gate Tool',adapterKey:'internal-test'}
]){
  r=await request('POST','/api/runtime/capabilities',cap);
  assert.equal(r.status,201,JSON.stringify(r.body));
}
r=await request('POST','/api/runtime/agent-profiles',{
  capabilityKey:agentKey,roleKey:'M263_REVIEW',policyMode:'QUALITY_FIRST'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/agent-capability-grants',{
  agentCapabilityKey:agentKey,childCapabilityKey:toolKey,requirementMode:'ALLOWED',priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
for(const [capabilityKey,bindingMode] of [[agentKey,'ALLOWED'],[toolKey,'DEFAULT']]){
  r=await request('POST','/api/runtime/project-type-capabilities',{
    projectTypeKey:'PRODUCT_DEVELOPMENT',capabilityKey,bindingMode,priority:1
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'PRODUCT_DEVELOPMENT',templateKey:`m263-human-${suffix}`,
  version:'1.0.0',displayName:'M26.3 Human Gate Workflow'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  stageKey:'REVIEW',displayName:'Human Review',sequenceNo:1,
  defaultAgentCapabilityKey:agentKey,gatePolicyKey:'G-HUMAN',
  config:{humanGateRequired:true,maxRetries:0}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const stageId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-stages/${stageId}/requirements`,{
  requirementKey:'PREPARE',capabilityType:'TOOL',capabilityKey:toolKey,
  routingMode:'FIXED',requirementMode:'REQUIRED'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`human-gate-${suffix}`,name:'Human Gate Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'INTERNAL_TOOL',
  workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const humanProjectId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${humanProjectId}/orchestrations`,{
  idempotencyKey:`m263-human-${suffix}`,
  stageInputs:{REVIEW:{PREPARE:{payload:{ready:true}}}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const humanSession=r.body.data;
assert.equal(humanSession.status,'BLOCKED');
assert.equal(humanSession.attempts.length,1);
assert.equal(humanSession.attempts[0].transitionType,'ESCALATE');
assert.ok(humanSession.attempts[0].decision.approvalRequest);
const humanApprovalId=humanSession.attempts[0].decision.approvalRequest.id;

r=await request('GET',`/api/runtime/approval-inbox?workspaceId=${workspaceId}&projectId=${humanProjectId}&status=PENDING`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,humanApprovalId);
assert.match(r.body.data[0].requestKey,/^HUMAN_GATE:/);

r=await request('POST',`/api/runtime/projects/${humanProjectId}/orchestrations`,{
  idempotencyKey:`m263-human-${suffix}`,
  stageInputs:{REVIEW:{PREPARE:{payload:{ready:true}}}}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.id,humanSession.id);
r=await request('GET',`/api/runtime/approval-inbox?workspaceId=${workspaceId}&projectId=${humanProjectId}&status=PENDING`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);

// Activity and database truth assertions.
r=await request('GET',`/api/runtime/activity?workspaceId=${workspaceId}&projectId=${projectId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.eventType==='APPROVAL_REQUESTED'&&x.objectId===approvalId));
assert.ok(r.body.data.some(x=>x.eventType==='APPROVAL_DECIDED'&&x.objectId===approvalId));
assert.ok(r.body.data.some(x=>x.eventType==='BENCHMARK_CHANGE_DETECTED'));

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

const [[snapshotHistory]]=await db.execute(
  `SELECT
     SUM(id=? AND status='HISTORICAL') AS old_historical,
     SUM(id=? AND status='CURRENT') AS new_current
   FROM benchmark_snapshots WHERE subject_id=?`,
  [productSnapshot1,productSnapshot2,productSubjectId]
);
assert.equal(Number(snapshotHistory.old_historical),1);
assert.equal(Number(snapshotHistory.new_current),1);

const [[creativeRef]]=await db.execute(
  'SELECT COUNT(*) AS count FROM creative_references WHERE subject_id=? AND forbidden_copying=TRUE',
  [creativeSubjectId]
);
assert.equal(Number(creativeRef.count),1);

const [[capRun]]=await db.execute(
  'SELECT COUNT(*) AS count FROM capability_benchmark_runs WHERE subject_id=? AND capability_key=?',
  [capabilitySubjectId,capabilityKey]
);
assert.equal(Number(capRun.count),1);

const [[approvalDecision]]=await db.execute(
  'SELECT COUNT(*) AS count FROM approval_decisions WHERE approval_request_id=?',
  [approvalId]
);
assert.equal(Number(approvalDecision.count),1);

const [[notificationSoT]]=await db.execute(
  `SELECT a.status AS approval_status,n.status AS notification_status
     FROM approval_requests a JOIN notifications n ON n.source_id=a.id
    WHERE a.id=? AND n.notification_type='PENDING_APPROVAL' LIMIT 1`,
  [approvalId]
);
assert.equal(notificationSoT.approval_status,'APPROVED');
assert.equal(notificationSoT.notification_status,'READ');

const [[humanApprovalCount]]=await db.execute(
  `SELECT COUNT(*) AS count FROM approval_requests
    WHERE project_id=? AND request_key LIKE 'HUMAN_GATE:%'`,
  [humanProjectId]
);
assert.equal(Number(humanApprovalCount.count),1);

await db.end();
console.log('G26_3_COMPETITIVE_APPROVAL_PASS');
