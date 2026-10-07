import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { createApprovalRequest } from './competitive-collaboration.mjs';
import { createProjectDecision,createProjectWorkItem } from './project-governance.mjs';
import { fireTrigger } from './trigger-runtime.mjs';

const GATE='G-M29-SELF-LOOP';
const ACTIONS=new Set(['BACKLOG','TRIGGER','NO_ACTION']);
const RISKS=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);

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
const list=async(db,sql,params=[])=>(await db.execute(sql,params))[0];
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT p.id,p.workspace_id,p.project_key,p.name,p.project_type,p.project_subtype_key FROM projects p WHERE p.id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadCandidate=async(id,db=getRuntimePool())=>{
  const row=await one(db,
    `SELECT c.*,s.signal_key,s.severity AS signal_severity,s.status AS signal_status,
            e.quality_status
       FROM m29_decision_candidates c
       JOIN m29_detected_signals s ON s.id=c.detected_signal_id
       JOIN m29_detection_evaluations e ON e.id=s.detection_evaluation_id
      WHERE c.id=?`,[id]
  );
  if(!row)throw errorOf('Decision candidate not found','M29_DECISION_CANDIDATE_NOT_FOUND',404);
  return row;
};
const approvalState=async(candidate,db)=>{
  if(!candidate.approval_request_id)return null;
  return one(db,'SELECT id,status FROM approval_requests WHERE id=?',[candidate.approval_request_id]);
};

export const resolveM29SelfLoopProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveM29DecisionCandidateScope=async id=>{
  const c=await loadCandidate(id),p=await loadProject(c.project_id);return {projectId:p.id,workspaceId:p.workspace_id};
};
export const resolveM29LoopExecutionScope=async id=>{
  const db=getRuntimePool();
  const row=await one(db,'SELECT project_id FROM m29_loop_executions WHERE id=?',[id]);
  if(!row)throw errorOf('Loop execution not found','M29_LOOP_EXECUTION_NOT_FOUND',404);
  const p=await loadProject(row.project_id,db);return {projectId:p.id,workspaceId:p.workspace_id};
};

