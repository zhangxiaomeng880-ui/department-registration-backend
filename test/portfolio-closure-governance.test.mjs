import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m264-platform-token';
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
  tenantKey:`m264-${suffix}`,name:'M26.4 Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'M26.4 Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

// ---------- Portfolio intelligence: health roll-up + cross-project dependency ----------
r=await request('POST','/api/runtime/portfolios',{
  workspaceId,portfolioKey:`P-${suffix}`,name:'M26.4 Portfolio',priority:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const portfolioId=r.body.data.id;

const projectIds=[];
for(const [key,name,priority] of [
  [`risk-${suffix}`,'Risk Project','CRITICAL'],
  [`green-${suffix}`,'Green Project','MEDIUM']
]){
  r=await request('POST','/api/runtime/projects',{
    workspaceId,projectKey:key,name,projectType:'PRODUCT_DEVELOPMENT',
    projectSubtypeKey:'AI_APPLICATION'
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.data.id;
  projectIds.push(id);
  r=await request('PATCH',`/api/runtime/projects/${id}/governance`,{priority});
  assert.equal(r.status,200,JSON.stringify(r.body));
  r=await request('POST','/api/runtime/portfolio-project-links',{
    portfolioId,projectId:id,roadmapOrder:projectIds.length,targetWindow:'2026-Q4'
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}
const [riskProjectId,greenProjectId]=projectIds;

r=await request('POST',`/api/runtime/projects/${riskProjectId}/risks`,{
  riskKey:`R-${suffix}`,title:'Critical delivery risk',
  probability:'HIGH',impact:'HIGH',mitigation:'Reduce scope',
  contingency:'Move dependent release',evidence:{source:'M26.4-test'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${riskProjectId}/dependencies`,{
  sourceType:'PROJECT',sourceId:riskProjectId,
  targetType:'PROJECT',targetId:greenProjectId,
  dependencyType:'BLOCKS',status:'ACTIVE',criticalPath:true,
  evidence:{source:'M26.4-test'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/projects/${riskProjectId}/health?asOf=2026-10-06T12:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.health,'RED');
assert.equal(r.body.data.signals.risk.health,'RED');
assert.equal(r.body.data.signals.dependency.crossProjectCount,1);

r=await request('POST',`/api/runtime/projects/${riskProjectId}/health/refresh`,{
  asOf:'2026-10-06T12:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.health,'RED');

r=await request('POST',`/api/runtime/portfolios/${portfolioId}/intelligence/refresh`,{
  asOf:'2026-10-06T12:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.portfolio.health,'RED');
assert.equal(r.body.data.summary.projectCount,2);
assert.equal(r.body.data.summary.crossProjectDependencyCount,1);
assert.equal(r.body.data.attentionOrder[0].projectId,riskProjectId);

// ---------- Project closure gate ----------
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`close-${suffix}`,name:'Closure Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'INTERNAL_TOOL'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const closureProjectId=r.body.data.id;

r=await request('PATCH',`/api/runtime/projects/${closureProjectId}/governance`,{status:'COMPLETED'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_COMPLETION_GATE_REQUIRED');

r=await request('GET',`/api/runtime/projects/${closureProjectId}/closure-readiness?asOf=2026-10-06T12:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.ready,false);
assert.ok(r.body.data.blockers.includes('FINAL_BASELINE_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${closureProjectId}/baselines`,{
  versionLabel:'FINAL',evidence:{qa:'PASS'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const finalBaselineId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${closureProjectId}/milestones`,{
  milestoneKey:'M-FINAL',displayName:'Final Milestone',sequenceNo:1,status:'ACTIVE',makeCurrent:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${closureProjectId}/work-items`,{
  itemKey:'WI-FINAL',itemType:'TASK',title:'Finish final delivery',
  milestoneId,status:'COMPLETED',estimateHours:1,evidence:{done:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/milestones/${milestoneId}/complete`,{
  completionEvidence:{deliverable:'PASS'},asOf:'2026-10-06T12:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.managementStatus,'COMPLETED');

r=await request('POST',`/api/runtime/projects/${closureProjectId}/blockers`,{
  blockerKey:'B-FINAL',blockingObjectType:'PROJECT',blockingObjectId:closureProjectId,
  reason:'Awaiting final operational note',resumeCondition:'Evidence attached'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const blockerId=r.body.data.id;

r=await request('GET',`/api/runtime/projects/${closureProjectId}/closure-readiness?asOf=2026-10-06T12:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.ready,false);
assert.ok(r.body.data.blockers.includes('ACTIVE_BLOCKERS'));

r=await request('POST',`/api/runtime/blockers/${blockerId}/resolve`,{
  evidence:{note:'Operational evidence attached'}
});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/projects/${closureProjectId}/closure-readiness?asOf=2026-10-06T12:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.ready,true,JSON.stringify(r.body));
assert.equal(r.body.data.finalBaseline.id,finalBaselineId);

r=await request('POST',`/api/runtime/projects/${closureProjectId}/complete`,{
  finalBaselineId,
  finalReview:{status:'PASS',summary:'Final review passed'},
  archivePolicy:{retention:'RETAIN',restoreAllowed:true},
  outcome:{result:'PASS',metricSummary:'M26.4 closure verified'},
  residualRisks:[],
  evidence:{qa:'PASS',gate:'M26.4'},
  completedAt:'2026-10-06'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'COMPLETED');
assert.ok(r.body.data.closureReviewId);

r=await request('POST',`/api/runtime/projects/${closureProjectId}/archive`,{
  evidence:{reason:'Closure accepted'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'ARCHIVED');

r=await request('PATCH',`/api/runtime/projects/${closureProjectId}/governance`,{status:'ACTIVE'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_ARCHIVED_TERMINAL');

// ---------- Persisted truth ----------
const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

const [[healthSnapshots]]=await db.execute(
  'SELECT COUNT(*) AS count FROM project_health_snapshots WHERE project_id=?',[riskProjectId]
);
assert.ok(Number(healthSnapshots.count)>=1);

const [[portfolioSnapshots]]=await db.execute(
  'SELECT COUNT(*) AS count FROM portfolio_intelligence_snapshots WHERE portfolio_id=?',[portfolioId]
);
assert.ok(Number(portfolioSnapshots.count)>=1);

const [[closureReviews]]=await db.execute(
  'SELECT COUNT(*) AS count FROM project_closure_reviews WHERE project_id=? AND final_baseline_id=?',
  [closureProjectId,finalBaselineId]
);
assert.equal(Number(closureReviews.count),1);

const [[archivedProject]]=await db.execute(
  'SELECT status,archived_at,current_baseline_id FROM projects WHERE id=?',[closureProjectId]
);
assert.equal(archivedProject.status,'ARCHIVED');
assert.ok(archivedProject.archived_at);
assert.equal(archivedProject.current_baseline_id,finalBaselineId);

await db.end();
console.log('Runtime V2.6 M26.4 portfolio intelligence + project closure validation passed');
