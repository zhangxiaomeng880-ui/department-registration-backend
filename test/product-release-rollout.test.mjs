import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m274-platform-token';
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
const shaA='a'.repeat(40),shaB='b'.repeat(40);
const artifactSha='c'.repeat(64);

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

let r=await request('GET','/api/runtime/product-modules');
expectStatus(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.PRODUCT_RESEARCH_STUDY,'用户研究');
assert.equal(modules.PRODUCT_REQUIREMENT_BASELINE,'需求基线');
assert.equal(modules.PRODUCT_FEASIBILITY_REVIEW,'可行性评审');
assert.equal(modules.PRODUCT_DESIGN_CONTRACT,'设计契约');
assert.equal(modules.PRODUCT_TECHNICAL_CONTRACT,'技术契约');
assert.equal(modules.PRODUCT_AI_CONTRACT,'AI 应用专项契约');
assert.equal(modules.PRODUCT_ENGINEERING_CHANGESET,'工程变更集');
assert.equal(modules.PRODUCT_BUILD_RECORD,'构建记录');
assert.equal(modules.PRODUCT_PREVIEW_DEPLOYMENT,'预览部署');
assert.equal(modules.PRODUCT_SMOKE_EVIDENCE,'冒烟验证证据');
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));

r=await request('POST','/api/runtime/tenants',{tenantKey:`m274-${suffix}`,name:'M27.4 Tenant'});
expectStatus(r,201);const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'M27.4 Workspace'});
expectStatus(r,201);const workspaceId=r.body.data.id;
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`eng-${suffix}`,name:'M27.4 产品工程项目',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SAAS_PLATFORM'
});
expectStatus(r,201);const projectId=r.body.data.id;

// Seed an already-passed M27.1/M27.2 baseline; those domains have independent full gates.
const opportunityId=randomUUID(),goalId=randomUUID(),betId=randomUUID();
const requirementId=randomUUID(),requirementVersionId=randomUUID();
const projectBaselineId=randomUUID(),productBaselineId=randomUUID();
const feasibilityId=randomUUID(),releaseVersionId=randomUUID(),deliveryPlanId=randomUUID();
const designContractId=randomUUID(),designVersionId=randomUUID();
const technicalContractId=randomUUID(),technicalVersionId=randomUUID();
const workItemId=randomUUID();

