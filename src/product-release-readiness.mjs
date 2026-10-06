import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateQaGate } from './product-acceptance-qa.mjs';

const GATE='G-PD-RELEASE-READY';
const SHA40=/^[0-9a-f]{40}$/i;
const SHA64=/^[0-9a-f]{64}$/i;
const ROLLOUT_STRATEGIES=new Set([
  'DIRECT','STAGED','FEATURE_FLAG','CANARY','PERCENTAGE','INTERNAL','BETA','TENANT_SCOPED','REGION_SCOPED'
]);
const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{
  if(v==null)return null;
  if(typeof v==='object')return v;
  try{return JSON.parse(v);}catch{return null;}
};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.keys(value).sort().reduce((out,key)=>{out[key]=stable(value[key]);return out;},{});
  }
  return value;
};
const sha256=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const sameSet=(a,b)=>{
  const aa=[...new Set(a||[])].sort(),bb=[...new Set(b||[])].sort();
  return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);
};
const baselineRequirementIds=baseline=>{
  const rows=parseJson(baseline.requirement_versions_json)||[];
  return rows.map(x=>x.versionId).filter(Boolean);
};
const deliveryWorkItemIds=plan=>(parseJson(plan.work_item_ids_json)||[]).filter(Boolean);

const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Release Readiness requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentBaseline=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' ORDER BY locked_at DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Product Baseline is required','PRODUCT_BASELINE_REQUIRED',409);
  return rows[0];
};
const currentDeliveryPlan=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_delivery_plans WHERE project_id=? AND status='CURRENT' ORDER BY created_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Delivery Plan is required','DELIVERY_PLAN_REQUIRED',409);
  return rows[0];
};
const currentAiContract=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT c.id contract_id,v.*
       FROM product_ai_contracts c
       JOIN product_ai_contract_versions v ON v.ai_contract_id=c.id AND v.version_no=c.current_version_no
      WHERE c.project_id=? AND c.status IN ('APPROVED','CURRENT')
      ORDER BY c.updated_at DESC LIMIT 1`,[projectId]
  );
  return rows[0]||null;
};
const assertIdentity=async(db,id,code)=>{
  const [rows]=await db.execute('SELECT id FROM identities WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Identity not found',code,404,{id});
};
const assertReadyOrNa=(row,key)=>{
  if(!row||typeof row!=='object')throw errorOf(
    `${key} readiness is required`,'RELEASE_READINESS_SECTION_REQUIRED',409,{section:key}
  );
  const status=upper(row.status);
  if(status==='READY'||status==='PASS')return;
  if(status==='N_A'&&nonEmpty(row.rationale))return;
  throw errorOf(
    `${key} must be READY/PASS or explicit N_A with rationale`,
    'RELEASE_READINESS_SECTION_NOT_READY',409,{section:key,status}
  );
};
const assertObservability=input=>{
  for(const key of ['monitoring','alerts','dashboard'])assertReadyOrNa(input?.[key],`observability.${key}`);
};
const assertDocumentation=input=>{
  for(const key of ['userDocs','adminDocs','migrationGuide','apiSdkDocs'])assertReadyOrNa(input?.[key],`documentation.${key}`);
};
const assertOperations=input=>{
  assertReadyOrNa(input?.runbook,'operations.runbook');
  if(!nonEmpty(input?.supportOwner)||!nonEmpty(input?.incidentOwner))throw errorOf(
    'Support and incident ownership are required','RELEASE_OPERATIONS_OWNERS_REQUIRED',409
  );
};
const assertLaunch=input=>{
  assertReadyOrNa(input,'launchEnablement');
  if(['READY','PASS'].includes(upper(input?.status))&&!nonEmpty(input?.communicationPlan))throw errorOf(
    'Ready launch enablement requires communicationPlan','RELEASE_COMMUNICATION_PLAN_REQUIRED',409
  );
};
const assertInstrumentation=input=>{
  if(upper(input?.status)!=='PASS'||input?.eventsVerified!==true||input?.primaryMetricVerified!==true)throw errorOf(
    'Instrumentation must be verified before release freeze','RELEASE_INSTRUMENTATION_NOT_VERIFIED',409
  );
};
const assertMigration=input=>{
  const status=upper(input?.status);
  if(status==='APPLIED'){
    if(!Array.isArray(input.versions)||!input.versions.length)throw errorOf(
      'Applied migration requires version list','RELEASE_MIGRATION_VERSIONS_REQUIRED',409
    );
    return;
  }
  if(status==='N_A'&&nonEmpty(input.rationale))return;
  throw errorOf('Migration must be APPLIED or explicit N_A','RELEASE_MIGRATION_NOT_READY',409);
};
const assertAuditCompliance=input=>{
  assertReadyOrNa(input?.audit,'auditCompliance.audit');
  assertReadyOrNa(input?.compliance,'auditCompliance.compliance');
};
const assertKnownIssues=input=>{
  if(!Array.isArray(input))throw errorOf('knownIssues must be an array','INVALID_RELEASE_KNOWN_ISSUES');
  for(const issue of input){
    requireFields(issue,['severity','status','summary'],'INVALID_RELEASE_KNOWN_ISSUE');
    if(['OPEN','ACCEPTED'].includes(upper(issue.status))){
      if(['HIGH','CRITICAL'].includes(upper(issue.severity)))throw errorOf(
        'Open/accepted HIGH or CRITICAL known issue blocks release freeze','RELEASE_BLOCKING_KNOWN_ISSUE',409,
        {summary:issue.summary,severity:issue.severity}
      );
      if(!nonEmpty(issue.owner)||!nonEmpty(issue.mitigation))throw errorOf(
        'Open known issue requires owner and mitigation','RELEASE_KNOWN_ISSUE_MITIGATION_REQUIRED',409,{summary:issue.summary}
      );
    }
  }
};
const assertRisks=input=>{
  if(!Array.isArray(input))throw errorOf('risks must be an array','INVALID_RELEASE_RISKS');
  for(const risk of input){
    requireFields(risk,['severity','status','summary'],'INVALID_RELEASE_RISK');
    if(['OPEN','ACCEPTED'].includes(upper(risk.status))){
      if(!nonEmpty(risk.owner)||!nonEmpty(risk.mitigation)||!nonEmpty(risk.contingency))throw errorOf(
        'Open release risk requires owner, mitigation and contingency','RELEASE_RISK_CONTROL_REQUIRED',409,{summary:risk.summary}
      );
      if(['HIGH','CRITICAL'].includes(upper(risk.severity))&&!nonEmpty(risk.acceptedBy))throw errorOf(
        'HIGH/CRITICAL release risk requires explicit acceptedBy','RELEASE_RISK_ACCEPTANCE_REQUIRED',409,{summary:risk.summary}
      );
    }
  }
};
const assertRollout=input=>{
  requireFields(input,['strategy','verification','stopConditions'],'INVALID_ROLLOUT_PLAN');
  const strategy=upper(input.strategy);
  if(!ROLLOUT_STRATEGIES.has(strategy))throw errorOf('Unsupported rollout strategy','INVALID_ROLLOUT_STRATEGY',409,{strategy});
};
const assertRollback=async(db,projectId,currentVersionId,input)=>{
  requireFields(input,['mode','triggers','steps'],'INVALID_ROLLBACK_PLAN');
  const mode=upper(input.mode);
  if(mode==='NO_PREVIOUS_RELEASE'){
    if(!nonEmpty(input.rationale))throw errorOf('No-previous-release rollback requires rationale','ROLLBACK_RATIONALE_REQUIRED',409);
    return;
  }
  if(mode!=='VERSION')throw errorOf('Rollback mode must be VERSION or NO_PREVIOUS_RELEASE','INVALID_ROLLBACK_MODE',409);
  if(!input.targetReleaseVersionId)throw errorOf('Rollback targetReleaseVersionId is required','ROLLBACK_TARGET_REQUIRED',409);
  if(input.targetReleaseVersionId===currentVersionId)throw errorOf('Rollback target cannot equal current release candidate','ROLLBACK_TARGET_SELF',409);
  const [rows]=await db.execute('SELECT * FROM project_versions WHERE id=?',[input.targetReleaseVersionId]);
  if(!rows.length)throw errorOf('Rollback target version not found','ROLLBACK_TARGET_NOT_FOUND',404);
  if(rows[0].project_id!==projectId||rows[0].version_type!=='RELEASE_DISTRIBUTION'||
     !['LOCKED','RELEASED'].includes(rows[0].status))throw errorOf(
    'Rollback target must be a LOCKED/RELEASED release version in the same project','ROLLBACK_TARGET_NOT_USABLE',409
  );
};

const validateConfigPromptModelFeature=async(db,project,input)=>{
  requireFields(input,['config','featureFlags','prompt','models'],'INVALID_RELEASE_CONFIG_SNAPSHOT');
  assertReadyOrNa(input.config,'configPromptModelFeature.config');
  assertReadyOrNa(input.featureFlags,'configPromptModelFeature.featureFlags');
  if(project.project_subtype_key==='AI_APPLICATION'){
    const ai=await currentAiContract(project.id,db);
    if(!ai)throw errorOf('Current AI Contract is required','AI_CONTRACT_REQUIRED',409);
    if(input.aiContractVersionId!==ai.id)throw errorOf(
      'Release snapshot must bind current AI Contract Version','RELEASE_AI_CONTRACT_STALE',409
    );
    if(input.prompt?.status!=='LOCKED'||input.prompt?.promptVersionId!==ai.prompt_version_id)throw errorOf(
      'Release snapshot must lock current Prompt Version','RELEASE_PROMPT_VERSION_NOT_LOCKED',409
    );
    if(input.models?.status!=='LOCKED'||!Array.isArray(input.models.bindings)||!input.models.bindings.length)throw errorOf(
      'AI release snapshot must lock model bindings','RELEASE_MODEL_BINDINGS_NOT_LOCKED',409
    );
    const [bindings]=await db.execute(
      'SELECT provider_key,model_key,binding_role FROM product_ai_model_bindings WHERE ai_contract_version_id=? ORDER BY binding_role,provider_key,model_key',
      [ai.id]
    );
    const expected=bindings.map(x=>`${x.binding_role}:${x.provider_key}:${x.model_key}`).sort();
    const actual=input.models.bindings.map(x=>`${upper(x.bindingRole)}:${x.providerKey}:${x.modelKey}`).sort();
    if(!sameSet(expected,actual))throw errorOf(
      'Release model snapshot does not match current AI Contract','RELEASE_MODEL_BINDINGS_MISMATCH',409,{expected,actual}
    );
  }else{
    assertReadyOrNa(input.prompt,'configPromptModelFeature.prompt');
    assertReadyOrNa(input.models,'configPromptModelFeature.models');
    if(upper(input.prompt.status)!=='N_A'||upper(input.models.status)!=='N_A')throw errorOf(
      'Non-AI product must mark Prompt and Model as explicit N_A','NON_AI_RELEASE_PROMPT_MODEL_NA_REQUIRED',409
    );
  }
};

const validateCandidateInput=async(projectId,input,actorId,db)=>{
  const project=await loadProductProject(projectId,db);
  requireFields(input,[
    'productBaselineId','releaseVersionId','deliveryPlanId','buildRecordId','previewDeploymentId',
    'acceptanceRunId','qaPlanId','qaExecutionId','regressionRunId','rcKey','title',
    'includedRequirementVersionIds','includedWorkItemIds','environment','configPromptModelFeature',
    'migration','auditCompliance','releaseNotes','rolloutPlan','rollbackPlan','observability',
    'operations','documentation','launchEnablement','instrumentation','ownerIdentityId',
    'approverIdentityId','evidence'
  ],'INVALID_RELEASE_CANDIDATE');
  if(!Array.isArray(input.knownIssues)||!Array.isArray(input.risks))throw errorOf(
    'knownIssues and risks must be arrays','INVALID_RELEASE_RISK_SNAPSHOT'
  );
  if(input.ownerIdentityId===input.approverIdentityId)throw errorOf(
    'Release owner and approver must be different identities','RELEASE_SEPARATION_OF_DUTIES_REQUIRED',409
  );
  await assertIdentity(db,input.ownerIdentityId,'RELEASE_OWNER_NOT_FOUND');
  await assertIdentity(db,input.approverIdentityId,'RELEASE_APPROVER_NOT_FOUND');

  const baseline=await currentBaseline(projectId,db);
  if(baseline.id!==input.productBaselineId)throw errorOf('Release candidate baseline is stale','PRODUCT_BASELINE_STALE',409);
  const plan=await currentDeliveryPlan(projectId,db);
  if(plan.id!==input.deliveryPlanId)throw errorOf('Release candidate Delivery Plan is stale','DELIVERY_PLAN_STALE',409);

  const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[input.releaseVersionId]);
  if(!versions.length)throw errorOf('Release Version not found','PROJECT_VERSION_NOT_FOUND',404);
  const version=versions[0];
  if(version.project_id!==projectId||version.version_type!=='RELEASE_DISTRIBUTION'||version.status!=='CANDIDATE')throw errorOf(
    'Release candidate requires a CANDIDATE RELEASE_DISTRIBUTION version','RELEASE_VERSION_CANDIDATE_REQUIRED',409,
    {status:version.status,versionType:version.version_type}
  );
  if(plan.target_release_version_id!==version.id)throw errorOf(
    'Current Delivery Plan must target the Release Version','DELIVERY_PLAN_RELEASE_VERSION_MISMATCH',409
  );

  const qa=await evaluateQaGate(projectId,{persist:false},actorId);
  if(qa.status!=='PASS')throw errorOf('G-PD-QA must PASS before Release Readiness','QA_GATE_REQUIRED',409,{reasonCodes:qa.reasonCodes});
  const qe=qa.evidenceSnapshot||{};
  const expectedIds={
    acceptanceRunId:qe.acceptanceRunId,qaPlanId:qe.qaPlanId,qaExecutionId:qe.qaExecutionId,
    regressionRunId:qe.regressionRunId,previewDeploymentId:qe.previewDeploymentId
  };
  for(const [key,value] of Object.entries(expectedIds)){
    if(input[key]!==value)throw errorOf(
      'Release candidate must bind the exact current QA evidence set','RELEASE_QA_EVIDENCE_MISMATCH',409,
      {field:key,expected:value,actual:input[key]}
    );
  }

  const [previews]=await db.execute('SELECT * FROM product_preview_deployments WHERE id=?',[input.previewDeploymentId]);
  if(!previews.length)throw errorOf('Preview Deployment not found','PREVIEW_DEPLOYMENT_NOT_FOUND',404);
  const preview=previews[0];
  if(preview.project_id!==projectId||preview.deployment_status!=='SUCCESS'||preview.target_release_version_id!==version.id)
    throw errorOf('Release candidate Preview is not usable','RELEASE_PREVIEW_NOT_USABLE',409);

  const [builds]=await db.execute('SELECT * FROM product_build_records WHERE id=?',[input.buildRecordId]);
  if(!builds.length)throw errorOf('Build Record not found','BUILD_RECORD_NOT_FOUND',404);
  const build=builds[0];
  if(build.project_id!==projectId||build.id!==preview.build_record_id||build.build_status!=='SUCCESS'||
     build.target_release_version_id!==version.id)throw errorOf('Release candidate Build is not the accepted Preview build','RELEASE_BUILD_MISMATCH',409);
  if(build.commit_sha!==preview.commit_sha||!SHA40.test(build.commit_sha))throw errorOf(
    'Release Build and Preview must share exact commit','RELEASE_COMMIT_MISMATCH',409
  );
  if(!build.artifact_sha256||!SHA64.test(build.artifact_sha256))throw errorOf(
    'Release build requires immutable artifact SHA-256','RELEASE_ARTIFACT_DIGEST_REQUIRED',409
  );

  const requiredRequirements=baselineRequirementIds(baseline);
  if(!sameSet(requiredRequirements,input.includedRequirementVersionIds))throw errorOf(
    'Release Candidate must include exactly the current Product Baseline requirements',
    'RELEASE_REQUIREMENT_SET_MISMATCH',409,{expected:requiredRequirements,actual:input.includedRequirementVersionIds}
  );
  const plannedWorkItems=deliveryWorkItemIds(plan);
  if(!sameSet(plannedWorkItems,input.includedWorkItemIds))throw errorOf(
    'Release Candidate must include exactly the current Delivery Plan work items',
    'RELEASE_WORK_ITEM_SET_MISMATCH',409,{expected:plannedWorkItems,actual:input.includedWorkItemIds}
  );
  if(plannedWorkItems.length){
    const placeholders=plannedWorkItems.map(()=>'?').join(',');
    const [items]=await db.execute(
      `SELECT id,status FROM project_work_items WHERE project_id=? AND id IN (${placeholders})`,
      [projectId,...plannedWorkItems]
    );
    const incomplete=items.filter(x=>x.status!=='COMPLETED').map(x=>({id:x.id,status:x.status}));
    if(items.length!==plannedWorkItems.length||incomplete.length)throw errorOf(
      'All included Release Work Items must be COMPLETED','RELEASE_WORK_ITEMS_NOT_COMPLETE',409,{incomplete}
    );
  }

  if(input.environment.previewEnvironment!==preview.environment||!nonEmpty(input.environment.targetEnvironment))
    throw errorOf('Release environment snapshot must bind Preview and target environment','RELEASE_ENVIRONMENT_SNAPSHOT_REQUIRED',409);

  await validateConfigPromptModelFeature(db,project,input.configPromptModelFeature);
  assertMigration(input.migration);
  assertAuditCompliance(input.auditCompliance);
  assertKnownIssues(input.knownIssues);
  assertRisks(input.risks);
  requireFields(input.releaseNotes,['summary','changelog'],'INVALID_RELEASE_NOTES');
  assertRollout(input.rolloutPlan);
  await assertRollback(db,projectId,version.id,input.rollbackPlan);
  assertObservability(input.observability);
  assertOperations(input.operations);
  assertDocumentation(input.documentation);
  assertLaunch(input.launchEnablement);
  assertInstrumentation(input.instrumentation);

  return {project,baseline,plan,version,qa,build,preview};
};

export const resolveReleaseCandidateScope=async candidateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,p.workspace_id FROM product_release_candidates r
      JOIN projects p ON p.id=r.project_id WHERE r.id=?`,[candidateId]
  );
  if(!rows.length)throw errorOf('Release Candidate not found','RELEASE_CANDIDATE_NOT_FOUND',404);
  return {releaseCandidateId:candidateId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createReleaseCandidate=async(projectId,input={},actorId=null)=>{
  const db=getRuntimePool();
  const v=await validateCandidateInput(projectId,input,actorId,db);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_release_candidates
      (id,project_id,product_baseline_id,release_version_id,delivery_plan_id,build_record_id,
       preview_deployment_id,acceptance_run_id,qa_plan_id,qa_execution_id,regression_run_id,
       rc_key,title,status,exact_commit_sha,artifact_sha256,included_requirements_json,included_work_items_json,
       environment_json,config_prompt_model_feature_json,migration_json,audit_compliance_json,known_issues_json,
       risks_json,release_notes_json,rollout_plan_json,rollback_plan_json,observability_json,operations_json,
       documentation_json,launch_enablement_json,instrumentation_json,owner_identity_id,approver_identity_id,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,v.baseline.id,v.version.id,v.plan.id,v.build.id,v.preview.id,input.acceptanceRunId,
      input.qaPlanId,input.qaExecutionId,input.regressionRunId,input.rcKey,input.title,v.build.commit_sha,
      v.build.artifact_sha256,asJson(input.includedRequirementVersionIds),asJson(input.includedWorkItemIds),
      asJson(input.environment),asJson(input.configPromptModelFeature),asJson(input.migration),
      asJson(input.auditCompliance),asJson(input.knownIssues),asJson(input.risks),asJson(input.releaseNotes),
      asJson(input.rolloutPlan),asJson(input.rollbackPlan),asJson(input.observability),asJson(input.operations),
      asJson(input.documentation),asJson(input.launchEnablement),asJson(input.instrumentation),
      input.ownerIdentityId,input.approverIdentityId,asJson(input.evidence)
    ]
  );
  return {
    id,projectId,rcKey:input.rcKey,title:input.title,status:'DRAFT',releaseVersionId:v.version.id,
    exactCommitSha:v.build.commit_sha,artifactSha256:v.build.artifact_sha256,previewDeploymentId:v.preview.id
  };
};

