import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M29-FINAL';
const PRODUCT='PRODUCT_DEVELOPMENT';
const AIGC='AIGC_CONTENT';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};

const loadProject=async(projectId,db=getRuntimePool())=>{
  const p=await one(db,'SELECT id,workspace_id,project_key,name,project_type,status FROM projects WHERE id=?',[projectId]);
  if(!p)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(![PRODUCT,AIGC].includes(p.project_type))throw errorOf(
    'M29 real loop attestation requires Product Development or AIGC project',
    'M29_REAL_LOOP_PROJECT_TYPE_INVALID',409
  );
  return p;
};

export const resolveM29FinalProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createM29RealLoopAttestation=async(projectId,input={},actorId=null)=>{
  const project=await loadProject(projectId);
  requireFields(input,[
    'loopClosureId','attestationMode','decision','attestedByRef','attestedAt',
    'sourceResultRef','provenance','evidence'
  ],'INVALID_M29_REAL_LOOP_ATTESTATION');

  const mode=String(input.attestationMode).trim().toUpperCase();
  const decision=String(input.decision).trim().toUpperCase();
  const synthetic=input.isSynthetic===true;
  if(!['APPROVED','REJECTED'].includes(decision))throw errorOf(
    'Attestation decision must be APPROVED or REJECTED',
    'M29_REAL_LOOP_ATTESTATION_DECISION_INVALID',409
  );
  if(mode==='CI'||mode==='AUTO'||mode==='AUTOMATION'||(decision==='APPROVED'&&(mode!=='HUMAN'||synthetic)))
    throw errorOf(
      'Real loop APPROVED attestation requires HUMAN and non-synthetic evidence',
      'M29_REAL_LOOP_HUMAN_ATTESTATION_REQUIRED',409,{attestationMode:mode,isSynthetic:synthetic}
    );
  if(decision==='APPROVED'&&input.provenance?.realExternalOutcome!==true)throw errorOf(
    'Real loop APPROVED attestation requires explicit realExternalOutcome provenance',
    'M29_REAL_LOOP_REAL_OUTCOME_PROVENANCE_REQUIRED',409
  );

  const attestedAt=asDate(input.attestedAt);
  const db=getRuntimePool();
  const chain=await one(db,`SELECT
      c.id closure_id,c.status closure_status,c.next_round_json,c.knowledge_refs_json,c.backlog_refs_json,
      x.id execution_id,x.status execution_status,d.id candidate_id,d.detected_signal_id,
      s.id signal_id,s.metric_observation_id,q.status quality_status,o.source_object_type,o.source_object_id
    FROM m29_loop_closures c
    JOIN m29_loop_executions x ON x.id=c.loop_execution_id
    JOIN m29_decision_candidates d ON d.id=x.decision_candidate_id
    JOIN m29_detected_signals s ON s.id=d.detected_signal_id
    JOIN m29_metric_observations o ON o.id=s.metric_observation_id
    JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
    WHERE c.id=? AND c.project_id=? LIMIT 1`,[input.loopClosureId,projectId]);
  if(!chain)throw errorOf('Loop closure not found','M29_REAL_LOOP_CLOSURE_NOT_FOUND',404);
  if(chain.closure_status!=='FROZEN'||chain.execution_status!=='PASS'||chain.quality_status!=='PASS')
    throw errorOf(
      'Real loop attestation requires frozen closure, PASS execution and PASS data quality',
      'M29_REAL_LOOP_CHAIN_NOT_PASS',409
    );
  if(!nonEmpty(parseJson(chain.next_round_json))||
     (!nonEmpty(parseJson(chain.knowledge_refs_json))&&!nonEmpty(parseJson(chain.backlog_refs_json))))
    throw errorOf(
      'Real loop closure must contain next-round and Knowledge/Backlog writeback',
      'M29_REAL_LOOP_BACKWRITE_REQUIRED',409
    );
  if(String(input.sourceResultRef?.sourceObjectId||'')!==String(chain.source_object_id)||
     String(input.sourceResultRef?.sourceObjectType||'')!==String(chain.source_object_type))
    throw errorOf(
      'Attestation source result must match the immutable metric source fact',
      'M29_REAL_LOOP_SOURCE_RESULT_MISMATCH',409
    );

  const id=randomUUID();
  await db.execute(`INSERT INTO m29_real_loop_attestations
    (id,project_id,project_type,detected_signal_id,decision_candidate_id,loop_execution_id,loop_closure_id,
     attestation_mode,decision,attested_by_ref,attested_at,is_synthetic,source_result_ref_json,
     provenance_json,evidence_json,status,created_by_identity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
    [id,projectId,project.project_type,chain.signal_id,chain.candidate_id,chain.execution_id,chain.closure_id,
     mode,decision,input.attestedByRef,attestedAt,synthetic?1:0,asJson(input.sourceResultRef),
     asJson(input.provenance),asJson(input.evidence),actorId]);
  return {id,projectId,projectType:project.project_type,loopClosureId:chain.closure_id,
    attestationMode:mode,decision,isSynthetic:synthetic,attestedAt};
};

const criterion=(key,name,pass,evidence)=>({key,name,status:pass?'PASS':'HOLD',pass:Boolean(pass),evidence});

export const evaluateM29FinalGate=async(input={},actorId=null)=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();

  const projects=await list(db,`SELECT id,workspace_id,project_type,project_key,name FROM projects
    WHERE project_type IN (?,?)`,[PRODUCT,AIGC]);
  const byType=type=>projects.filter(x=>x.project_type===type);
  const productProjects=byType(PRODUCT),aigcProjects=byType(AIGC);

  const passCounts=async(table,gateKey,type)=>{
    const ids=byType(type).map(x=>x.id);
    if(!ids.length)return 0;
    const qs=ids.map(()=>'?').join(',');
    return count(db,`SELECT COUNT(DISTINCT project_id) count FROM ${table}
      WHERE gate_key=? AND status='PASS' AND project_id IN (${qs})`,[gateKey,...ids]);
  };

  const [
    productData,aigcData,productLoop,aigcLoop,automationPass,analyticsEvalPass,exactBindingCount
  ]=await Promise.all([
    passCounts('m29_data_detection_gate_evaluations','G-M29-DATA-DETECTION',PRODUCT),
    passCounts('m29_data_detection_gate_evaluations','G-M29-DATA-DETECTION',AIGC),
    passCounts('m29_self_loop_gate_evaluations','G-M29-SELF-LOOP',PRODUCT),
    passCounts('m29_self_loop_gate_evaluations','G-M29-SELF-LOOP',AIGC),
    count(db,`SELECT COUNT(*) count FROM m29_automation_gate_evaluations
      WHERE gate_key='G-M29-AUTOMATION' AND status='PASS'`),
    count(db,`SELECT COUNT(*) count FROM m29_analytics_eval_gate_evaluations
      WHERE gate_key='G-M29-ANALYTICS-EVAL' AND status='PASS'`),
    count(db,`SELECT COUNT(*) count FROM m29_eval_benchmark_bindings
      WHERE status='VERIFIED' AND capability_type IN ('MODEL','TOOL')
        AND CHAR_LENGTH(candidate_runtime_sha)=40`)
  ]);

  const implementationCriteria=[
    criterion('DATA_PRODUCT','Product 数据/指标/质量/检测通过',productData>0,{passProjectCount:productData}),
    criterion('DATA_AIGC','AIGC 数据/指标/质量/检测通过',aigcData>0,{passProjectCount:aigcData}),
    criterion('SELF_LOOP_PRODUCT','Product 决策/执行/回写结构闭环通过',productLoop>0,{passProjectCount:productLoop}),
    criterion('SELF_LOOP_AIGC','AIGC 决策/执行/回写结构闭环通过',aigcLoop>0,{passProjectCount:aigcLoop}),
    criterion('AUTOMATION','Scheduler/Event/Webhook 自动化入口通过',automationPass>0,{passEvaluationCount:automationPass}),
    criterion('ANALYTICS_EVAL','Analytics + Eval/Benchmark exact-version 通过',
      analyticsEvalPass>0&&exactBindingCount>0,
      {analyticsEvalPassCount:analyticsEvalPass,exactBenchmarkBindingCount:exactBindingCount})
  ];
  const implementationStatus=implementationCriteria.every(x=>x.pass)?'PASS':'HOLD';

  const attestations=await list(db,`SELECT a.*,p.project_key,p.name FROM m29_real_loop_attestations a
    JOIN projects p ON p.id=a.project_id
    WHERE a.decision='APPROVED' AND a.attestation_mode='HUMAN'
      AND a.is_synthetic=FALSE AND a.status='ACTIVE'
    ORDER BY a.attested_at DESC`);
  const realProduct=attestations.find(x=>x.project_type===PRODUCT)||null;
  const realAigc=attestations.find(x=>x.project_type===AIGC)||null;

  const exitCriteria=[
    criterion('IMPLEMENTATION','M29 reusable implementation aggregate PASS',
      implementationStatus==='PASS',{implementationStatus}),
    criterion('REAL_PRODUCT_LOOP','至少一个真实 Product 结果数据→决策→下一轮闭环',
      Boolean(realProduct),{attestationId:realProduct?.id||null,projectId:realProduct?.project_id||null}),
    criterion('REAL_AIGC_LOOP','至少一个真实 AIGC 结果数据→决策→下一轮闭环',
      Boolean(realAigc),{attestationId:realAigc?.id||null,projectId:realAigc?.project_id||null})
  ];
  const blueprintExitStatus=exitCriteria.every(x=>x.pass)?'PASS':'HOLD';
  const reasons=[
    ...implementationCriteria.filter(x=>!x.pass).map(x=>`M29_IMPLEMENTATION_${x.key}_REQUIRED`),
    ...(realProduct?[]:['M29_REAL_PRODUCT_LOOP_REQUIRED']),
    ...(realAigc?[]:['M29_REAL_AIGC_LOOP_REQUIRED'])
  ];
  const evidence={
    scopeKey:'PLATFORM',
    projectCounts:{product:productProjects.length,aigc:aigcProjects.length},
    implementationCriteriaPassed:implementationCriteria.filter(x=>x.pass).length,
    implementationCriteriaTotal:implementationCriteria.length,
    implementationStatus,blueprintExitStatus,
    realProductLoopAttested:Boolean(realProduct),realAigcLoopAttested:Boolean(realAigc),
    syntheticOrCiEvidenceCannotSatisfyRealExit:true
  };
  const id=randomUUID();
  if(input.persist!==false)await db.execute(`INSERT INTO m29_final_gate_evaluations
    (id,scope_key,gate_key,implementation_status,blueprint_exit_status,implementation_criteria_json,
     exit_criteria_json,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
    VALUES (?,'PLATFORM',?,?,?,?,?,?,?,?,?)`,
    [id,GATE,implementationStatus,blueprintExitStatus,asJson(implementationCriteria),
     asJson(exitCriteria),asJson(reasons),asJson(evidence),asOf,actorId]);

  return {id,scopeKey:'PLATFORM',gateKey:GATE,implementationStatus,blueprintExitStatus,
    implementationCriteria,exitCriteria,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM29FinalState=async()=>{
  const db=getRuntimePool();
  const [attestations,evaluations]=await Promise.all([
    list(db,`SELECT a.id,a.project_id,a.project_type,a.loop_closure_id,a.attestation_mode,a.decision,
      a.attested_by_ref,a.attested_at,a.is_synthetic,a.source_result_ref_json,a.provenance_json,a.status,
      p.project_key,p.name project_name
      FROM m29_real_loop_attestations a JOIN projects p ON p.id=a.project_id
      ORDER BY a.attested_at DESC,a.created_at DESC`),
    list(db,`SELECT * FROM m29_final_gate_evaluations
      WHERE scope_key='PLATFORM' ORDER BY as_of DESC,created_at DESC`)
  ]);
  return {
    frontend:{language:'zh-CN',gateName:'M29 数据 / 评测 / 自动化 / 自闭环最终门禁',
      moduleNames:['M29 实现最终验收','真实双域自闭环实证'],
      realExitPolicy:'Implementation PASS 可由结构化 Gate/Eval 证明；Blueprint Exit 必须同时具备 HUMAN、非合成的 Product 与 AIGC 真实闭环实证，CI/AUTO 不得替代。'},
    attestations:attestations.map(x=>({id:x.id,projectId:x.project_id,projectType:x.project_type,
      projectKey:x.project_key,projectName:x.project_name,loopClosureId:x.loop_closure_id,
      attestationMode:x.attestation_mode,decision:x.decision,attestedByRef:x.attested_by_ref,
      attestedAt:x.attested_at,isSynthetic:Boolean(x.is_synthetic),
      sourceResultRef:parseJson(x.source_result_ref_json),provenance:parseJson(x.provenance_json),status:x.status})),
    latest:evaluations[0]?{id:evaluations[0].id,implementationStatus:evaluations[0].implementation_status,
      blueprintExitStatus:evaluations[0].blueprint_exit_status,
      implementationCriteria:parseJson(evaluations[0].implementation_criteria_json),
      exitCriteria:parseJson(evaluations[0].exit_criteria_json),
      reasonCodes:parseJson(evaluations[0].reason_codes_json),
      evidenceSnapshot:parseJson(evaluations[0].evidence_snapshot_json),asOf:evaluations[0].as_of}:null
  };
};