await db.execute(
  `INSERT INTO product_opportunities
   (id,project_id,opportunity_key,opportunity_type,title,pain_opportunity,impact_json,confidence,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [opportunityId,projectId,'OPP-ENG','OPPORTUNITY','工程追溯','缺少精确工程版本链',
   JSON.stringify({delivery:'traceable'}),'HIGH','OPEN',JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_goal_definitions
   (id,project_id,goal_key,business_goal,product_goal,primary_metric_json,qualitative_acceptance_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [goalId,projectId,'GOAL-ENG','降低工程返工','建立精确工程版本链',
   JSON.stringify({metric:'traceability'}),JSON.stringify(['exact commit preview']),'CURRENT',JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_bets
   (id,project_id,goal_definition_id,opportunity_id,bet_key,statement,expected_outcome_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [betId,projectId,goalId,opportunityId,'BET-ENG','精确版本链减少验收歧义',
   JSON.stringify({traceability:'100%'}),'APPROVED',JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_requirements
   (id,project_id,requirement_key,requirement_type,title,status,current_version_no)
   VALUES (?,?,?,?,?,'APPROVED',1)`,
  [requirementId,projectId,'REQ-ENG-1','FUNCTIONAL','精确工程版本追溯']
);
await db.execute(
  `INSERT INTO product_requirement_versions
   (id,requirement_id,project_id,version_no,scenario_json,business_rules_json,main_flow_json,state_matrix_json,
    in_scope_json,out_of_scope_json,priority,acceptance_criteria_json,metric_json,evidence_links_json,evidence_json)
   VALUES (?,?,?,1,?,?,?,?,?,?,'HIGH',?,?,?,?)`,
  [requirementVersionId,requirementId,projectId,
   JSON.stringify({trigger:'engineering'}),
   JSON.stringify(['preview must equal build commit']),
   JSON.stringify(['implement','build','preview','smoke']),
   JSON.stringify({normal:true,error:true}),
   JSON.stringify(['repo','branch','commit','pr','build','preview']),
   JSON.stringify(['production release']),
   JSON.stringify(['exact commit is traceable']),
   JSON.stringify({primary:'traceability'}),
   JSON.stringify([{fixture:'M27.4'}]),
   JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO project_baselines
   (id,project_id,baseline_no,version_label,status,scope_json,out_of_scope_json,evidence_json)
   VALUES (?,?,1,'ENG-B1','CURRENT',?,?,?)`,
  [projectBaselineId,projectId,JSON.stringify({include:['engineering trace']}),
   JSON.stringify({exclude:['production']}),JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_requirement_baselines
   (id,project_id,project_baseline_id,baseline_key,goal_definition_id,product_bet_id,requirement_versions_json,
    scope_json,business_rules_json,acceptance_criteria_json,metric_json,key_decisions_json,out_of_scope_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT',?)`,
  [productBaselineId,projectId,projectBaselineId,'PD-ENG-B1',goalId,betId,
   JSON.stringify([{requirementId,requirementKey:'REQ-ENG-1',versionNo:1,versionId:requirementVersionId}]),
   JSON.stringify({include:['engineering trace']}),JSON.stringify({exactVersion:true}),
   JSON.stringify({requirementKeys:['REQ-ENG-1']}),JSON.stringify({primary:'traceability'}),
   JSON.stringify([]),JSON.stringify({exclude:['production']}),JSON.stringify({fixture:'M27.4'})]
);
await db.execute('UPDATE projects SET current_baseline_id=? WHERE id=?',[projectBaselineId,projectId]);

const feasibilitySections=Object.fromEntries([
  'ARCHITECTURE','FRAMEWORK_RUNTIME','DATA','API_INTEGRATION','AUTH_PERMISSION',
  'SECURITY_PRIVACY_COMPLIANCE','PERFORMANCE_SCALABILITY','RELIABILITY_AVAILABILITY',
  'DEPLOYMENT_MIGRATION','THIRD_PARTY_DEPENDENCY','COST_QUOTA','OBSERVABILITY_SUPPORTABILITY','ROLLBACK'
].map(k=>[k,{status:'PASS'}]));
await db.execute(
  `INSERT INTO product_feasibility_reviews
   (id,project_id,product_baseline_id,review_key,overall_status,section_status_json,architecture_json,
    framework_runtime_json,data_json,api_integration_json,auth_permission_json,security_privacy_compliance_json,
    performance_scalability_json,reliability_availability_json,deployment_migration_json,third_party_dependency_json,
    cost_quota_json,observability_supportability_json,rollback_json,risk_summary_json,architecture_decision_required,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
  [feasibilityId,projectId,productBaselineId,'FEAS-ENG','PASS',JSON.stringify(feasibilitySections),
   '{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}',JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO project_versions(id,project_id,version_key,version_type,label,status)
   VALUES (?,?,?,'RELEASE_DISTRIBUTION','M27.4 工程候选','DRAFT')`,
  [releaseVersionId,projectId,'REL-M274']
);
await db.execute(
  `INSERT INTO project_work_items
   (id,project_id,item_key,item_type,title,stage_key,priority,status,estimate_hours,acceptance_criteria_json,evidence_json)
   VALUES (?,?,?,?,?,?,'HIGH','IN_PROGRESS',8,?,?)`,
  [workItemId,projectId,'WI-ENG-1','FEATURE','实现工程版本追溯','PD_09_ENGINEERING',
   JSON.stringify(['commit/build/preview/smoke exact']),JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_delivery_plans
   (id,project_id,product_baseline_id,feasibility_review_id,plan_key,target_release_version_id,
    milestone_ids_json,iteration_ids_json,work_item_ids_json,dependency_ids_json,capacity_snapshot_ids_json,
    critical_path_json,release_sequence_json,definition_of_done_json,acceptance_plan_json,risk_blocker_plan_json,
    status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT',?)`,
  [deliveryPlanId,projectId,productBaselineId,feasibilityId,'PLAN-ENG',releaseVersionId,
   '[]','[]',JSON.stringify([workItemId]),'[]','[]',
   JSON.stringify({items:[workItemId]}),JSON.stringify(['engineering','build','preview']),
   JSON.stringify(['G-PD-ENGINEERING PASS']),JSON.stringify({next:'acceptance'}),
   JSON.stringify({failClosed:true}),JSON.stringify({fixture:'M27.4'})]
);

await db.execute(
  `INSERT INTO product_design_contracts(id,project_id,contract_key,title,status,current_version_no)
   VALUES (?,?,?,?, 'APPROVED',1)`,
  [designContractId,projectId,'DESIGN-ENG','工程追溯设计契约']
);
await db.execute(
  `INSERT INTO product_design_contract_versions
   (id,design_contract_id,project_id,product_baseline_id,version_no,source_locator_json,source_verification_json,
    information_architecture_json,user_flows_json,screens_pages_json,components_json,tokens_style_json,interaction_json,
    state_matrix_json,responsive_adaptive_json,accessibility_json,content_copy_json,platform_behavior_json,
    prototype_locator_json,design_acceptance_matrix_json,evidence_json)
   VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [designVersionId,designContractId,projectId,productBaselineId,
   JSON.stringify({provider:'FIGMA',ref:'fixture'}),
   JSON.stringify({readable:true,verifiedAt:'2026-10-07T00:00:00Z',evidenceRef:'fixture://design'}),
   '{}','{}','{}','{}','{}','{}',JSON.stringify({normal:true,error:true}),
   '{}','{}','{}','{}',JSON.stringify({ref:'fixture'}),JSON.stringify({REQ_ENG_1:['pass']}),
   JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_trace_links
   (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json)
   VALUES (?,?,?,?,?,?,?,?)`,
  [randomUUID(),projectId,'REQUIREMENT_VERSION',requirementVersionId,'DESIGN_CONTRACT_VERSION',
   designVersionId,'DESIGNED_BY',JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_technical_contracts(id,project_id,contract_key,title,status,current_version_no)
   VALUES (?,?,?,?, 'APPROVED',1)`,
  [technicalContractId,projectId,'TECH-ENG','工程追溯技术契约']
);
const technicalSections={
  TECHNICAL_DESIGN:{status:'PASS'},API:{status:'N_A',rationale:'No API change'},
  DATA:{status:'N_A',rationale:'No data schema change'},INTEGRATION:{status:'N_A',rationale:'No external integration'},
  INSTRUMENTATION:{status:'PASS'}
};
await db.execute(
  `INSERT INTO product_technical_contract_versions
   (id,technical_contract_id,project_id,product_baseline_id,design_contract_version_id,version_no,
    technical_design_json,api_contract_json,data_contract_json,integration_contract_json,
    instrumentation_contract_json,section_status_json,evidence_json)
   VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?)`,
  [technicalVersionId,technicalContractId,projectId,productBaselineId,designVersionId,
   JSON.stringify({sourceControl:'GitHub'}),JSON.stringify({n_a:true}),
   JSON.stringify({n_a:true}),JSON.stringify({n_a:true}),
   JSON.stringify({events:['engineering_preview_verified']}),JSON.stringify(technicalSections),
   JSON.stringify({fixture:'M27.4'})]
);
await db.execute(
  `INSERT INTO product_trace_links
   (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json)
   VALUES (?,?,?,?,?,?,?,?)`,
  [randomUUID(),projectId,'REQUIREMENT_VERSION',requirementVersionId,'TECHNICAL_CONTRACT_VERSION',
   technicalVersionId,'IMPLEMENTED_BY_CONTRACT',JSON.stringify({fixture:'M27.4'})]
);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Engineering gate starts HOLD.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ENGINEERING/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('ENGINEERING_WORK_ITEM_NOT_COMPLETED:WI-ENG-1'));
assert.ok(r.body.data.reasonCodes.includes('ENGINEERING_CHANGESET_REQUIRED:WI-ENG-1'));

// Source verification and exact merged PR commit are mandatory.
const changesetBase={
  productBaselineId,deliveryPlanId,workItemId,designContractVersionId:designVersionId,
  technicalContractVersionId:technicalVersionId,changesetKey:'CS-1',
  repositoryFullName:'example/product-runtime',branchName:'feat/m274',
  commitSha:shaA,
  pullRequest:{number:274,url:'https://example.invalid/pr/274',state:'MERGED',merged:true,mergedCommitSha:shaB},
  sourceVerification:{verified:true,verifiedAt:'2026-10-07T01:00:00Z',evidenceRef:'github://verification/274'},
  requirementVersionIds:[requirementVersionId],
  dependencyChange:{status:'NO_CHANGE'},migration:{status:'N_A',rationale:'No database change'},
  staticCheck:{status:'PASS',checks:['lint','typecheck']},
  automatedTest:{status:'PASS',suites:['unit','integration']},
  knownIssues:[],evidence:{github:'verified'}
};
r=await request('POST',`/api/runtime/projects/${projectId}/product-engineering-changesets`,changesetBase);
expectStatus(r,409);assert.equal(r.body.error,'ENGINEERING_PR_COMMIT_MISMATCH');

r=await request('POST',`/api/runtime/projects/${projectId}/product-engineering-changesets`,{
  ...changesetBase,pullRequest:{...changesetBase.pullRequest,mergedCommitSha:shaA}
});
expectStatus(r,201);const changesetId=r.body.data.id;
assert.equal(r.body.data.commitSha,shaA);

// Build must use exact changeset commit.
r=await request('POST',`/api/runtime/projects/${projectId}/product-build-records`,{
  changesetId,targetReleaseVersionId:releaseVersionId,buildKey:'BUILD-1',buildId:'ci-274',
  commitSha:shaB,artifactLocator:{provider:'CI',ref:'artifact://274'},
  artifactSha256:artifactSha,buildStatus:'SUCCESS',buildSystem:'GITHUB_ACTIONS',
  configVersion:{runtime:'v2.7'},migrationVersion:{status:'N_A',rationale:'No migration'},
  testSummary:{status:'PASS',suites:['unit','integration']},evidence:{ci:'success'}
});
expectStatus(r,409);assert.equal(r.body.error,'BUILD_CHANGESET_COMMIT_MISMATCH');

r=await request('POST',`/api/runtime/projects/${projectId}/product-build-records`,{
  changesetId,targetReleaseVersionId:releaseVersionId,buildKey:'BUILD-1',buildId:'ci-274',
  commitSha:shaA,artifactLocator:{provider:'CI',ref:'artifact://274'},
  artifactSha256:artifactSha,buildStatus:'SUCCESS',buildSystem:'GITHUB_ACTIONS',
  configVersion:{runtime:'v2.7'},migrationVersion:{status:'N_A',rationale:'No migration'},
  testSummary:{status:'PASS',suites:['unit','integration']},evidence:{ci:'success'}
});
expectStatus(r,201);const buildId=r.body.data.id;

// Preview readiness is fail-closed.
r=await request('POST',`/api/runtime/projects/${projectId}/product-preview-deployments`,{
  buildRecordId:buildId,targetReleaseVersionId:releaseVersionId,previewKey:'PREVIEW-1',
  environment:'staging-preview',deploymentId:'deploy-274',deploymentStatus:'SUCCESS',
  commitSha:shaA,previewLocator:{type:'url',ref:'https://preview.invalid/274'},
  configSnapshot:{runtime:'v2.7'},health:{status:'HEALTHY'},readiness:{status:'PASS',httpStatus:503},
  evidence:{deployment:'success'}
});
expectStatus(r,409);assert.equal(r.body.error,'PREVIEW_READINESS_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/product-preview-deployments`,{
  buildRecordId:buildId,targetReleaseVersionId:releaseVersionId,previewKey:'PREVIEW-1',
  environment:'staging-preview',deploymentId:'deploy-274',deploymentStatus:'SUCCESS',
  commitSha:shaA,previewLocator:{type:'url',ref:'https://preview.invalid/274'},
  configSnapshot:{runtime:'v2.7'},health:{status:'HEALTHY'},readiness:{status:'PASS',httpStatus:200},
  evidence:{deployment:'success'}
});
expectStatus(r,201);const previewId=r.body.data.id;

// Smoke evidence also fails closed.
r=await request('POST',`/api/runtime/projects/${projectId}/product-smoke-evidence`,{
  previewDeploymentId:previewId,smokeKey:'SMOKE-1',status:'PASS',
  checks:[{key:'ready',status:'PASS'},{key:'main-flow',status:'FAIL'}],
  evidence:{runner:'synthetic'}
});
expectStatus(r,409);assert.equal(r.body.error,'SMOKE_CHECKS_PASS_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/product-smoke-evidence`,{
  previewDeploymentId:previewId,smokeKey:'SMOKE-1',status:'PASS',
  checks:[{key:'ready',status:'PASS'},{key:'main-flow',status:'PASS'}],
  evidence:{runner:'synthetic'}
});
expectStatus(r,201);const smokeId=r.body.data.id;

// Even with build/preview/smoke, unfinished engineering work keeps Gate HOLD.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ENGINEERING/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('ENGINEERING_WORK_ITEM_NOT_COMPLETED:WI-ENG-1'));

r=await request('PATCH',`/api/runtime/work-items/${workItemId}`,{
  status:'COMPLETED',actualWorkMinutes:480,evidence:{engineering:'complete'}
});
expectStatus(r,200);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ENGINEERING/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.exactPreviews.length,1);
assert.equal(r.body.data.evidenceSnapshot.exactPreviews[0].commitSha,shaA);
assert.equal(r.body.data.evidenceSnapshot.exactPreviews[0].smokeEvidenceId,smokeId);

// Read model exposes exact version chain.
r=await request('GET',`/api/runtime/projects/${projectId}/product-engineering-domain`);
expectStatus(r,200);
assert.equal(r.body.data.changesets.length,1);
assert.equal(r.body.data.builds.length,1);
assert.equal(r.body.data.previews.length,1);
assert.equal(r.body.data.smokeEvidence.length,1);
assert.equal(r.body.data.changesets[0].commitSha,shaA);
assert.equal(r.body.data.builds[0].commitSha,shaA);
assert.equal(r.body.data.previews[0].commitSha,shaA);

// Durable lineage: Requirement -> Changeset -> Build -> Preview -> Smoke.
const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='REQUIREMENT_VERSION' AND source_id=? AND target_type='ENGINEERING_CHANGESET' AND target_id=?) requirement_changeset,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='ENGINEERING_CHANGESET' AND source_id=? AND target_type='BUILD_RECORD' AND target_id=?) changeset_build,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='BUILD_RECORD' AND source_id=? AND target_type='PREVIEW_DEPLOYMENT' AND target_id=?) build_preview,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='PREVIEW_DEPLOYMENT' AND source_id=? AND target_type='SMOKE_EVIDENCE' AND target_id=?) preview_smoke`,
  [projectId,requirementVersionId,changesetId,projectId,changesetId,buildId,projectId,buildId,previewId,projectId,previewId,smokeId]
);
assert.equal(Number(truth.requirement_changeset),1);
assert.equal(Number(truth.changeset_build),1);
assert.equal(Number(truth.build_preview),1);
assert.equal(Number(truth.preview_smoke),1);

// M27.5 starts with Product Acceptance, independently from QA.
const acceptanceChecks=(functionalStatus='PASS')=>[
  {checkKey:'ACC-FUNCTIONAL',category:'FUNCTIONAL',status:functionalStatus,requirementVersionId,
   evidence:{requirement:'REQ-ENG-1'}},
  {checkKey:'ACC-BUSINESS',category:'BUSINESS_RULE',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-FLOW',category:'FLOW',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-INTERACTION',category:'INTERACTION',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-STATE',category:'STATE',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-VISUAL',category:'VISUAL',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-RESPONSIVE',category:'RESPONSIVE',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-CONTENT',category:'CONTENT',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-PERMISSION',category:'PERMISSION_ROLE',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-SCOPE',category:'SCOPE_OUT_OF_SCOPE',status:'PASS',evidence:{verified:true}},
  {checkKey:'ACC-AI',category:'AI_BEHAVIOR',status:'N_A',rationale:'SAAS_PLATFORM 项目不适用 AI 行为验收',
   evidence:{notApplicable:true}}
];

r=await request('POST',`/api/runtime/projects/${projectId}/product-acceptance-runs`,{
  productBaselineId,previewDeploymentId:previewId,acceptanceKey:'ACC-BAD-NO-GAP',
  checks:acceptanceChecks('FAIL'),gaps:[],evidence:{review:'FAIL'}
});
expectStatus(r,409);assert.equal(r.body.error,'ACCEPTANCE_FAIL_GAP_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/product-acceptance-runs`,{
  productBaselineId,previewDeploymentId:previewId,acceptanceKey:'ACC-FAIL-1',
  checks:acceptanceChecks('FAIL'),
  gaps:[{
    checkKey:'ACC-FUNCTIONAL',gapKey:'GAP-1',requirementVersionId,severity:'HIGH',
    summary:'主流程验收未达到需求标准',returnStageKey:'PD_09_ENGINEERING',
    resumePoint:{stageKey:'PD_09_ENGINEERING',workItemId,reason:'修复后从工程实现恢复'},
    evidence:{acceptance:'failed'}
  }],
  evidence:{review:'FAIL'}
});
expectStatus(r,201);const failedAcceptanceId=r.body.data.id;
assert.equal(r.body.data.gapIds.length,1);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ACCEPTANCE/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('ACCEPTANCE_OPEN_GAPS'));