export const createM29DecisionCandidate=async(projectId,input={},actorId=null)=>{
  requireFields(input,['detectedSignalId','candidateKey','title','actionType','proposedAction','rationale','riskLevel','evidence'],
    'INVALID_M29_DECISION_CANDIDATE');
  const actionType=upper(input.actionType),risk=upper(input.riskLevel);
  if(!ACTIONS.has(actionType))throw errorOf('Unsupported action type','M29_ACTION_TYPE_INVALID',409,{actionType});
  if(!RISKS.has(risk))throw errorOf('Unsupported risk level','M29_RISK_LEVEL_INVALID',409,{riskLevel:risk});
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  const signal=await one(db,
    `SELECT s.*,e.quality_status
       FROM m29_detected_signals s
       JOIN m29_detection_evaluations e ON e.id=s.detection_evaluation_id
      WHERE s.id=? AND s.project_id=?`,[input.detectedSignalId,projectId]
  );
  if(!signal)throw errorOf('Detected signal does not belong to project','M29_SIGNAL_SCOPE_INVALID',409);
  if(signal.status!=='DETECTED')throw errorOf('Detected signal is not actionable','M29_SIGNAL_NOT_ACTIONABLE',409,{status:signal.status});
  if(signal.quality_status==='FAIL')throw errorOf('Failed-quality signal cannot create a decision','M29_SIGNAL_QUALITY_BLOCKED',409);
  if(actionType==='TRIGGER'&&!nonEmpty(input.proposedAction.triggerKey))
    throw errorOf('TRIGGER action requires triggerKey','M29_TRIGGER_KEY_REQUIRED',409);
  const requiresHuman=Boolean(input.requiresHumanApproval)||risk==='HIGH'||risk==='CRITICAL';
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_decision_candidates
      (id,project_id,detected_signal_id,candidate_key,title,action_type,proposed_action_json,
       rationale,risk_level,requires_human_approval,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)`,
    [id,projectId,signal.id,input.candidateKey,input.title,actionType,asJson(input.proposedAction),
     input.rationale,risk,requiresHuman?1:0,requiresHuman?'PENDING_APPROVAL':'READY',
     asJson(input.evidence),actorId]
  );
  let approvalRequestId=null;
  if(requiresHuman){
    const approval=await createApprovalRequest({
      workspaceId:project.workspace_id,projectId,
      requestKey:`M29_DECISION:${id}`,
      targetType:'M29_DECISION_CANDIDATE',targetId:id,requiredRole:'REVIEWER',
      requestedAction:`批准 M29 决策候选：${input.title}`,
      riskLevel:risk,context:{candidateId:id,signalId:signal.id,actionType},
      evidence:{...input.evidence,source:'M29_SELF_LOOP'},requestedByIdentityId:actorId,
      effectiveObjectType:'M29_DECISION_CANDIDATE',effectiveObjectId:id
    });
    approvalRequestId=approval.id;
    await db.execute('UPDATE m29_decision_candidates SET approval_request_id=? WHERE id=?',[approvalRequestId,id]);
  }
  return {id,projectId,detectedSignalId:signal.id,candidateKey:input.candidateKey,title:input.title,
    actionType,riskLevel:risk,requiresHumanApproval:requiresHuman,approvalRequestId,
    status:requiresHuman?'PENDING_APPROVAL':'READY'};
};

const ensureDecision=async(candidate,actorId,evidence)=>{
  const db=getRuntimePool(),decisionKey=`M29:${candidate.candidate_key}`;
  const existing=await one(db,'SELECT id,status FROM project_decisions WHERE project_id=? AND decision_key=?',[candidate.project_id,decisionKey]);
  if(existing)return {id:existing.id,projectId:candidate.project_id,decisionKey,status:existing.status,idempotent:true};
  return {...await createProjectDecision(candidate.project_id,{
    decisionKey,title:candidate.title,
    context:{source:'M29_DETECTED_SIGNAL',signalId:candidate.detected_signal_id,signalKey:candidate.signal_key},
    options:{proposedAction:parseJson(candidate.proposed_action_json)},
    decision:{actionType:candidate.action_type,rationale:candidate.rationale},
    ownerIdentityId:actorId||null,approverIdentityId:null,
    impact:{nextRound:true,riskLevel:candidate.risk_level},
    reversible:true,status:'EFFECTIVE',evidence
  }),idempotent:false};
};
const ensureBacklog=async(candidate,action,evidence)=>{
  const db=getRuntimePool(),itemKey=`M29-LOOP-${candidate.id}`;
  const existing=await one(db,'SELECT id,status,item_type,title FROM project_work_items WHERE project_id=? AND item_key=?',[candidate.project_id,itemKey]);
  if(existing)return {id:existing.id,projectId:candidate.project_id,itemKey,itemType:existing.item_type,title:existing.title,status:existing.status,idempotent:true};
  return {...await createProjectWorkItem(candidate.project_id,{
    itemKey,itemType:upper(action.workItemType||'IMPROVEMENT'),
    title:action.title||candidate.title,stageKey:action.stageKey||'M29_SELF_LOOP',
    ownerIdentityId:action.ownerIdentityId||null,priority:candidate.risk_level,status:'READY',
    acceptanceCriteria:action.acceptanceCriteria||['处理检测信号并形成下一轮可验证结果'],
    evidence,metadata:{source:'M29_SELF_LOOP',candidateId:candidate.id,signalId:candidate.detected_signal_id}
  }),idempotent:false};
};

export const executeM29DecisionCandidate=async(candidateId,input={},actorId=null)=>{
  requireFields(input,['evidence'],'INVALID_M29_DECISION_EXECUTION');
  const db=getRuntimePool(),candidate=await loadCandidate(candidateId,db);
  const existing=await one(db,'SELECT * FROM m29_loop_executions WHERE decision_candidate_id=?',[candidateId]);
  if(existing)return {id:existing.id,projectId:existing.project_id,decisionCandidateId:candidateId,
    projectDecisionId:existing.project_decision_id,executionMode:existing.execution_mode,
    workItemId:existing.work_item_id||null,triggerFireId:existing.trigger_fire_id||null,
    status:existing.status,idempotent:true};
  if(['REJECTED','REQUEST_CHANGE','EXPIRED'].includes(candidate.status))
    throw errorOf('Decision candidate is not executable','M29_DECISION_NOT_EXECUTABLE',409,{status:candidate.status});
  if(candidate.requires_human_approval){
    const approval=await approvalState(candidate,db);
    if(!approval||approval.status!=='APPROVED'){
      if(approval&&['REJECTED','REQUEST_CHANGE','EXPIRED'].includes(approval.status)){
        await db.execute('UPDATE m29_decision_candidates SET status=? WHERE id=?',[approval.status,candidateId]);
      }
      throw errorOf('Human approval is required before execution','M29_HUMAN_APPROVAL_REQUIRED',409,
        {approvalRequestId:candidate.approval_request_id,approvalStatus:approval?.status||null});
    }
    await db.execute("UPDATE m29_decision_candidates SET status='APPROVED' WHERE id=?",[candidateId]);
  }
  const action=parseJson(candidate.proposed_action_json)||{};
  const decision=await ensureDecision(candidate,actorId,input.evidence);
  let workItem=null,trigger=null,status='PASS',executionMode=candidate.action_type;
  if(candidate.action_type==='BACKLOG'){
    workItem=await ensureBacklog(candidate,action,input.evidence);
  }else if(candidate.action_type==='TRIGGER'){
    trigger=await fireTrigger({
      triggerKey:action.triggerKey,projectId:candidate.project_id,
      eventId:candidate.detected_signal_id,dedupeKey:`M29:${candidate.id}`,
      capabilityInput:action.capabilityInput||undefined,
      resumePoint:action.resumePoint||null,triggerReason:'M29_DETECTED_SIGNAL'
    });
    status=trigger.status==='PASS'?'PASS':'PENDING';
  }
  const id=randomUUID(),executedAt=input.executedAt?new Date(input.executedAt):new Date();
  if(Number.isNaN(executedAt.getTime()))throw errorOf('Invalid executedAt','INVALID_DATE');
  await db.execute(
    `INSERT INTO m29_loop_executions
      (id,project_id,decision_candidate_id,project_decision_id,execution_mode,work_item_id,
       trigger_fire_id,status,result_json,evidence_json,executed_by_identity_id,executed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,candidate.project_id,candidate.id,decision.id,executionMode,workItem?.id||null,trigger?.id||null,
     status,asJson({decision,workItem,trigger}),asJson(input.evidence),actorId,executedAt]
  );
  await db.execute('UPDATE m29_decision_candidates SET status=? WHERE id=?',[status==='PASS'?'EXECUTED':'EXECUTING',candidate.id]);
  await db.execute("UPDATE m29_detected_signals SET status='ACTIONED' WHERE id=?",[candidate.detected_signal_id]);
  return {id,projectId:candidate.project_id,decisionCandidateId:candidate.id,projectDecisionId:decision.id,
    executionMode,workItemId:workItem?.id||null,triggerFireId:trigger?.id||null,status,idempotent:false};
};

