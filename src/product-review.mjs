import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateOutcomeGate } from './product-outcome.mjs';

const GATE='G-PD-REVIEW';
const REQUIRED_OUTPUT_TYPES=[
  'PRODUCT_BACKLOG','BUG','TECH_DEBT','PROCESS_IMPROVEMENT',
  'AI_CAPABILITY_IMPROVEMENT','REUSABLE_PATTERN','DEPRECATED_KNOWLEDGE','NEXT_VERSION_PROPOSAL'
];
const WORK_ITEM_OUTPUT_TYPES=new Set([
  'PRODUCT_BACKLOG','BUG','TECH_DEBT','PROCESS_IMPROVEMENT','AI_CAPABILITY_IMPROVEMENT'
]);
const REVIEW_DECISIONS=new Set(['CONTINUE','ITERATE','CLOSE','HOLD','ROLLBACK']);
const OPTIONAL_NA_SECTIONS=new Set(['aiHuman','cost','reuse']);

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

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT id,workspace_id,project_type FROM projects WHERE id=?',[projectId]);
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'Product Review requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const validateSection=(name,value)=>{
  if(!value||typeof value!=='object')throw errorOf(
    'Review section is required','PRODUCT_REVIEW_SECTION_REQUIRED',409,{section:name}
  );
  const status=upper(value.status||'REVIEWED');
  if(status==='N_A'){
    if(!OPTIONAL_NA_SECTIONS.has(name))throw errorOf(
      'This review section cannot be N_A','PRODUCT_REVIEW_SECTION_NA_NOT_ALLOWED',409,{section:name}
    );
    if(!nonEmpty(value.rationale))throw errorOf(
      'N_A review section requires rationale','PRODUCT_REVIEW_SECTION_NA_REASON_REQUIRED',409,{section:name}
    );
    return;
  }
  if(status!=='REVIEWED')throw errorOf(
    'Review section status must be REVIEWED or N_A','INVALID_PRODUCT_REVIEW_SECTION_STATUS',409,{section:name,status}
  );
  if(!nonEmpty(value.evidence))throw errorOf(
    'Reviewed section requires evidence','PRODUCT_REVIEW_SECTION_EVIDENCE_REQUIRED',409,{section:name}
  );
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