r=await request('POST',`/api/runtime/projects/${projectId}/product-acceptance-runs`,{
  productBaselineId,previewDeploymentId:previewId,acceptanceKey:'ACC-PASS-1',
  checks:acceptanceChecks('PASS'),gaps:[],evidence:{review:'PASS'}
});
expectStatus(r,201);const acceptedRun1=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ACCEPTANCE/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.acceptanceRunId,acceptedRun1);
assert.equal(r.body.data.evidenceSnapshot.previewDeploymentId,previewId);

// QA Plan must cover every standard quality category.
const qaCategories=[
  'UNIT','COMPONENT','API_CONTRACT','INTEGRATION','E2E','VISUAL_REGRESSION','DEVICE_BROWSER',
  'ACCESSIBILITY','PERFORMANCE_LOAD','SECURITY_DEPENDENCY','MIGRATION_COMPATIBILITY',
  'ERROR_RECOVERY','OBSERVABILITY','INSTRUMENTATION'
];
const qaCases=qaCategories.map((category,i)=>({
  caseKey:`QA-${String(i+1).padStart(2,'0')}-${category}`,category,
  ...(category==='E2E'?{requirementVersionId}:{}),
  title:`${category} 质量验证`,assertions:{mustPass:true},evidence:{plan:'M27.5'}
}));