const candidateManifest=async(db,row)=>{
  const [versionRows]=await db.execute('SELECT * FROM project_versions WHERE id=?',[row.release_version_id]);
  const [buildRows]=await db.execute('SELECT * FROM product_build_records WHERE id=?',[row.build_record_id]);
  const [previewRows]=await db.execute('SELECT * FROM product_preview_deployments WHERE id=?',[row.preview_deployment_id]);
  const version=versionRows[0],build=buildRows[0],preview=previewRows[0];
  return {
    schemaVersion:'M27.6-1',
    projectId:row.project_id,
    releaseCandidateId:row.id,
    releaseVersion:{id:version.id,key:version.version_key,label:version.label,type:version.version_type},
    productBaselineId:row.product_baseline_id,
    deliveryPlanId:row.delivery_plan_id,
    source:{
      exactCommitSha:row.exact_commit_sha,
      buildRecordId:row.build_record_id,
      buildId:build.build_id,
      artifactSha256:row.artifact_sha256,
      previewDeploymentId:row.preview_deployment_id,
      deploymentId:preview.deployment_id,
      previewEnvironment:preview.environment
    },
    includedRequirementVersionIds:parseJson(row.included_requirements_json)||[],
    includedWorkItemIds:parseJson(row.included_work_items_json)||[],
    acceptanceRunId:row.acceptance_run_id,
    qaPlanId:row.qa_plan_id,
    qaExecutionId:row.qa_execution_id,
    regressionRunId:row.regression_run_id,
    environment:parseJson(row.environment_json),
    configPromptModelFeature:parseJson(row.config_prompt_model_feature_json),
    migration:parseJson(row.migration_json),
    auditCompliance:parseJson(row.audit_compliance_json),
    knownIssues:parseJson(row.known_issues_json),
    risks:parseJson(row.risks_json),
    releaseNotes:parseJson(row.release_notes_json),
    rolloutPlan:parseJson(row.rollout_plan_json),
    rollbackPlan:parseJson(row.rollback_plan_json),
    observability:parseJson(row.observability_json),
    operations:parseJson(row.operations_json),
    documentation:parseJson(row.documentation_json),
    launchEnablement:parseJson(row.launch_enablement_json),
    instrumentation:parseJson(row.instrumentation_json),
    ownerIdentityId:row.owner_identity_id,
    approverIdentityId:row.approver_identity_id,
    evidence:parseJson(row.evidence_json)
  };
};

