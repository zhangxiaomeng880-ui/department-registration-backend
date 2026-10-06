import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateEngineeringGate } from './product-engineering-preview.mjs';

const ACCEPTANCE_GATE='G-PD-ACCEPTANCE';
const QA_GATE='G-PD-QA';
const SHA40=/^[0-9a-f]{40}$/i;

const ACCEPTANCE_CATEGORIES=[
  'FUNCTIONAL','BUSINESS_RULE','FLOW','INTERACTION','STATE','VISUAL','RESPONSIVE',
  'CONTENT','PERMISSION_ROLE','SCOPE_OUT_OF_SCOPE','AI_BEHAVIOR'
];
const QA_STANDARD_CATEGORIES=[
  'UNIT','COMPONENT','API_CONTRACT','INTEGRATION','E2E','VISUAL_REGRESSION','DEVICE_BROWSER',
  'ACCESSIBILITY','PERFORMANCE_LOAD','SECURITY_DEPENDENCY','MIGRATION_COMPATIBILITY',
  'ERROR_RECOVERY','OBSERVABILITY','INSTRUMENTATION'
];
const QA_AI_CATEGORIES=[
  'EVAL_REGRESSION','PROMPT_RAG_REGRESSION','TOOL_PERMISSION','HALLUCINATION_UNSUPPORTED_CLAIM',
  'SAFETY_POLICY','LATENCY_COST','FALLBACK_DEGRADED_MODE'
];

const ACCEPTANCE_STATUSES=new Set(['PASS','FAIL','BLOCKED','N_A']);
const QA_RESULT_STATUSES=new Set(['PASS','FAIL','NOT_RUN','BLOCKED','N_A']);
const QA_RUN_STATUSES=new Set(['PASS','FAIL','BLOCKED']);
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);

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
const assertEnum=(value,set,code,label)=>{
  const x=upper(value);
  if(!set.has(x))throw errorOf(`Unsupported ${label}`,code,400,{value});
  return x;
};
const assertSha=value=>{
  if(!SHA40.test(String(value||'')))throw errorOf('Exact 40-character commit SHA is required','INVALID_COMMIT_SHA',409,{value});
  return String(value).toLowerCase();
};

const loadProductProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Quality domain requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
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
const baselineRequirementIds=baseline=>{
  const items=parseJson(baseline.requirement_versions_json)||[];
  return items.map(x=>x.versionId).filter(Boolean);
};
const assertProjectRow=async(db,table,id,projectId,code)=>{
  const [rows]=await db.execute(`SELECT * FROM ${table} WHERE id=?`,[id]);
  if(!rows.length)throw errorOf('Object not found',code,404,{id});
  if(rows[0].project_id!==projectId)throw errorOf('Object scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409,{id});
  return rows[0];
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};
const engineeringPreviewSet=async(projectId,actorId=null)=>{
  const gate=await evaluateEngineeringGate(projectId,{persist:false},actorId);
  return {
    gate,
    ids:new Set((gate.evidenceSnapshot?.exactPreviews||[]).map(x=>x.previewDeploymentId))
  };
};
const assertAcceptanceStatus=(status,category,projectSubtype,rationale)=>{
  const s=assertEnum(status,ACCEPTANCE_STATUSES,'INVALID_ACCEPTANCE_STATUS','acceptance status');
  if(s==='N_A'&&!nonEmpty(rationale))throw errorOf(
    'Acceptance N_A requires rationale','ACCEPTANCE_NA_REASON_REQUIRED',409,{category}
  );
  if(category==='AI_BEHAVIOR'&&projectSubtype==='AI_APPLICATION'&&s!=='PASS')throw errorOf(
    'AI Application requires AI_BEHAVIOR acceptance PASS','AI_ACCEPTANCE_REQUIRED',409,{status:s}
  );
  return s;
};
const assertQaResultStatus=(status,category,rationale)=>{
  const s=assertEnum(status,QA_RESULT_STATUSES,'INVALID_QA_RESULT_STATUS','QA result status');
  if(s==='N_A'&&!nonEmpty(rationale))throw errorOf(
    'QA N_A requires rationale','QA_NA_REASON_REQUIRED',409,{category}
  );
  return s;
};

export const resolveQualityProjectScope=async projectId=>{
  const p=await loadProductProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};
export const resolveQaDefectScope=async defectId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT d.id,d.project_id,p.workspace_id FROM product_qa_defects d
      JOIN projects p ON p.id=d.project_id WHERE d.id=?`,[defectId]
  );
  if(!rows.length)throw errorOf('QA Defect not found','QA_DEFECT_NOT_FOUND',404);
  return {defectId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAcceptanceRun=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  requireFields(input,['productBaselineId','previewDeploymentId','acceptanceKey','checks','evidence'],'INVALID_ACCEPTANCE_RUN');
  if(!Array.isArray(input.checks)||!input.checks.length)throw errorOf('checks must be a non-empty array','INVALID_ACCEPTANCE_CHECKS');
  if(!Array.isArray(input.gaps))throw errorOf('gaps must be an array','INVALID_ACCEPTANCE_GAPS');

  const db=getRuntimePool(),baseline=await currentBaseline(projectId,db);
  if(baseline.id!==input.productBaselineId)throw errorOf('Acceptance baseline is stale','PRODUCT_BASELINE_STALE',409);
  const preview=await assertProjectRow(db,'product_preview_deployments',input.previewDeploymentId,projectId,'PREVIEW_DEPLOYMENT_NOT_FOUND');
  if(preview.deployment_status!=='SUCCESS')throw errorOf('Acceptance requires successful Preview','ACCEPTANCE_PREVIEW_NOT_SUCCESS',409);

  const eng=await engineeringPreviewSet(projectId,actorId);
  if(eng.gate.status!=='PASS')throw errorOf('Engineering Gate must PASS before Acceptance','ENGINEERING_GATE_REQUIRED',409);
  if(!eng.ids.has(input.previewDeploymentId))throw errorOf(
    'Acceptance must use an exact Preview from current Engineering Gate','ACCEPTANCE_PREVIEW_NOT_ENGINEERING_CURRENT',409
  );

  const requiredCategories=new Set(ACCEPTANCE_CATEGORIES);
  const seenCategories=new Set(),seenCheckKeys=new Set();
  const requirementIds=new Set(baselineRequirementIds(baseline));
  const coveredRequirements=new Set();
  const normalized=[];
  for(const check of input.checks){
    requireFields(check,['checkKey','category','status','evidence'],'INVALID_ACCEPTANCE_CHECK');
    if(seenCheckKeys.has(check.checkKey))throw errorOf('Duplicate acceptance checkKey','DUPLICATE_ACCEPTANCE_CHECK',409,{checkKey:check.checkKey});
    seenCheckKeys.add(check.checkKey);
    const category=upper(check.category);
    if(!requiredCategories.has(category))throw errorOf('Unsupported acceptance category','INVALID_ACCEPTANCE_CATEGORY',409,{category});
    seenCategories.add(category);
    const status=assertAcceptanceStatus(check.status,category,project.project_subtype_key,check.rationale);
    if(check.requirementVersionId){
      if(!requirementIds.has(check.requirementVersionId))throw errorOf(
        'Acceptance check requirement must be in current Product Baseline','ACCEPTANCE_REQUIREMENT_NOT_IN_BASELINE',409,
        {requirementVersionId:check.requirementVersionId}
      );
      coveredRequirements.add(check.requirementVersionId);
    }
    normalized.push({...check,category,status});
  }
  const missingCategories=[...requiredCategories].filter(x=>!seenCategories.has(x));
  if(missingCategories.length)throw errorOf(
    'Acceptance category coverage is incomplete','ACCEPTANCE_CATEGORY_COVERAGE_INCOMPLETE',409,{missingCategories}
  );
  const missingRequirements=[...requirementIds].filter(x=>!coveredRequirements.has(x));
  if(missingRequirements.length)throw errorOf(
    'Acceptance must cover every Requirement Version in current Product Baseline',
    'ACCEPTANCE_REQUIREMENT_COVERAGE_INCOMPLETE',409,{missingRequirements}
  );

  const failKeys=new Set(normalized.filter(x=>x.status==='FAIL').map(x=>x.checkKey));
  const gapByCheck=new Map();
  for(const gap of input.gaps){
    requireFields(gap,[
      'checkKey','gapKey','requirementVersionId','severity','summary','returnStageKey','resumePoint','evidence'
    ],'INVALID_ACCEPTANCE_GAP');
    if(!failKeys.has(gap.checkKey))throw errorOf(
      'Acceptance Gap must point to a FAIL check','ACCEPTANCE_GAP_FAIL_CHECK_REQUIRED',409,{checkKey:gap.checkKey}
    );
    if(gapByCheck.has(gap.checkKey))throw errorOf('Only one primary Gap per FAIL check is allowed','DUPLICATE_ACCEPTANCE_GAP',409,{checkKey:gap.checkKey});
    if(!requirementIds.has(gap.requirementVersionId))throw errorOf(
      'Acceptance Gap must link current Requirement Version','ACCEPTANCE_GAP_REQUIREMENT_REQUIRED',409
    );
    assertEnum(gap.severity,SEVERITIES,'INVALID_GAP_SEVERITY','gap severity');
    if(!['PD_04_PRODUCT','PD_07_DESIGN','PD_08_CONTRACT','PD_09_ENGINEERING','PD_10_BUILD'].includes(gap.returnStageKey))
      throw errorOf('Acceptance Gap returnStageKey is invalid','INVALID_ACCEPTANCE_RETURN_STAGE',409,{returnStageKey:gap.returnStageKey});
    gapByCheck.set(gap.checkKey,gap);
  }
  const failWithoutGap=[...failKeys].filter(k=>!gapByCheck.has(k));
  if(failWithoutGap.length)throw errorOf(
    'Every FAIL acceptance check requires Gap / Requirement / Evidence / Return Stage / Resume Point',
    'ACCEPTANCE_FAIL_GAP_REQUIRED',409,{checkKeys:failWithoutGap}
  );

  const conn=await db.getConnection(),runId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_acceptance_runs
        (id,project_id,product_baseline_id,preview_deployment_id,acceptance_key,status,evidence_json,accepted_by_identity_id,completed_at)
       VALUES (?,?,?,?,?,'COMPLETE',?,?,?)`,
      [runId,projectId,baseline.id,input.previewDeploymentId,input.acceptanceKey,asJson(input.evidence),actorId,
       input.completedAt?new Date(input.completedAt):new Date()]
    );
    const checkIds=new Map();
    for(const check of normalized){
      const checkId=randomUUID();checkIds.set(check.checkKey,checkId);
      await conn.execute(
        `INSERT INTO product_acceptance_checks
          (id,acceptance_run_id,project_id,check_key,category,requirement_version_id,status,rationale,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [checkId,runId,projectId,check.checkKey,check.category,check.requirementVersionId||null,
         check.status,check.rationale||null,asJson(check.evidence)]
      );
      if(check.requirementVersionId)await insertTrace(conn,{
        projectId,sourceType:'REQUIREMENT_VERSION',sourceId:check.requirementVersionId,
        targetType:'ACCEPTANCE_RUN',targetId:runId,linkType:'ACCEPTED_BY',actorId
      });
    }
    const gapIds=[];
    for(const gap of input.gaps){
      const id=randomUUID();gapIds.push(id);
      await conn.execute(
        `INSERT INTO product_acceptance_gaps
          (id,project_id,acceptance_run_id,acceptance_check_id,requirement_version_id,gap_key,severity,
           summary,status,return_stage_key,resume_point_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?, 'OPEN',?,?,?)`,
        [id,projectId,runId,checkIds.get(gap.checkKey),gap.requirementVersionId,gap.gapKey,upper(gap.severity),
         gap.summary,gap.returnStageKey,asJson(gap.resumePoint),asJson(gap.evidence)]
      );
    }
    await insertTrace(conn,{projectId,sourceType:'PREVIEW_DEPLOYMENT',sourceId:input.previewDeploymentId,
      targetType:'ACCEPTANCE_RUN',targetId:runId,linkType:'ACCEPTED_AS',actorId});
    await conn.commit();
    return {id:runId,projectId,acceptanceKey:input.acceptanceKey,productBaselineId:baseline.id,
      previewDeploymentId:input.previewDeploymentId,status:'COMPLETE',checkCount:normalized.length,gapIds};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateAcceptanceGate=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};
  const eng=await engineeringPreviewSet(projectId,actorId);
  if(eng.gate.status!=='PASS')reasons.push('ENGINEERING_NOT_READY');
  const baseline=await currentBaseline(projectId,db);
  evidence.productBaselineId=baseline.id;

  const [runs]=await db.execute(
    `SELECT * FROM product_acceptance_runs WHERE project_id=? AND status='COMPLETE'
      ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT 1`,[projectId]
  );
  const run=runs[0]||null;
  evidence.acceptanceRunId=run?.id||null;
  evidence.previewDeploymentId=run?.preview_deployment_id||null;
  if(!run)reasons.push('ACCEPTANCE_RUN_REQUIRED');
  else{
    if(run.product_baseline_id!==baseline.id)reasons.push('ACCEPTANCE_BASELINE_STALE');
    if(!eng.ids.has(run.preview_deployment_id))reasons.push('ACCEPTANCE_PREVIEW_NOT_ENGINEERING_CURRENT');
    const [checks,gaps]=await Promise.all([
      db.execute('SELECT * FROM product_acceptance_checks WHERE acceptance_run_id=? ORDER BY category,check_key',[run.id]).then(x=>x[0]),
      db.execute("SELECT * FROM product_acceptance_gaps WHERE acceptance_run_id=? AND status='OPEN'",[run.id]).then(x=>x[0])
    ]);
    evidence.checkCount=checks.length;evidence.openGapIds=gaps.map(x=>x.id);
    const categories=new Set(checks.map(x=>x.category));
    for(const category of ACCEPTANCE_CATEGORIES)if(!categories.has(category))reasons.push(`ACCEPTANCE_CATEGORY_REQUIRED:${category}`);
    const requiredReq=new Set(baselineRequirementIds(baseline));
    const passedReq=new Set(checks.filter(x=>x.requirement_version_id&&x.status==='PASS').map(x=>x.requirement_version_id));
    for(const id of requiredReq)if(!passedReq.has(id))reasons.push(`ACCEPTANCE_REQUIREMENT_NOT_PASS:${id}`);
    for(const check of checks){
      if(check.status==='FAIL')reasons.push(`ACCEPTANCE_CHECK_FAIL:${check.check_key}`);
      if(check.status==='BLOCKED')reasons.push(`ACCEPTANCE_CHECK_BLOCKED:${check.check_key}`);
      if(check.status==='N_A'&&!nonEmpty(check.rationale))reasons.push(`ACCEPTANCE_NA_REASON_REQUIRED:${check.check_key}`);
      if(project.project_subtype_key==='AI_APPLICATION'&&check.category==='AI_BEHAVIOR'&&check.status!=='PASS')
        reasons.push('AI_ACCEPTANCE_REQUIRED');
    }
    if(gaps.length)reasons.push('ACCEPTANCE_OPEN_GAPS');
  }
  const result={projectId,gateKey:ACCEPTANCE_GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m275_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,ACCEPTANCE_GATE,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const createQaPlan=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  requireFields(input,['productBaselineId','planKey','title','matrix','cases','evidence'],'INVALID_QA_PLAN');
  if(!Array.isArray(input.cases)||!input.cases.length)throw errorOf('cases must be a non-empty array','INVALID_QA_CASES');
  const db=getRuntimePool(),baseline=await currentBaseline(projectId,db);
  if(baseline.id!==input.productBaselineId)throw errorOf('QA Plan baseline is stale','PRODUCT_BASELINE_STALE',409);
  const required=new Set([...QA_STANDARD_CATEGORIES,...(project.project_subtype_key==='AI_APPLICATION'?QA_AI_CATEGORIES:[])]);
  const seen=new Set(),keys=new Set();
  for(const c of input.cases){
    requireFields(c,['caseKey','category','title','assertions','evidence'],'INVALID_QA_CASE');
    if(keys.has(c.caseKey))throw errorOf('Duplicate QA caseKey','DUPLICATE_QA_CASE',409,{caseKey:c.caseKey});
    keys.add(c.caseKey);
    const category=upper(c.category);
    if(!required.has(category)&&!QA_AI_CATEGORIES.includes(category))
      throw errorOf('Unsupported QA category','INVALID_QA_CATEGORY',409,{category});
    if(project.project_subtype_key!=='AI_APPLICATION'&&QA_AI_CATEGORIES.includes(category))
      throw errorOf('AI QA category is only valid for AI_APPLICATION','AI_QA_CATEGORY_NOT_APPLICABLE',409,{category});
    seen.add(category);
    if(c.requirementVersionId&&!baselineRequirementIds(baseline).includes(c.requirementVersionId))
      throw errorOf('QA case requirement must be in current Product Baseline','QA_REQUIREMENT_NOT_IN_BASELINE',409);
  }
  const missing=[...required].filter(x=>!seen.has(x));
  if(missing.length)throw errorOf('QA matrix coverage is incomplete','QA_MATRIX_COVERAGE_INCOMPLETE',409,{missingCategories:missing});

  const conn=await db.getConnection(),planId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute("UPDATE product_qa_plans SET status='HISTORICAL' WHERE project_id=? AND status='CURRENT'",[projectId]);
    await conn.execute(
      `INSERT INTO product_qa_plans
        (id,project_id,product_baseline_id,plan_key,title,status,matrix_json,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,'CURRENT',?,?,?)`,
      [planId,projectId,baseline.id,input.planKey,input.title,asJson(input.matrix),asJson(input.evidence),actorId]
    );
    const caseIds={};
    for(const c of input.cases){
      const id=randomUUID();caseIds[c.caseKey]=id;
      await conn.execute(
        `INSERT INTO product_qa_cases
          (id,qa_plan_id,project_id,case_key,category,requirement_version_id,title,assertions_json,status,evidence_json)
         VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',?)`,
        [id,planId,projectId,c.caseKey,upper(c.category),c.requirementVersionId||null,c.title,
         asJson(c.assertions),asJson(c.evidence)]
      );
    }
    await conn.commit();
    return {id:planId,projectId,productBaselineId:baseline.id,planKey:input.planKey,
      title:input.title,status:'CURRENT',caseIds};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createQaExecution=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,['qaPlanId','previewDeploymentId','executionKey','results','evidence'],'INVALID_QA_EXECUTION');
  if(!Array.isArray(input.results)||!input.results.length)throw errorOf('results must be a non-empty array','INVALID_QA_RESULTS');
  if(!Array.isArray(input.defects))throw errorOf('defects must be an array','INVALID_QA_DEFECTS');
  const db=getRuntimePool();
  const acceptance=await evaluateAcceptanceGate(projectId,{persist:false},actorId);
  if(acceptance.status!=='PASS')throw errorOf('Acceptance Gate must PASS before QA execution','ACCEPTANCE_GATE_REQUIRED',409);
  if(acceptance.evidenceSnapshot.previewDeploymentId!==input.previewDeploymentId)throw errorOf(
    'QA must execute against the exact accepted Preview','QA_PREVIEW_NOT_ACCEPTED',409
  );
  const plan=await assertProjectRow(db,'product_qa_plans',input.qaPlanId,projectId,'QA_PLAN_NOT_FOUND');
  if(plan.status!=='CURRENT')throw errorOf('QA execution requires current QA Plan','QA_PLAN_STALE',409);
  const baseline=await currentBaseline(projectId,db);
  if(plan.product_baseline_id!==baseline.id)throw errorOf('QA Plan baseline is stale','QA_PLAN_BASELINE_STALE',409);
  await assertProjectRow(db,'product_preview_deployments',input.previewDeploymentId,projectId,'PREVIEW_DEPLOYMENT_NOT_FOUND');

  const [cases]=await db.execute("SELECT * FROM product_qa_cases WHERE qa_plan_id=? AND status='ACTIVE'",[input.qaPlanId]);
  const byKey=new Map(cases.map(x=>[x.case_key,x]));
  const resultKeys=new Set(),normalized=[];
  for(const result of input.results){
    requireFields(result,['caseKey','status','evidence'],'INVALID_QA_CASE_RESULT');
    if(resultKeys.has(result.caseKey))throw errorOf('Duplicate QA result caseKey','DUPLICATE_QA_RESULT',409,{caseKey:result.caseKey});
    resultKeys.add(result.caseKey);
    const c=byKey.get(result.caseKey);
    if(!c)throw errorOf('QA result references unknown active case','QA_CASE_NOT_FOUND',404,{caseKey:result.caseKey});
    normalized.push({...result,status:assertQaResultStatus(result.status,c.category,result.rationale),case:c});
  }
  const missing=cases.filter(x=>!resultKeys.has(x.case_key)).map(x=>x.case_key);
  if(missing.length)throw errorOf(
    'Every active QA case must have explicit PASS / FAIL / NOT_RUN / BLOCKED / N_A',
    'QA_RESULT_COVERAGE_INCOMPLETE',409,{missingCases:missing}
  );

  const failKeys=new Set(normalized.filter(x=>x.status==='FAIL').map(x=>x.case.case_key));
  const defectByCase=new Map();
  for(const defect of input.defects){
    requireFields(defect,['caseKey','defectKey','severity','summary','returnStageKey','evidence'],'INVALID_QA_DEFECT');
    if(!failKeys.has(defect.caseKey))throw errorOf(
      'QA Defect must point to a FAIL case','QA_DEFECT_FAIL_CASE_REQUIRED',409,{caseKey:defect.caseKey}
    );
    if(defectByCase.has(defect.caseKey))throw errorOf('Only one primary Defect per FAIL case is allowed','DUPLICATE_QA_DEFECT',409);
    assertEnum(defect.severity,SEVERITIES,'INVALID_DEFECT_SEVERITY','defect severity');
    if(!['PD_07_DESIGN','PD_08_CONTRACT','PD_09_ENGINEERING','PD_10_BUILD'].includes(defect.returnStageKey))
      throw errorOf('QA Defect returnStageKey is invalid','INVALID_QA_RETURN_STAGE',409,{returnStageKey:defect.returnStageKey});
    defectByCase.set(defect.caseKey,defect);
  }
  const failWithoutDefect=[...failKeys].filter(k=>!defectByCase.has(k));
  if(failWithoutDefect.length)throw errorOf(
    'Every FAIL QA case requires a formal Defect','QA_FAIL_DEFECT_REQUIRED',409,{caseKeys:failWithoutDefect}
  );

  const conn=await db.getConnection(),executionId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_qa_executions
        (id,project_id,qa_plan_id,preview_deployment_id,execution_key,status,evidence_json,executed_by_identity_id,executed_at)
       VALUES (?,?,?,?,?,'COMPLETE',?,?,?)`,
      [executionId,projectId,input.qaPlanId,input.previewDeploymentId,input.executionKey,asJson(input.evidence),actorId,
       input.executedAt?new Date(input.executedAt):new Date()]
    );
    const resultIds=new Map();
    for(const result of normalized){
      const id=randomUUID();resultIds.set(result.case.case_key,id);
      await conn.execute(
        `INSERT INTO product_qa_case_results
          (id,qa_execution_id,qa_case_id,project_id,status,rationale,evidence_json)
         VALUES (?,?,?,?,?,?,?)`,
        [id,executionId,result.case.id,projectId,result.status,result.rationale||null,asJson(result.evidence)]
      );
    }
    const defectIds=[];
    for(const defect of input.defects){
      const c=byKey.get(defect.caseKey),id=randomUUID();defectIds.push(id);
      await conn.execute(
        `INSERT INTO product_qa_defects
          (id,project_id,qa_execution_id,qa_case_result_id,requirement_version_id,defect_key,severity,
           summary,status,return_stage_key,evidence_json)
         VALUES (?,?,?,?,?,?,?,?, 'OPEN',?,?)`,
        [id,projectId,executionId,resultIds.get(defect.caseKey),c.requirement_version_id||null,
         defect.defectKey,upper(defect.severity),defect.summary,defect.returnStageKey,asJson(defect.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'QA_CASE_RESULT',sourceId:resultIds.get(defect.caseKey),
        targetType:'QA_DEFECT',targetId:id,linkType:'RAISED_AS',actorId});
    }
    await insertTrace(conn,{projectId,sourceType:'PREVIEW_DEPLOYMENT',sourceId:input.previewDeploymentId,
      targetType:'QA_EXECUTION',targetId:executionId,linkType:'VERIFIED_AS',actorId});
    await conn.commit();
    return {id:executionId,projectId,qaPlanId:input.qaPlanId,previewDeploymentId:input.previewDeploymentId,
      executionKey:input.executionKey,status:'COMPLETE',resultCount:normalized.length,defectIds};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createQaRetest=async(defectId,input={},actorId=null)=>{
  requireFields(input,['previewDeploymentId','fixChangesetId','fixCommitSha','status','evidence'],'INVALID_QA_RETEST');
  const status=assertEnum(input.status,QA_RUN_STATUSES,'INVALID_QA_RETEST_STATUS','retest status');
  if(status==='BLOCKED')throw errorOf('Blocked retest cannot close defect','QA_RETEST_BLOCKED',409);
  const sha=assertSha(input.fixCommitSha),db=getRuntimePool();
  const [defects]=await db.execute('SELECT * FROM product_qa_defects WHERE id=?',[defectId]);
  if(!defects.length)throw errorOf('QA Defect not found','QA_DEFECT_NOT_FOUND',404);
  const defect=defects[0];
  if(defect.status==='RESOLVED')throw errorOf('QA Defect already resolved','QA_DEFECT_ALREADY_RESOLVED',409);
  const changeset=await assertProjectRow(db,'product_engineering_changesets',input.fixChangesetId,defect.project_id,'ENGINEERING_CHANGESET_NOT_FOUND');
  if(changeset.commit_sha.toLowerCase()!==sha)throw errorOf('Fix commit must equal Fix Changeset commit','QA_FIX_COMMIT_MISMATCH',409);
  const preview=await assertProjectRow(db,'product_preview_deployments',input.previewDeploymentId,defect.project_id,'PREVIEW_DEPLOYMENT_NOT_FOUND');
  if(preview.commit_sha.toLowerCase()!==sha)throw errorOf('Retest Preview must run exact Fix Commit','QA_RETEST_PREVIEW_COMMIT_MISMATCH',409);
  if(preview.deployment_status!=='SUCCESS')throw errorOf('Retest requires successful Preview','QA_RETEST_PREVIEW_NOT_SUCCESS',409);

  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_qa_retests
      (id,project_id,defect_id,preview_deployment_id,fix_changeset_id,fix_commit_sha,status,evidence_json,tested_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,defect.project_id,defectId,input.previewDeploymentId,input.fixChangesetId,sha,status,asJson(input.evidence),
     input.testedAt?new Date(input.testedAt):new Date()]
  );
  if(status==='PASS')await db.execute(
    `UPDATE product_qa_defects SET status='RETEST_PASS',fix_changeset_id=?,fix_commit_sha=? WHERE id=?`,
    [input.fixChangesetId,sha,defectId]
  );
  await insertTrace(db,{projectId:defect.project_id,sourceType:'QA_DEFECT',sourceId:defectId,
    targetType:'QA_RETEST',targetId:id,linkType:'RETESTED_BY',actorId});
  return {id,projectId:defect.project_id,defectId,previewDeploymentId:input.previewDeploymentId,
    fixChangesetId:input.fixChangesetId,fixCommitSha:sha,status};
};

export const createQaRegression=async(projectId,input={},actorId=null)=>{
  await loadProductProject(projectId);
  requireFields(input,['qaPlanId','previewDeploymentId','regressionKey','status','scope','evidence'],'INVALID_QA_REGRESSION');
  const status=assertEnum(input.status,QA_RUN_STATUSES,'INVALID_QA_REGRESSION_STATUS','regression status');
  const db=getRuntimePool();
  const plan=await assertProjectRow(db,'product_qa_plans',input.qaPlanId,projectId,'QA_PLAN_NOT_FOUND');
  if(plan.status!=='CURRENT')throw errorOf('Regression requires current QA Plan','QA_PLAN_STALE',409);
  await assertProjectRow(db,'product_preview_deployments',input.previewDeploymentId,projectId,'PREVIEW_DEPLOYMENT_NOT_FOUND');
  const defectIds=Array.isArray(input.defectIds)?input.defectIds:[];
  if(status==='PASS'&&defectIds.length){
    for(const defectId of defectIds){
      const [rows]=await db.execute('SELECT * FROM product_qa_defects WHERE id=? AND project_id=?',[defectId,projectId]);
      if(!rows.length)throw errorOf('QA Defect not found','QA_DEFECT_NOT_FOUND',404,{defectId});
      const defect=rows[0];
      if(defect.status!=='RETEST_PASS')throw errorOf('Regression closure requires PASS Retest','QA_DEFECT_RETEST_PASS_REQUIRED',409,{defectId});
      const [retests]=await db.execute(
        "SELECT * FROM product_qa_retests WHERE defect_id=? AND status='PASS' ORDER BY tested_at DESC,id DESC LIMIT 1",[defectId]
      );
      if(!retests.length||retests[0].preview_deployment_id!==input.previewDeploymentId)
        throw errorOf('Regression must use same Preview as latest PASS Retest','QA_REGRESSION_PREVIEW_MISMATCH',409,{defectId});
    }
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_qa_regression_runs
      (id,project_id,qa_plan_id,preview_deployment_id,regression_key,status,scope_json,evidence_json,tested_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.qaPlanId,input.previewDeploymentId,input.regressionKey,status,
     asJson({...input.scope,defectIds}),asJson(input.evidence),input.testedAt?new Date(input.testedAt):new Date()]
  );
  if(status==='PASS'&&defectIds.length){
    const placeholders=defectIds.map(()=>'?').join(',');
    await db.execute(
      `UPDATE product_qa_defects SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP(6)
       WHERE project_id=? AND id IN (${placeholders})`,[projectId,...defectIds]
    );
  }
  await insertTrace(db,{projectId,sourceType:'PREVIEW_DEPLOYMENT',sourceId:input.previewDeploymentId,
    targetType:'QA_REGRESSION',targetId:id,linkType:'REGRESSION_VERIFIED_BY',actorId});
  return {id,projectId,qaPlanId:input.qaPlanId,previewDeploymentId:input.previewDeploymentId,
    regressionKey:input.regressionKey,status,defectIds};
};

export const evaluateQaGate=async(projectId,input={},actorId=null)=>{
  const project=await loadProductProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};
  const acceptance=await evaluateAcceptanceGate(projectId,{persist:false},actorId);
  if(acceptance.status!=='PASS')reasons.push('ACCEPTANCE_NOT_READY');
  const baseline=await currentBaseline(projectId,db);
  evidence.productBaselineId=baseline.id;
  evidence.acceptanceRunId=acceptance.evidenceSnapshot?.acceptanceRunId||null;
  evidence.previewDeploymentId=acceptance.evidenceSnapshot?.previewDeploymentId||null;

  const [plans]=await db.execute(
    "SELECT * FROM product_qa_plans WHERE project_id=? AND status='CURRENT' ORDER BY updated_at DESC,id DESC LIMIT 1",[projectId]
  );
  const plan=plans[0]||null;
  evidence.qaPlanId=plan?.id||null;
  if(!plan)reasons.push('QA_PLAN_REQUIRED');
  else{
    if(plan.product_baseline_id!==baseline.id)reasons.push('QA_PLAN_BASELINE_STALE');
    const requiredCategories=[...QA_STANDARD_CATEGORIES,...(project.project_subtype_key==='AI_APPLICATION'?QA_AI_CATEGORIES:[])];
    const [cases]=await db.execute("SELECT * FROM product_qa_cases WHERE qa_plan_id=? AND status='ACTIVE'",[plan.id]);
    const categories=new Set(cases.map(x=>x.category));
    for(const category of requiredCategories)if(!categories.has(category))reasons.push(`QA_CATEGORY_REQUIRED:${category}`);

    const [executions]=await db.execute(
      `SELECT * FROM product_qa_executions
        WHERE project_id=? AND qa_plan_id=? AND preview_deployment_id=? AND status='COMPLETE'
        ORDER BY executed_at DESC,created_at DESC,id DESC LIMIT 1`,
      [projectId,plan.id,acceptance.evidenceSnapshot?.previewDeploymentId||'']
    );
    const execution=executions[0]||null;
    evidence.qaExecutionId=execution?.id||null;
    if(!execution)reasons.push('QA_EXECUTION_REQUIRED_FOR_ACCEPTED_PREVIEW');
    else{
      const [results]=await db.execute('SELECT * FROM product_qa_case_results WHERE qa_execution_id=?',[execution.id]);
      evidence.resultCount=results.length;
      const byCase=new Map(results.map(x=>[x.qa_case_id,x]));
      for(const c of cases){
        const result=byCase.get(c.id);
        if(!result){reasons.push(`QA_CASE_RESULT_REQUIRED:${c.case_key}`);continue;}
        if(result.status==='FAIL')reasons.push(`QA_CASE_FAIL:${c.case_key}`);
        if(result.status==='NOT_RUN')reasons.push(`QA_CASE_NOT_RUN:${c.case_key}`);
        if(result.status==='BLOCKED')reasons.push(`QA_CASE_BLOCKED:${c.case_key}`);
        if(result.status==='N_A'&&!nonEmpty(result.rationale))reasons.push(`QA_NA_REASON_REQUIRED:${c.case_key}`);
      }
    }

    const [defects]=await db.execute(
      "SELECT id,defect_key,severity,status FROM product_qa_defects WHERE project_id=? AND status<>'RESOLVED'",[projectId]
    );
    evidence.openDefects=defects;
    if(defects.length)reasons.push('QA_UNRESOLVED_DEFECTS');

    const [regressions]=await db.execute(
      `SELECT * FROM product_qa_regression_runs
        WHERE project_id=? AND qa_plan_id=? AND preview_deployment_id=? AND status='PASS'
        ORDER BY tested_at DESC,created_at DESC LIMIT 1`,
      [projectId,plan.id,acceptance.evidenceSnapshot?.previewDeploymentId||'']
    );
    evidence.regressionRunId=regressions[0]?.id||null;
    if(!regressions.length)reasons.push('QA_PASS_REGRESSION_REQUIRED');
  }

  const result={projectId,gateKey:QA_GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m275_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,QA_GATE,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getProductQualityState=async projectId=>{
  await loadProductProject(projectId);
  const db=getRuntimePool();
  const [acceptanceRuns,acceptanceChecks,gaps,plans,cases,executions,results,defects,retests,regressions,gates]=await Promise.all([
    db.execute('SELECT * FROM product_acceptance_runs WHERE project_id=? ORDER BY completed_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_acceptance_checks WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_acceptance_gaps WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_plans WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_cases WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_executions WHERE project_id=? ORDER BY executed_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_case_results WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_defects WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_retests WHERE project_id=? ORDER BY tested_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_qa_regression_runs WHERE project_id=? ORDER BY tested_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m275_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    acceptanceRuns:acceptanceRuns.map(x=>({id:x.id,acceptanceKey:x.acceptance_key,productBaselineId:x.product_baseline_id,
      previewDeploymentId:x.preview_deployment_id,status:x.status,completedAt:x.completed_at})),
    acceptanceChecks:acceptanceChecks.map(x=>({id:x.id,acceptanceRunId:x.acceptance_run_id,checkKey:x.check_key,
      category:x.category,requirementVersionId:x.requirement_version_id,status:x.status,rationale:x.rationale||null})),
    acceptanceGaps:gaps.map(x=>({id:x.id,acceptanceRunId:x.acceptance_run_id,gapKey:x.gap_key,severity:x.severity,
      summary:x.summary,status:x.status,returnStageKey:x.return_stage_key,resumePoint:parseJson(x.resume_point_json)})),
    qaPlans:plans.map(x=>({id:x.id,planKey:x.plan_key,title:x.title,productBaselineId:x.product_baseline_id,status:x.status,
      matrix:parseJson(x.matrix_json)})),
    qaCases:cases.map(x=>({id:x.id,qaPlanId:x.qa_plan_id,caseKey:x.case_key,category:x.category,
      requirementVersionId:x.requirement_version_id,title:x.title,status:x.status})),
    qaExecutions:executions.map(x=>({id:x.id,qaPlanId:x.qa_plan_id,previewDeploymentId:x.preview_deployment_id,
      executionKey:x.execution_key,status:x.status,executedAt:x.executed_at})),
    qaResults:results.map(x=>({id:x.id,qaExecutionId:x.qa_execution_id,qaCaseId:x.qa_case_id,
      status:x.status,rationale:x.rationale||null})),
    defects:defects.map(x=>({id:x.id,defectKey:x.defect_key,severity:x.severity,summary:x.summary,status:x.status,
      returnStageKey:x.return_stage_key,fixChangesetId:x.fix_changeset_id||null,fixCommitSha:x.fix_commit_sha||null})),
    retests:retests.map(x=>({id:x.id,defectId:x.defect_id,previewDeploymentId:x.preview_deployment_id,
      fixChangesetId:x.fix_changeset_id,fixCommitSha:x.fix_commit_sha,status:x.status,testedAt:x.tested_at})),
    regressions:regressions.map(x=>({id:x.id,qaPlanId:x.qa_plan_id,previewDeploymentId:x.preview_deployment_id,
      regressionKey:x.regression_key,status:x.status,scope:parseJson(x.scope_json),testedAt:x.tested_at})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),asOf:x.as_of}))
  };
};