r=await request('POST',`/api/runtime/projects/${projectId}/product-qa-plans`,{
  productBaselineId,planKey:'QA-PLAN-1',title:'M27.5 质量验证计划',
  matrix:{standardCategories:qaCategories},cases:qaCases,evidence:{review:'PASS'}
});
expectStatus(r,201);const qaPlanId=r.body.data.id;

const qaResults=(failE2E=false)=>qaCases.map(x=>({
  caseKey:x.caseKey,
  status:(failE2E&&x.category==='E2E')?'FAIL':'PASS',
  evidence:{runner:'M27.5',category:x.category}
}));

// QA FAIL cannot disappear into a status field; it must create a Defect.
r=await request('POST',`/api/runtime/projects/${projectId}/product-qa-executions`,{
  qaPlanId,previewDeploymentId:previewId,executionKey:'QA-EXEC-BAD',
  results:qaResults(true),defects:[],evidence:{run:'failed'}
});
expectStatus(r,409);assert.equal(r.body.error,'QA_FAIL_DEFECT_REQUIRED');

const e2eCaseKey=qaCases.find(x=>x.category==='E2E').caseKey;
r=await request('POST',`/api/runtime/projects/${projectId}/product-qa-executions`,{
  qaPlanId,previewDeploymentId:previewId,executionKey:'QA-EXEC-FAIL-1',
  results:qaResults(true),
  defects:[{
    caseKey:e2eCaseKey,defectKey:'DEFECT-1',severity:'HIGH',
    summary:'主流程 E2E 回归失败',returnStageKey:'PD_09_ENGINEERING',
    evidence:{execution:'QA-EXEC-FAIL-1'}
  }],
  evidence:{run:'failed'}
});
expectStatus(r,201);const failedQaExecutionId=r.body.data.id;const defectId=r.body.data.defectIds[0];

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-QA/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('QA_UNRESOLVED_DEFECTS'));

