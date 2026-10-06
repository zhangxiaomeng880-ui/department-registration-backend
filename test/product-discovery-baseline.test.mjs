import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m271-platform-token';
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
  tenantKey:`m271-${suffix}`,name:'M27.1 Tenant'
});
expectStatus(r,201);const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:'main',name:'M27.1 Workspace'
});
expectStatus(r,201);const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`pd-${suffix}`,name:'M27.1 Product Project',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SAAS_PLATFORM'
});
expectStatus(r,201);const projectId=r.body.data.id;

// Non-product projects cannot use Product Development domain objects.
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`other-${suffix}`,name:'Non Product Project',
  projectType:'AIGC_CONTENT',projectSubtypeKey:'SHORT_DRAMA'
});
expectStatus(r,201);const nonProductId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${nonProductId}/product-evidence`,{
  evidenceKey:'BAD',sourceType:'USER_FEEDBACK',observation:'No',
  rawEvidence:{source:'test'}
});
expectStatus(r,409);
assert.equal(r.body.error,'PRODUCT_PROJECT_TYPE_REQUIRED');

// Discovery gate must fail before formal objects exist.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-DISCOVERY/evaluate`,{
  asOf:'2026-10-07T00:00:00Z'
});
expectStatus(r,200);
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('EVIDENCE_REQUIRED'));
assert.ok(r.body.data.reasonCodes.includes('COMPETITIVE_SNAPSHOT_REQUIRED'));

// Evidence -> Insight -> Opportunity.
r=await request('POST',`/api/runtime/projects/${projectId}/product-evidence`,{
  evidenceKey:'EV-USER-1',sourceType:'USER_FEEDBACK',
  sourceRef:'support://feedback/1',sourceDate:'2026-10-06',
  segment:{role:'operator'},context:{flow:'project-review'},
  observation:'Users cannot quickly see why a project is blocked.',
  rawEvidence:{feedbackId:'F-1',summary:'Need blocker reason in one place'},
  confidence:'HIGH',freshnessExpiresAt:'2027-01-01T00:00:00Z'
});
expectStatus(r,201);const evidenceId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-insights`,{
  insightKey:'INS-1',title:'Blocker context is fragmented',
  observation:'Project operators need a single evidence-backed blocker view.',
  evidenceIds:[evidenceId],confidence:'HIGH'
});
expectStatus(r,201);const insightId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-opportunities`,{
  opportunityKey:'OPP-1',opportunityType:'PROBLEM',title:'Unified blocker context',
  painOpportunity:'Operators spend time reconstructing why work is blocked.',
  impact:{user:'faster triage',business:'less waiting'},
  frequency:'WEEKLY',severity:'HIGH',confidence:'HIGH',
  insightIds:[insightId]
});
expectStatus(r,201);const opportunityId=r.body.data.id;

// Competitive evidence is a required dated Benchmark Snapshot, not prose in a PRD.
r=await request('POST','/api/runtime/benchmark-subjects',{
  workspaceId,projectId,benchmarkType:'PRODUCT_MARKET',
  subjectKey:`COMP-${suffix}`,name:'Comparable Project Platform'
});
expectStatus(r,201);const subjectId=r.body.data.id;