const liveProjectBlockers=async(db,projectId)=>{
  const [risks,issues,blockers]=await Promise.all([
    db.execute(
      "SELECT id,risk_key,impact,status FROM project_risks WHERE project_id=? AND status='OPEN' AND impact IN ('HIGH','CRITICAL')",
      [projectId]
    ).then(x=>x[0]),
    db.execute(
      "SELECT id,issue_key,severity,status FROM project_issues WHERE project_id=? AND status='OPEN' AND severity IN ('HIGH','CRITICAL')",
      [projectId]
    ).then(x=>x[0]),
    db.execute(
      "SELECT id,blocker_key,status FROM project_blockers WHERE project_id=? AND status='OPEN'",[projectId]
    ).then(x=>x[0])
  ]);
  return {risks,issues,blockers};
};

export const freezeReleaseCandidate=async(candidateId,input={},actorId=null)=>{
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_release_candidates WHERE id=? FOR UPDATE',[candidateId]);
    if(!rows.length)throw errorOf('Release Candidate not found','RELEASE_CANDIDATE_NOT_FOUND',404);
    const row=rows[0];
    if(row.status!=='DRAFT')throw errorOf('Only DRAFT Release Candidate can be frozen','RELEASE_CANDIDATE_NOT_DRAFT',409,{status:row.status});

    const [versions]=await conn.execute('SELECT * FROM project_versions WHERE id=? FOR UPDATE',[row.release_version_id]);
    const version=versions[0];
    if(!version||version.project_id!==row.project_id||version.version_type!=='RELEASE_DISTRIBUTION'||version.status!=='CANDIDATE')
      throw errorOf('Release Version must still be CANDIDATE at freeze time','RELEASE_VERSION_CANDIDATE_REQUIRED',409);

    const baseline=await currentBaseline(row.project_id,conn);
    if(baseline.id!==row.product_baseline_id)throw errorOf('Release Candidate baseline became stale','RELEASE_CANDIDATE_STALE',409);
    const plan=await currentDeliveryPlan(row.project_id,conn);
    if(plan.id!==row.delivery_plan_id||plan.target_release_version_id!==row.release_version_id)
      throw errorOf('Release Candidate Delivery Plan became stale','RELEASE_CANDIDATE_STALE',409);

    const qa=await evaluateQaGate(row.project_id,{persist:false},actorId);
    if(qa.status!=='PASS')throw errorOf('QA Gate is no longer PASS','RELEASE_QA_GATE_STALE',409,{reasonCodes:qa.reasonCodes});
    const qe=qa.evidenceSnapshot||{};
    const idPairs=[
      ['acceptance_run_id',qe.acceptanceRunId],['qa_plan_id',qe.qaPlanId],['qa_execution_id',qe.qaExecutionId],
      ['regression_run_id',qe.regressionRunId],['preview_deployment_id',qe.previewDeploymentId]
    ];
    for(const [field,expected] of idPairs)if(row[field]!==expected)throw errorOf(
      'Release Candidate QA evidence became stale','RELEASE_QA_EVIDENCE_STALE',409,{field,expected,actual:row[field]}
    );

    const blockers=await liveProjectBlockers(conn,row.project_id);
    if(blockers.risks.length||blockers.issues.length||blockers.blockers.length)throw errorOf(
      'Live project risk/issue/blocker prevents Release Candidate freeze','RELEASE_LIVE_BLOCKER',409,blockers
    );

    if(actorId&&row.approver_identity_id!==actorId&&input.allowPlatformAdminOverride!==true)throw errorOf(
      'Only the recorded approver may freeze this Release Candidate','RELEASE_APPROVER_REQUIRED',403
    );

    const manifest=await candidateManifest(conn,row);
    const digest=sha256(manifest),manifestId=randomUUID();
    await conn.execute(
      `INSERT INTO product_release_evidence_manifests
        (id,project_id,release_candidate_id,release_version_id,manifest_json,manifest_sha256,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?)`,
      [manifestId,row.project_id,row.id,row.release_version_id,asJson(manifest),digest,actorId||row.approver_identity_id]
    );
    await conn.execute(
      "UPDATE product_release_candidates SET status='FROZEN',manifest_sha256=?,frozen_at=CURRENT_TIMESTAMP(6) WHERE id=?",
      [digest,row.id]
    );
    await conn.execute(
      `UPDATE project_versions SET status='LOCKED',effective_at=COALESCE(effective_at,CURRENT_TIMESTAMP(6)),
       source_pointer_json=?,evidence_json=? WHERE id=?`,
      [asJson({releaseCandidateId:row.id,manifestId,manifestSha256:digest,exactCommitSha:row.exact_commit_sha,
        artifactSha256:row.artifact_sha256}),
       asJson({releaseCandidateId:row.id,manifestId,manifestSha256:digest,gate:GATE}),row.release_version_id]
    );
    await insertTrace(conn,{projectId:row.project_id,sourceType:'PREVIEW_DEPLOYMENT',sourceId:row.preview_deployment_id,
      targetType:'RELEASE_CANDIDATE',targetId:row.id,linkType:'FROZEN_IN',actorId});
    await insertTrace(conn,{projectId:row.project_id,sourceType:'QA_EXECUTION',sourceId:row.qa_execution_id,
      targetType:'RELEASE_CANDIDATE',targetId:row.id,linkType:'QUALITY_FROZEN_IN',actorId});
    await insertTrace(conn,{projectId:row.project_id,sourceType:'RELEASE_CANDIDATE',sourceId:row.id,
      targetType:'PROJECT_VERSION',targetId:row.release_version_id,linkType:'LOCKS',actorId});
    await conn.commit();
    return {
      id:row.id,projectId:row.project_id,rcKey:row.rc_key,status:'FROZEN',
      releaseVersionId:row.release_version_id,releaseVersionStatus:'LOCKED',
      manifestId,manifestSha256:digest,exactCommitSha:row.exact_commit_sha,artifactSha256:row.artifact_sha256
    };
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,actorId})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson({gate:GATE}),actorId||null]
  );
};