// A real fix must create a new engineering source/build/preview chain.
r=await request('POST',`/api/runtime/projects/${projectId}/product-engineering-changesets`,{
  productBaselineId,deliveryPlanId,workItemId,designContractVersionId:designVersionId,
  technicalContractVersionId:technicalVersionId,changesetKey:'CS-2-FIX',
  repositoryFullName:'example/product-runtime',branchName:'fix/m275-defect-1',
  commitSha:shaB,
  pullRequest:{number:275,url:'https://example.invalid/pr/275',state:'MERGED',merged:true,mergedCommitSha:shaB},
  sourceVerification:{verified:true,verifiedAt:'2026-10-07T01:30:00Z',evidenceRef:'github://verification/275'},
  requirementVersionIds:[requirementVersionId],
  dependencyChange:{status:'NO_CHANGE'},migration:{status:'N_A',rationale:'No database change'},
  staticCheck:{status:'PASS',checks:['lint','typecheck']},
  automatedTest:{status:'PASS',suites:['unit','integration','e2e-fix']},
  knownIssues:[],evidence:{defectId}
});
expectStatus(r,201);const fixChangesetId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-build-records`,{
  changesetId:fixChangesetId,targetReleaseVersionId:releaseVersionId,buildKey:'BUILD-2-FIX',buildId:'ci-275',
  commitSha:shaB,artifactLocator:{provider:'CI',ref:'artifact://275'},
  artifactSha256:'d'.repeat(64),buildStatus:'SUCCESS',buildSystem:'GITHUB_ACTIONS',
  configVersion:{runtime:'v2.7'},migrationVersion:{status:'N_A',rationale:'No migration'},
  testSummary:{status:'PASS',suites:['unit','integration','e2e-fix']},evidence:{ci:'success'}
});
expectStatus(r,201);const fixBuildId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-preview-deployments`,{
  buildRecordId:fixBuildId,targetReleaseVersionId:releaseVersionId,previewKey:'PREVIEW-2-FIX',
  environment:'staging-preview',deploymentId:'deploy-275',deploymentStatus:'SUCCESS',
  commitSha:shaB,previewLocator:{type:'url',ref:'https://preview.invalid/275'},
  configSnapshot:{runtime:'v2.7'},health:{status:'HEALTHY'},readiness:{status:'PASS',httpStatus:200},
  evidence:{deployment:'success'}
});
expectStatus(r,201);const fixPreviewId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-smoke-evidence`,{
  previewDeploymentId:fixPreviewId,smokeKey:'SMOKE-2-FIX',status:'PASS',
  checks:[{key:'ready',status:'PASS'},{key:'main-flow',status:'PASS'}],
  evidence:{runner:'synthetic-fix'}
});
expectStatus(r,201);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ENGINEERING/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.exactPreviews[0].commitSha,shaB);
assert.equal(r.body.data.evidenceSnapshot.exactPreviews[0].previewDeploymentId,fixPreviewId);

// New code invalidates the old acceptance target; fixed Preview must be accepted again.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ACCEPTANCE/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('ACCEPTANCE_PREVIEW_NOT_ENGINEERING_CURRENT'));

r=await request('POST',`/api/runtime/projects/${projectId}/product-acceptance-runs`,{
  productBaselineId,previewDeploymentId:fixPreviewId,acceptanceKey:'ACC-PASS-FIX',
  checks:acceptanceChecks('PASS'),gaps:[],evidence:{review:'PASS',fix:true}
});
expectStatus(r,201);const acceptedFixRunId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-ACCEPTANCE/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.acceptanceRunId,acceptedFixRunId);
assert.equal(r.body.data.evidenceSnapshot.previewDeploymentId,fixPreviewId);

// Retest cannot reuse the original failed source.
r=await request('POST',`/api/runtime/qa-defects/${defectId}/retests`,{
  previewDeploymentId:previewId,fixChangesetId:changesetId,fixCommitSha:shaA,
  status:'PASS',evidence:{invalid:'same-source'}
});
expectStatus(r,409);assert.equal(r.body.error,'QA_FIX_MUST_CHANGE_SOURCE');

r=await request('POST',`/api/runtime/qa-defects/${defectId}/retests`,{
  previewDeploymentId:fixPreviewId,fixChangesetId,fixCommitSha:shaB,
  status:'PASS',evidence:{retest:'PASS'}
});
expectStatus(r,201);const retestId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-qa-regressions`,{
  qaPlanId,previewDeploymentId:fixPreviewId,regressionKey:'REGRESSION-FIX-1',status:'PASS',
  scope:{mode:'FULL',areas:qaCategories},defectIds:[defectId],evidence:{regression:'PASS'}
});
expectStatus(r,201);const regressionId=r.body.data.id;

// Final QA Execution must be clean on the exact accepted fixed Preview.
r=await request('POST',`/api/runtime/projects/${projectId}/product-qa-executions`,{
  qaPlanId,previewDeploymentId:fixPreviewId,executionKey:'QA-EXEC-PASS-FIX',
  results:qaResults(false),defects:[],evidence:{run:'PASS',fix:true}
});
expectStatus(r,201);const finalQaExecutionId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-QA/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.qaExecutionId,finalQaExecutionId);
assert.equal(r.body.data.evidenceSnapshot.previewDeploymentId,fixPreviewId);
assert.equal(r.body.data.evidenceSnapshot.regressionRunId,regressionId);
assert.equal(r.body.data.evidenceSnapshot.openDefects.length,0);

// Quality read model keeps historical failures and the closed recovery chain.
r=await request('GET',`/api/runtime/projects/${projectId}/product-quality-domain`);
expectStatus(r,200);
assert.equal(r.body.data.acceptanceRuns.length,3);
assert.equal(r.body.data.qaPlans.length,1);
assert.equal(r.body.data.qaExecutions.length,2);
assert.equal(r.body.data.defects.length,1);
assert.equal(r.body.data.defects[0].status,'RESOLVED');
assert.equal(r.body.data.defects[0].fixChangesetId,fixChangesetId);
assert.equal(r.body.data.defects[0].fixCommitSha,shaB);
assert.equal(r.body.data.retests[0].id,retestId);
assert.equal(r.body.data.regressions[0].id,regressionId);

