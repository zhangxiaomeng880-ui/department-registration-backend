import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m272-platform-token';
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

let r=await request('POST','/api/runtime/tenants',{tenantKey:`m272-${suffix}`,name:'M27.2 Tenant'});
expectStatus(r,201);const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'M27.2 Workspace'});
expectStatus(r,201);const workspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`pd-${suffix}`,name:'M27.2 Product Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SAAS_PLATFORM'
});
expectStatus(r,201);const projectId=r.body.data.id;

// Build the minimum valid M27.1 Product Baseline first.
r=await request('POST',`/api/runtime/projects/${projectId}/product-research-studies`,{
  researchKey:'RS-1',objective:'Understand blocker triage friction.',
  researchQuestion:'What context is missing?',method:'INTERVIEW',
  participantSegment:{role:'PM'},sample:{count:3},
  rawEvidenceLocator:{type:'notes',ref:'research://m272/1'},confidence:'HIGH'
});
expectStatus(r,201);const researchStudyId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-evidence`,{
  researchStudyId,evidenceKey:'EV-1',sourceType:'USER_FEEDBACK',
  sourceDate:'2026-10-06',observation:'Blocker context is fragmented.',
  rawEvidence:{note:'Need reason, waiting-on, resume condition together'},
  confidence:'HIGH',freshnessExpiresAt:'2027-01-01T00:00:00Z'
});
expectStatus(r,201);const evidenceId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-insights`,{
  insightKey:'INS-1',title:'Fragmented blocker context',
  observation:'PMs reconstruct blocker context across views.',
  evidenceIds:[evidenceId],confidence:'HIGH'
});
expectStatus(r,201);const insightId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-opportunities`,{
  opportunityKey:'OPP-1',opportunityType:'PROBLEM',title:'Unified blocker context',
  painOpportunity:'PMs spend time rebuilding delivery context.',
  impact:{delivery:'faster triage'},insightIds:[insightId],confidence:'HIGH'
});
expectStatus(r,201);const opportunityId=r.body.data.id;

r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'PRODUCT_MARKET',
  subjectKey:`COMP-${suffix}`,name:'Comparable Project Tool'
});
expectStatus(r,201);const subjectId=r.body.data.id;
r=await request('POST',`/api/runtime/benchmark-subjects/${subjectId}/snapshots`,{
  snapshotKey:'2026-10-06',sourceProvider:'OFFICIAL_SITE',sourceRef:'official://project-tool',
  observedAt:'2026-10-06T08:00:00Z',asOfDate:'2026-10-06',freshnessDays:30,
  evidence:{capture:'official'}
});
expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/product-solution-candidates`,{
  opportunityId,candidateKey:'SOL-1',title:'Unified blocker panel',
  summary:'One panel for blocker reason, dependency and resume context.'
});
expectStatus(r,201);const solutionCandidateId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${projectId}/product-hypotheses`,{
  opportunityId,solutionCandidateId,hypothesisKey:'HYP-1',
  statement:'Unified context reduces blocker triage time.',
  validationMethod:{type:'usage-study'},successSignal:{metric:'triage_time',direction:'down'}
});
expectStatus(r,201);const hypothesisId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${projectId}/decisions`,{
  decisionKey:`PRI-${suffix}`,title:'Do blocker context now',
  context:{opportunityId},options:['DO_NOW','PLAN'],decision:{selected:'DO_NOW'},
  impact:{scope:'M27'},evidence:{discovery:true}
});
expectStatus(r,201);const priorityDecisionId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${projectId}/product-prioritizations`,{
  opportunityId,hypothesisId,prioritizationKey:'PRI-1',scoringModel:'CUSTOM',
  scoreInputs:{goalFit:5,impact:5,evidenceStrength:4,reachFrequency:4,confidence:4,effort:2,riskDependency:2,timeCriticality:4,opportunityCost:3},
  output:'DO_NOW',rationale:'High value and evidence.',decisionId:priorityDecisionId,evidence:{review:'PASS'}
});
expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/product-goals`,{
  goalKey:'GOAL-1',businessGoal:'Reduce waiting time.',productGoal:'Make blockers actionable.',
  primaryMetric:{key:'triage_minutes',target:'-30%'},qualitativeAcceptance:['PM understands blocker in one view']
});
expectStatus(r,201);const goalId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${projectId}/product-bets`,{
  goalDefinitionId:goalId,opportunityId,hypothesisId,betKey:'BET-1',
  statement:'Unified context is the smallest intervention.',
  expectedOutcome:{triage_minutes:'-30%'},evidence:{priorityDecisionId}
});
expectStatus(r,201);const betId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-requirements`,{
  requirementKey:'REQ-1',requirementType:'FUNCTIONAL',title:'Unified blocker context',
  status:'APPROVED',userRoleSegment:{role:'PM'},scenario:{trigger:'Open blocked project'},
  businessRules:['M26 blocker object is source of truth'],mainFlow:['Open project','Read blocker'],
  stateMatrix:{normal:true,empty:true,error:true,loading:true,permission:true},
  inScope:['reason','waiting-on','resume condition'],outOfScope:['resource planning'],
  acceptanceCriteria:['Reason and resume condition are visible'],metric:{primary:'triage_minutes'},
  evidenceLinks:[{evidenceId},{insightId},{opportunityId}],
  traceFrom:[
    {sourceType:'EVIDENCE',sourceId:evidenceId},{sourceType:'INSIGHT',sourceId:insightId},
    {sourceType:'OPPORTUNITY',sourceId:opportunityId},{sourceType:'GOAL',sourceId:goalId},
    {sourceType:'PRODUCT_BET',sourceId:betId}
  ]
});
expectStatus(r,201);const requirementId=r.body.data.id;const requirementVersionId=r.body.data.currentVersionId;