export const evaluateReleaseReadyGate=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};
  const qa=await evaluateQaGate(projectId,{persist:false},actorId);
  if(qa.status!=='PASS')reasons.push('QA_NOT_READY');
  const baseline=await currentBaseline(projectId,db);
  evidence.productBaselineId=baseline.id;

  const [rows]=await db.execute(
    "SELECT * FROM product_release_candidates WHERE project_id=? AND status='FROZEN' ORDER BY frozen_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const rc=rows[0]||null;
  evidence.releaseCandidateId=rc?.id||null;
  evidence.releaseVersionId=rc?.release_version_id||null;
  evidence.manifestSha256=rc?.manifest_sha256||null;
  if(!rc)reasons.push('FROZEN_RELEASE_CANDIDATE_REQUIRED');
  else{
    evidence.previewDeploymentId=rc.preview_deployment_id;
    evidence.exactCommitSha=rc.exact_commit_sha;
    evidence.artifactSha256=rc.artifact_sha256;
    if(rc.product_baseline_id!==baseline.id)reasons.push('RELEASE_CANDIDATE_BASELINE_STALE');
    if(qa.status==='PASS'){
      const qe=qa.evidenceSnapshot||{};
      if(rc.preview_deployment_id!==qe.previewDeploymentId)reasons.push('RELEASE_CANDIDATE_PREVIEW_STALE');
      if(rc.acceptance_run_id!==qe.acceptanceRunId)reasons.push('RELEASE_CANDIDATE_ACCEPTANCE_STALE');
      if(rc.qa_execution_id!==qe.qaExecutionId)reasons.push('RELEASE_CANDIDATE_QA_EXECUTION_STALE');
      if(rc.regression_run_id!==qe.regressionRunId)reasons.push('RELEASE_CANDIDATE_REGRESSION_STALE');
    }
    const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[rc.release_version_id]);
    if(!versions.length||!['LOCKED','RELEASED'].includes(versions[0].status)||versions[0].version_type!=='RELEASE_DISTRIBUTION')
      reasons.push('RELEASE_VERSION_NOT_LOCKED_OR_RELEASED');
    const [manifests]=await db.execute(
      'SELECT * FROM product_release_evidence_manifests WHERE release_candidate_id=?',[rc.id]
    );
    const manifest=manifests[0]||null;
    evidence.manifestId=manifest?.id||null;
    if(!manifest)reasons.push('RELEASE_EVIDENCE_MANIFEST_REQUIRED');
    else{
      const parsed=parseJson(manifest.manifest_json);
      const digest=sha256(parsed);
      if(digest!==manifest.manifest_sha256||digest!==rc.manifest_sha256)reasons.push('RELEASE_MANIFEST_INTEGRITY_FAILED');
    }
    const blockers=await liveProjectBlockers(db,projectId);
    if(blockers.risks.length)reasons.push('RELEASE_HIGH_CRITICAL_PROJECT_RISK');
    if(blockers.issues.length)reasons.push('RELEASE_HIGH_CRITICAL_PROJECT_ISSUE');
    if(blockers.blockers.length)reasons.push('RELEASE_PROJECT_BLOCKER_OPEN');
  }
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m276_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getReleaseReadinessState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [candidates,manifests,gates]=await Promise.all([
    db.execute('SELECT * FROM product_release_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_release_evidence_manifests WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m276_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    releaseCandidates:candidates.map(x=>({
      id:x.id,rcKey:x.rc_key,title:x.title,status:x.status,productBaselineId:x.product_baseline_id,
      releaseVersionId:x.release_version_id,deliveryPlanId:x.delivery_plan_id,buildRecordId:x.build_record_id,
      previewDeploymentId:x.preview_deployment_id,acceptanceRunId:x.acceptance_run_id,qaPlanId:x.qa_plan_id,
      qaExecutionId:x.qa_execution_id,regressionRunId:x.regression_run_id,exactCommitSha:x.exact_commit_sha,
      artifactSha256:x.artifact_sha256,manifestSha256:x.manifest_sha256||null,frozenAt:x.frozen_at||null
    })),
    manifests:manifests.map(x=>({
      id:x.id,releaseCandidateId:x.release_candidate_id,releaseVersionId:x.release_version_id,
      manifestSha256:x.manifest_sha256,manifest:parseJson(x.manifest_json),createdAt:x.created_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