r=await request('POST',`/api/runtime/benchmark-subjects/${subjectId}/snapshots`,{
  snapshotKey:'2026-10-06',sourceProvider:'OFFICIAL_SITE',
  sourceRef:'https://example.invalid/project-health',
  observedAt:'2026-10-06T10:00:00Z',asOfDate:'2026-10-06',
  freshnessDays:30,evidence:{capture:'official-project-page'}
});
expectStatus(r,201);const benchmarkSnapshotId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-DISCOVERY/evaluate`,{
  asOf:'2026-10-07T00:00:00Z'
});
expectStatus(r,200);
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Priority requires candidate + hypothesis + explicit Project Decision.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PRIORITY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('SOLUTION_CANDIDATE_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${projectId}/product-solution-candidates`,{
  opportunityId,candidateKey:'SOL-1',title:'Unified blocker panel',
  summary:'Show blocker, owner, waiting-on, resume condition and evidence together.',
  assumptions:['Existing blocker data is sufficient']
});
expectStatus(r,201);const candidateId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-hypotheses`,{
  opportunityId,solutionCandidateId:candidateId,hypothesisKey:'HYP-1',
  statement:'If blocker context is unified, triage time will fall.',
  validationMethod:{type:'usage-study'},successSignal:{metric:'triage_time',direction:'down'},
  confidence:'MEDIUM'
});
expectStatus(r,201);const hypothesisId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/decisions`,{
  decisionKey:`PD-PRIORITY-${suffix}`,title:'Prioritize unified blocker context',
  context:{opportunityId},options:['DO_NOW','PLAN','PARK'],
  decision:{selected:'DO_NOW'},impact:{scope:'M27.1'},evidence:{discovery:true}
});
expectStatus(r,201);const decisionId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-prioritizations`,{
  opportunityId,hypothesisId,prioritizationKey:'PRI-1',scoringModel:'CUSTOM',
  scoreInputs:{
    goalFit:5,impact:5,evidenceStrength:4,reachFrequency:4,confidence:4,
    effort:2,riskDependency:2,timeCriticality:4,opportunityCost:3
  },
  computedScore:4.25,output:'DO_NOW',
  rationale:'High impact and evidence strength with manageable effort.',
  decisionId,evidence:{review:'product-owner'}
});
expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PRIORITY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Goal and Product Bet.
r=await request('POST',`/api/runtime/projects/${projectId}/product-goals`,{
  goalKey:'GOAL-1',
  businessGoal:'Reduce project delivery waiting time.',
  productGoal:'Make blockers understandable and actionable in one view.',
  primaryMetric:{key:'median_blocker_triage_minutes',target:'-30%'},
  guardrailMetrics:[{key:'false_blocker_rate',max:'2%'}],
  qualitativeAcceptance:['PM can explain blocker reason without reconstructing history'],
  targetWindow:'2026-Q4',nonGoals:['Build a full workforce planning system']
});
expectStatus(r,201);const goalId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-bets`,{
  goalDefinitionId:goalId,opportunityId,hypothesisId,betKey:'BET-1',
  statement:'A unified blocker context panel is the smallest useful intervention.',
  expectedOutcome:{metric:'median_blocker_triage_minutes',target:'-30%'},
  constraints:{scope:'project-governance-only'},evidence:{decisionId}
});
expectStatus(r,201);const betId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-GOAL/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Product Definition: an approved, fully specified requirement with upstream trace.
r=await request('POST',`/api/runtime/projects/${projectId}/product-requirements`,{
  requirementKey:'REQ-1',requirementType:'FUNCTIONAL',title:'Unified blocker context panel',
  status:'APPROVED',userRoleSegment:{role:'PM'},
  scenario:{trigger:'Open active project with blocker'},
  useCaseJob:{job:'Understand why delivery is blocked and what unblocks it'},
  businessRules:[
    'Only active blockers are shown by default',
    'Waiting-on and resume condition are preserved as source facts'
  ],
  preconditions:['Project exists'],
  mainFlow:['Open project','Read blocker context','Navigate to evidence'],
  alternateFlow:['No blocker -> show clear empty state'],
  exceptionFlow:['Missing evidence -> show unknown, never invent'],
  stateMatrix:{normal:true,empty:true,error:true,loading:true,permission:true},
  inScope:['blocker reason','owner','waiting-on','resume condition','evidence'],
  outOfScope:['resource planning','individual performance scoring'],
  assumptions:['M26 blocker object is the source of truth'],
  openQuestions:['Whether dependency view joins this panel in M27.2'],
  priority:'HIGH',
  acceptanceCriteria:[
    'Given an open blocker, the panel displays reason and resume condition',
    'If evidence is absent, the UI reports evidence unavailable'
  ],
  metric:{primary:'median_blocker_triage_minutes',guardrail:'false_blocker_rate'},
  dependency:{objects:['project_blockers','project_dependencies']},
  risk:{privacy:'low'},
  evidenceLinks:[{evidenceId},{insightId},{opportunityId},{decisionId}],
  evidence:{productDefinitionReview:'PASS'},
  traceFrom:[
    {sourceType:'PRODUCT_BET',sourceId:betId,linkType:'JUSTIFIES'},
    {sourceType:'OPPORTUNITY',sourceId:opportunityId,linkType:'JUSTIFIES'}
  ]
});
expectStatus(r,201);const requirementId=r.body.data.id;
assert.equal(r.body.data.currentVersionNo,1);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PRODUCT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Freeze Product Baseline -> generic Project Baseline.
r=await request('POST',`/api/runtime/projects/${projectId}/product-baselines`,{
  baselineKey:'PD-B1',goalDefinitionId:goalId,productBetId:betId,
  scope:{include:['unified blocker panel']},
  businessRules:{sourceOfTruth:'project_blockers'},
  acceptanceCriteria:{requirementKeys:['REQ-1']},
  metric:{primary:'median_blocker_triage_minutes'},
  keyDecisions:[{decisionId}],
  outOfScope:{exclude:['resource planning']},
  evidence:{gates:['G-PD-DISCOVERY','G-PD-PRIORITY','G-PD-GOAL','G-PD-PRODUCT']}
});
expectStatus(r,201);const productBaseline1=r.body.data.id;
const projectBaseline1=r.body.data.projectBaselineId;
assert.equal(r.body.data.requirementVersions[0].versionNo,1);