export const resolveReviewProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createProductDeliveryReview=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'releaseRolloutId','outcomeReviewId','reviewKey',
    'plannedActual','scopeChange','scheduleWaitBlock','firstPassRework','defectEscape',
    'releaseIncident','aiHuman','cost','outcome','reuse','failureMode','improvement',
    'decision','outputs','evidence'
  ],'INVALID_PRODUCT_REVIEW');
  if(!Array.isArray(input.outputs)||!input.outputs.length)throw errorOf(
    'Review outputs must be a non-empty array','INVALID_PRODUCT_REVIEW_OUTPUTS'
  );

  for(const key of [
    'plannedActual','scopeChange','scheduleWaitBlock','firstPassRework','defectEscape',
    'releaseIncident','aiHuman','cost','outcome','reuse','failureMode','improvement'
  ]) validateSection(key,input[key]);

  const decisionType=upper(input.decision.type);
  if(!REVIEW_DECISIONS.has(decisionType))throw errorOf(
    'Unsupported product review decision','INVALID_PRODUCT_REVIEW_DECISION',409,{decisionType}
  );

  const db=getRuntimePool();
  const outcomeGate=await evaluateOutcomeGate(projectId,{persist:false},actorId);
  if(outcomeGate.status!=='PASS')throw errorOf(
    'G-PD-OUTCOME must PASS before Product Review','OUTCOME_GATE_REQUIRED',409,{reasonCodes:outcomeGate.reasonCodes}
  );
  const outcomeReviewId=outcomeGate.evidenceSnapshot?.outcomeReviewId;
  const releaseRolloutId=outcomeGate.evidenceSnapshot?.releaseRolloutId;
  if(input.outcomeReviewId!==outcomeReviewId||input.releaseRolloutId!==releaseRolloutId)throw errorOf(
    'Product Review must bind current Outcome Review and Release Rollout','PRODUCT_REVIEW_OUTCOME_STALE',409,
    {expectedOutcomeReviewId:outcomeReviewId,expectedReleaseRolloutId:releaseRolloutId}
  );
  const [outcomeRows]=await db.execute('SELECT * FROM product_outcome_reviews WHERE id=?',[outcomeReviewId]);
  if(!outcomeRows.length||outcomeRows[0].status!=='FROZEN')throw errorOf(
    'Frozen Outcome Review is required','FROZEN_OUTCOME_REVIEW_REQUIRED',409
  );
  const outcomeReview=outcomeRows[0];

  const byType=new Map();
  for(const output of input.outputs){
    requireFields(output,['outputKey','outputType','disposition','title','evidence'],'INVALID_PRODUCT_REVIEW_OUTPUT');
    const type=upper(output.outputType),disposition=upper(output.disposition);
    if(!REQUIRED_OUTPUT_TYPES.includes(type))throw errorOf(
      'Unsupported Product Review output type','INVALID_PRODUCT_REVIEW_OUTPUT_TYPE',409,{type}
    );
    if(byType.has(type))throw errorOf('Duplicate Product Review output type','DUPLICATE_PRODUCT_REVIEW_OUTPUT_TYPE',409,{type});
    if(!['EMIT','N_A'].includes(disposition))throw errorOf(
      'Output disposition must be EMIT or N_A','INVALID_PRODUCT_REVIEW_OUTPUT_DISPOSITION',409,{type,disposition}
    );
    if(disposition==='N_A'&&!nonEmpty(output.rationale))throw errorOf(
      'N_A Review output requires rationale','PRODUCT_REVIEW_OUTPUT_NA_REASON_REQUIRED',409,{type}
    );
    byType.set(type,{...output,outputType:type,disposition});
  }
  const missing=REQUIRED_OUTPUT_TYPES.filter(x=>!byType.has(x));
  if(missing.length)throw errorOf(
    'Every required review output type must be EMIT or explicit N_A',
    'PRODUCT_REVIEW_OUTPUT_COVERAGE_INCOMPLETE',409,{missingOutputTypes:missing}
  );
  if(byType.get('NEXT_VERSION_PROPOSAL').disposition!=='EMIT')throw errorOf(
    'Next Version Proposal must be emitted','NEXT_VERSION_PROPOSAL_REQUIRED',409
  );
  const actionable=[...WORK_ITEM_OUTPUT_TYPES].filter(t=>byType.get(t)?.disposition==='EMIT');
  if(!actionable.length)throw errorOf(
    'At least one actionable improvement output must be emitted','PRODUCT_REVIEW_ACTION_REQUIRED',409
  );

  if(input.approverIdentityId){
    const [approvers]=await db.execute('SELECT id FROM identities WHERE id=?',[input.approverIdentityId]);
    if(!approvers.length)throw errorOf('Review approver not found','PRODUCT_REVIEW_APPROVER_NOT_FOUND',404);
  }

  const conn=await db.getConnection(),reviewId=randomUUID(),decisionId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_delivery_reviews
        (id,project_id,release_rollout_id,release_version_id,outcome_review_id,review_key,
         planned_actual_json,scope_change_json,schedule_wait_block_json,first_pass_rework_json,
         defect_escape_json,release_incident_json,ai_human_json,cost_json,outcome_json,reuse_json,
         failure_mode_json,improvement_json,decision_json,evidence_json,status,reviewed_by_identity_id,reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [reviewId,projectId,input.releaseRolloutId,outcomeReview.release_version_id,input.outcomeReviewId,input.reviewKey,
       asJson(input.plannedActual),asJson(input.scopeChange),asJson(input.scheduleWaitBlock),
       asJson(input.firstPassRework),asJson(input.defectEscape),asJson(input.releaseIncident),
       asJson(input.aiHuman),asJson(input.cost),asJson(input.outcome),asJson(input.reuse),
       asJson(input.failureMode),asJson(input.improvement),asJson({...input.decision,type:decisionType}),
       asJson(input.evidence),actorId,input.reviewedAt?new Date(input.reviewedAt):new Date()]
    );

    await conn.execute(
      `INSERT INTO project_decisions
        (id,project_id,decision_key,title,context_json,options_json,decision_json,owner_identity_id,
         approver_identity_id,impact_json,reversible,effective_version,status,evidence_json,decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'EFFECTIVE',?,?)`,
      [decisionId,projectId,input.reviewKey+'-DECISION',input.decision.title||'产品复盘决策',
       asJson({reviewId,outcomeReviewId:input.outcomeReviewId,releaseRolloutId:input.releaseRolloutId}),
       asJson(input.decision.options||[]),asJson({...input.decision,type:decisionType}),
       actorId,input.approverIdentityId||null,asJson(input.decision.impact||null),
       input.decision.reversible===false?false:true,String(outcomeReview.release_version_id),
       asJson({source:'PRODUCT_REVIEW',reviewId}),input.reviewedAt?new Date(input.reviewedAt):new Date()]
    );

    const outputs=[];
    for(const type of REQUIRED_OUTPUT_TYPES){
      const output=byType.get(type),outputId=randomUUID();
      let workItemId=null,projectVersionId=null,knowledgeRef=null;
      if(output.disposition==='EMIT'&&WORK_ITEM_OUTPUT_TYPES.has(type)){
        requireFields(output,['itemKey','priority','acceptanceCriteria'],'INVALID_PRODUCT_REVIEW_WORK_ITEM_OUTPUT');
        workItemId=randomUUID();
        await conn.execute(
          `INSERT INTO project_work_items
            (id,project_id,item_key,item_type,title,stage_key,priority,status,
             acceptance_criteria_json,evidence_json,metadata_json)
           VALUES (?,?,?,?,?,'PD_18_KNOWLEDGE',?,'PLANNED',?,?,?)`,
          [workItemId,projectId,output.itemKey,type,output.title,upper(output.priority),
           asJson(output.acceptanceCriteria),asJson(output.evidence),
           asJson({source:'PRODUCT_REVIEW',reviewId,outputType:type})]
        );
      }else if(output.disposition==='EMIT'&&type==='NEXT_VERSION_PROPOSAL'){
        requireFields(output,['versionKey','label'],'INVALID_NEXT_VERSION_PROPOSAL');
        projectVersionId=randomUUID();
        await conn.execute(
          `INSERT INTO project_versions
            (id,project_id,version_key,version_type,label,status,source_pointer_json,evidence_json,effective_at)
           VALUES (?,?,?,?,?,'DRAFT',?,?,NULL)`,
          [projectVersionId,projectId,output.versionKey,'RELEASE_DISTRIBUTION',output.label,
           asJson({source:'PRODUCT_REVIEW',reviewId,previousReleaseVersionId:outcomeReview.release_version_id}),
           asJson(output.evidence)]
        );
      }else if(output.disposition==='EMIT'&&['REUSABLE_PATTERN','DEPRECATED_KNOWLEDGE'].includes(type)){
        if(!nonEmpty(output.knowledgeRef))throw errorOf(
          'Knowledge output requires knowledgeRef','PRODUCT_REVIEW_KNOWLEDGE_REF_REQUIRED',409,{type}
        );
        knowledgeRef=output.knowledgeRef;
      }
      await conn.execute(
        `INSERT INTO product_review_outputs
          (id,project_id,review_id,output_key,output_type,disposition,title,rationale,
           work_item_id,decision_id,project_version_id,knowledge_ref_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [outputId,projectId,reviewId,output.outputKey,type,output.disposition,output.title,
         output.rationale||null,workItemId,decisionId,projectVersionId,
         knowledgeRef?asJson(knowledgeRef):null,asJson(output.evidence)]
      );
      if(workItemId)await insertTrace(conn,{projectId,sourceType:'PRODUCT_REVIEW',sourceId:reviewId,
        targetType:'WORK_ITEM',targetId:workItemId,linkType:'CREATES_BACKLOG',actorId,evidence:{outputType:type}});
      if(projectVersionId)await insertTrace(conn,{projectId,sourceType:'PRODUCT_REVIEW',sourceId:reviewId,
        targetType:'PROJECT_VERSION',targetId:projectVersionId,linkType:'PROPOSES_NEXT_VERSION',actorId,evidence:{outputType:type}});
      outputs.push({id:outputId,outputType:type,disposition:output.disposition,workItemId,projectVersionId,knowledgeRef});
    }
    await insertTrace(conn,{projectId,sourceType:'OUTCOME_REVIEW',sourceId:input.outcomeReviewId,
      targetType:'PRODUCT_REVIEW',targetId:reviewId,linkType:'REVIEWED_BY',actorId,evidence:{decisionType}});
    await insertTrace(conn,{projectId,sourceType:'PRODUCT_REVIEW',sourceId:reviewId,
      targetType:'DECISION',targetId:decisionId,linkType:'DECIDES_AS',actorId,evidence:{decisionType}});
    await conn.commit();
    return {id:reviewId,projectId,reviewKey:input.reviewKey,status:'FROZEN',
      releaseRolloutId:input.releaseRolloutId,releaseVersionId:outcomeReview.release_version_id,
      outcomeReviewId:input.outcomeReviewId,decisionId,decisionType,outputs};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateProductReviewGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const outcome=await evaluateOutcomeGate(projectId,{persist:false},actorId);
  if(outcome.status!=='PASS')reasons.push('OUTCOME_NOT_READY_FOR_REVIEW');
  evidence.outcomeReviewId=outcome.evidenceSnapshot?.outcomeReviewId||null;
  evidence.releaseRolloutId=outcome.evidenceSnapshot?.releaseRolloutId||null;

  const [reviews]=await db.execute(
    "SELECT * FROM product_delivery_reviews WHERE project_id=? AND status='FROZEN' ORDER BY reviewed_at DESC,id DESC LIMIT 1",
    [projectId]
  );
  const review=reviews[0]||null;
  evidence.productReviewId=review?.id||null;
  if(!review)reasons.push('FROZEN_PRODUCT_REVIEW_REQUIRED');
  else{
    evidence.releaseVersionId=review.release_version_id;
    evidence.decision=parseJson(review.decision_json);
    if(evidence.outcomeReviewId&&review.outcome_review_id!==evidence.outcomeReviewId)
      reasons.push('PRODUCT_REVIEW_OUTCOME_STALE');
    if(evidence.releaseRolloutId&&review.release_rollout_id!==evidence.releaseRolloutId)
      reasons.push('PRODUCT_REVIEW_RELEASE_STALE');

    const [outputs]=await db.execute('SELECT * FROM product_review_outputs WHERE review_id=?',[review.id]);
    evidence.outputs=outputs.map(x=>({
      outputType:x.output_type,disposition:x.disposition,workItemId:x.work_item_id||null,
      projectVersionId:x.project_version_id||null,knowledgeRef:parseJson(x.knowledge_ref_json)
    }));
    for(const type of REQUIRED_OUTPUT_TYPES){
      const rows=outputs.filter(x=>x.output_type===type);
      if(rows.length!==1)reasons.push('PRODUCT_REVIEW_OUTPUT_REQUIRED:'+type);
      else{
        const row=rows[0];
        if(row.disposition==='N_A'&&!nonEmpty(row.rationale))reasons.push('PRODUCT_REVIEW_OUTPUT_NA_REASON_REQUIRED:'+type);
        if(WORK_ITEM_OUTPUT_TYPES.has(type)&&row.disposition==='EMIT'&&!row.work_item_id)
          reasons.push('PRODUCT_REVIEW_WORK_ITEM_REQUIRED:'+type);
        if(type==='NEXT_VERSION_PROPOSAL'){
          if(row.disposition!=='EMIT'||!row.project_version_id)reasons.push('NEXT_VERSION_PROPOSAL_REQUIRED');
          else{
            const [versions]=await db.execute('SELECT * FROM project_versions WHERE id=?',[row.project_version_id]);
            if(!versions.length||versions[0].project_id!==projectId||versions[0].version_type!=='RELEASE_DISTRIBUTION'||
               versions[0].status!=='DRAFT')reasons.push('NEXT_VERSION_PROPOSAL_INVALID');
          }
        }
        if(['REUSABLE_PATTERN','DEPRECATED_KNOWLEDGE'].includes(type)&&row.disposition==='EMIT'&&!row.knowledge_ref_json)
          reasons.push('PRODUCT_REVIEW_KNOWLEDGE_REF_REQUIRED:'+type);
      }
    }
    if(!outputs.some(x=>WORK_ITEM_OUTPUT_TYPES.has(x.output_type)&&x.disposition==='EMIT'&&x.work_item_id))
      reasons.push('PRODUCT_REVIEW_ACTION_REQUIRED');
    const decisionIds=[...new Set(outputs.map(x=>x.decision_id).filter(Boolean))];
    if(decisionIds.length!==1)reasons.push('PRODUCT_REVIEW_DECISION_REQUIRED');
    else{
      const [decisions]=await db.execute('SELECT * FROM project_decisions WHERE id=?',[decisionIds[0]]);
      if(!decisions.length||decisions[0].project_id!==projectId||decisions[0].status!=='EFFECTIVE')
        reasons.push('PRODUCT_REVIEW_DECISION_INVALID');
      else evidence.decisionId=decisions[0].id;
    }
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO product_m2710_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getProductReviewState=async projectId=>{
  await loadProject(projectId);
  const db=getRuntimePool();
  const [reviews,outputs,gates]=await Promise.all([
    db.execute('SELECT * FROM product_delivery_reviews WHERE project_id=? ORDER BY reviewed_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_review_outputs WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m2710_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,
    reviews:reviews.map(x=>({
      id:x.id,reviewKey:x.review_key,status:x.status,releaseRolloutId:x.release_rollout_id,
      releaseVersionId:x.release_version_id,outcomeReviewId:x.outcome_review_id,
      plannedActual:parseJson(x.planned_actual_json),scopeChange:parseJson(x.scope_change_json),
      scheduleWaitBlock:parseJson(x.schedule_wait_block_json),firstPassRework:parseJson(x.first_pass_rework_json),
      defectEscape:parseJson(x.defect_escape_json),releaseIncident:parseJson(x.release_incident_json),
      aiHuman:parseJson(x.ai_human_json),cost:parseJson(x.cost_json),outcome:parseJson(x.outcome_json),
      reuse:parseJson(x.reuse_json),failureMode:parseJson(x.failure_mode_json),
      improvement:parseJson(x.improvement_json),decision:parseJson(x.decision_json),reviewedAt:x.reviewed_at
    })),
    outputs:outputs.map(x=>({
      id:x.id,reviewId:x.review_id,outputKey:x.output_key,outputType:x.output_type,
      disposition:x.disposition,title:x.title,rationale:x.rationale||null,
      workItemId:x.work_item_id||null,decisionId:x.decision_id||null,
      projectVersionId:x.project_version_id||null,knowledgeRef:parseJson(x.knowledge_ref_json)
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
