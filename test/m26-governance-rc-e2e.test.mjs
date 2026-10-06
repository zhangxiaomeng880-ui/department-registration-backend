import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m265-platform-token';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expectStatus=(r,status)=>assert.equal(r.status,status,JSON.stringify(r.body));
const suffix=randomUUID().slice(0,8);

let r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m265-${suffix}`,name:'M26 RC Tenant'
});expectStatus(r,201);const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'M26 RC Workspace'
});expectStatus(r,201);const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/strategic-items',{
  workspaceId,itemKey:`INIT-${suffix}`,itemType:'INITIATIVE',
  title:'M26 Governance RC',goal:'Prove project operating governance end to end',
  priority:'HIGH',health:'GREEN'
});expectStatus(r,201);const initiativeId=r.body.data.id;

r=await request('POST','/api/runtime/portfolios',{
  workspaceId,portfolioKey:`PORT-${suffix}`,name:'M26 RC Portfolio',priority:'HIGH'
});expectStatus(r,201);const portfolioId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`M26-RC-${suffix}`,name:'M26 RC Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'AI_APPLICATION'
});expectStatus(r,201);const projectId=r.body.data.id;

r=await request('PATCH',`/api/runtime/projects/${projectId}/governance`,{
  status:'ACTIVE',priority:'HIGH',goal:'Pass M26 exit gate',
  startDate:'2026-10-06',targetDate:'2026-10-20'
});expectStatus(r,200);

r=await request('POST','/api/runtime/strategy-project-links',{
  strategicItemId:initiativeId,projectId,linkRole:'CONTRIBUTES_TO',weightBps:10000
});expectStatus(r,201);
r=await request('POST','/api/runtime/portfolio-project-links',{
  portfolioId,projectId,roadmapOrder:1,targetWindow:'2026-Q4'
});expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/milestones`,{
  milestoneKey:'M26-RC',displayName:'M26 RC',sequenceNo:265,status:'ACTIVE',
  plannedStart:'2026-10-06',plannedEnd:'2026-10-10',
  requiredDeliverables:['RC_EVIDENCE'],requiredGates:[],makeCurrent:true
});expectStatus(r,201);const milestoneId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/work-items`,{
  milestoneId,itemKey:'RC-WORK',itemType:'TASK',title:'Integrated RC',
  priority:'HIGH',status:'IN_PROGRESS',estimateHours:8
});expectStatus(r,201);const workItemId=r.body.data.id;

r=await request('POST',`/api/runtime/milestones/${milestoneId}/capacity-snapshots`,{
  availableHoursPerCalendarDay:8,observedAt:'2026-10-06T08:00:00Z',
  expiresAt:'2026-10-20T00:00:00Z',source:{type:'RC_CAPACITY'}
});expectStatus(r,201);

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'MILESTONE',targetId:milestoneId,updateStatus:'ON_TRACK',
  cadenceDays:3,observedAt:'2026-10-06T08:00:00Z',
  progressPercent:0,nextAction:'Complete M26 RC'
});expectStatus(r,201);

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-06T12:00:00Z`);
expectStatus(r,200);
assert.equal(r.body.data.forecast.method,'CAPACITY_HOURS_PER_CALENDAR_DAY');
assert.equal(r.body.data.health,'ON_TRACK');