r=await request('POST',`/api/runtime/projects/${projectId}/product-baselines`,{
  baselineKey:'PD-B1',goalDefinitionId:goalId,productBetId:betId,
  scope:{include:['unified blocker context']},businessRules:{sourceOfTruth:'project_blockers'},
  acceptanceCriteria:{requirementKeys:['REQ-1']},metric:{primary:'triage_minutes'},
  keyDecisions:[{priorityDecisionId}],outOfScope:{exclude:['resource planning']},
  evidence:{m271:'PASS'}
});
expectStatus(r,201);const productBaselineId=r.body.data.id;

// G-PD-FEASIBILITY starts HOLD.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-FEASIBILITY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('FEASIBILITY_REVIEW_REQUIRED'));

const sectionStatus={
  ARCHITECTURE:{status:'PASS'},FRAMEWORK_RUNTIME:{status:'PASS'},DATA:{status:'PASS'},
  API_INTEGRATION:{status:'PASS'},AUTH_PERMISSION:{status:'PASS'},
  SECURITY_PRIVACY_COMPLIANCE:{status:'PASS'},PERFORMANCE_SCALABILITY:{status:'PASS'},
  RELIABILITY_AVAILABILITY:{status:'PASS'},DEPLOYMENT_MIGRATION:{status:'PASS'},
  THIRD_PARTY_DEPENDENCY:{status:'PASS'},COST_QUOTA:{status:'PASS'},
  OBSERVABILITY_SUPPORTABILITY:{status:'PASS'},ROLLBACK:{status:'PASS'}
};
r=await request('POST',`/api/runtime/projects/${projectId}/product-feasibility-reviews`,{
  productBaselineId,reviewKey:'FEAS-1',overallStatus:'PASS',sectionStatus,
  architecture:{pattern:'modular service'},frameworkRuntime:{runtime:'Node.js 20'},
  data:{sourceOfTruth:'MySQL'},apiIntegration:{style:'REST'},authPermission:{model:'existing RBAC'},
  securityPrivacyCompliance:{pii:'none-new'},performanceScalability:{slo:'documented'},
  reliabilityAvailability:{failureMode:'fail-closed'},deploymentMigration:{migration:'forward-compatible'},
  thirdPartyDependency:{newDependencies:[]},costQuota:{guardrail:'existing'},
  observabilitySupportability:{logs:true,runbook:true},rollback:{strategy:'previous deployment'},
  riskSummary:{residual:'low'},architectureDecisionRequired:true,evidence:{review:'PASS'}
});
expectStatus(r,201);const feasibilityReviewId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-FEASIBILITY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('ADR_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${projectId}/decisions`,{
  decisionKey:`ADR-${suffix}`,title:'Use existing project governance objects',
  context:{productBaselineId},options:['reuse','duplicate'],decision:{selected:'reuse'},
  impact:{architecture:'avoid duplicate source of truth'},evidence:{feasibilityReviewId}
});
expectStatus(r,201);const architectureProjectDecisionId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-architecture-decisions`,{
  feasibilityReviewId,productBaselineId,adrKey:'ADR-1',title:'Reuse M26 governance primitives',
  context:{problem:'Delivery planning already has milestone/work/dependency objects'},
  options:[{key:'reuse'},{key:'duplicate'}],decision:{selected:'reuse'},
  consequences:{positive:['one source of truth'],tradeoff:['domain layer references generic objects']},
  projectDecisionId:architectureProjectDecisionId,evidence:{review:'PASS'}
});
expectStatus(r,201);const adrId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-FEASIBILITY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Build real delivery planning objects from M26.
r=await request('POST',`/api/runtime/projects/${projectId}/iterations`,{
  iterationKey:'IT-1',name:'M27.2 Contract Iteration',sequenceNo:1,goal:'Lock design and technical contracts',
  startDate:'2026-10-07',endDate:'2026-10-14',status:'ACTIVE',makeCurrent:true
});
expectStatus(r,201);const iterationId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/milestones`,{
  milestoneKey:'PD-M3',displayName:'Design + Technical Contract Locked',sequenceNo:3,
  objective:'Lock M27.2 contracts',status:'ACTIVE',plannedStart:'2026-10-07',plannedEnd:'2026-10-14',
  requiredDeliverables:['DESIGN_CONTRACT','TECHNICAL_CONTRACT'],requiredGates:['G-PD-DESIGN','G-PD-CONTRACT'],makeCurrent:true
});
expectStatus(r,201);const milestoneId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/work-items`,{
  milestoneId,iterationId,itemKey:'WI-DESIGN',itemType:'FEATURE',title:'Design blocker context',
  stageKey:'PD_07_DESIGN',priority:'HIGH',status:'PLANNED',estimateHours:8,
  acceptanceCriteria:['Design contract locked']
});
expectStatus(r,201);const designWorkId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/work-items`,{
  milestoneId,iterationId,itemKey:'WI-CONTRACT',itemType:'TASK',title:'Technical contract blocker context',
  stageKey:'PD_08_CONTRACT',priority:'HIGH',status:'PLANNED',estimateHours:8,
  acceptanceCriteria:['Technical contract locked']
});
expectStatus(r,201);const contractWorkId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/dependencies`,{
  sourceType:'WORK_ITEM',sourceId:contractWorkId,targetType:'WORK_ITEM',targetId:designWorkId,
  dependencyType:'DEPENDS_ON',criticalPath:true,evidence:{reason:'contract follows design'}
});
expectStatus(r,201);const dependencyId=r.body.data.id;

r=await request('POST',`/api/runtime/milestones/${milestoneId}/capacity-snapshots`,{
  availableHoursPerCalendarDay:8,observedAt:'2026-10-07T00:00:00Z',
  expiresAt:'2026-10-15T00:00:00Z',source:{type:'PLAN'}
});
expectStatus(r,201);const capacitySnapshotId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/versions`,{
  versionKey:'REL-M27.2',versionType:'RELEASE_DISTRIBUTION',label:'M27.2 Contract RC'
});
expectStatus(r,201);const releaseVersionId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-delivery-plans`,{
  productBaselineId,feasibilityReviewId,planKey:'PLAN-1',targetReleaseVersionId:releaseVersionId,
  milestoneIds:[milestoneId],iterationIds:[iterationId],workItemIds:[designWorkId,contractWorkId],
  dependencyIds:[dependencyId],capacitySnapshotIds:[capacitySnapshotId],
  criticalPath:{items:[designWorkId,contractWorkId]},releaseSequence:['design','contract','engineering'],
  definitionOfDone:['Design and technical contract Gate PASS'],
  acceptancePlan:{product:'after preview',qa:'separate stage'},
  riskBlockerPlan:{risks:'tracked in M26',blockers:'fail closed'},evidence:{planReview:'PASS'}
});
expectStatus(r,201);const deliveryPlanId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PLAN/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Design source verification must be real/explicit.
const designPayload={
  productBaselineId,contractKey:'DESIGN-1',title:'Unified blocker context design',status:'APPROVED',
  sourceLocator:{provider:'FIGMA',ref:'figma://file/node'},
  sourceVerification:{readable:false,verifiedAt:'2026-10-07T00:00:00Z',evidenceRef:'verification://failed'},
  designSystemLocator:{provider:'FIGMA',ref:'figma://system'},
  informationArchitecture:{location:'Project > Health > Blocker'},
  userFlows:['Open project','Inspect blocker','Open evidence'],
  screensPages:['Project health'],components:['BlockerPanel','EvidenceLink'],
  tokensStyle:{system:'existing'},interaction:{expandable:true},
  stateMatrix:{normal:true,empty:true,error:true,loading:true,disabled:true,permission:true},
  responsiveAdaptive:{desktop:true,mobile:true},accessibility:{keyboard:true,labels:true},
  contentCopy:{unknownEvidence:'Evidence unavailable'},platformBehavior:{web:true},
  prototypeLocator:{provider:'FIGMA',ref:'figma://prototype'},
  designAcceptanceMatrix:{REQ_1:['reason visible','resume condition visible']},
  requirementVersionIds:[requirementVersionId],evidence:{review:'PASS'}
};
r=await request('POST',`/api/runtime/projects/${projectId}/product-design-contracts`,designPayload);
expectStatus(r,409);assert.equal(r.body.error,'DESIGN_SOURCE_NOT_VERIFIED');

designPayload.sourceVerification={readable:true,verifiedAt:'2026-10-07T00:00:00Z',evidenceRef:'verification://figma-read-pass'};
r=await request('POST',`/api/runtime/projects/${projectId}/product-design-contracts`,designPayload);
expectStatus(r,201);const designContractId=r.body.data.id;const designContractVersionId=r.body.data.currentVersionId;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-DESIGN/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Technical/API/Data/Integration/Instrumentation contract. N_A requires rationale.
const technicalPayload={
  productBaselineId,contractKey:'TECH-1',title:'Unified blocker context technical contract',status:'APPROVED',
  designContractVersionId,
  technicalDesign:{modules:['project-governance','product-domain'],errorHandling:'fail-closed',observability:'existing'},
  apiContract:{endpoints:['GET /projects/:id/health'],auth:'RBAC',compatibility:'backward-compatible'},
  dataContract:{entities:['project_blockers','project_dependencies'],sourceOfTruth:'MySQL'},
  integrationContract:{systems:[],fallback:'none'},
  instrumentationContract:{events:['blocker_panel_viewed'],metricMapping:{triage_minutes:'derived'}},
  sectionStatus:{
    TECHNICAL_DESIGN:{status:'PASS'},API:{status:'PASS'},DATA:{status:'PASS'},
    INTEGRATION:{status:'N_A'},INSTRUMENTATION:{status:'PASS'}
  },
  requirementVersionIds:[requirementVersionId],evidence:{review:'PASS'}
};
r=await request('POST',`/api/runtime/projects/${projectId}/product-technical-contracts`,technicalPayload);
expectStatus(r,409);assert.equal(r.body.error,'INVALID_TECHNICAL_SECTION_STATUS');

technicalPayload.sectionStatus.INTEGRATION={status:'N_A',rationale:'No new external integration is introduced.'};
r=await request('POST',`/api/runtime/projects/${projectId}/product-technical-contracts`,technicalPayload);
expectStatus(r,201);const technicalContractId=r.body.data.id;const technicalContractVersionId=r.body.data.currentVersionId;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Contract revisions cannot silently drift.
r=await request('POST',`/api/runtime/product-design-contracts/${designContractId}/versions`,{
  ...designPayload,sourceVerification:{readable:true,verifiedAt:'2026-10-07T01:00:00Z',evidenceRef:'verification://v2'}
});
expectStatus(r,409);assert.equal(r.body.error,'DESIGN_CONTRACT_CHANGE_REQUIRED');

r=await request('GET',`/api/runtime/projects/${projectId}/product-delivery-domain`);
expectStatus(r,200);
assert.equal(r.body.data.feasibilityReviews[0].id,feasibilityReviewId);
assert.equal(r.body.data.architectureDecisions[0].id,adrId);
assert.equal(r.body.data.deliveryPlans[0].id,deliveryPlanId);
assert.equal(r.body.data.designContracts[0].id,designContractId);
assert.equal(r.body.data.technicalContracts[0].id,technicalContractId);
assert.equal(r.body.data.designVersions[0].id,designContractVersionId);
assert.equal(r.body.data.technicalVersions[0].id,technicalContractVersionId);

r=await request('GET',`/api/runtime/product-design-contracts/${designContractId}`);
expectStatus(r,200);assert.equal(r.body.data.versions.length,1);
r=await request('GET',`/api/runtime/product-technical-contracts/${technicalContractId}`);
expectStatus(r,200);assert.equal(r.body.data.versions.length,1);
assert.equal(r.body.data.versions[0].sectionStatus.INTEGRATION.status,'N_A');

// DB truth: exact current baseline and explicit requirement traces into both contracts.
const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='REQUIREMENT_VERSION' AND source_id=? AND target_type='DESIGN_CONTRACT_VERSION' AND target_id=?) design_trace,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='REQUIREMENT_VERSION' AND source_id=? AND target_type='TECHNICAL_CONTRACT_VERSION' AND target_id=?) technical_trace,
    (SELECT COUNT(*) FROM product_delivery_plans WHERE project_id=? AND status='CURRENT') current_plan`,
  [projectId,requirementVersionId,designContractVersionId,projectId,requirementVersionId,technicalContractVersionId,projectId]
);
assert.equal(Number(truth.design_trace),1);
assert.equal(Number(truth.technical_trace),1);
assert.equal(Number(truth.current_plan),1);
await db.end();

console.log('Runtime V2.7 M27.2 feasibility + delivery + design + technical contract validation passed');
