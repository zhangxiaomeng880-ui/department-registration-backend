import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AI-NATIVE-V2-FINAL';
const SHA40=/^[0-9a-f]{40}$/i;
const CRITERIA_NAMES=[
  'Objective / Initiative → Portfolio → Project → Milestone → Version → Iteration → Work Item 可管理',
  'Milestone Roll-up / Forecast / Health / Dependency / Capacity / Staleness / Completion Evidence 可运行',
  'Project Baseline / Version / Domain / Module / Epic / Risk / Decision / Change / Closure / Archive 可运行',
  'Competitive Intelligence 覆盖 Product/Market、Creative/Content、Model/Tool Benchmark 与证据时效/决策链',
  'Project Type / Workflow / Stage / Agent / Capability / Prompt / Connection 可配置和版本化',
  'Agent / Model / Tool / Skill / MCP / Connector 统一注册，Policy Fail-closed',
  'Human Gate 形成 Approval Request / Decision / Evidence',
  'Runtime Event / Attempt / Idempotency / Timeout / Cancel / Retry / Fallback / Interrupt / Dead-letter / Resume / Rollback 可运行',
  'Trigger / Schedule / Event / Webhook 可启动受控 Workflow 并留 Evidence',
  'Knowledge 支持 Source / Version / Permission / Freshness / Retrieval Quality / Backwrite',
  'Asset / Artifact 支持 Version / Current / Candidate / Locked / Lineage / Rights / Usage / History / Restore',
  'Data Source / Metric / Instrumentation / Data Quality / Experiment / Portfolio & Project Analytics 可解释',
  'Eval 覆盖 Model / Agent / Router / RAG / Tool / Workflow / E2E 并绑定 exact version',
  'Product Development 全生命周期实现可运行',
  'AI_APPLICATION 专项 Model / Prompt / RAG / Agent / Tool / Eval / Safety / Injection / Fallback / Human Escalation Gate 可运行',
  'AIGC Project / Version / Unit / Scene / Shot / Asset / Generation / Candidate / Timeline / Master / Distribution / Performance 可运行',
  'AIGC Call Sheet / Reference Role / Immutable / Only Variable / Generation History / Selection / Lock / Restore 可执行',
  'AIGC QA 覆盖 Story/Continuity、Identity/Look/Scene/Prop、Action/Expression、Temporal/Spatial、Audio/Sync、Edit/Caption、Technical、Rights/Compliance、Localization',
  'Product Development 与 AIGC 各至少一个真实 E2E PASS，并形成结果数据→决策→下一轮真实自闭环',
  'Environment / Release Promotion / Rollback、Provider/Connection/Runtime Health、Alert/Incident、Retention/Backup/Restore 可验证',
  'Usage / Cost / Budget / Quota 可追溯',
  'M25–M30 不新增非必要商业功能，商业化不反向驱动未验证产品形态'
];

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const allCriteria=()=>Array.from({length:22},(_,i)=>String(i+1).padStart(2,'0'));