r=await request('POST',`/api/runtime/projects/${projectId}/risks`,{
  riskKey:'RC-RISK',title:'RC evidence risk',probability:'MEDIUM',impact:'HIGH'
});expectStatus(r,201);const riskId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/blockers`,{
  blockerKey:'RC-BLOCK',blockingObjectType:'WORK_ITEM',blockingObjectId:workItemId,
  reason:'Awaiting approval',waitingOn:'Governance gate',resumeCondition:'Approval accepted'
});expectStatus(r,201);const blockerId=r.body.data.id;

r=await request('GET',`/api/runtime/projects/${projectId}/health?asOf=2026-10-06T12:00:00Z`);
expectStatus(r,200);assert.equal(r.body.data.health,'RED');

r=await request('POST','/api/runtime/benchmark-dimensions',{
  workspaceId,benchmarkType:'PRODUCT_MARKET',dimensionKey:'PROJECT_GOVERNANCE',
  displayName:'Project Governance'
});expectStatus(r,201);
r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'PRODUCT_MARKET',
  subjectKey:`COMP-${suffix}`,name:'Comparable Platform'
});expectStatus(r,201);const subjectId=r.body.data.id;
r=await request('POST',`/api/runtime/benchmark-subjects/${subjectId}/snapshots`,{
  snapshotKey:'2026-10-06',sourceProvider:'INTERNAL_RESEARCH',
  sourceRef:'research-note',observedAt:'2026-10-06T09:00:00Z',
  asOfDate:'2026-10-06',freshnessDays:30,evidence:{capture:'RC'}
});expectStatus(r,201);const snapshotId=r.body.data.id;
r=await request('POST',`/api/runtime/benchmark-snapshots/${snapshotId}/observations`,{
  dimensionKey:'PROJECT_GOVERNANCE',observationType:'FACT',
  statement:'Comparable workflow exposes governed approval state.',
  confidence:'HIGH',evidence:{source:'RC'}
});expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/decisions`,{
  decisionKey:'RC-DECISION',title:'Keep explicit governance gates',
  context:{subjectId},options:['implicit','explicit'],
  decision:{selected:'explicit'},impact:{scope:'M26'},evidence:{benchmark:true}
});expectStatus(r,201);const decisionId=r.body.data.id;
r=await request('POST','/api/runtime/benchmark-decision-links',{
  projectId,decisionId,subjectId,snapshotId,linkRole:'INFORMS',
  rationale:'Benchmark evidence informs a governed decision.'
});expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/versions`,{
  versionKey:'M26-RC-1',versionType:'RELEASE_DISTRIBUTION',label:'M26 RC 1'
});expectStatus(r,201);const versionId=r.body.data.id;
r=await request('PATCH',`/api/runtime/project-versions/${versionId}`,{
  status:'CANDIDATE',evidence:{gate:'M26.5'}
});expectStatus(r,200);

r=await request('POST','/api/runtime/approval-requests',{
  workspaceId,projectId,requestKey:`RC-APP-${suffix}`,
  targetType:'PROJECT_VERSION',targetId:versionId,
  requestedAction:'Approve M26 RC',riskLevel:'HIGH',
  evidence:{gate:'M26.5'}
});expectStatus(r,201);const approvalId=r.body.data.id;

r=await request('POST',`/api/runtime/approval-requests/${approvalId}/decisions`,{
  decision:'APPROVE',reason:'Integrated evidence is sufficient',evidence:{gate:'M26.5'}
});expectStatus(r,200);assert.equal(r.body.data.status,'APPROVED');

for(const status of ['LOCKED','RELEASED']){
  r=await request('PATCH',`/api/runtime/project-versions/${versionId}`,{
    status,evidence:{gate:`M26.5-${status}`}
  });expectStatus(r,200);
}
r=await request('POST',`/api/runtime/milestones/${milestoneId}/version-links`,{
  projectVersionId:versionId,linkRole:'OUTPUT'
});expectStatus(r,201);

r=await request('PATCH',`/api/runtime/risks/${riskId}`,{status:'RESOLVED'});expectStatus(r,200);
r=await request('POST',`/api/runtime/blockers/${blockerId}/resolve`,{evidence:{approvalId}});expectStatus(r,200);
r=await request('PATCH',`/api/runtime/work-items/${workItemId}`,{
  status:'COMPLETED',actualWorkMinutes:480,evidence:{qa:'PASS'}
});expectStatus(r,200);
r=await request('POST',`/api/runtime/milestones/${milestoneId}/complete`,{
  completionEvidence:{deliverables:['RC_EVIDENCE'],integratedGate:'PASS'}
});expectStatus(r,200);assert.equal(r.body.data.managementStatus,'COMPLETED');

r=await request('POST',`/api/runtime/projects/${projectId}/baselines`,{
  versionLabel:'M26-RC-FINAL',decisions:[{decisionId}],
  releaseDistribution:{projectVersionId:versionId,status:'RELEASED'},
  evidence:{gate:'M26.5',approvalId}
});expectStatus(r,201);const finalBaselineId=r.body.data.id;

r=await request('GET',`/api/runtime/projects/${projectId}/governance`);expectStatus(r,200);
assert.ok(r.body.data.strategyLinks.some(x=>x.strategicItemId===initiativeId));
assert.ok(r.body.data.decisions.some(x=>x.id===decisionId));

r=await request('GET',`/api/runtime/projects/${projectId}/competitive-intelligence?asOf=2026-10-06T12:00:00Z`);
expectStatus(r,200);assert.equal(r.body.data.subjects[0].decisionLinks.length,1);

r=await request('POST',`/api/runtime/projects/${projectId}/health/refresh`,{
  asOf:'2026-10-06T12:00:00Z'
});expectStatus(r,200);assert.equal(r.body.data.health,'GREEN',JSON.stringify(r.body));

r=await request('POST',`/api/runtime/portfolios/${portfolioId}/intelligence/refresh`,{
  asOf:'2026-10-06T12:00:00Z'
});expectStatus(r,200);assert.equal(r.body.data.portfolio.health,'GREEN');

r=await request('GET',`/api/runtime/projects/${projectId}/closure-readiness?asOf=2026-10-06T12:00:00Z`);
expectStatus(r,200);assert.equal(r.body.data.ready,true,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/complete`,{
  finalBaselineId,
  finalReview:{status:'PASS',summary:'M26 integrated RC passed'},
  archivePolicy:{retention:'RETAIN',restoreAllowed:true},
  outcome:{m26Exit:'PASS',next:'M27_PRODUCT_DEVELOPMENT_E2E'},
  residualRisks:[],evidence:{gate:'M26.5',approvalId,versionId},
  completedAt:'2026-10-06'
});expectStatus(r,200);assert.equal(r.body.data.status,'COMPLETED');

console.log('Runtime V2.6 M26 integrated governance RC exit passed');