// Durable quality lineage exists; failures are never overwritten.
const [[qualityTruth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM product_acceptance_gaps WHERE project_id=? AND acceptance_run_id=? AND status='OPEN') historical_gaps,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='PREVIEW_DEPLOYMENT' AND source_id=? AND target_type='ACCEPTANCE_RUN') preview_acceptance_links,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='QA_DEFECT' AND source_id=? AND target_type='QA_RETEST' AND target_id=?) defect_retest_links,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='PREVIEW_DEPLOYMENT' AND source_id=? AND target_type='QA_REGRESSION' AND target_id=?) preview_regression_links`,
  [projectId,failedAcceptanceId,
   projectId,fixPreviewId,
   projectId,defectId,retestId,
   projectId,fixPreviewId,regressionId]
);
assert.equal(Number(qualityTruth.historical_gaps),1);
assert.equal(Number(qualityTruth.preview_acceptance_links),1);
assert.equal(Number(qualityTruth.defect_retest_links),1);
assert.equal(Number(qualityTruth.preview_regression_links),1);

// M27.6 product modules remain Chinese.
r=await request('GET','/api/runtime/product-modules');
expectStatus(r,200);
const releaseModules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(releaseModules.PRODUCT_RELEASE_CANDIDATE,'发布候选版本');
assert.equal(releaseModules.PRODUCT_RELEASE_EVIDENCE_MANIFEST,'发布证据清单');
assert.equal(releaseModules.PRODUCT_RELEASE_OBSERVABILITY,'发布监控与告警');
assert.equal(releaseModules.PRODUCT_RELEASE_OPERATIONS,'发布运行手册与支持');
assert.equal(releaseModules.PRODUCT_RELEASE_COMMUNICATION,'发布说明与启用');
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));

// Release Readiness is not the same thing as QA PASS.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-RELEASE-READY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('FROZEN_RELEASE_CANDIDATE_REQUIRED'));

r=await request('POST','/api/runtime/identities',{
  identityKey:`m276-owner-${suffix}`,displayName:'发布负责人'
});
expectStatus(r,201);const releaseOwnerId=r.body.data.id;
r=await request('POST','/api/runtime/identities',{
  identityKey:`m276-approver-${suffix}`,displayName:'发布审批人'
});
expectStatus(r,201);const releaseApproverId=r.body.data.id;

const releaseCandidateBase={
  productBaselineId,releaseVersionId,deliveryPlanId,buildRecordId:fixBuildId,
  previewDeploymentId:fixPreviewId,acceptanceRunId:acceptedFixRunId,
  qaPlanId,qaExecutionId:finalQaExecutionId,regressionRunId:regressionId,
  rcKey:'RC-M276-1',title:'M27.6 发布候选版本',
  includedRequirementVersionIds:[requirementVersionId],
  includedWorkItemIds:[workItemId],
  environment:{previewEnvironment:'staging-preview',targetEnvironment:'production',region:'primary'},
  configPromptModelFeature:{
    config:{status:'READY',version:'runtime-v2.7'},
    featureFlags:{status:'READY',flags:{releaseReadiness:true}},
    prompt:{status:'N_A',rationale:'SAAS_PLATFORM 非 AI 应用'},
    models:{status:'N_A',rationale:'SAAS_PLATFORM 非 AI 应用'}
  },
  migration:{status:'N_A',rationale:'本候选版本无数据库变更'},
  auditCompliance:{
    audit:{status:'PASS',evidence:'audit://m276'},
    compliance:{status:'N_A',rationale:'本验证项目无新增合规范围'}
  },
  knownIssues:[],
  risks:[],
  releaseNotes:{summary:'冻结 M27.6 Release Candidate',changelog:['工程、验收、QA 证据链完成']},
  rolloutPlan:{
    strategy:'STAGED',
    verification:['health','readiness','critical flow'],
    stopConditions:['critical error','readiness fail'],
    scope:{first:'internal',then:'full'}
  },
  rollbackPlan:{
    mode:'NO_PREVIOUS_RELEASE',
    rationale:'测试项目没有上一已发布版本',
    triggers:['health fail','critical regression'],
    steps:['stop rollout','restore last known good baseline','verify health']
  },
  observability:{
    monitoring:{status:'PASS',evidence:'monitor://m276'},
    alerts:{status:'PASS',evidence:'alerts://m276'},
    dashboard:{status:'PASS',evidence:'dashboard://m276'}
  },
  operations:{
    runbook:{status:'PASS',evidence:'runbook://m276'},
    supportOwner:'product-support',incidentOwner:'runtime-oncall'
  },
  documentation:{
    userDocs:{status:'N_A',rationale:'内部 Runtime 验证项目'},
    adminDocs:{status:'READY',evidence:'docs://admin'},
    migrationGuide:{status:'N_A',rationale:'无 Migration'},
    apiSdkDocs:{status:'N_A',rationale:'无新增外部 API / SDK'}
  },
  launchEnablement:{status:'N_A',rationale:'内部验证项目不需要外部 Launch'},
  instrumentation:{status:'PASS',eventsVerified:true,primaryMetricVerified:true,evidence:'metric://m276'},
  ownerIdentityId:releaseOwnerId,approverIdentityId:releaseApproverId,
  evidence:{qa:'PASS',releaseReview:'M27.6'}
};

// DRAFT Release Version cannot be frozen as RC.
r=await request('POST',`/api/runtime/projects/${projectId}/product-release-candidates`,releaseCandidateBase);
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_VERSION_CANDIDATE_REQUIRED');

r=await request('PATCH',`/api/runtime/project-versions/${releaseVersionId}`,{status:'CANDIDATE'});
expectStatus(r,200);assert.equal(r.body.data.status,'CANDIDATE');

// HIGH/CRITICAL unresolved release issue is fail-closed.
r=await request('POST',`/api/runtime/projects/${projectId}/product-release-candidates`,{
  ...releaseCandidateBase,
  rcKey:'RC-M276-BLOCKED',
  knownIssues:[{
    severity:'HIGH',status:'OPEN',summary:'高风险问题仍未关闭',
    owner:'engineering',mitigation:'待修复'
  }]
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_BLOCKING_KNOWN_ISSUE');

// Owner and approver separation is mandatory.
r=await request('POST',`/api/runtime/projects/${projectId}/product-release-candidates`,{
  ...releaseCandidateBase,
  rcKey:'RC-M276-SOD',
  approverIdentityId:releaseOwnerId
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_SEPARATION_OF_DUTIES_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/product-release-candidates`,releaseCandidateBase);
expectStatus(r,201);const releaseCandidateId=r.body.data.id;
assert.equal(r.body.data.status,'DRAFT');
assert.equal(r.body.data.exactCommitSha,shaB);
assert.equal(r.body.data.artifactSha256,'d'.repeat(64));

// DRAFT candidate alone is not release-ready.
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-RELEASE-READY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('FROZEN_RELEASE_CANDIDATE_REQUIRED'));

r=await request('POST',`/api/runtime/product-release-candidates/${releaseCandidateId}/freeze`,{});
expectStatus(r,200);const releaseManifestId=r.body.data.manifestId;
const manifestSha=r.body.data.manifestSha256;
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.releaseVersionStatus,'LOCKED');
assert.match(manifestSha,/^[a-f0-9]{64}$/);