export const recordAiNativeV2FinalRegressionReceipt=async(input={})=>{
  const required=['provider','repositoryFullName','workflowName','workflowRunId','exactRuntimeSha',
    'status','coveredCriteria','testMarkers','evidence'];
  const missing=required.filter(k=>input[k]==null||input[k]===''||(Array.isArray(input[k])&&!input[k].length));
  if(missing.length)throw errorOf('Required fields are missing','INVALID_AI_NATIVE_V2_FINAL_REGRESSION',400,{missing});
  if(upper(input.provider)!=='GITHUB_ACTIONS')throw errorOf(
    'Final regression receipt must come from GitHub Actions','AI_NATIVE_V2_REGRESSION_PROVIDER_REQUIRED',409
  );
  if(upper(input.status)!=='PASS')throw errorOf(
    'Final regression receipt status must PASS','AI_NATIVE_V2_REGRESSION_PASS_REQUIRED',409
  );
  if(!SHA40.test(String(input.exactRuntimeSha)))throw errorOf(
    'Final regression receipt requires exact 40-char Runtime SHA','AI_NATIVE_V2_REGRESSION_EXACT_SHA_REQUIRED',409
  );
  const covered=[...new Set(input.coveredCriteria.map(x=>String(x).padStart(2,'0')))].sort();
  const missingCriteria=allCriteria().filter(x=>!covered.includes(x));
  if(missingCriteria.length)throw errorOf(
    'Final regression receipt must cover all 22 implementation criteria',
    'AI_NATIVE_V2_REGRESSION_COVERAGE_INCOMPLETE',409,{missingCriteria}
  );
  if(!Array.isArray(input.testMarkers)||input.testMarkers.length<6)throw errorOf(
    'Final regression receipt requires representative test markers',
    'AI_NATIVE_V2_REGRESSION_MARKERS_REQUIRED',409
  );
  const db=getRuntimePool(),sha=String(input.exactRuntimeSha).toLowerCase();
  const existing=await one(db,`SELECT * FROM ai_native_v2_final_regression_receipts
    WHERE provider='GITHUB_ACTIONS' AND repository_full_name=? AND workflow_run_id=? AND exact_runtime_sha=?`,
    [input.repositoryFullName,String(input.workflowRunId),sha]);
  if(existing)return {id:existing.id,status:existing.status,exactRuntimeSha:existing.exact_runtime_sha,
    workflowRunId:existing.workflow_run_id,idempotent:true};
  const id=randomUUID(),recordedAt=input.recordedAt?asDate(input.recordedAt):new Date();
  await db.execute(`INSERT INTO ai_native_v2_final_regression_receipts
    (id,provider,repository_full_name,workflow_name,workflow_run_id,exact_runtime_sha,status,
     covered_criteria_json,test_markers_json,evidence_json,recorded_at)
    VALUES (?,'GITHUB_ACTIONS',?,?,?,?, 'PASS',?,?,?,?)`,
    [id,input.repositoryFullName,input.workflowName,String(input.workflowRunId),sha,
     asJson(covered),asJson(input.testMarkers),asJson(input.evidence),recordedAt]);
  return {id,status:'PASS',repositoryFullName:input.repositoryFullName,workflowName:input.workflowName,
    workflowRunId:String(input.workflowRunId),exactRuntimeSha:sha,coveredCriteria:covered,
    testMarkers:input.testMarkers,recordedAt,idempotent:false};
};

