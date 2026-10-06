import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m261-platform-token';

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
  tenantKey:`m261-${suffix}`,name:'M26.1 Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'Main Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'other',name:'Other Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherWorkspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m261-project-${suffix}`,name:'M26.1 Product',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'FRONTEND_PROTOTYPE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await request('GET',`/api/runtime/projects/${projectId}/governance`,undefined,null);
assert.equal(r.status,401,JSON.stringify(r.body));

r=await request('PATCH',`/api/runtime/projects/${projectId}/governance`,{
  goal:'Validate project operating governance',
  successCriteria:{m26_1:'PASS'},
  scope:{include:['strategy','project','baseline','work']},
  outOfScope:{exclude:['forecast','competitive-intelligence']},
  priority:'HIGH',health:'GREEN',
  startDate:'2026-10-06',targetDate:'2026-11-15',
  riskLevel:'MEDIUM',
  budgetGuardrailAmount:5000,budgetGuardrailCurrency:'USD',
  tags:['AI_NATIVE','M26_1']
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.projectSubtypeKey,'FRONTEND_PROTOTYPE');
assert.equal(r.body.data.priority,'HIGH');
assert.equal(r.body.data.health,'GREEN');

r=await request('PATCH',`/api/runtime/projects/${projectId}/governance`,{status:'AT_RISK'});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'INVALID_PROJECT_STATUS');

r=await request('PATCH',`/api/runtime/projects/${projectId}/governance`,{health:'AT_RISK'});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'INVALID_PROJECT_HEALTH');

