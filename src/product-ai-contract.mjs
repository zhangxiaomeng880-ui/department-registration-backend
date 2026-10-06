import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateProductDeliveryGate } from './product-development-delivery.mjs';

const AI_GATE='G-PD-AI-CONTRACT';
const CONTRACT_STATUSES=new Set(['DRAFT','APPROVED','CURRENT','DEPRECATED']);
const SECTION_STATUSES=new Set(['PASS','N_A','BLOCKED']);
const AI_SECTIONS=[
  'MODEL_PROVIDER','PROMPT','RAG','PERMISSIONS','STRUCTURED_OUTPUT','SAFETY_PII',
  'ADVERSARIAL_TEST','FALLBACK_FAIL_CLOSED','HUMAN_ESCALATION','OFFLINE_EVAL',
  'THRESHOLDS','ONLINE_FEEDBACK_DRIFT','REPRODUCIBILITY'
];
const REQUIRED_PASS_SECTIONS=new Set([
  'MODEL_PROVIDER','PROMPT','PERMISSIONS','STRUCTURED_OUTPUT','SAFETY_PII',
  'ADVERSARIAL_TEST','FALLBACK_FAIL_CLOSED','HUMAN_ESCALATION','OFFLINE_EVAL',
  'THRESHOLDS','ONLINE_FEEDBACK_DRIFT','REPRODUCIBILITY'
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
const assertEnum=(value,set,code,label)=>{
  const x=upper(value);
  if(!set.has(x))throw errorOf(`Unsupported ${label}`,code,400,{value});
  return x;
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

const loadAiProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='PRODUCT_DEVELOPMENT')throw errorOf(
    'AI Product Contract requires PRODUCT_DEVELOPMENT project','PRODUCT_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentProductBaseline=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM product_requirement_baselines WHERE project_id=? AND status='CURRENT' ORDER BY locked_at DESC LIMIT 1",
    [projectId]
  );
  if(!rows.length)throw errorOf('Current Product Baseline is required','PRODUCT_BASELINE_REQUIRED',409);
  return rows[0];
};
const currentTechnicalVersion=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT t.id contract_id,t.contract_key,t.status,v.*
       FROM product_technical_contracts t
       JOIN product_technical_contract_versions v
         ON v.technical_contract_id=t.id AND v.version_no=t.current_version_no
      WHERE t.project_id=? AND t.status IN ('APPROVED','CURRENT')
      ORDER BY t.updated_at DESC LIMIT 1`,[projectId]
  );
  if(!rows.length)throw errorOf('Current Technical Contract is required','TECHNICAL_CONTRACT_REQUIRED',409);
  return rows[0];
};
const assertProjectDecision=async(db,id,projectId)=>{
  const [rows]=await db.execute('SELECT project_id FROM project_changes WHERE id=?',[id]);
  if(!rows.length)throw errorOf('Project Change not found','PROJECT_CHANGE_NOT_FOUND',404);
  if(rows[0].project_id!==projectId)throw errorOf('Project Change scope mismatch','PRODUCT_OBJECT_SCOPE_MISMATCH',409);
};
const validateSections=input=>{
  if(!input||typeof input!=='object')throw errorOf('sectionStatus is required','INVALID_AI_SECTION_STATUS');
  const result={};
  const missing=[];
  for(const section of AI_SECTIONS){
    const row=input[section];
    if(!row||typeof row!=='object'){missing.push(section);continue;}
    const status=assertEnum(row.status,SECTION_STATUSES,'INVALID_AI_SECTION_STATUS',`${section} status`);
    if(status==='N_A'&&!nonEmpty(row.rationale))throw errorOf(
      `${section} N_A requires rationale`,'AI_SECTION_NA_REASON_REQUIRED',409,{section}
    );
    if(REQUIRED_PASS_SECTIONS.has(section)&&status!=='PASS')throw errorOf(
      `${section} must PASS for AI_APPLICATION`,'AI_REQUIRED_SECTION_NOT_PASS',409,{section,status}
    );
    result[section]={status,rationale:row.rationale||null,evidence:row.evidence||null};
  }
  if(missing.length)throw errorOf('AI Contract sections are incomplete','INVALID_AI_SECTION_STATUS',409,{missing});
  return result;
};
const validateAdversarialContract=input=>{
  requireFields(input,['promptInjection','toolAbuse','dataExfiltration'],'INVALID_AI_ADVERSARIAL_CONTRACT');
  for(const key of ['promptInjection','toolAbuse','dataExfiltration']){
    const row=input[key];
    if(!row||typeof row!=='object')throw errorOf('Adversarial test definition is invalid','INVALID_AI_ADVERSARIAL_CONTRACT',409,{key});
    const status=upper(row.status||'REQUIRED');
    if(status==='N_A'){
      if(!row.rationale)throw errorOf('N_A adversarial test requires rationale','AI_ADVERSARIAL_NA_REASON_REQUIRED',409,{key});
    }else if(!['REQUIRED','PLANNED'].includes(status)||!nonEmpty(row.assertions)){
      throw errorOf('Adversarial test requires assertions','AI_ADVERSARIAL_ASSERTIONS_REQUIRED',409,{key});
    }
  }
};
const validateBindingArrays=input=>{
  if(!Array.isArray(input.modelBindings)||!input.modelBindings.length)throw errorOf(
    'At least one model binding is required','AI_MODEL_BINDING_REQUIRED',409
  );
  if(!Array.isArray(input.knowledgeBindings))throw errorOf('knowledgeBindings must be an array','INVALID_AI_KNOWLEDGE_BINDINGS');
  if(!Array.isArray(input.capabilityBindings))throw errorOf('capabilityBindings must be an array','INVALID_AI_CAPABILITY_BINDINGS');
  if(!Array.isArray(input.evalBindings)||!input.evalBindings.length)throw errorOf(
    'At least one frozen offline eval binding is required','AI_EVAL_BINDING_REQUIRED',409
  );
};

export const resolveAiContractScope=async contractId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.id,c.project_id,p.workspace_id FROM product_ai_contracts c
      JOIN projects p ON p.id=c.project_id WHERE c.id=?`,[contractId]
  );
  if(!rows.length)throw errorOf('AI Contract not found','PRODUCT_AI_CONTRACT_NOT_FOUND',404);
  return {aiContractId:contractId,projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAiPromptVersion=async(projectId,input={},actorId=null)=>{
  const project=await loadAiProject(projectId);
  if(project.project_subtype_key!=='AI_APPLICATION')throw errorOf(
    'AI Prompt Version is only valid for AI_APPLICATION subtype','AI_APPLICATION_SUBTYPE_REQUIRED',409
  );
  requireFields(input,['productBaselineId','promptKey','instructionContract','structuredOutputSchema','evidence'],'INVALID_AI_PROMPT_VERSION');
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const baseline=await currentProductBaseline(projectId,conn);
    if(baseline.id!==input.productBaselineId)throw errorOf('Prompt must target current Product Baseline','PRODUCT_BASELINE_STALE',409);
    const [previous]=await conn.execute(
      'SELECT * FROM product_ai_prompt_versions WHERE project_id=? AND prompt_key=? ORDER BY version_no DESC LIMIT 1 FOR UPDATE',
      [projectId,input.promptKey]
    );
    const versionNo=previous.length?Number(previous[0].version_no)+1:1;
    if(previous.length){
      if(!input.changeId)throw errorOf('Prompt revision requires changeId','AI_PROMPT_CHANGE_REQUIRED',409);
      await assertProjectDecision(conn,input.changeId,projectId);
      await conn.execute(
        "UPDATE product_ai_prompt_versions SET status='HISTORICAL' WHERE project_id=? AND prompt_key=? AND status='CURRENT'",
        [projectId,input.promptKey]
      );
    }
    const id=randomUUID(),instructionSha256=sha256(input.instructionContract);
    await conn.execute(
      `INSERT INTO product_ai_prompt_versions
        (id,project_id,product_baseline_id,prompt_key,version_no,instruction_sha256,instruction_contract_json,
         structured_output_schema_json,status,change_id,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?, 'CURRENT',?,?,?)`,
      [id,projectId,input.productBaselineId,input.promptKey,versionNo,instructionSha256,
       asJson(input.instructionContract),asJson(input.structuredOutputSchema),input.changeId||null,
       asJson(input.evidence),actorId]
    );
    await conn.commit();
    return {id,projectId,productBaselineId:input.productBaselineId,promptKey:input.promptKey,versionNo,
      instructionSha256,status:'CURRENT',changeId:input.changeId||null};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const validateModelBindings=async(db,bindings)=>{
  let primary=0;
  for(const binding of bindings){
    if(!binding.providerKey||!binding.modelKey||!binding.bindingRole)throw errorOf(
      'modelBindings require providerKey, modelKey and bindingRole','INVALID_AI_MODEL_BINDING'
    );
    const [rows]=await db.execute(
      `SELECT m.enabled model_enabled,p.enabled provider_enabled,p.health_status
         FROM model_registry m JOIN provider_registry p ON p.provider_key=m.provider_key
        WHERE m.provider_key=? AND m.model_key=?`,[binding.providerKey,binding.modelKey]
    );
    if(!rows.length)throw errorOf('Model binding not found in registry','AI_MODEL_NOT_FOUND',404,{binding});
    if(!Boolean(rows[0].model_enabled)||!Boolean(rows[0].provider_enabled))throw errorOf(
      'AI model/provider binding is disabled','AI_MODEL_BINDING_DISABLED',409,{binding}
    );
    if(upper(binding.bindingRole)==='PRIMARY')primary++;
  }
  if(primary!==1)throw errorOf('Exactly one PRIMARY model binding is required','AI_PRIMARY_MODEL_REQUIRED',409,{primaryCount:primary});
};
const validateKnowledgeBindings=async(db,bindings)=>{
  for(const binding of bindings){
    if(!binding.sourceId||!nonEmpty(binding.retrievalPolicy)||!nonEmpty(binding.freshnessPolicy))throw errorOf(
      'Knowledge binding requires sourceId, retrievalPolicy and freshnessPolicy','INVALID_AI_KNOWLEDGE_BINDING'
    );
    const [rows]=await db.execute('SELECT status FROM knowledge_sources WHERE id=?',[binding.sourceId]);
    if(!rows.length)throw errorOf('Knowledge source not found','KNOWLEDGE_SOURCE_NOT_FOUND',404,{sourceId:binding.sourceId});
    if(rows[0].status!=='ACTIVE')throw errorOf('Knowledge source is not active','KNOWLEDGE_SOURCE_NOT_ACTIVE',409,{sourceId:binding.sourceId});
  }
};
const validateCapabilityBindings=async(db,bindings)=>{
  for(const binding of bindings){
    if(!binding.capabilityKey||!binding.capabilityRole||!binding.purpose)throw errorOf(
      'Capability binding requires capabilityKey, capabilityRole and purpose','INVALID_AI_CAPABILITY_BINDING'
    );
    const [rows]=await db.execute(
      'SELECT capability_type,status,routable FROM capability_registry WHERE capability_key=?',[binding.capabilityKey]
    );
    if(!rows.length)throw errorOf('Capability not found','AI_CAPABILITY_NOT_FOUND',404,{capabilityKey:binding.capabilityKey});
    if(rows[0].status!=='ACTIVE'||!Boolean(rows[0].routable))throw errorOf(
      'Capability is not active/routable','AI_CAPABILITY_NOT_ROUTABLE',409,{capabilityKey:binding.capabilityKey}
    );
    if(!['AGENT','TOOL','MCP'].includes(rows[0].capability_type))throw errorOf(
      'AI contract permission binding only supports AGENT/TOOL/MCP','INVALID_AI_CAPABILITY_TYPE',409,
      {capabilityKey:binding.capabilityKey,capabilityType:rows[0].capability_type}
    );
  }
};
const validateEvalBindings=async(db,bindings)=>{
  let offlineBaseline=0;
  for(const binding of bindings){
    if(!binding.suiteVersionId||!nonEmpty(binding.threshold))throw errorOf(
      'Eval binding requires suiteVersionId and threshold','INVALID_AI_EVAL_BINDING'
    );
    const [rows]=await db.execute('SELECT status,fixture_sha256,case_count FROM eval_suite_versions WHERE id=?',[binding.suiteVersionId]);
    if(!rows.length)throw errorOf('Eval suite version not found','EVAL_SUITE_VERSION_NOT_FOUND',404);
    if(rows[0].status!=='FROZEN'||!rows[0].fixture_sha256||Number(rows[0].case_count)<1)throw errorOf(
      'AI Contract requires a frozen non-empty eval suite version','AI_EVAL_VERSION_NOT_FROZEN',409
    );
    if(upper(binding.bindingRole||'OFFLINE_BASELINE')==='OFFLINE_BASELINE')offlineBaseline++;
  }
  if(!offlineBaseline)throw errorOf('OFFLINE_BASELINE eval binding is required','AI_OFFLINE_EVAL_BASELINE_REQUIRED',409);
};

const validateAiPayload=async(db,projectId,input)=>{
  requireFields(input,[
    'productBaselineId','technicalContractVersionId','promptVersionId','modelProviderRequirements',
    'ragContract','capabilityPermissionContract','structuredOutputContract','safetyPolicyPiiContract',
    'adversarialTestContract','fallbackFailClosedContract','humanEscalationContract',
    'qualityThreshold','latencyThreshold','costThreshold','onlineFeedbackDrift','reproducibility',
    'sectionStatus','evidence'
  ],'INVALID_PRODUCT_AI_CONTRACT_VERSION');
  validateBindingArrays(input);
  const sections=validateSections(input.sectionStatus);
  validateAdversarialContract(input.adversarialTestContract);
  const baseline=await currentProductBaseline(projectId,db);
  if(baseline.id!==input.productBaselineId)throw errorOf('AI Contract must target current Product Baseline','PRODUCT_BASELINE_STALE',409);
  const technical=await currentTechnicalVersion(projectId,db);
  if(technical.id!==input.technicalContractVersionId||technical.product_baseline_id!==baseline.id)throw errorOf(
    'AI Contract must bind the current Technical Contract on the same Product Baseline','AI_TECHNICAL_CONTRACT_STALE',409
  );
  const [prompts]=await db.execute(
    `SELECT * FROM product_ai_prompt_versions WHERE id=? AND project_id=? AND status='CURRENT'`,
    [input.promptVersionId,projectId]
  );
  if(!prompts.length)throw errorOf('Current AI Prompt Version not found','AI_PROMPT_VERSION_NOT_CURRENT',409);
  if(prompts[0].product_baseline_id!==baseline.id)throw errorOf('AI Prompt Version baseline mismatch','AI_PROMPT_BASELINE_MISMATCH',409);
  if(input.structuredOutputContract?.schemaSha256&&
     input.structuredOutputContract.schemaSha256!==sha256(parseJson(prompts[0].structured_output_schema_json))){
    throw errorOf('Structured output schema hash does not match Prompt Version','AI_STRUCTURED_OUTPUT_HASH_MISMATCH',409);
  }
  if(input.capabilityPermissionContract?.denyByDefault!==true)throw errorOf(
    'AI capability permissions must be deny-by-default','AI_PERMISSION_DENY_BY_DEFAULT_REQUIRED',409
  );
  if(input.fallbackFailClosedContract?.failClosed!==true)throw errorOf(
    'AI fallback contract must define failClosed=true','AI_FAIL_CLOSED_REQUIRED',409
  );
  if(!nonEmpty(input.humanEscalationContract.triggers)||!nonEmpty(input.humanEscalationContract.actions))throw errorOf(
    'Human escalation requires triggers and actions','AI_HUMAN_ESCALATION_REQUIRED',409
  );
  if(!nonEmpty(input.qualityThreshold)||!nonEmpty(input.latencyThreshold)||!nonEmpty(input.costThreshold))throw errorOf(
    'Quality, latency and cost thresholds are required','AI_THRESHOLDS_REQUIRED',409
  );
  if(!nonEmpty(input.onlineFeedbackDrift.signals)||!nonEmpty(input.onlineFeedbackDrift.actions))throw errorOf(
    'Online feedback/drift contract requires signals and actions','AI_DRIFT_CONTRACT_REQUIRED',409
  );
  if(!nonEmpty(input.reproducibility.runtimeVersion)||!nonEmpty(input.reproducibility.workflowVersion)||
     !nonEmpty(input.reproducibility.modelSelectionPolicy)||!nonEmpty(input.reproducibility.sourceVersionPolicy)){
    throw errorOf('Reproducibility metadata is incomplete','AI_REPRODUCIBILITY_REQUIRED',409);
  }
  if(sections.RAG.status==='PASS'&&!input.knowledgeBindings.length)throw errorOf(
    'RAG PASS requires at least one Knowledge Source binding','AI_RAG_SOURCE_REQUIRED',409
  );
  await validateModelBindings(db,input.modelBindings);
  await validateKnowledgeBindings(db,input.knowledgeBindings);
  await validateCapabilityBindings(db,input.capabilityBindings);
  await validateEvalBindings(db,input.evalBindings);
  return {sections,baseline,technical,prompt:prompts[0]};
};

const insertBindings=async(db,versionId,input)=>{
  for(const binding of input.modelBindings){
    await db.execute(
      `INSERT INTO product_ai_model_bindings
        (ai_contract_version_id,provider_key,model_key,binding_role,required,fallback_order,constraints_json)
       VALUES (?,?,?,?,?,?,?)`,
      [versionId,binding.providerKey,binding.modelKey,upper(binding.bindingRole),
       binding.required===false?0:1,binding.fallbackOrder==null?null:Number(binding.fallbackOrder),
       asJson(binding.constraints||null)]
    );
  }
  for(const binding of input.knowledgeBindings){
    await db.execute(
      `INSERT INTO product_ai_knowledge_bindings
        (ai_contract_version_id,source_id,binding_role,retrieval_policy_json,freshness_policy_json)
       VALUES (?,?,?,?,?)`,
      [versionId,binding.sourceId,upper(binding.bindingRole||'RAG_SOURCE'),
       asJson(binding.retrievalPolicy),asJson(binding.freshnessPolicy)]
    );
  }
  for(const binding of input.capabilityBindings){
    await db.execute(
      `INSERT INTO product_ai_capability_bindings
        (ai_contract_version_id,capability_key,permission_mode,capability_role,purpose,data_scope_json)
       VALUES (?,?,?,?,?,?)`,
      [versionId,binding.capabilityKey,upper(binding.permissionMode||'ALLOWED'),
       upper(binding.capabilityRole),binding.purpose,asJson(binding.dataScope||null)]
    );
  }
  for(const binding of input.evalBindings){
    await db.execute(
      `INSERT INTO product_ai_eval_bindings
        (ai_contract_version_id,suite_version_id,binding_role,threshold_json)
       VALUES (?,?,?,?)`,
      [versionId,binding.suiteVersionId,upper(binding.bindingRole||'OFFLINE_BASELINE'),asJson(binding.threshold)]
    );
  }
};

const insertAiVersion=async(db,{contractId,projectId,versionNo,input,changeId,actorId})=>{
  const validated=await validateAiPayload(db,projectId,input);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO product_ai_contract_versions
      (id,ai_contract_id,project_id,product_baseline_id,technical_contract_version_id,prompt_version_id,version_no,
       model_provider_requirements_json,rag_contract_json,capability_permission_contract_json,
       structured_output_contract_json,safety_policy_pii_contract_json,adversarial_test_contract_json,
       fallback_fail_closed_contract_json,human_escalation_contract_json,quality_threshold_json,
       latency_threshold_json,cost_threshold_json,online_feedback_drift_json,reproducibility_json,
       section_status_json,change_id,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,contractId,projectId,input.productBaselineId,input.technicalContractVersionId,input.promptVersionId,versionNo,
     asJson(input.modelProviderRequirements),asJson(input.ragContract),asJson(input.capabilityPermissionContract),
     asJson(input.structuredOutputContract),asJson(input.safetyPolicyPiiContract),asJson(input.adversarialTestContract),
     asJson(input.fallbackFailClosedContract),asJson(input.humanEscalationContract),asJson(input.qualityThreshold),
     asJson(input.latencyThreshold),asJson(input.costThreshold),asJson(input.onlineFeedbackDrift),
     asJson(input.reproducibility),asJson(validated.sections),changeId||null,asJson(input.evidence),actorId]
  );
  await insertBindings(db,id,input);
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,'TECHNICAL_CONTRACT_VERSION',input.technicalContractVersionId,
     'AI_CONTRACT_VERSION',id,'EXTENDED_BY',asJson({gate:AI_GATE}),actorId]
  );
  await db.execute(
    `INSERT INTO product_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,'AI_PROMPT_VERSION',input.promptVersionId,
     'AI_CONTRACT_VERSION',id,'LOCKED_IN',asJson({gate:AI_GATE}),actorId]
  );
  return id;
};

export const createAiContract=async(projectId,input={},actorId=null)=>{
  const project=await loadAiProject(projectId);
  if(project.project_subtype_key!=='AI_APPLICATION')throw errorOf(
    'AI Contract is only valid for AI_APPLICATION subtype','AI_APPLICATION_SUBTYPE_REQUIRED',409
  );
  if(!input.contractKey||!input.title)throw errorOf('contractKey and title are required','INVALID_PRODUCT_AI_CONTRACT');
  const status=assertEnum(input.status||'APPROVED',CONTRACT_STATUSES,'INVALID_AI_CONTRACT_STATUS','AI contract status');
  const db=getRuntimePool(),conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO product_ai_contracts(id,project_id,contract_key,title,status,current_version_no,owner_identity_id)
       VALUES (?,?,?,?,?,1,?)`,
      [id,projectId,input.contractKey,input.title,status,input.ownerIdentityId||actorId||null]
    );
    const versionId=await insertAiVersion(conn,{contractId:id,projectId,versionNo:1,input,changeId:null,actorId});
    await conn.commit();
    return {id,projectId,contractKey:input.contractKey,title:input.title,status,currentVersionNo:1,currentVersionId:versionId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const reviseAiContract=async(contractId,input={},actorId=null)=>{
  if(!input.changeId)throw errorOf('AI Contract revision requires changeId','AI_CONTRACT_CHANGE_REQUIRED',409);
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM product_ai_contracts WHERE id=? FOR UPDATE',[contractId]);
    if(!rows.length)throw errorOf('AI Contract not found','PRODUCT_AI_CONTRACT_NOT_FOUND',404);
    const row=rows[0];
    await assertProjectDecision(conn,input.changeId,row.project_id);
    const versionNo=Number(row.current_version_no)+1;
    const versionId=await insertAiVersion(conn,{contractId,projectId:row.project_id,versionNo,input,changeId:input.changeId,actorId});
    const status=input.status?assertEnum(input.status,CONTRACT_STATUSES,'INVALID_AI_CONTRACT_STATUS','AI contract status'):row.status;
    await conn.execute('UPDATE product_ai_contracts SET current_version_no=?,status=? WHERE id=?',[versionNo,status,contractId]);
    await conn.commit();
    return {id:contractId,projectId:row.project_id,contractKey:row.contract_key,status,currentVersionNo:versionNo,currentVersionId:versionId,changeId:input.changeId};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const currentAiContract=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT c.id contract_id,c.contract_key,c.status,v.*
       FROM product_ai_contracts c
       JOIN product_ai_contract_versions v
         ON v.ai_contract_id=c.id AND v.version_no=c.current_version_no
      WHERE c.project_id=? AND c.status IN ('APPROVED','CURRENT')
      ORDER BY c.updated_at DESC LIMIT 1`,[projectId]
  );
  return rows[0]||null;
};

export const evaluateAiContractGate=async(projectId,input={},actorId=null)=>{
  const project=await loadAiProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  if(project.project_subtype_key!=='AI_APPLICATION'){
    const result={projectId,gateKey:AI_GATE,status:'SKIPPED',reasonCodes:['NOT_AI_APPLICATION'],
      evidenceSnapshot:{projectSubtypeKey:project.project_subtype_key},asOf};
    if(input.persist!==false){
      const db=getRuntimePool();
      await db.execute(
        `INSERT INTO product_m273_gate_evaluations
          (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(),projectId,AI_GATE,'SKIPPED',asJson(result.reasonCodes),asJson(result.evidenceSnapshot),asOf,actorId]
      );
    }
    return result;
  }
  const db=getRuntimePool(),reasons=[],evidence={projectSubtypeKey:project.project_subtype_key};
  const baseGate=await evaluateProductDeliveryGate(projectId,'G-PD-CONTRACT',{persist:false},actorId);
  if(baseGate.status!=='PASS')reasons.push('BASE_TECHNICAL_CONTRACT_NOT_READY');
  const baseline=await currentProductBaseline(projectId,db);
  const technical=await currentTechnicalVersion(projectId,db);
  const ai=await currentAiContract(projectId,db);
  evidence.productBaselineId=baseline.id;
  evidence.technicalContractVersionId=technical.id;
  evidence.aiContractId=ai?.contract_id||null;
  evidence.aiContractVersionId=ai?.id||null;
  if(!ai)reasons.push('AI_CONTRACT_REQUIRED');
  else{
    if(ai.product_baseline_id!==baseline.id)reasons.push('AI_CONTRACT_BASELINE_STALE');
    if(ai.technical_contract_version_id!==technical.id)reasons.push('AI_TECHNICAL_CONTRACT_STALE');
    const sections=parseJson(ai.section_status_json)||{};
    for(const section of REQUIRED_PASS_SECTIONS)if(sections[section]?.status!=='PASS')reasons.push(`AI_SECTION_NOT_PASS:${section}`);
    if(Object.values(sections).some(x=>x?.status==='BLOCKED'))reasons.push('AI_CONTRACT_SECTION_BLOCKED');

    const [prompt]=await db.execute(
      "SELECT * FROM product_ai_prompt_versions WHERE id=? AND status='CURRENT'",[ai.prompt_version_id]
    );
    if(!prompt.length)reasons.push('AI_PROMPT_VERSION_STALE');
    else if(prompt[0].product_baseline_id!==baseline.id)reasons.push('AI_PROMPT_BASELINE_MISMATCH');

    const [[models]]=await db.execute(
      "SELECT COUNT(*) count FROM product_ai_model_bindings WHERE ai_contract_version_id=? AND binding_role='PRIMARY'",[ai.id]
    );
    if(Number(models.count)!==1)reasons.push('AI_PRIMARY_MODEL_REQUIRED');

    const ragStatus=sections.RAG?.status;
    if(ragStatus==='PASS'){
      const [[knowledge]]=await db.execute(
        'SELECT COUNT(*) count FROM product_ai_knowledge_bindings WHERE ai_contract_version_id=?',[ai.id]
      );
      if(!Number(knowledge.count))reasons.push('AI_RAG_SOURCE_REQUIRED');
    }

    const [[evals]]=await db.execute(
      `SELECT COUNT(*) count FROM product_ai_eval_bindings b
        JOIN eval_suite_versions v ON v.id=b.suite_version_id
       WHERE b.ai_contract_version_id=? AND b.binding_role='OFFLINE_BASELINE'
         AND v.status='FROZEN' AND v.case_count>0 AND v.fixture_sha256 IS NOT NULL`,[ai.id]
    );
    if(!Number(evals.count))reasons.push('AI_OFFLINE_EVAL_BASELINE_REQUIRED');

    const permissions=parseJson(ai.capability_permission_contract_json)||{};
    if(permissions.denyByDefault!==true)reasons.push('AI_PERMISSION_DENY_BY_DEFAULT_REQUIRED');
    const fallback=parseJson(ai.fallback_fail_closed_contract_json)||{};
    if(fallback.failClosed!==true)reasons.push('AI_FAIL_CLOSED_REQUIRED');
  }
  const result={projectId,gateKey:AI_GATE,status:reasons.length?'HOLD':'PASS',reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
  if(input.persist!==false){
    await db.execute(
      `INSERT INTO product_m273_gate_evaluations
        (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,AI_GATE,result.status,asJson(reasons),asJson(evidence),asOf,actorId]
    );
  }
  return result;
};

export const getAiContract=async contractId=>{
  const db=getRuntimePool();
  const [contracts]=await db.execute('SELECT * FROM product_ai_contracts WHERE id=?',[contractId]);
  if(!contracts.length)throw errorOf('AI Contract not found','PRODUCT_AI_CONTRACT_NOT_FOUND',404);
  const [versions]=await db.execute(
    'SELECT * FROM product_ai_contract_versions WHERE ai_contract_id=? ORDER BY version_no',[contractId]
  );
  const result=[];
  for(const v of versions){
    const [models,knowledge,capabilities,evals]=await Promise.all([
      db.execute('SELECT * FROM product_ai_model_bindings WHERE ai_contract_version_id=? ORDER BY binding_role,fallback_order',[v.id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_ai_knowledge_bindings WHERE ai_contract_version_id=? ORDER BY binding_role,source_id',[v.id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_ai_capability_bindings WHERE ai_contract_version_id=? ORDER BY capability_role,capability_key',[v.id]).then(x=>x[0]),
      db.execute('SELECT * FROM product_ai_eval_bindings WHERE ai_contract_version_id=? ORDER BY binding_role,suite_version_id',[v.id]).then(x=>x[0])
    ]);
    result.push({
      id:v.id,versionNo:Number(v.version_no),productBaselineId:v.product_baseline_id,
      technicalContractVersionId:v.technical_contract_version_id,promptVersionId:v.prompt_version_id,
      sectionStatus:parseJson(v.section_status_json),modelProviderRequirements:parseJson(v.model_provider_requirements_json),
      ragContract:parseJson(v.rag_contract_json),capabilityPermissionContract:parseJson(v.capability_permission_contract_json),
      structuredOutputContract:parseJson(v.structured_output_contract_json),
      safetyPolicyPiiContract:parseJson(v.safety_policy_pii_contract_json),
      adversarialTestContract:parseJson(v.adversarial_test_contract_json),
      fallbackFailClosedContract:parseJson(v.fallback_fail_closed_contract_json),
      humanEscalationContract:parseJson(v.human_escalation_contract_json),
      qualityThreshold:parseJson(v.quality_threshold_json),latencyThreshold:parseJson(v.latency_threshold_json),
      costThreshold:parseJson(v.cost_threshold_json),onlineFeedbackDrift:parseJson(v.online_feedback_drift_json),
      reproducibility:parseJson(v.reproducibility_json),changeId:v.change_id||null,
      modelBindings:models.map(x=>({providerKey:x.provider_key,modelKey:x.model_key,bindingRole:x.binding_role,required:Boolean(x.required),fallbackOrder:x.fallback_order,constraints:parseJson(x.constraints_json)})),
      knowledgeBindings:knowledge.map(x=>({sourceId:x.source_id,bindingRole:x.binding_role,retrievalPolicy:parseJson(x.retrieval_policy_json),freshnessPolicy:parseJson(x.freshness_policy_json)})),
      capabilityBindings:capabilities.map(x=>({capabilityKey:x.capability_key,permissionMode:x.permission_mode,capabilityRole:x.capability_role,purpose:x.purpose,dataScope:parseJson(x.data_scope_json)})),
      evalBindings:evals.map(x=>({suiteVersionId:x.suite_version_id,bindingRole:x.binding_role,threshold:parseJson(x.threshold_json)}))
    });
  }
  const c=contracts[0];
  return {id:c.id,projectId:c.project_id,contractKey:c.contract_key,title:c.title,status:c.status,
    currentVersionNo:Number(c.current_version_no),versions:result};
};

export const getAiProductState=async projectId=>{
  const project=await loadAiProject(projectId);
  const db=getRuntimePool();
  const [prompts,contracts,gates]=await Promise.all([
    db.execute('SELECT * FROM product_ai_prompt_versions WHERE project_id=? ORDER BY prompt_key,version_no',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_ai_contracts WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM product_m273_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId]).then(x=>x[0])
  ]);
  return {
    projectId,projectSubtypeKey:project.project_subtype_key,
    prompts:prompts.map(x=>({id:x.id,promptKey:x.prompt_key,versionNo:Number(x.version_no),
      productBaselineId:x.product_baseline_id,instructionSha256:x.instruction_sha256,status:x.status,changeId:x.change_id||null})),
    contracts:contracts.map(x=>({id:x.id,contractKey:x.contract_key,title:x.title,status:x.status,currentVersionNo:Number(x.current_version_no)})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),asOf:x.as_of}))
  };
};