const latestWorkspaceGate=async(db,table,workspaceId,gateKey)=>{
  const row=await one(db,`SELECT id,status,as_of FROM ${table}
    WHERE workspace_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId,gateKey]);
  return row?{id:row.id,status:row.status,asOf:row.as_of}:null;
};

const criterion=(number,name,implementationPass,blueprintPass,evidence)=>({
  number:String(number).padStart(2,'0'),name,
  implementationStatus:implementationPass?'PASS':'HOLD',
  blueprintStatus:blueprintPass?'PASS':'HOLD',
  implementationPass:Boolean(implementationPass),blueprintPass:Boolean(blueprintPass),evidence
});

export const evaluateAiNativeV2FinalGate=async(input={})=>{
  const sha=String(input.candidateRuntimeSha||'').toLowerCase();
  if(!SHA40.test(sha))throw errorOf('candidateRuntimeSha is required','AI_NATIVE_V2_FINAL_RUNTIME_SHA_REQUIRED',400);
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();

  const regression=await one(db,`SELECT * FROM ai_native_v2_final_regression_receipts
    WHERE exact_runtime_sha=? AND status='PASS' ORDER BY recorded_at DESC,created_at DESC LIMIT 1`,[sha]);
  const covered=new Set(parseJson(regression?.covered_criteria_json)||[]);

  const m29=await one(db,`SELECT * FROM m29_final_gate_evaluations
    WHERE scope_key='PLATFORM' AND gate_key='G-M29-FINAL' ORDER BY as_of DESC,created_at DESC LIMIT 1`);

  const searchAudit=await one(db,`SELECT * FROM m30_search_audit_gate_evaluations
    WHERE gate_key='G-M30-SEARCH-AUDIT' AND status='PASS' ORDER BY as_of DESC,created_at DESC LIMIT 1`);
  const workspaceId=searchAudit?.workspace_id||null;
  const m30=workspaceId?{
    ops:await latestWorkspaceGate(db,'m30_ops_foundation_gate_evaluations',workspaceId,'G-M30-OPS-FOUNDATION'),
    release:await latestWorkspaceGate(db,'m30_release_rollback_gate_evaluations',workspaceId,'G-M30-RELEASE-ROLLBACK'),
    incident:await latestWorkspaceGate(db,'m30_alert_incident_gate_evaluations',workspaceId,'G-M30-ALERT-INCIDENT'),
    backup:await latestWorkspaceGate(db,'m30_retention_backup_gate_evaluations',workspaceId,'G-M30-RETENTION-BACKUP'),
    searchAudit:{id:searchAudit.id,status:searchAudit.status,asOf:searchAudit.as_of}
  }:null;
  const m30AllPass=Boolean(m30&&Object.values(m30).every(x=>x?.status==='PASS'));

  const [productE2e,aigcRealE2e,productRealLoop,aigcRealLoop]=await Promise.all([
    count(db,`SELECT COUNT(DISTINCT c.project_id) count FROM product_development_e2e_certifications c
      WHERE c.status='FROZEN' AND EXISTS (
        SELECT 1 FROM product_m2711_gate_evaluations g
        WHERE g.project_id=c.project_id AND g.gate_key='G-PD-FINAL' AND g.status='PASS'
      )`),
    count(db,`SELECT COUNT(DISTINCT project_id) count FROM aigc_real_project_e2e_attestations
      WHERE decision='APPROVED' AND attestation_mode='HUMAN' AND is_synthetic=FALSE AND status='ACTIVE'`),
    count(db,`SELECT COUNT(DISTINCT project_id) count FROM m29_real_loop_attestations
      WHERE project_type='PRODUCT_DEVELOPMENT' AND decision='APPROVED'
        AND attestation_mode='HUMAN' AND is_synthetic=FALSE AND status='ACTIVE'`),
    count(db,`SELECT COUNT(DISTINCT project_id) count FROM m29_real_loop_attestations
      WHERE project_type='AIGC_CONTENT' AND decision='APPROVED'
        AND attestation_mode='HUMAN' AND is_synthetic=FALSE AND status='ACTIVE'`)
  ]);

  const regressionPass=Boolean(regression);
  const m29ImplementationPass=m29?.implementation_status==='PASS';
  const realCriterion19=productE2e>0&&aigcRealE2e>0&&productRealLoop>0&&aigcRealLoop>0;
  const criteria=[];
  for(let n=1;n<=22;n++){
    const num=String(n).padStart(2,'0');
    let impl=regressionPass&&covered.has(num);
    if(n===19)impl=impl&&m29ImplementationPass;
    if(n===20)impl=impl&&m30AllPass;
    const blueprint=n===19?impl&&realCriterion19:impl;
    criteria.push(criterion(n,CRITERIA_NAMES[n-1],impl,blueprint,{
      regressionReceiptId:regression?.id||null,
      ...(n===19?{productRealE2eProjectCount:productE2e,aigcRealE2eProjectCount:aigcRealE2e,
        productRealSelfLoopProjectCount:productRealLoop,aigcRealSelfLoopProjectCount:aigcRealLoop,
        m29BlueprintExitStatus:m29?.blueprint_exit_status||null}:{}),
      ...(n===20?{workspaceId,m30}:{}),
      ...(n===21?{regressionCoversUsageCostBudgetQuota:covered.has('21')}:{}),
      ...(n===22?{commercialScopePolicy:'NO_NEW_NONESSENTIAL_COMMERCIAL_FEATURES_IN_M25_M30'}:{})
    }));
  }

  const implementationStatus=criteria.every(x=>x.implementationPass)?'PASS':'HOLD';
  const blueprintFinalStatus=criteria.every(x=>x.blueprintPass)?'PASS':'HOLD';
  const reasons=[];
  if(!regressionPass)reasons.push('AI_NATIVE_V2_FULL_REGRESSION_RECEIPT_REQUIRED');
  if(!m29ImplementationPass)reasons.push('AI_NATIVE_V2_M29_IMPLEMENTATION_PASS_REQUIRED');
  if(!m30AllPass)reasons.push('AI_NATIVE_V2_M30_PLATFORM_GATES_PASS_REQUIRED');
  if(productE2e<1)reasons.push('AI_NATIVE_V2_REAL_PRODUCT_E2E_REQUIRED');
  if(aigcRealE2e<1)reasons.push('AI_NATIVE_V2_REAL_AIGC_E2E_REQUIRED');
  if(productRealLoop<1)reasons.push('AI_NATIVE_V2_REAL_PRODUCT_SELF_LOOP_REQUIRED');
  if(aigcRealLoop<1)reasons.push('AI_NATIVE_V2_REAL_AIGC_SELF_LOOP_REQUIRED');

  const evidence={
    candidateRuntimeSha:sha,regressionReceiptId:regression?.id||null,
    regressionProvider:regression?.provider||null,regressionWorkflowRunId:regression?.workflow_run_id||null,
    coveredCriteria:regression?parseJson(regression.covered_criteria_json):[],
    m29ImplementationStatus:m29?.implementation_status||null,m29BlueprintExitStatus:m29?.blueprint_exit_status||null,
    m30ValidationWorkspaceId:workspaceId,m30AllPass,
    realEvidence:{productE2eProjectCount:productE2e,aigcE2eProjectCount:aigcRealE2e,
      productSelfLoopProjectCount:productRealLoop,aigcSelfLoopProjectCount:aigcRealLoop},
    ciOrSyntheticCannotSatisfyCriterion19:true,
    allowedFinalFrozen:blueprintFinalStatus==='PASS'
  };
  const id=randomUUID();
  await db.execute(`INSERT INTO ai_native_v2_final_gate_evaluations
    (id,gate_key,candidate_runtime_sha,implementation_status,blueprint_final_status,
     criteria_json,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,GATE,sha,implementationStatus,blueprintFinalStatus,asJson(criteria),asJson(reasons),asJson(evidence),asOf]);
  return {id,gateKey:GATE,candidateRuntimeSha:sha,implementationStatus,blueprintFinalStatus,
    criteria,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getAiNativeV2FinalState=async()=>{
  const db=getRuntimePool();
  const rows=await list(db,`SELECT * FROM ai_native_v2_final_gate_evaluations
    WHERE gate_key=? ORDER BY as_of DESC,created_at DESC`,[GATE]);
  return {
    frontend:{language:'zh-CN',title:'AI Native 2.0 最终门禁',
      policy:'Implementation PASS 与 Blueprint FINAL/FROZEN 严格分离；Criterion 19 必须使用真实 Product + AIGC E2E 与真实结果数据自闭环，CI/fixture/synthetic 不得替代。'},
    latest:rows[0]?{id:rows[0].id,candidateRuntimeSha:rows[0].candidate_runtime_sha,
      implementationStatus:rows[0].implementation_status,blueprintFinalStatus:rows[0].blueprint_final_status,
      criteria:parseJson(rows[0].criteria_json),reasonCodes:parseJson(rows[0].reason_codes_json),
      evidenceSnapshot:parseJson(rows[0].evidence_snapshot_json),asOf:rows[0].as_of}:null
  };
};