r=await request('POST','/api/runtime/strategic-items',{
  workspaceId,itemKey:`OBJ-${suffix}`,itemType:'OBJECTIVE',
  title:'Productize AI Native 2.0',goal:'Reach private-workspace product readiness',
  successMetric:{m30Final:true},priority:'HIGH',health:'GREEN'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const objectiveId=r.body.data.id;

r=await request('POST','/api/runtime/strategic-items',{
  workspaceId,parentId:objectiveId,itemKey:`INIT-${suffix}`,itemType:'INITIATIVE',
  title:'Complete M26-M30',goal:'Close management and domain E2E gaps',
  successMetric:{milestones:['M26','M27','M28','M29','M30']}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const initiativeId=r.body.data.id;

r=await request('GET',`/api/runtime/strategic-items?workspaceId=${workspaceId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,2);

r=await request('POST','/api/runtime/portfolios',{
  workspaceId,portfolioKey:`PORT-${suffix}`,name:'AI Native 2.0',
  strategicTheme:'Product Readiness',priority:'HIGH',health:'GREEN',
  capacitySignal:{signal:'BALANCED'},budgetSignal:{currency:'USD',level:'CONTROLLED'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const portfolioId=r.body.data.id;

r=await request('POST','/api/runtime/strategy-project-links',{
  strategicItemId:initiativeId,projectId,linkRole:'CONTRIBUTES_TO',weightBps:10000
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/portfolio-project-links',{
  portfolioId,projectId,roadmapOrder:1,targetWindow:'2026-Q4'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('GET',`/api/runtime/portfolios/${portfolioId}/roadmap`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.projects.length,1);
assert.equal(r.body.data.projects[0].projectSubtypeKey,'FRONTEND_PROTOTYPE');

r=await request('POST','/api/runtime/portfolios',{
  workspaceId:otherWorkspaceId,portfolioKey:`OTHER-${suffix}`,name:'Other'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherPortfolioId=r.body.data.id;

r=await request('POST','/api/runtime/portfolio-project-links',{
  portfolioId:otherPortfolioId,projectId
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'GOVERNANCE_WORKSPACE_MISMATCH');

r=await request('POST',`/api/runtime/projects/${projectId}/structure-nodes`,{
  nodeKey:'DOMAIN-1',nodeType:'BUSINESS_DOMAIN',name:'Private Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const domainId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/structure-nodes`,{
  parentId:domainId,nodeKey:'MODULE-1',nodeType:'MODULE',name:'Project OS'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const moduleId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/structure-nodes`,{
  parentId:moduleId,nodeKey:'EPIC-1',nodeType:'EPIC',name:'Governance Core'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const epicId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/iterations`,{
  iterationKey:'I-1',name:'M26.1 Iteration',sequenceNo:1,
  goal:'Governance Core',startDate:'2026-10-06',endDate:'2026-10-10',makeCurrent:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
const iterationId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/milestones`,{
  milestoneKey:'M26.1-OUTCOME',displayName:'Project Governance Core Ready',sequenceNo:101,
  objective:'Project management facts are durable and queryable',
  status:'ACTIVE',progressPercent:25,
  plannedStart:'2026-10-06',plannedEnd:'2026-10-10',
  exitCriteria:{gate:'M26_1_PASS'},requiredDeliverables:['schema','api','qa'],makeCurrent:true
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;
assert.equal(r.body.data.managementStatus,'ACTIVE');

r=await request('POST',`/api/runtime/projects/${projectId}/work-items`,{
  structureNodeId:epicId,milestoneId,iterationId,
  itemKey:'WI-1',itemType:'FEATURE',title:'Project Governance API',
  stageKey:'PD_06_PLAN',priority:'HIGH',status:'IN_PROGRESS',
  estimateHours:8,acceptanceCriteria:{api:true,rbac:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workItemId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/dependencies`,{
  sourceType:'WORK_ITEM',sourceId:workItemId,
  targetType:'MILESTONE',targetId:milestoneId,
  dependencyType:'PRODUCES',criticalPath:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

for(const [path,body] of [
  ['risks',{riskKey:'R-1',title:'Schedule risk',probability:'MEDIUM',impact:'HIGH',mitigation:'Keep M26 split into gates'}],
  ['issues',{issueKey:'ISS-1',title:'Stale M26 branch',severity:'MEDIUM',source:'Git Branch Audit'}],
  ['blockers',{blockerKey:'B-1',blockingObjectType:'WORK_ITEM',blockingObjectId:workItemId,reason:'Await CI',waitingOn:'M26.1 Gate',resumeCondition:'CI PASS'}],
  ['decisions',{decisionKey:'D-1',title:'Rebase M26 on final M25.6',context:{staleBase:'17765e'},options:['reuse stale','rebase'],decision:{selected:'rebase'},impact:{preservesM256:true}}],
  ['changes',{changeKey:'C-1',changeReason:'M26 stale base conflict',changeScope:{branch:'M26.1'},impactedObjects:['project_subtype_key'],revalidationScope:['M25.6'],after:{base:'212feb79'}}]
]){
  r=await request('POST',`/api/runtime/projects/${projectId}/${path}`,body);
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST',`/api/runtime/projects/${projectId}/baselines`,{
  versionLabel:'B1',architecture:{runtime:'V2.6-M26.1'},
  snapshot:{phase:'initial'},evidence:{source:'M26.1 Gate'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const baseline1=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/baselines`,{
  versionLabel:'B2',snapshot:{phase:'after-governance'},evidence:{source:'M26.1 Gate'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const baseline2=r.body.data.id;
assert.notEqual(baseline1,baseline2);

r=await request('GET',`/api/runtime/projects/${projectId}/governance`);
assert.equal(r.status,200,JSON.stringify(r.body));
const gov=r.body.data;
assert.equal(gov.project.currentBaselineId,baseline2);
assert.equal(gov.project.currentIterationId,iterationId);
assert.equal(gov.project.currentMilestoneId,milestoneId);
assert.equal(gov.baselines.length,2);
assert.equal(gov.baselines[0].status,'HISTORICAL');
assert.equal(gov.baselines[0].replacedById,baseline2);
assert.equal(gov.baselines[1].status,'CURRENT');
assert.equal(gov.structureNodes.length,3);
assert.equal(gov.iterations.length,1);
assert.ok(gov.milestones.some(x=>x.id===milestoneId&&x.managementStatus==='ACTIVE'));
assert.equal(gov.workItems.length,1);
assert.equal(gov.dependencies.length,1);
assert.equal(gov.risks.length,1);
assert.equal(gov.issues.length,1);
assert.equal(gov.blockers.length,1);
assert.equal(gov.decisions.length,1);
assert.equal(gov.changes.length,1);
assert.equal(gov.strategyLinks.length,1);
assert.equal(gov.portfolioLinks.length,1);

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`archive-${suffix}`,name:'Archive Guard',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'INTERNAL_TOOL'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const archiveProjectId=r.body.data.id;

r=await request('PATCH',`/api/runtime/projects/${archiveProjectId}/governance`,{status:'ARCHIVED'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_ARCHIVE_BASELINE_REQUIRED');

r=await request('POST',`/api/runtime/projects/${archiveProjectId}/baselines`,{versionLabel:'FINAL'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('PATCH',`/api/runtime/projects/${archiveProjectId}/governance`,{status:'ARCHIVED'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_ARCHIVE_CLOSURE_REQUIRED');

r=await request('PATCH',`/api/runtime/projects/${archiveProjectId}/governance`,{
  status:'ARCHIVED',closure:{finalReview:'PASS',archivePolicy:'RETAIN'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_ARCHIVE_REVIEW_REQUIRED');

r=await request('POST',`/api/runtime/projects/${archiveProjectId}/complete`,{
  finalReview:{status:'PASS',summary:'Governance final review'},
  archivePolicy:{retention:'RETAIN'},
  outcome:{result:'PASS'},
  evidence:{qa:'PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'COMPLETED');

r=await request('POST',`/api/runtime/projects/${archiveProjectId}/archive`,{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'ARCHIVED');

r=await request('PATCH',`/api/runtime/projects/${archiveProjectId}/governance`,{status:'ACTIVE'});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROJECT_ARCHIVED_TERMINAL');

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[subtypeColumns]]=await db.execute(
  `SELECT
     SUM(COLUMN_NAME='project_subtype_key') AS canonical_count,
     SUM(COLUMN_NAME='project_subtype') AS duplicate_count
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projects'
     AND COLUMN_NAME IN ('project_subtype_key','project_subtype')`
);
assert.equal(Number(subtypeColumns.canonical_count),1);
assert.equal(Number(subtypeColumns.duplicate_count),0);

const [[baselineCurrent]]=await db.execute(
  "SELECT COUNT(*) AS count FROM project_baselines WHERE project_id=? AND status='CURRENT'",[projectId]
);
assert.equal(Number(baselineCurrent.count),1);

const [[m26Objects]]=await db.execute(
  `SELECT
     (SELECT COUNT(*) FROM strategic_items WHERE workspace_id=?) AS strategic_count,
     (SELECT COUNT(*) FROM portfolios WHERE workspace_id=?) AS portfolio_count,
     (SELECT COUNT(*) FROM project_work_items WHERE project_id=?) AS work_item_count,
     (SELECT COUNT(*) FROM project_decisions WHERE project_id=?) AS decision_count`,
  [workspaceId,workspaceId,projectId,projectId]
);
assert.equal(Number(m26Objects.strategic_count),2);
assert.equal(Number(m26Objects.portfolio_count),1);
assert.equal(Number(m26Objects.work_item_count),1);
assert.equal(Number(m26Objects.decision_count),1);

await db.end();
console.log('G26_1_STRATEGY_PROJECT_GOVERNANCE_PASS');
