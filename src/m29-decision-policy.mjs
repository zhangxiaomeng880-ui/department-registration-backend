import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M29-DECISION';
const OUTCOMES=new Set(['ACTION','NO_ACTION','BACKLOG','REVIEW']);
const TARGET_TYPES=new Set(['CAPABILITY','WORKFLOW','BACKLOG','REVIEW','NONE']);
const RISKS=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const FINAL_STATUSES=new Set(['AUTO_APPROVED','APPROVED','REJECTED','RESOLVED']);

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
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
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadSignal=async(signalId,projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT s.*,r.decision_policy_json,r.severity AS rule_severity,r.rule_key
       FROM m29_detected_signals s
       JOIN m29_detection_rules r ON r.id=s.detection_rule_id
      WHERE s.id=? AND s.project_id=?`,[signalId,projectId]
  );
  if(!rows.length)throw errorOf('Detected signal not found','M29_SIGNAL_NOT_FOUND',404);
  return rows[0];
};
const normalizeTarget=(outcome,targetType)=>{
  if(outcome==='ACTION'&&!['CAPABILITY','WORKFLOW'].includes(targetType))
    throw errorOf('ACTION must target CAPABILITY or WORKFLOW','M29_DECISION_ACTION_TARGET_INVALID',409);
  if(outcome==='BACKLOG'&&targetType!=='BACKLOG')
    throw errorOf('BACKLOG outcome must target BACKLOG','M29_DECISION_BACKLOG_TARGET_INVALID',409);
  if(outcome==='REVIEW'&&targetType!=='REVIEW')
    throw errorOf('REVIEW outcome must target REVIEW','M29_DECISION_REVIEW_TARGET_INVALID',409);
  if(outcome==='NO_ACTION'&&targetType!=='NONE')
    throw errorOf('NO_ACTION must target NONE','M29_DECISION_NO_ACTION_TARGET_INVALID',409);
};
const requiresHumanGate=({outcome,risk,policy,externalSideEffect,irreversible})=>{
  if(outcome!=='ACTION')return false;
  return externalSideEffect===true||irreversible===true||
    ['HIGH','CRITICAL'].includes(risk)||policy?.automaticAction!==true;
};

export const resolveM29DecisionProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveM29DecisionCandidateScope=async decisionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT d.project_id,p.workspace_id FROM m29_decision_candidates d
      JOIN projects p ON p.id=d.project_id WHERE d.id=?`,[decisionId]
  );
  if(!rows.length)throw errorOf('Decision candidate not found','M29_DECISION_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createM29DecisionCandidate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'detectedSignalId','decisionKey','outcome','targetType','actionSpec','rationale','evidence'
  ],'INVALID_M29_DECISION_CANDIDATE');
  const outcome=upper(input.outcome),targetType=upper(input.targetType);
  if(!OUTCOMES.has(outcome))throw errorOf(
    'Decision outcome invalid','M29_DECISION_OUTCOME_INVALID',409,{outcome}
  );
  if(!TARGET_TYPES.has(targetType))throw errorOf(
    'Decision target type invalid','M29_DECISION_TARGET_INVALID',409,{targetType}
  );
  normalizeTarget(outcome,targetType);
  if(outcome==='ACTION'&&!nonEmpty(input.actionSpec?.targetKey))
    throw errorOf('ACTION requires actionSpec.targetKey','M29_DECISION_ACTION_SPEC_REQUIRED',409);

  const db=getRuntimePool(),signal=await loadSignal(input.detectedSignalId,projectId,db);
  if(!['DETECTED','DECISION_PENDING'].includes(signal.status))throw errorOf(
    'Signal is not available for decision','M29_SIGNAL_STATE_INVALID',409,{status:signal.status}
  );
  const [dataGates]=await db.execute(
    `SELECT status FROM m29_data_detection_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-DATA-DETECTION'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[projectId]
  );
  if(!dataGates.length||dataGates[0].status!=='PASS')throw errorOf(
    'Decision candidate requires G-M29-DATA-DETECTION PASS','G_M29_DATA_DETECTION_REQUIRED',409
  );

  const policy=parseJson(signal.decision_policy_json)||{};
  if(policy.nextLayer&&upper(policy.nextLayer)!=='DECISION_CANDIDATE')throw errorOf(
    'Signal decision policy does not route to Decision Candidate',
    'M29_DECISION_POLICY_ROUTE_INVALID',409,{nextLayer:policy.nextLayer}
  );
  const risk=upper(input.riskLevel||signal.severity||signal.rule_severity||'MEDIUM');
  if(!RISKS.has(risk))throw errorOf('Decision risk invalid','M29_DECISION_RISK_INVALID',409,{risk});
  const externalSideEffect=input.externalSideEffect===true||input.actionSpec?.externalSideEffect===true;
  const irreversible=input.irreversible===true||input.actionSpec?.irreversible===true;
  const humanGateRequired=requiresHumanGate({outcome,risk,policy,externalSideEffect,irreversible});
  const status=outcome==='ACTION'
    ?(humanGateRequired?'APPROVAL_REQUIRED':'AUTO_APPROVED')
    :'RESOLVED';
  const decidedAt=FINAL_STATUSES.has(status)?new Date():null;

  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_decision_candidates
      (id,project_id,detected_signal_id,decision_key,outcome,target_type,action_spec_json,
       policy_snapshot_json,risk_level,external_side_effect,irreversible,human_gate_required,
       rationale_json,status,human_decision_json,decided_at,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
    [
      id,projectId,signal.id,input.decisionKey,outcome,targetType,asJson(input.actionSpec),
      asJson({detectionRuleKey:signal.rule_key,...policy}),risk,externalSideEffect?1:0,irreversible?1:0,
      humanGateRequired?1:0,asJson(input.rationale),status,decidedAt,asJson(input.evidence),actorId
    ]
  );
  await db.execute(
    "UPDATE m29_detected_signals SET status=? WHERE id=?",
    [status==='APPROVAL_REQUIRED'?'DECISION_PENDING':'DECIDED',signal.id]
  );
  return {
    id,projectId,detectedSignalId:signal.id,decisionKey:input.decisionKey,outcome,targetType,
    riskLevel:risk,humanGateRequired,status,executionReady:['AUTO_APPROVED','APPROVED'].includes(status),
    executionDispatched:false
  };
};

export const decideM29DecisionCandidate=async(decisionId,input={},actorId=null)=>{
  requireFields(input,['decision','evidence'],'INVALID_M29_HUMAN_DECISION');
  const decision=input.decision||{},mode=upper(decision.mode),result=upper(decision.decision);
  if(mode!=='HUMAN'||!['APPROVED','REJECTED'].includes(result)||
     !nonEmpty(decision.decidedByRef)||!nonEmpty(decision.decidedAt))
    throw errorOf('Decision requires explicit HUMAN APPROVED/REJECTED evidence',
      'M29_HUMAN_DECISION_REQUIRED',409);
  const decidedAt=new Date(decision.decidedAt);
  if(Number.isNaN(decidedAt.getTime()))throw errorOf('Invalid decidedAt','INVALID_DATE');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM m29_decision_candidates WHERE id=?',[decisionId]);
  const candidate=rows[0];
  if(!candidate)throw errorOf('Decision candidate not found','M29_DECISION_NOT_FOUND',404);
  if(!candidate.human_gate_required)throw errorOf(
    'Human decision is not required','M29_HUMAN_DECISION_NOT_REQUIRED',409
  );
  if(['APPROVED','REJECTED'].includes(candidate.status))
    return {id:candidate.id,status:candidate.status,idempotent:true};
  if(candidate.status!=='APPROVAL_REQUIRED')throw errorOf(
    'Decision candidate is not awaiting approval','M29_DECISION_STATE_INVALID',409,{status:candidate.status}
  );
  await db.execute(
    `UPDATE m29_decision_candidates
        SET status=?,human_decision_json=?,decided_at=?
      WHERE id=?`,
    [result,asJson({...decision,evidence:input.evidence}),decidedAt,candidate.id]
  );
  await db.execute("UPDATE m29_detected_signals SET status='DECIDED' WHERE id=?",[candidate.detected_signal_id]);
  return {
    id:candidate.id,projectId:candidate.project_id,status:result,idempotent:false,
    executionReady:result==='APPROVED',executionDispatched:false
  };
};

export const evaluateM29DecisionGate=async(projectId,input={})=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[];
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');

  const [dataGates]=await db.execute(
    `SELECT status FROM m29_data_detection_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-DATA-DETECTION'
      ORDER BY as_of DESC,created_at DESC LIMIT 1`,[projectId]
  );
  if(!dataGates.length||dataGates[0].status!=='PASS')
    reasons.push('G_M29_DATA_DETECTION_REQUIRED');

  const [signals,candidates]=await Promise.all([
    listRows(db,'SELECT * FROM m29_detected_signals WHERE project_id=?',[projectId]),
    listRows(db,'SELECT * FROM m29_decision_candidates WHERE project_id=?',[projectId])
  ]);
  if(!signals.length)reasons.push('M29_DECISION_SIGNAL_REQUIRED');
  if(!candidates.length)reasons.push('M29_DECISION_CANDIDATE_REQUIRED');

  const candidateBySignal=new Map(candidates.map(x=>[x.detected_signal_id,x]));
  const missingDecisionSignalIds=signals.filter(x=>!candidateBySignal.has(x.id)).map(x=>x.id);
  if(missingDecisionSignalIds.length)reasons.push('M29_DECISION_SIGNAL_COVERAGE_INCOMPLETE');

  const unresolved=candidates.filter(x=>x.status==='APPROVAL_REQUIRED');
  if(unresolved.length)reasons.push('M29_HUMAN_DECISION_PENDING');
  const unsafeAuto=candidates.filter(x=>
    x.status==='AUTO_APPROVED'&&(
      Boolean(x.human_gate_required)||Boolean(x.external_side_effect)||Boolean(x.irreversible)||
      ['HIGH','CRITICAL'].includes(x.risk_level)
    )
  );
  if(unsafeAuto.length)reasons.push('M29_UNSAFE_AUTO_DECISION_FORBIDDEN');
  const invalidTargets=candidates.filter(x=>{
    if(x.outcome==='ACTION')return !['CAPABILITY','WORKFLOW'].includes(x.target_type);
    if(x.outcome==='BACKLOG')return x.target_type!=='BACKLOG';
    if(x.outcome==='REVIEW')return x.target_type!=='REVIEW';
    if(x.outcome==='NO_ACTION')return x.target_type!=='NONE';
    return true;
  });
  if(invalidTargets.length)reasons.push('M29_DECISION_TARGET_INVALID');

  const evidence={
    detectedSignalCount:signals.length,
    decisionCandidateCount:candidates.length,
    coveredSignalCount:signals.length-missingDecisionSignalIds.length,
    missingDecisionSignalIds,
    humanGateRequiredCount:candidates.filter(x=>Boolean(x.human_gate_required)).length,
    humanDecisionPendingIds:unresolved.map(x=>x.id),
    approvedActionCount:candidates.filter(x=>x.outcome==='ACTION'&&['AUTO_APPROVED','APPROVED'].includes(x.status)).length,
    rejectedActionCount:candidates.filter(x=>x.outcome==='ACTION'&&x.status==='REJECTED').length,
    nonActionResolvedCount:candidates.filter(x=>x.outcome!=='ACTION'&&x.status==='RESOLVED').length,
    unsafeAutoDecisionIds:unsafeAuto.map(x=>x.id),
    executionDispatched:false,
    readyForExecutionLayer:reasons.length===0
  };
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO m29_decision_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
     VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf]
  );
  return result;
};

export const getM29DecisionState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [signals,candidates,gates]=await Promise.all([
    listRows(db,'SELECT * FROM m29_detected_signals WHERE project_id=? ORDER BY detected_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_decision_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_decision_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['决策候选','决策策略','人工决策'],
      gateName:'决策 / 策略 / 人工门禁',
      principle:'Detection 只产生 Signal；Decision 决定下一步，但 M29.2 不执行任何动作'
    },
    signals:signals.map(x=>({
      id:x.id,signalKey:x.signal_key,severity:x.severity,status:x.status,
      signalPayload:parseJson(x.signal_payload_json),detectedAt:x.detected_at
    })),
    decisions:candidates.map(x=>({
      id:x.id,detectedSignalId:x.detected_signal_id,decisionKey:x.decision_key,
      outcome:x.outcome,targetType:x.target_type,actionSpec:parseJson(x.action_spec_json),
      policySnapshot:parseJson(x.policy_snapshot_json),riskLevel:x.risk_level,
      externalSideEffect:Boolean(x.external_side_effect),irreversible:Boolean(x.irreversible),
      humanGateRequired:Boolean(x.human_gate_required),rationale:parseJson(x.rationale_json),
      status:x.status,humanDecision:parseJson(x.human_decision_json),decidedAt:x.decided_at,
      executionReady:x.outcome==='ACTION'&&['AUTO_APPROVED','APPROVED'].includes(x.status),
      executionDispatched:false
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
