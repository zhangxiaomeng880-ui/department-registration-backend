import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M30-FINAL';
const SHA40=/^[0-9a-f]{40}$/i;
const REQUIRED_MARKERS=[
  'M29_5_IMPLEMENTATION_FINAL_PASS_REAL_DUAL_DOMAIN_EXIT_HOLD',
  'M30_1_PRIVATE_WORKSPACE_OPS_FOUNDATION_PASS',
  'M30_2_RELEASE_PROMOTION_ROLLBACK_PASS_PRODUCTION_HUMAN_GATE_HOLD',
  'M30_3_ALERT_INCIDENT_RECOVERY_LOOP_PASS',
  'M30_4_RETENTION_BACKUP_RESTORE_PASS_PRODUCTION_RESTORE_HOLD',
  'M30_5_GLOBAL_SEARCH_AUDIT_EVIDENCE_PASS'
];

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const criterion=(key,name,pass,evidence)=>({key,name,status:pass?'PASS':'HOLD',pass:Boolean(pass),evidence});

const validateRegressionEvidence=input=>{
  const e=input?.regressionEvidence;
  if(!e||String(e.status).toUpperCase()!=='PASS'||e.scope!=='M25-M30.5'||
     !SHA40.test(String(e.runtimeCommitSha||''))||!e.source||
     !Array.isArray(e.markers))return {pass:false,reason:'M30_FULL_REGRESSION_EVIDENCE_REQUIRED'};
  const runtime=String(e.runtimeCommitSha).toLowerCase();
  const expected=String(process.env.RUNTIME_COMMIT_SHA||'').toLowerCase();
  if(expected&&runtime!==expected)return {pass:false,reason:'M30_REGRESSION_RUNTIME_SHA_MISMATCH'};
  const missing=REQUIRED_MARKERS.filter(x=>!e.markers.includes(x));
  if(missing.length)return {pass:false,reason:'M30_REGRESSION_MARKERS_INCOMPLETE',missing};
  return {pass:true,runtimeCommitSha:runtime,source:e.source,markers:[...e.markers]};
};