// Frozen candidate is immutable through the release API.
r=await request('POST',`/api/runtime/product-release-candidates/${releaseCandidateId}/freeze`,{});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_CANDIDATE_NOT_DRAFT');

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-RELEASE-READY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.releaseCandidateId,releaseCandidateId);
assert.equal(r.body.data.evidenceSnapshot.releaseVersionId,releaseVersionId);
assert.equal(r.body.data.evidenceSnapshot.manifestSha256,manifestSha);
assert.equal(r.body.data.evidenceSnapshot.previewDeploymentId,fixPreviewId);
assert.equal(r.body.data.evidenceSnapshot.exactCommitSha,shaB);

// Version lifecycle is reused rather than duplicated.
r=await request('GET',`/api/runtime/projects/${projectId}/versions`);
expectStatus(r,200);
const frozenVersion=r.body.data.find(x=>x.id===releaseVersionId);
assert.equal(frozenVersion.status,'LOCKED');
assert.equal(frozenVersion.sourcePointer.releaseCandidateId,releaseCandidateId);
assert.equal(frozenVersion.sourcePointer.manifestSha256,manifestSha);

// Read model exposes immutable Release Candidate and Evidence Manifest.
r=await request('GET',`/api/runtime/projects/${projectId}/product-release-readiness`);
expectStatus(r,200);
assert.equal(r.body.data.releaseCandidates.length,1);
assert.equal(r.body.data.releaseCandidates[0].status,'FROZEN');
assert.equal(r.body.data.manifests.length,1);
assert.equal(r.body.data.manifests[0].id,releaseManifestId);
assert.equal(r.body.data.manifests[0].manifestSha256,manifestSha);
assert.equal(r.body.data.manifests[0].manifest.source.exactCommitSha,shaB);
assert.equal(r.body.data.manifests[0].manifest.source.previewDeploymentId,fixPreviewId);

// Integrity check detects out-of-band manifest tampering.
const [[manifestBefore]]=await db.execute(
  'SELECT manifest_json FROM product_release_evidence_manifests WHERE id=?',[releaseManifestId]
);
await db.execute(
  'UPDATE product_release_evidence_manifests SET manifest_json=? WHERE id=?',
  [JSON.stringify({tampered:true}),releaseManifestId]
);
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-RELEASE-READY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('RELEASE_MANIFEST_INTEGRITY_FAILED'));

