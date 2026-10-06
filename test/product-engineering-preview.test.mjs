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

await db.end();
console.log('Runtime V2.7 M27.4 engineering + build + preview validation passed');