export const closeM29SelfLoop=async(executionId,input={},actorId=null)=>{
  requireFields(input,['closureKey','outcome','nextRound','evidence'],'INVALID_M29_LOOP_CLOSURE');
  const db=getRuntimePool();
  const execution=await one(db,
    `SELECT e.*,c.detected_signal_id FROM m29_loop_executions e
       JOIN m29_decision_candidates c ON c.id=e.decision_candidate_id WHERE e.id=?`,[executionId]
  );
  if(!execution)throw errorOf('Loop execution not found','M29_LOOP_EXECUTION_NOT_FOUND',404);
  const existing=await one(db,'SELECT * FROM m29_loop_closures WHERE loop_execution_id=?',[executionId]);
  if(existing)return {id:existing.id,projectId:existing.project_id,loopExecutionId:executionId,status:existing.status,idempotent:true};
  if(execution.status!=='PASS')throw errorOf('Only PASS execution can close the loop','M29_LOOP_EXECUTION_NOT_PASS',409,{status:execution.status});
  const knowledgeRefs=Array.isArray(input.knowledgeRefs)?input.knowledgeRefs:[];
  const backlogRefs=Array.isArray(input.backlogRefs)?[...input.backlogRefs]:[];
  if(execution.work_item_id&&!backlogRefs.includes(execution.work_item_id))backlogRefs.push(execution.work_item_id);
  if(!knowledgeRefs.length&&!backlogRefs.length)throw errorOf(
    'Loop closure requires Knowledge or Backlog reference','M29_LOOP_WRITEBACK_REQUIRED',409
  );
  const closedAt=input.closedAt?new Date(input.closedAt):new Date();
  if(Number.isNaN(closedAt.getTime()))throw errorOf('Invalid closedAt','INVALID_DATE');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_loop_closures
      (id,project_id,loop_execution_id,closure_key,outcome_json,knowledge_refs_json,
       backlog_refs_json,next_round_json,status,evidence_json,closed_by_identity_id,closed_at)
     VALUES (?,?,?,?,?,?,?,?,'FROZEN',?,?,?)`,
    [id,execution.project_id,executionId,input.closureKey,asJson(input.outcome),asJson(knowledgeRefs),
     asJson(backlogRefs),asJson(input.nextRound),asJson(input.evidence),actorId,closedAt]
  );
  await db.execute("UPDATE m29_decision_candidates SET status='CLOSED' WHERE id=?",[execution.decision_candidate_id]);
  await db.execute("UPDATE m29_detected_signals SET status='CLOSED' WHERE id=?",[execution.detected_signal_id]);
  return {id,projectId:execution.project_id,loopExecutionId:executionId,status:'FROZEN',
    knowledgeRefs,backlogRefs,nextRound:input.nextRound,idempotent:false};
};

export const evaluateM29SelfLoopGate=async(projectId,input={})=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[];
  const dataGate=await one(db,
    "SELECT id,status,as_of FROM m29_data_detection_gate_evaluations WHERE project_id=? AND gate_key='G-M29-DATA-DETECTION' ORDER BY as_of DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  if(dataGate?.status!=='PASS')reasons.push('M29_DATA_DETECTION_GATE_REQUIRED');
  const [candidates,executions,closures,pendingHuman,lineageGaps]=await Promise.all([
    list(db,'SELECT * FROM m29_decision_candidates WHERE project_id=?',[projectId]),
    list(db,'SELECT * FROM m29_loop_executions WHERE project_id=?',[projectId]),
    list(db,'SELECT * FROM m29_loop_closures WHERE project_id=?',[projectId]),
    list(db,`SELECT c.id FROM m29_decision_candidates c
      LEFT JOIN approval_requests a ON a.id=c.approval_request_id
      WHERE c.project_id=? AND c.requires_human_approval=TRUE
        AND (a.id IS NULL OR a.status='PENDING')`,[projectId]),
    list(db,`SELECT e.id FROM m29_loop_executions e
      WHERE e.project_id=? AND e.project_decision_id IS NULL`,[projectId])
  ]);
  if(!candidates.length)reasons.push('M29_DECISION_CANDIDATE_REQUIRED');
  if(!executions.length)reasons.push('M29_DECISION_EXECUTION_REQUIRED');
  if(!closures.length)reasons.push('M29_LOOP_CLOSURE_REQUIRED');
  if(pendingHuman.length)reasons.push('M29_HUMAN_APPROVAL_PENDING');
  if(lineageGaps.length)reasons.push('M29_DECISION_LINEAGE_INCOMPLETE');
  const incomplete=executions.filter(e=>e.status==='PASS'&&!closures.some(c=>c.loop_execution_id===e.id));
  if(incomplete.length)reasons.push('M29_LOOP_CLOSURE_COVERAGE_INCOMPLETE');
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const evidence={
    dataDetectionGateStatus:dataGate?.status||null,
    decisionCandidateCount:candidates.length,executionCount:executions.length,closureCount:closures.length,
    pendingHumanApprovalCount:pendingHuman.length,lineageGapCount:lineageGaps.length,
    closedBacklogLoopCount:closures.filter(c=>(parseJson(c.backlog_refs_json)||[]).length>0).length,
    closedKnowledgeLoopCount:closures.filter(c=>(parseJson(c.knowledge_refs_json)||[]).length>0).length,
    readyForCrossDomainExit:reasons.length===0
  };
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO m29_self_loop_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
     VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf]
  );
  return result;
};

export const getM29SelfLoopState=async projectId=>{
  const project=await loadProject(projectId),db=getRuntimePool();
  const [candidates,executions,closures,gates]=await Promise.all([
    list(db,'SELECT * FROM m29_decision_candidates WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM m29_loop_executions WHERE project_id=? ORDER BY executed_at,id',[projectId]),
    list(db,'SELECT * FROM m29_loop_closures WHERE project_id=? ORDER BY closed_at,id',[projectId]),
    list(db,'SELECT * FROM m29_self_loop_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type},
    frontend:{
      language:'zh-CN',
      moduleNames:['决策候选','闭环执行','知识 / 待办回写','下一轮'],
      gateName:'决策 / 执行 / 闭环门禁',
      principle:'数据只产生决策输入；高风险决策必须 Human Gate；执行复用现有 Backlog / Trigger Runtime'
    },
    decisionCandidates:candidates.map(x=>({id:x.id,detectedSignalId:x.detected_signal_id,candidateKey:x.candidate_key,
      title:x.title,actionType:x.action_type,riskLevel:x.risk_level,requiresHumanApproval:Boolean(x.requires_human_approval),
      approvalRequestId:x.approval_request_id||null,status:x.status})),
    executions:executions.map(x=>({id:x.id,decisionCandidateId:x.decision_candidate_id,projectDecisionId:x.project_decision_id,
      executionMode:x.execution_mode,workItemId:x.work_item_id||null,triggerFireId:x.trigger_fire_id||null,status:x.status,
      executedAt:x.executed_at})),
    closures:closures.map(x=>({id:x.id,loopExecutionId:x.loop_execution_id,closureKey:x.closure_key,
      outcome:parseJson(x.outcome_json),knowledgeRefs:parseJson(x.knowledge_refs_json)||[],
      backlogRefs:parseJson(x.backlog_refs_json)||[],nextRound:parseJson(x.next_round_json),status:x.status,closedAt:x.closed_at})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
