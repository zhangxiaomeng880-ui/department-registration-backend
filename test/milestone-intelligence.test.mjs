import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m262-platform-token';
const request=async(method,path,body,auth=token)=>{
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
  tenantKey:`m262-${suffix}`,name:'M26.2 Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'Main'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m262-project-${suffix}`,name:'M26.2 Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SAAS_PLATFORM'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/strategic-items',{
  workspaceId,itemKey:`INIT-${suffix}`,itemType:'INITIATIVE',
  title:'M26 Management Intelligence',goal:'Make governance measurable'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const initiativeId=r.body.data.id;

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'STRATEGIC_ITEM',targetId:initiativeId,updateStatus:'ON_TRACK',
  cadenceDays:7,observedAt:'2026-10-06T00:00:00Z',
  nextAction:'Complete M26.2',evidence:{source:'initiative-review'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/strategic-items/${initiativeId}/governance-updates`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].updateStatus,'ON_TRACK');

r=await request('POST',`/api/runtime/projects/${projectId}/milestones`,{
  milestoneKey:'M26.2-OUTCOME',displayName:'Milestone Intelligence Ready',sequenceNo:201,
  objective:'Forecast and govern milestone completion',
  status:'ACTIVE',plannedStart:'2026-10-06',plannedEnd:'2026-10-12',
  requiredDeliverables:['SPEC','QA'],requiredGates:[],makeCurrent:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;

r=await request('PATCH',`/api/runtime/milestones/${milestoneId}/plan`,{
  updateCadenceDays:2
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.updateCadenceDays,2);

for(const item of [
  {itemKey:'WI-1',title:'Milestone engine',status:'COMPLETED',estimateHours:8},
  {itemKey:'WI-2',title:'Forecast and staleness',status:'IN_PROGRESS',estimateHours:8}
]){
  r=await request('POST',`/api/runtime/projects/${projectId}/work-items`,{
    milestoneId,itemType:'FEATURE',priority:'HIGH',...item
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  if(item.itemKey==='WI-1') globalThis.wi1=r.body.data.id;
  if(item.itemKey==='WI-2') globalThis.wi2=r.body.data.id;
}
const wi1=globalThis.wi1,wi2=globalThis.wi2;

r=await request('POST',`/api/runtime/milestones/${milestoneId}/capacity-snapshots`,{
  availableHoursPerCalendarDay:8,
  observedAt:'2026-10-06T00:00:00Z',
  expiresAt:'2026-10-20T00:00:00Z',
  source:{type:'TEAM_CAPACITY'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'MILESTONE',targetId:milestoneId,updateStatus:'ON_TRACK',
  cadenceDays:2,observedAt:'2026-10-06T00:00:00Z',
  progressPercent:50,nextAction:'Finish forecast implementation'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-06T12:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.progress.calculatedPercent,50);
assert.equal(r.body.data.progress.effectivePercent,50);
assert.equal(r.body.data.forecast.forecastEnd,'2026-10-07');
assert.equal(r.body.data.forecast.method,'CAPACITY_HOURS_PER_CALENDAR_DAY');
assert.equal(r.body.data.health,'ON_TRACK');
assert.equal(r.body.data.staleness.stale,false);

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-09T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.staleness.stale,true);
assert.equal(r.body.data.health,'AT_RISK');
assert.ok(r.body.data.healthReasons.includes('STALE_UPDATE'));

r=await request('POST',`/api/runtime/milestones/${milestoneId}/progress-override`,{
  progressPercent:80
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'MILESTONE_PROGRESS_OVERRIDE_REASON_REQUIRED');

r=await request('POST',`/api/runtime/milestones/${milestoneId}/progress-override`,{
  progressPercent:80,reason:'External deliverable accepted before local work-item sync'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.progress.overridePercent,80);
assert.equal(r.body.data.progress.effectivePercent,80);

r=await request('POST',`/api/runtime/projects/${projectId}/dependencies`,{
  sourceType:'WORK_ITEM',sourceId:wi2,targetType:'MILESTONE',targetId:milestoneId,
  dependencyType:'PRODUCES',criticalPath:true,
  externalReference:{delay:true,reason:'External dependency slipped'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const dependencyId=r.body.data.id;

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'MILESTONE',targetId:milestoneId,updateStatus:'ON_TRACK',
  cadenceDays:2,observedAt:'2026-10-09T00:00:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-09T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.health,'OFF_TRACK');
assert.equal(r.body.data.dependencies.violation,true);
assert.ok(r.body.data.healthReasons.includes('CRITICAL_PATH_VIOLATION'));

r=await request('PATCH',`/api/runtime/dependencies/${dependencyId}`,{
  status:'RESOLVED',externalReference:{delay:false}
});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/risks`,{
  riskKey:'R-HIGH',title:'High impact quality risk',probability:'MEDIUM',impact:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const riskId=r.body.data.id;

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-09T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.health,'AT_RISK');
assert.ok(r.body.data.healthReasons.includes('HIGH_IMPACT_RISK'));

r=await request('PATCH',`/api/runtime/risks/${riskId}`,{status:'CLOSED'});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/blockers`,{
  blockerKey:'B-1',blockingObjectType:'WORK_ITEM',blockingObjectId:wi2,
  reason:'Waiting on approval',waitingOn:'Owner',resumeCondition:'Approval received'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const blockerId=r.body.data.id;

r=await request('GET',`/api/runtime/milestones/${milestoneId}/intelligence?asOf=2026-10-09T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.health,'OFF_TRACK');
assert.ok(r.body.data.healthReasons.includes('ACTIVE_BLOCKER'));

r=await request('POST',`/api/runtime/blockers/${blockerId}/resolve`,{
  evidence:{approval:'received'}
});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/milestones/${milestoneId}/complete`,{
  completionEvidence:{deliverables:['SPEC','QA']}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'MILESTONE_COMPLETION_GATE_BLOCKED');
assert.ok(r.body.details.blockers.includes('PROGRESS_NOT_100'));

r=await request('POST',`/api/runtime/milestones/${milestoneId}/progress-override`,{
  progressPercent:null
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.progress.overridePercent,null);

r=await request('PATCH',`/api/runtime/work-items/${wi2}`,{
  status:'COMPLETED',actualWorkMinutes:420,evidence:{qa:'PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/milestones/${milestoneId}/complete`,{
  completionEvidence:{deliverables:['SPEC','QA'],finalReview:'PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.managementStatus,'COMPLETED');
assert.equal(r.body.data.progress.effectivePercent,100);
assert.equal(r.body.data.completion.ready,true);

r=await request('POST',`/api/runtime/projects/${projectId}/versions`,{
  versionKey:'REL-BYPASS',versionType:'RELEASE_DISTRIBUTION',label:'Bypass',status:'RELEASED'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_VERSION_MUST_START_DRAFT');

r=await request('POST',`/api/runtime/projects/${projectId}/versions`,{
  versionKey:'REL-1',versionType:'RELEASE_DISTRIBUTION',label:'Release 1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const versionId=r.body.data.id;
assert.equal(r.body.data.status,'DRAFT');

r=await request('PATCH',`/api/runtime/project-versions/${versionId}`,{status:'RELEASED'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_VERSION_TRANSITION_NOT_ALLOWED');

for(const status of ['CANDIDATE','LOCKED','RELEASED']){
  r=await request('PATCH',`/api/runtime/project-versions/${versionId}`,{
    status,evidence:{gate:`VERSION_${status}`}
  });
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.data.status,status);
}

r=await request('POST',`/api/runtime/milestones/${milestoneId}/version-links`,{
  projectVersionId:versionId,linkRole:'OUTPUT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.linkRole,'OUTPUT');

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'PROJECT',targetId:projectId,updateStatus:'ON_TRACK',
  cadenceDays:1,observedAt:'2026-10-06T00:00:00Z',nextAction:'Monitor outcome'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/projects/${projectId}/intelligence?asOf=2026-10-08T00:00:00Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.staleness.stale,true);
assert.equal(r.body.data.health,'AMBER');
assert.equal(r.body.data.completedMilestoneCount,1);
assert.equal(r.body.data.milestoneVersionLinks.length,1);
assert.equal(r.body.data.milestoneVersionLinks[0].projectVersionId,versionId);

r=await request('POST','/api/runtime/governance-updates',{
  targetType:'PROJECT',targetId:projectId,updateStatus:'ON_TRACK',
  cadenceDays:1,observedAt:'2026-10-08T00:00:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/intelligence/refresh`,{
  asOf:'2026-10-08T00:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.staleness.stale,false);
assert.equal(r.body.data.health,'GREEN');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[milestoneRow]]=await db.execute(
  `SELECT management_status,health,progress_percent,calculated_progress_percent,
          completion_evidence_json
     FROM project_milestones WHERE id=?`,[milestoneId]
);
assert.equal(milestoneRow.management_status,'COMPLETED');
assert.equal(Number(milestoneRow.progress_percent),100);
assert.equal(Number(milestoneRow.calculated_progress_percent),100);
assert.ok(milestoneRow.completion_evidence_json);

const [[versionLinks]]=await db.execute(
  'SELECT COUNT(*) AS count FROM milestone_version_links WHERE milestone_id=? AND project_version_id=?',
  [milestoneId,versionId]
);
assert.equal(Number(versionLinks.count),1);

const [[stageCoupling]]=await db.execute(
  `SELECT COUNT(*) AS count FROM project_stage_instances
    WHERE project_id=? AND id=?`,[projectId,milestoneId]
);
assert.equal(Number(stageCoupling.count),0);

const [[updates]]=await db.execute(
  'SELECT COUNT(*) AS count FROM governance_updates WHERE project_id=?',[projectId]
);
assert.ok(Number(updates.count)>=4);

await db.end();
console.log('G26_2_MILESTONE_INTELLIGENCE_PASS');