// Requirement versions cannot drift silently.
r=await request('POST',`/api/runtime/product-requirements/${requirementId}/versions`,{
  scenario:{trigger:'Changed without governed request'},
  businessRules:['bad'],mainFlow:['bad'],stateMatrix:{normal:true},
  inScope:['bad'],outOfScope:['bad'],acceptanceCriteria:['bad'],
  metric:{primary:'bad'},evidenceLinks:[{evidenceId}]
});
expectStatus(r,409);
assert.equal(r.body.error,'PRODUCT_REQUIREMENT_CHANGE_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/changes`,{
  changeKey:'CR-REQ-1',before:{requirementVersion:1},
  changeReason:'Add dependency context to acceptance scope.',
  changeScope:{requirementKey:'REQ-1'},
  impactedObjects:['DESIGN','CONTRACT','CODE','TEST'],
  revalidationScope:['G-PD-PRODUCT','G-PD-DESIGN','G-PD-CONTRACT'],
  after:{requirementVersion:2},evidence:{ownerReview:'PASS'}
});
expectStatus(r,201);const changeId=r.body.data.id;

r=await request('POST',`/api/runtime/product-requirements/${requirementId}/versions`,{
  changeId,status:'APPROVED',userRoleSegment:{role:'PM'},
  scenario:{trigger:'Open active project with blocker'},
  useCaseJob:{job:'Understand blocker and critical dependency'},
  businessRules:[
    'Only active blockers are shown by default',
    'Critical dependency context is shown when present'
  ],
  mainFlow:['Open project','Read blocker context','Read critical dependency','Navigate to evidence'],
  alternateFlow:['No blocker -> show clear empty state'],
  exceptionFlow:['Missing evidence -> show unknown, never invent'],
  stateMatrix:{normal:true,empty:true,error:true,loading:true,permission:true},
  inScope:['blocker context','critical dependency context'],
  outOfScope:['resource planning'],
  assumptions:['M26 governance objects remain source of truth'],
  openQuestions:[],
  priority:'HIGH',
  acceptanceCriteria:[
    'Open blocker shows reason and resume condition',
    'Critical dependency is shown when it affects the blocker'
  ],
  metric:{primary:'median_blocker_triage_minutes',guardrail:'false_blocker_rate'},
  dependency:{objects:['project_blockers','project_dependencies']},
  risk:{privacy:'low'},
  evidenceLinks:[{evidenceId},{insightId},{opportunityId},{decisionId}],
  evidence:{changeId}
});
expectStatus(r,201);
assert.equal(r.body.data.currentVersionNo,2);
assert.equal(r.body.data.changeId,changeId);