export const evaluateM30FinalGate=async(input={},actorId=null)=>{
  const db=getRuntimePool(),asOf=input.asOf?asDate(input.asOf):new Date();

  const searchAudit=await one(db,`SELECT * FROM m30_search_audit_gate_evaluations
    WHERE gate_key='G-M30-SEARCH-AUDIT' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`);
  const workspaceId=searchAudit?.workspace_id||null;

  const [
    m29Final,ops,releaseRollback,alertIncident,retentionBackup,
    realProductCount,realAigcCount,realM29Product,realM29Aigc,
    unsafeProdPromotions,unsafeProdRestores,pendingProdApprovals
  ]=await Promise.all([
    one(db,`SELECT * FROM m29_final_gate_evaluations
      WHERE scope_key='PLATFORM' AND gate_key='G-M29-FINAL'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`),
    workspaceId?one(db,`SELECT * FROM m30_ops_foundation_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-OPS-FOUNDATION'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]):null,
    workspaceId?one(db,`SELECT * FROM m30_release_rollback_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-RELEASE-ROLLBACK'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]):null,
    workspaceId?one(db,`SELECT * FROM m30_alert_incident_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-ALERT-INCIDENT'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]):null,
    workspaceId?one(db,`SELECT * FROM m30_retention_backup_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-RETENTION-BACKUP'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[workspaceId]):null,
    count(db,`SELECT COUNT(*) count FROM product_development_e2e_certifications c
      JOIN projects p ON p.id=c.project_id
      WHERE c.status='FROZEN' AND EXISTS (
        SELECT 1 FROM product_m2711_gate_evaluations g
        WHERE g.project_id=c.project_id AND g.gate_key='G-PD-FINAL' AND g.status='PASS'
      )`),
    count(db,`SELECT COUNT(*) count FROM aigc_real_project_e2e_attestations a
      JOIN projects p ON p.id=a.project_id
      WHERE a.decision='APPROVED' AND a.attestation_mode='HUMAN' AND a.is_synthetic=FALSE
        AND EXISTS (
          SELECT 1 FROM aigc_domain_final_gate_evaluations g
          WHERE g.project_id=a.project_id AND g.gate_key='G-AIGC-DOMAIN-FINAL' AND g.status='PASS'
        )`),
    count(db,`SELECT COUNT(*) count FROM m29_real_loop_attestations
      WHERE project_type='PRODUCT_DEVELOPMENT' AND decision='APPROVED'
        AND attestation_mode='HUMAN' AND is_synthetic=FALSE`),
    count(db,`SELECT COUNT(*) count FROM m29_real_loop_attestations
      WHERE project_type='AIGC_CONTENT' AND decision='APPROVED'
        AND attestation_mode='HUMAN' AND is_synthetic=FALSE`),
    count(db,`SELECT COUNT(*) count FROM platform_release_promotions p
      JOIN platform_environments e ON e.id=p.target_environment_id
      WHERE e.environment_type='PRODUCTION' AND p.status='PROMOTED'
        AND (p.execution_mode IS NULL OR p.execution_mode<>'HUMAN')`),
    count(db,`SELECT COUNT(*) count FROM platform_restore_rehearsals r
      JOIN platform_environments e ON e.id=r.target_environment_id
      WHERE e.environment_type='PRODUCTION'
        AND (r.execution_mode<>'HUMAN' OR r.is_synthetic=TRUE)`),
    count(db,`SELECT COUNT(*) count FROM approval_requests
      WHERE requested_action IN ('PRODUCTION_RELEASE_PROMOTION','PRODUCTION_RELEASE_ROLLBACK')
        AND status='PENDING'`)
  ]);

  const regression=validateRegressionEvidence(input);
  const implementationCriteria=[
    criterion('M29_IMPLEMENTATION','M29 reusable implementation aggregate PASS',
      m29Final?.implementation_status==='PASS',
      {implementationStatus:m29Final?.implementation_status||null,blueprintExitStatus:m29Final?.blueprint_exit_status||null}),
    criterion('M30_OPS_FOUNDATION','Private Workspace / Environment / Connection Health PASS',
      ops?.status==='PASS',{gateId:ops?.id||null,status:ops?.status||null}),
    criterion('M30_RELEASE_ROLLBACK','Environment / Release Promotion / Rollback PASS',
      releaseRollback?.status==='PASS',{gateId:releaseRollback?.id||null,status:releaseRollback?.status||null}),
    criterion('M30_ALERT_INCIDENT','Alert / Incident recovery loop PASS',
      alertIncident?.status==='PASS',{gateId:alertIncident?.id||null,status:alertIncident?.status||null}),
    criterion('M30_RETENTION_BACKUP','Retention / Backup / Restore PASS',
      retentionBackup?.status==='PASS',{gateId:retentionBackup?.id||null,status:retentionBackup?.status||null}),
    criterion('M30_SEARCH_AUDIT','Global Search / Audit Evidence PASS',
      searchAudit?.status==='PASS',{gateId:searchAudit?.id||null,status:searchAudit?.status||null}),
    criterion('FULL_REGRESSION','M25–M30.5 full regression bound to exact Runtime SHA',
      regression.pass,regression),
    criterion('PRODUCTION_FAIL_CLOSED','Production unsafe automation remains zero',
      unsafeProdPromotions===0&&unsafeProdRestores===0,
      {unsafeProductionPromotions:unsafeProdPromotions,unsafeProductionRestores:unsafeProdRestores,
       pendingProductionHumanApprovals:pendingProdApprovals})
  ];
  const implementationStatus=implementationCriteria.every(x=>x.pass)?'PASS':'HOLD';

  const realProduct=realProductCount>0;
  const realAigc=realAigcCount>0;
  const realDualLoop=realM29Product>0&&realM29Aigc>0&&m29Final?.blueprint_exit_status==='PASS';
  const finalCriteria=[
    criterion('IMPLEMENTATION','M25–M30 reusable implementation aggregate PASS',
      implementationStatus==='PASS',{implementationStatus}),
    criterion('REAL_PRODUCT_E2E','至少一个真实 Product Development E2E PASS',
      realProduct,{realProductE2eCount:realProductCount}),
    criterion('REAL_AIGC_E2E','至少一个 HUMAN + 非合成真实 AIGC E2E PASS',
      realAigc,{realAigcE2eCount:realAigcCount}),
    criterion('REAL_DUAL_DOMAIN_SELF_LOOP','Product 与 AIGC 均有真实结果数据→决策→下一轮闭环',
      realDualLoop,{m29BlueprintExitStatus:m29Final?.blueprint_exit_status||null,
        realProductLoopCount:realM29Product,realAigcLoopCount:realM29Aigc})
  ];
  const blueprintFinalStatus=finalCriteria.every(x=>x.pass)?'PASS':'HOLD';

  const reasons=[
    ...implementationCriteria.filter(x=>!x.pass).map(x=>'M30_IMPLEMENTATION_'+x.key+'_REQUIRED'),
    ...(realProduct?[]:['AI_NATIVE_2_REAL_PRODUCT_E2E_REQUIRED']),
    ...(realAigc?[]:['AI_NATIVE_2_REAL_AIGC_E2E_REQUIRED']),
    ...(realDualLoop?[]:['AI_NATIVE_2_REAL_DUAL_DOMAIN_SELF_LOOP_REQUIRED'])
  ];
  const evidence={
    workspaceId,
    implementationCriteriaPassed:implementationCriteria.filter(x=>x.pass).length,
    implementationCriteriaTotal:implementationCriteria.length,
    finalCriteriaPassed:finalCriteria.filter(x=>x.pass).length,
    finalCriteriaTotal:finalCriteria.length,
    implementationStatus,blueprintFinalStatus,
    realProductE2eCount:realProductCount,realAigcE2eCount:realAigcCount,
    realProductLoopCount:realM29Product,realAigcLoopCount:realM29Aigc,
    pendingProductionHumanApprovals:pendingProdApprovals,
    unsafeProductionAutomationCount:unsafeProdPromotions+unsafeProdRestores,
    regressionRuntimeSha:regression.runtimeCommitSha||null,
    syntheticOrCiEvidenceCannotSatisfyRealFinal:true,
    finalFrozenAllowedOnlyWhenBlueprintFinalPass:true
  };
  const id=randomUUID();
  if(input.persist!==false)await db.execute(`INSERT INTO m30_final_gate_evaluations
    (id,scope_key,workspace_id,gate_key,implementation_status,blueprint_final_status,
     implementation_criteria_json,final_criteria_json,reason_codes_json,evidence_snapshot_json,
     as_of,evaluated_by_identity_id)
    VALUES (?,'PLATFORM',?,?,?,?,?,?,?,?,?,?)`,
    [id,workspaceId,GATE,implementationStatus,blueprintFinalStatus,asJson(implementationCriteria),
     asJson(finalCriteria),asJson(reasons),asJson(evidence),asOf,actorId]);
  return {id,scopeKey:'PLATFORM',workspaceId,gateKey:GATE,implementationStatus,blueprintFinalStatus,
    implementationCriteria,finalCriteria,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30FinalState=async()=>{
  const db=getRuntimePool();
  const evaluations=await list(db,`SELECT * FROM m30_final_gate_evaluations
    WHERE scope_key='PLATFORM' AND gate_key='G-M30-FINAL'
    ORDER BY as_of DESC,created_at DESC`);
  const latest=evaluations[0]||null;
  return {
    frontend:{
      language:'zh-CN',
      gateName:'AI Native 2.0 最终门禁',
      implementationPolicy:'M30 Implementation PASS 表示 M25–M30 平台实现与完整回归闭合。',
      realFinalPolicy:'AI Native 2.0 FINAL / FROZEN 还必须具备真实 Product E2E、HUMAN 非合成真实 AIGC E2E，以及 Product/AIGC 双域真实结果自闭环；CI/Synthetic 不能替代。'
    },
    requiredRegressionMarkers:[...REQUIRED_MARKERS],
    latest:latest?{
      id:latest.id,workspaceId:latest.workspace_id,implementationStatus:latest.implementation_status,
      blueprintFinalStatus:latest.blueprint_final_status,
      implementationCriteria:parseJson(latest.implementation_criteria_json),
      finalCriteria:parseJson(latest.final_criteria_json),
      reasonCodes:parseJson(latest.reason_codes_json),
      evidenceSnapshot:parseJson(latest.evidence_snapshot_json),asOf:latest.as_of
    }:null,
    evaluations:evaluations.map(x=>({
      id:x.id,workspaceId:x.workspace_id,implementationStatus:x.implementation_status,
      blueprintFinalStatus:x.blueprint_final_status,reasonCodes:parseJson(x.reason_codes_json),asOf:x.as_of
    }))
  };
};