await db.execute(
  'UPDATE product_release_evidence_manifests SET manifest_json=? WHERE id=?',
  [typeof manifestBefore.manifest_json==='string'
    ?manifestBefore.manifest_json
    :JSON.stringify(manifestBefore.manifest_json),releaseManifestId]
);
r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-RELEASE-READY/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Durable release lineage and manifest are persisted once.
const [[releaseTruth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM product_release_evidence_manifests WHERE project_id=? AND release_candidate_id=?) manifests,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='PREVIEW_DEPLOYMENT' AND source_id=? AND target_type='RELEASE_CANDIDATE' AND target_id=?) preview_rc,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='QA_EXECUTION' AND source_id=? AND target_type='RELEASE_CANDIDATE' AND target_id=?) qa_rc,
    (SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='RELEASE_CANDIDATE' AND source_id=? AND target_type='PROJECT_VERSION' AND target_id=?) rc_version`,
  [projectId,releaseCandidateId,
   projectId,fixPreviewId,releaseCandidateId,
   projectId,finalQaExecutionId,releaseCandidateId,
   projectId,releaseCandidateId,releaseVersionId]
);
assert.equal(Number(releaseTruth.manifests),1);
assert.equal(Number(releaseTruth.preview_rc),1);
assert.equal(Number(releaseTruth.qa_rc),1);
assert.equal(Number(releaseTruth.rc_version),1);

// M27.7 product modules remain Chinese.
r=await request('GET','/api/runtime/product-modules');
expectStatus(r,200);
const rolloutModules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(rolloutModules.PRODUCT_RELEASE_ROLLOUT,'发布执行');
assert.equal(rolloutModules.PRODUCT_RELEASE_WAVE,'灰度批次');
assert.equal(rolloutModules.PRODUCT_RELEASE_VERIFICATION,'发布验证证据');
assert.equal(rolloutModules.PRODUCT_RELEASE_STATE_EVENT,'发布状态记录');
assert.ok(r.body.data.every(x=>/[\u4e00-\u9fff]/.test(x.displayName)));

// Release Gate is independent from Release Readiness and starts HOLD.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('RELEASE_ROLLOUT_REQUIRED'));

const rolloutWaves=[
  {waveKey:'WAVE-1-INTERNAL',sequenceNo:1,scope:{audience:'internal'},isFinalWave:false},
  {waveKey:'WAVE-2-FULL',sequenceNo:2,scope:{audience:'full'},isFinalWave:true}
];

// Strategy is frozen in M27.6 and cannot change during release.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-release-rollouts',{
  releaseCandidateId,rolloutKey:'ROLLOUT-BAD-STRATEGY',strategy:'DIRECT',
  targetEnvironment:'production',deploymentId:'prod-deploy-bad-strategy',
  exactCommitSha:shaB,artifactSha256:'d'.repeat(64),
  targetScope:{audience:'all'},deploymentEvidence:{provider:'synthetic',status:'SUCCESS'}
});
expectStatus(r,409);assert.equal(r.body.error,'ROLLOUT_STRATEGY_FROZEN_MISMATCH');

// Artifact identity is immutable from RC -> deployment.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-release-rollouts',{
  releaseCandidateId,rolloutKey:'ROLLOUT-BAD-ARTIFACT',strategy:'STAGED',
  targetEnvironment:'production',deploymentId:'prod-deploy-bad-artifact',
  exactCommitSha:shaA,artifactSha256:'d'.repeat(64),
  targetScope:{audience:'all'},deploymentEvidence:{provider:'synthetic',status:'SUCCESS'},
  waves:rolloutWaves
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_ARTIFACT_IDENTITY_MISMATCH');

r=await request('POST','/api/runtime/projects/'+projectId+'/product-release-rollouts',{
  releaseCandidateId,rolloutKey:'ROLLOUT-M277-1',strategy:'STAGED',
  targetEnvironment:'production',deploymentId:'prod-deploy-m277-1',
  exactCommitSha:shaB,artifactSha256:'d'.repeat(64),
  targetScope:{audience:'planned-production-scope'},
  deploymentEvidence:{provider:'synthetic-deployer',status:'SUCCESS',deploymentId:'prod-deploy-m277-1'},
  waves:rolloutWaves
});
expectStatus(r,201);const rolloutId=r.body.data.id;
assert.equal(r.body.data.releaseState,'DEPLOYED');
assert.equal(Object.keys(r.body.data.waveIds).length,2);

// DEPLOYED is not VERIFIED and therefore cannot pass release gate.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('RELEASE_NOT_RELEASED'));

// Fail-closed verification: health/readiness/smoke/critical flow are all required.
r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/verify',{
  exactCommitSha:shaB,artifactSha256:'d'.repeat(64),
  health:{status:'PASS'},readiness:{status:'PASS'},smoke:{status:'FAIL'},criticalFlow:{status:'PASS'},
  evidence:{verification:'bad-smoke'}
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_SMOKE_NOT_PASS');

r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/verify',{
  exactCommitSha:shaB,artifactSha256:'d'.repeat(64),
  health:{status:'PASS'},readiness:{status:'PASS'},smoke:{status:'PASS'},criticalFlow:{status:'PASS'},
  evidence:{verification:'production-deployment-pass'}
});
expectStatus(r,200);assert.equal(r.body.data.releaseState,'VERIFIED');

r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');

// Staged waves must execute in sequence.
const waveVerification={
  health:{status:'PASS'},readiness:{status:'PASS'},smoke:{status:'PASS'},criticalFlow:{status:'PASS'},
  scopeVerified:true,evidence:{guardrails:'PASS'}
};
r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/release',{
  approval:{status:'APPROVED',approverIdentityId:releaseApproverId,evidence:'approval://m277'},
  releaseEvidence:{audience:'initial'},
  waveKey:'WAVE-2-FULL',verification:waveVerification
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_WAVE_OUT_OF_SEQUENCE');

r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/release',{
  approval:{status:'APPROVED',approverIdentityId:releaseOwnerId,evidence:'approval://wrong'},
  releaseEvidence:{audience:'initial'},
  waveKey:'WAVE-1-INTERNAL',verification:waveVerification
});
expectStatus(r,409);assert.equal(r.body.error,'RELEASE_APPROVER_MISMATCH');

r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/release',{
  approval:{status:'APPROVED',approverIdentityId:releaseApproverId,evidence:'approval://m277'},
  releaseEvidence:{audience:'internal',featureAvailability:'enabled'},
  waveKey:'WAVE-1-INTERNAL',verification:waveVerification
});
expectStatus(r,200);assert.equal(r.body.data.releaseState,'RELEASED');
assert.equal(r.body.data.initialWaveKey,'WAVE-1-INTERNAL');

// RELEASED is a real release state and is enough for G-PD-RELEASE PASS.
// FULLY_ROLLED_OUT remains a distinct later fact.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.releaseState,'RELEASED');

// M27.6 readiness stays historically valid after Version LOCKED -> RELEASED.
r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE-READY/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

r=await request('GET','/api/runtime/projects/'+projectId+'/versions');
expectStatus(r,200);
const releasedVersion=r.body.data.find(x=>x.id===releaseVersionId);
assert.equal(releasedVersion.status,'RELEASED');

// Full rollout cannot be claimed while a planned wave is incomplete.
r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/complete',{
  finalVerification:waveVerification,evidence:{fullRollout:'premature'}
});
expectStatus(r,409);assert.equal(r.body.error,'FULL_ROLLOUT_WAVES_INCOMPLETE');

r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/waves/advance',{
  waveKey:'WAVE-2-FULL',verification:waveVerification
});
expectStatus(r,200);assert.equal(r.body.data.waveKey,'WAVE-2-FULL');
assert.equal(r.body.data.waveStatus,'VERIFIED');assert.equal(r.body.data.isFinalWave,true);

r=await request('POST','/api/runtime/product-release-rollouts/'+rolloutId+'/complete',{
  finalVerification:{
    health:{status:'PASS'},readiness:{status:'PASS'},smoke:{status:'PASS'},criticalFlow:{status:'PASS'},
    evidence:{fullScope:'verified'}
  },
  evidence:{rollout:'all-planned-scope-complete'}
});
expectStatus(r,200);assert.equal(r.body.data.releaseState,'FULLY_ROLLED_OUT');
assert.equal(r.body.data.lifecycleStatus,'COMPLETED');

r=await request('POST','/api/runtime/projects/'+projectId+'/product-gates/G-PD-RELEASE/evaluate',{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.releaseState,'FULLY_ROLLED_OUT');
assert.equal(r.body.data.evidenceSnapshot.waves.length,2);
assert.ok(r.body.data.evidenceSnapshot.waves.every(x=>x.status==='VERIFIED'));

// Read model preserves strict release-state history and wave evidence.
r=await request('GET','/api/runtime/projects/'+projectId+'/product-release-rollout');
expectStatus(r,200);
assert.equal(r.body.data.rollouts.length,1);
assert.equal(r.body.data.rollouts[0].releaseState,'FULLY_ROLLED_OUT');
assert.equal(r.body.data.rollouts[0].strategy,'STAGED');
assert.equal(r.body.data.waves.length,2);
assert.deepEqual(r.body.data.waves.map(x=>x.waveKey),['WAVE-1-INTERNAL','WAVE-2-FULL']);
const primaryStates=r.body.data.stateEvents
  .filter(x=>['DEPLOYED','VERIFIED','RELEASED','FULLY_ROLLED_OUT'].includes(x.eventKey))
  .map(x=>x.toState);
assert.deepEqual(primaryStates,['DEPLOYED','VERIFIED','RELEASED','FULLY_ROLLED_OUT']);

// Durable release lineage exists and release state was never collapsed into deployment status.
const [[rolloutTruth]]=await db.execute(
  'SELECT '+
  "(SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='RELEASE_CANDIDATE' AND source_id=? AND target_type='RELEASE_ROLLOUT' AND target_id=?) candidate_rollout,"+
  "(SELECT COUNT(*) FROM product_trace_links WHERE project_id=? AND source_type='RELEASE_ROLLOUT' AND source_id=? AND target_type='PROJECT_VERSION' AND target_id=?) rollout_version,"+
  "(SELECT COUNT(*) FROM product_release_state_events WHERE project_id=? AND rollout_id=? AND event_key IN ('DEPLOYED','VERIFIED','RELEASED','FULLY_ROLLED_OUT')) primary_state_events",
  [projectId,releaseCandidateId,rolloutId,
   projectId,rolloutId,releaseVersionId,
   projectId,rolloutId]
);
assert.equal(Number(rolloutTruth.candidate_rollout),1);
assert.equal(Number(rolloutTruth.rollout_version),1);
assert.equal(Number(rolloutTruth.primary_state_events),4);

await db.end();
console.log('Runtime V2.7 M27.7 release rollout state-machine validation passed');