// Existing baseline is now stale until a new Product Baseline is locked.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PRODUCT/evaluate`,{});
expectStatus(r,200);
assert.equal(r.body.data.status,'HOLD',JSON.stringify(r.body));
assert.ok(r.body.data.reasonCodes.includes('REQUIREMENT_BASELINE_STALE'));

r=await request('POST',`/api/runtime/projects/${projectId}/product-baselines`,{
  baselineKey:'PD-B2',versionLabel:'PD-B2',goalDefinitionId:goalId,productBetId:betId,
  scope:{include:['unified blocker panel','critical dependency context']},
  businessRules:{sourceOfTruth:['project_blockers','project_dependencies']},
  acceptanceCriteria:{requirementKeys:['REQ-1'],version:2},
  metric:{primary:'median_blocker_triage_minutes'},
  keyDecisions:[{decisionId},{changeId}],
  outOfScope:{exclude:['resource planning']},
  evidence:{changeId,revalidation:'PASS'}
});
expectStatus(r,201);const productBaseline2=r.body.data.id;
assert.notEqual(productBaseline1,productBaseline2);
assert.notEqual(projectBaseline1,r.body.data.projectBaselineId);
assert.equal(r.body.data.requirementVersions[0].versionNo,2);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-PRODUCT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Read model is bidirectionally inspectable.
r=await request('GET',`/api/runtime/projects/${projectId}/product-domain`);
expectStatus(r,200);
assert.equal(r.body.data.evidence.length,1);
assert.equal(r.body.data.insights.length,1);
assert.equal(r.body.data.opportunities.length,1);
assert.equal(r.body.data.prioritizations[0].decisionId,decisionId);
assert.equal(r.body.data.requirements[0].currentVersionNo,2);
assert.equal(r.body.data.baselines.length,2);
assert.equal(r.body.data.baselines[0].status,'HISTORICAL');
assert.equal(r.body.data.baselines[0].replacedById,productBaseline2);
assert.equal(r.body.data.baselines[1].status,'CURRENT');
assert.ok(r.body.data.traces.some(x=>x.sourceType==='EVIDENCE'&&x.targetType==='INSIGHT'));
assert.ok(r.body.data.traces.some(x=>x.sourceType==='PRODUCT_BET'&&x.targetType==='REQUIREMENT'));
assert.ok(r.body.data.traces.some(x=>x.sourceType==='REQUIREMENT_VERSION'&&x.targetType==='PRODUCT_BASELINE'));

r=await request('GET',`/api/runtime/product-requirements/${requirementId}`);
expectStatus(r,200);
assert.equal(r.body.data.versions.length,2);
assert.equal(r.body.data.versions[1].changeId,changeId);

// Database truth: one current Product Baseline and exact linkage to current generic Project Baseline.
const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',
  user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[baselineTruth]]=await db.execute(
  `SELECT
     (SELECT COUNT(*) FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT') current_product_baselines,
     (SELECT COUNT(*) FROM project_baselines WHERE project_id=? AND status='CURRENT') current_project_baselines`,
  [projectId,projectId]
);
assert.equal(Number(baselineTruth.current_product_baselines),1);
assert.equal(Number(baselineTruth.current_project_baselines),1);

const [[projectTruth]]=await db.execute(
  `SELECT p.current_baseline_id current_project_baseline_id,b.project_baseline_id product_project_baseline_id
     FROM projects p
     JOIN product_requirement_baselines b ON b.project_id=p.id AND b.status='CURRENT'
    WHERE p.id=?`,[projectId]
);
assert.equal(projectTruth.current_project_baseline_id,projectTruth.product_project_baseline_id);

const [[benchmarkTruth]]=await db.execute(
  "SELECT COUNT(*) AS count FROM benchmark_snapshots WHERE id=? AND status='CURRENT'",
  [benchmarkSnapshotId]
);
assert.equal(Number(benchmarkTruth.count),1);

await db.end();
console.log('Runtime V2.7 M27.1 product discovery + requirement baseline validation passed');
