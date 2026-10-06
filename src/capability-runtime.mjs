import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { selectProviderModel } from './policy-router-v2.mjs';
import { invokeOpenAiResponses, classifyProviderError } from './openai-responses-provider.mjs';
import { recordToolExecution } from './runtime-evidence.mjs';
import {
  authorizeCommercialExecution,commitUsageReservation,releaseUsageReservation
} from './commercial-control.mjs';

const INVOCABLE_TYPES=new Set(['MODEL','TOOL','SKILL','MCP']);
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stableValue(value))
,'utf8').digest('hex');
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
};
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const matchesConstraints=(row,constraints={})=>{
  if(Array.isArray(constraints.allowedCapabilityKeys)&&constraints.allowedCapabilityKeys.length&&
     !constraints.allowedCapabilityKeys.includes(row.capability_key)) return false;
  if(Array.isArray(constraints.excludedCapabilityKeys)&&constraints.excludedCapabilityKeys.includes(row.capability_key)) return false;
  if(Array.isArray(constraints.allowedAdapterKeys)&&constraints.allowedAdapterKeys.length&&
     !constraints.allowedAdapterKeys.includes(row.adapter_key)) return false;
  const requiredTags=constraints.requiredPolicyTags;
  if(requiredTags&&typeof requiredTags==='object'&&!Array.isArray(requiredTags)){
    const tags=parseJson(row.policy_tags_json)||{};
    for(const [key,value] of Object.entries(requiredTags)){
      if(JSON.stringify(tags[key])!==JSON.stringify(value)) return false;
    }
  }
  return true;
};
const normalizeCandidate=row=>({
  capabilityKey:row.capability_key,
  capabilityType:row.capability_type,
  displayName:row.display_name,
  adapterKey:row.adapter_key,
  bindingMode:row.binding_mode,
  projectPriority:Number(row.project_priority??100),
  agentPriority:row.agent_priority==null?null:Number(row.agent_priority),
  providerKey:row.provider_key||null,
  modelKey:row.model_key||null
});
const normalizeInvocation=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,projectId:row.project_id,
  runId:row.run_id,taskId:row.task_id,projectStageInstanceId:row.project_stage_instance_id,
  workflowStageId:row.workflow_stage_id,requirementId:row.requirement_id,
  agentCapabilityKey:row.agent_capability_key||null,capabilityType:row.capability_type,
  routingMode:row.routing_mode,policyMode:row.policy_mode||null,
  requestedCapabilityKey:row.requested_capability_key||null,selectedCapabilityKey:row.selected_capability_key,
  adapterKey:row.adapter_key,status:row.status,decision:parseJson(row.decision_json),
  inputSha256:row.input_sha256,outputSha256:row.output_sha256||null,
  outputEvidence:parseJson(row.output_evidence_json),toolExecutionId:row.tool_execution_id||null,
  usageLedgerId:row.usage_ledger_id||null,durationMs:row.duration_ms==null?null:Number(row.duration_ms),
  errorCode:row.error_code||null,errorCategory:row.error_category||null,errorMessage:row.error_message||null,
  startedAt:row.started_at,finishedAt:row.finished_at||null,createdAt:row.created_at
});

const loadInvocationContext=async(input,db=getRuntimePool())=>{
  if(!input?.projectId||!input?.runId||!input?.taskId||!input?.stageKey||!input?.requirementKey){
    throw errorOf(
      'projectId, runId, taskId, stageKey and requirementKey are required',
      'INVALID_CAPABILITY_INVOCATION'
    );
  }
  const [rows]=await db.execute(
    `SELECT
       p.id AS project_id,p.tenant_id,p.workspace_id,p.project_type,p.workflow_template_id,p.status AS project_status,
       r.id AS run_id,r.status AS run_status,r.project_id AS run_project_id,
       t.id AS task_id,t.stage_key AS task_stage_key,t.status AS task_status,t.run_id AS task_run_id,
       psi.id AS project_stage_instance_id,psi.workflow_template_stage_id,psi.status AS stage_instance_status,
       psi.agent_capability_key,ws.id AS workflow_stage_id,ws.stage_key,ws.default_agent_capability_key,
       req.id AS requirement_id,req.requirement_key,req.capability_type,req.capability_key,req.routing_mode,
       req.requirement_mode,req.priority AS requirement_priority,req.constraints_json,
       ap.policy_mode AS agent_policy_mode
       FROM projects p
       JOIN runs r ON r.project_id=p.id AND r.id=?
       JOIN tasks t ON t.run_id=r.id AND t.id=?
       JOIN project_stage_instances psi ON psi.project_id=p.id AND psi.stage_key=?
       JOIN workflow_template_stages ws ON ws.id=psi.workflow_template_stage_id
       JOIN stage_capability_requirements req ON req.workflow_stage_id=ws.id AND req.requirement_key=?
       LEFT JOIN agent_profiles ap ON ap.capability_key=psi.agent_capability_key
      WHERE p.id=?`,
    [input.runId,input.taskId,input.stageKey,input.requirementKey,input.projectId]
  );
  if(!rows.length) throw errorOf(
    'Capability requirement could not be resolved for project/run/task/stage',
    'CAPABILITY_REQUIREMENT_NOT_FOUND',404
  );
  const row=rows[0];
  if(row.project_status!=='ACTIVE') throw errorOf('Project is not active','PROJECT_NOT_ACTIVE',409);
  if(!row.workflow_template_id) throw errorOf('Project is not bound to a workflow template','PROJECT_WORKFLOW_NOT_BOUND',409);
  if(row.run_project_id!==row.project_id||row.task_run_id!==row.run_id) throw errorOf(
    'Run/task scope does not match project','CAPABILITY_INVOCATION_SCOPE_MISMATCH',409
  );
  if(row.task_stage_key!==row.stage_key) throw errorOf(
    'Task stage does not match lifecycle stage','CAPABILITY_INVOCATION_STAGE_MISMATCH',409,
    {taskStageKey:row.task_stage_key,stageKey:row.stage_key}
  );
  if(row.stage_instance_status!=='ACTIVE') throw errorOf(
    'Capability invocation requires the active project stage','PROJECT_STAGE_NOT_ACTIVE',409,
    {stageKey:row.stage_key,status:row.stage_instance_status}
  );
  if(!INVOCABLE_TYPES.has(row.capability_type)) throw errorOf(
    'Stage requirement capability type is not directly invocable',
    'CAPABILITY_TYPE_NOT_INVOCABLE',409,{capabilityType:row.capability_type}
  );
  return row;
};

const loadCandidates=async(context,db=getRuntimePool())=>{
  const params=[];
  let sql=`SELECT
      c.capability_key,c.capability_type,c.display_name,c.adapter_key,c.status,c.routable,c.policy_tags_json,
      b.binding_mode,b.priority AS project_priority,
      g.priority AS agent_priority,
      mb.provider_key,mb.model_key
    FROM project_type_capability_bindings b
    JOIN capability_registry c ON c.capability_key=b.capability_key
    LEFT JOIN model_capability_bindings mb ON mb.capability_key=c.capability_key`;

  if(context.agent_capability_key){
    sql+=` JOIN agent_capability_grants g
       ON g.child_capability_key=c.capability_key AND g.agent_capability_key=?`;
    params.push(context.agent_capability_key);
  }else{
    sql+=` LEFT JOIN agent_capability_grants g ON 1=0`;
  }

  sql+=` WHERE b.project_type_key=? AND c.capability_type=?
      AND b.binding_mode IN ('ALLOWED','DEFAULT')
      AND c.status='ACTIVE' AND c.routable=TRUE`;
  params.push(context.project_type,context.capability_type);
  const [rows]=await db.execute(sql,params);
  const constraints=parseJson(context.constraints_json)||{};
  return rows.filter(row=>matchesConstraints(row,constraints));
};

export const resolveStageCapability=async input=>{
  const db=getRuntimePool();
  const context=await loadInvocationContext(input,db);
  const candidates=await loadCandidates(context,db);
  const constraints=parseJson(context.constraints_json)||{};
  let selected=null,policyMode=null,fallbackChain=[];

  if(context.routing_mode==='FIXED'){
    selected=candidates.find(row=>row.capability_key===context.capability_key)||null;
    if(!selected) throw errorOf(
      'Fixed capability is no longer allowed, active and granted at execution time',
      'FIXED_CAPABILITY_NOT_EXECUTABLE',409,
      {capabilityKey:context.capability_key,stageKey:context.stage_key,requirementKey:context.requirement_key}
    );
    policyMode='FIXED';
  }else if(context.routing_mode==='POLICY'){
    if(context.capability_type==='MODEL'){
      const modelCandidates=candidates.filter(row=>row.provider_key&&row.model_key);
      if(!modelCandidates.length) throw errorOf(
        'No allowed model capability is executable','NO_ALLOWED_CAPABILITY_ROUTE',409
      );
      policyMode=context.agent_policy_mode||constraints.policyMode||'QUALITY_FIRST';
      const route=await selectProviderModel({
        policyMode,
        taskType:constraints.taskType||input.taskType||null,
        requiredStructuredOutput:constraints.structuredOutput===true||constraints.requiredStructuredOutput===true,
        allowedModelPairs:modelCandidates.map(row=>({providerKey:row.provider_key,modelKey:row.model_key}))
      });
      if(!route.allowed) throw errorOf(
        route.reason||'No allowed model route','NO_ALLOWED_CAPABILITY_ROUTE',409,
        {policyMode,providerPolicyCode:route.code}
      );
      selected=modelCandidates.find(
        row=>row.provider_key===route.selectedProviderKey&&row.model_key===route.selectedModelKey
      )||null;
      if(!selected) throw errorOf(
        'Model policy selected a capability outside the allowed candidate set',
        'CAPABILITY_POLICY_ESCAPE',500
      );
      fallbackChain=(route.fallbackChain||[]).map(item=>{
        const row=modelCandidates.find(x=>x.provider_key===item.providerKey&&x.model_key===item.modelKey);
        return row?{...normalizeCandidate(row),healthStatus:item.healthStatus}:item;
      });
    }else{
      policyMode='PRIORITY';
      const ordered=[...candidates].sort((a,b)=>{
        const bindingRank=x=>x.binding_mode==='DEFAULT'?0:1;
        return bindingRank(a)-bindingRank(b)||
          Number(a.project_priority||100)-Number(b.project_priority||100)||
          Number(a.agent_priority||100)-Number(b.agent_priority||100)||
          String(a.capability_key).localeCompare(String(b.capability_key));
      });
      selected=ordered[0]||null;
      fallbackChain=ordered.slice(1).map(normalizeCandidate);
    }
    if(!selected) throw errorOf(
      'No allowed capability satisfies the stage requirement','NO_ALLOWED_CAPABILITY_ROUTE',409,
      {stageKey:context.stage_key,requirementKey:context.requirement_key,capabilityType:context.capability_type}
    );
  }else{
    throw errorOf('Unsupported stage routing mode','INVALID_ROUTING_MODE',500,{routingMode:context.routing_mode});
  }

  return {
    context:{
      tenantId:context.tenant_id,workspaceId:context.workspace_id,projectId:context.project_id,
      runId:context.run_id,taskId:context.task_id,
      projectStageInstanceId:context.project_stage_instance_id,workflowStageId:context.workflow_stage_id,
      requirementId:context.requirement_id,projectType:context.project_type,stageKey:context.stage_key,
      requirementKey:context.requirement_key,requirementMode:context.requirement_mode,
      agentCapabilityKey:context.agent_capability_key||null
    },
    capabilityType:context.capability_type,
    routingMode:context.routing_mode,
    policyMode,
    requestedCapabilityKey:context.capability_key||null,
    selected:normalizeCandidate(selected),
    fallbackChain
  };
};

const insertInvocation=async(resolution,inputSha256,db=getRuntimePool())=>{
  const id=randomUUID(),c=resolution.context;
  await db.execute(
    `INSERT INTO capability_invocations (
      id,tenant_id,workspace_id,project_id,run_id,task_id,project_stage_instance_id,workflow_stage_id,
      requirement_id,agent_capability_key,capability_type,routing_mode,policy_mode,requested_capability_key,
      selected_capability_key,adapter_key,status,decision_json,input_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'RUNNING',?,?)`,
    [
      id,c.tenantId,c.workspaceId,c.projectId,c.runId,c.taskId,c.projectStageInstanceId,c.workflowStageId,
      c.requirementId,c.agentCapabilityKey,resolution.capabilityType,resolution.routingMode,resolution.policyMode,
      resolution.requestedCapabilityKey,resolution.selected.capabilityKey,resolution.selected.adapterKey,
      asJson({
        projectType:c.projectType,stageKey:c.stageKey,requirementKey:c.requirementKey,
        selected:resolution.selected,fallbackChain:resolution.fallbackChain
      }),inputSha256
    ]
  );
  return id;
};
const finalizeInvocation=async(id,input,db=getRuntimePool())=>{
  await db.execute(
    `UPDATE capability_invocations SET
      status=?,output_sha256=?,output_evidence_json=?,tool_execution_id=?,usage_ledger_id=?,
      duration_ms=?,error_code=?,error_category=?,error_message=?,finished_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [
      input.status,input.outputSha256||null,asJson(input.outputEvidence||null),
      input.toolExecutionId||null,input.usageLedgerId||null,input.durationMs==null?null:Number(input.durationMs),
      input.errorCode||null,input.errorCategory||null,input.errorMessage||null,id
    ]
  );
};

export const getCapabilityInvocation=async invocationId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM capability_invocations WHERE id=?',[invocationId]);
  if(!rows.length) throw errorOf('Capability invocation not found','CAPABILITY_INVOCATION_NOT_FOUND',404);
  return normalizeInvocation(rows[0]);
};

const invokeInternalTestAdapter=async({resolution,input})=>{
  if(process.env.RUNTIME_ENABLE_INTERNAL_TEST_ADAPTER!=='true') throw errorOf(
    'Internal test adapter is disabled','CAPABILITY_ADAPTER_NOT_IMPLEMENTED',503,
    {adapterKey:resolution.selected.adapterKey}
  );
  return {
    status:'PASS',
    output:{
      adapter:'internal-test',
      capabilityKey:resolution.selected.capabilityKey,
      capabilityType:resolution.capabilityType,
      payload:input?.payload??null
    },
    evidence:{adapter:'internal-test',testOnly:true}
  };
};

const invokeModelAdapter=async({resolution,input,invocationId})=>{
  if(resolution.selected.adapterKey!=='openai-responses') throw errorOf(
    'Model capability adapter is not implemented','CAPABILITY_ADAPTER_NOT_IMPLEMENTED',503,
    {adapterKey:resolution.selected.adapterKey}
  );
  if(!input?.schema||typeof input.schema!=='object') throw errorOf(
    'MODEL invocation requires a structured output schema','MODEL_INVOCATION_SCHEMA_REQUIRED',400
  );
  if(input.input==null) throw errorOf('MODEL invocation requires input','MODEL_INVOCATION_INPUT_REQUIRED',400);

  const authorization=await authorizeCommercialExecution({
    runId:resolution.context.runId,
    entitlementKey:'MODEL_EXECUTION',
    operationKey:'MODEL_EXECUTION',
    reservationMetric:'TOOL_EXECUTION_COUNT',
    reservationAmount:1,
    reservationTtlSeconds:300,
    source:'CAPABILITY_RUNTIME'
  });
  const startedAt=performance.now();
  let providerResult;
  try{
    providerResult=await invokeOpenAiResponses({
      instructions:String(input.instructions||'Execute the requested capability task using only the supplied input.'),
      input:typeof input.input==='string'?input.input:JSON.stringify(input.input),
      schema:input.schema,
      schemaName:input.schemaName||'capability_output',
      metadata:{
        run_id:resolution.context.runId,
        task_id:resolution.context.taskId,
        capability_invocation_id:invocationId,
        capability_key:resolution.selected.capabilityKey
      },
      modelKey:resolution.selected.modelKey
    });
  }catch(error){
    let failureEvidence=null;
    try{
      failureEvidence=await recordToolExecution({
        runId:resolution.context.runId,taskId:resolution.context.taskId,
        correlationId:null,toolType:'MODEL_PROVIDER',toolKey:'openai.responses',
        providerKey:resolution.selected.providerKey,modelKey:resolution.selected.modelKey,
        status:'FAIL',
        input:{capabilityInvocationId:invocationId,inputSha256:sha256(input),sourceBodyPersisted:false},
        output:null,tokenInput:0,tokenOutput:0,durationMs:error.durationMs??null,
        errorCode:error.code||'MODEL_PROVIDER_ERROR',
        errorCategory:error.errorCategory||classifyProviderError(error),errorMessage:error.message
      });
    }finally{
      if(failureEvidence?.id) await commitUsageReservation(authorization.reservationId,{
        actualAmount:1,toolExecutionId:failureEvidence.id
      });
      else await releaseUsageReservation(authorization.reservationId,{reasonCode:'CAPABILITY_PROVIDER_FAILURE_UNRECORDED'});
    }
    error.toolExecutionId=failureEvidence?.id||null;
    error.usageLedgerId=failureEvidence?.usageLedgerId||null;
    throw error;
  }

  const outputSha256=sha256(providerResult.output);
  const evidence=await recordToolExecution({
    runId:resolution.context.runId,taskId:resolution.context.taskId,
    correlationId:null,toolType:'MODEL_PROVIDER',toolKey:'openai.responses',
    providerKey:resolution.selected.providerKey,modelKey:providerResult.model,
    status:providerResult.status==='completed'?'PASS':'HOLD',
    input:{capabilityInvocationId:invocationId,inputSha256:sha256(input),sourceBodyPersisted:false},
    output:{providerResponseId:providerResult.providerResponseId,outputSha256,outputPersisted:false},
    tokenInput:providerResult.usage?.input_tokens||0,
    cachedInputTokens:providerResult.usage?.input_tokens_details?.cached_tokens||0,
    cacheWriteTokens:providerResult.usage?.input_tokens_details?.cache_write_tokens||0,
    tokenOutput:providerResult.usage?.output_tokens||0,
    serviceTier:providerResult.serviceTier||'STANDARD',
    regionalUpliftBps:Number(process.env.OPENAI_REGIONAL_UPLIFT_BPS||0),
    durationMs:providerResult.durationMs
  });
  await commitUsageReservation(authorization.reservationId,{actualAmount:1,toolExecutionId:evidence.id});
  return {
    status:providerResult.status==='completed'?'PASS':'HOLD',
    output:providerResult.output,
    outputSha256,
    durationMs:providerResult.durationMs??Math.max(0,Math.round(performance.now()-startedAt)),
    toolExecutionId:evidence.id,usageLedgerId:evidence.usageLedgerId,
    evidence:{
      providerResponseId:providerResult.providerResponseId,providerKey:resolution.selected.providerKey,
      modelKey:providerResult.model,outputPersisted:false,commercialAuthorization:'ALLOW',
      usageReservationId:authorization.reservationId
    }
  };
};

export const invokeStageCapability=async input=>{
  const resolution=await resolveStageCapability(input);
  const db=getRuntimePool();
  const inputSha256=sha256(input.input??null);
  const invocationId=await insertInvocation(resolution,inputSha256,db);
  const startedAt=performance.now();
  try{
    let result;
    if(resolution.capabilityType==='MODEL'){
      result=await invokeModelAdapter({resolution,input:input.input||{},invocationId});
    }else if(resolution.selected.adapterKey==='internal-test'){
      result=await invokeInternalTestAdapter({resolution,input:input.input||{}});
    }else{
      throw errorOf(
        'Capability adapter is not implemented','CAPABILITY_ADAPTER_NOT_IMPLEMENTED',503,
        {capabilityKey:resolution.selected.capabilityKey,adapterKey:resolution.selected.adapterKey}
      );
    }
    const outputSha256=result.outputSha256||sha256(result.output??null);
    const durationMs=result.durationMs??Math.max(0,Math.round(performance.now()-startedAt));
    await finalizeInvocation(invocationId,{
      status:result.status||'PASS',outputSha256,
      outputEvidence:{...(result.evidence||{}),outputPersisted:false},
      toolExecutionId:result.toolExecutionId||null,usageLedgerId:result.usageLedgerId||null,durationMs
    },db);
    return {
      invocation:await getCapabilityInvocation(invocationId),
      resolution,
      output:result.output,
      outputPersisted:false
    };
  }catch(error){
    await finalizeInvocation(invocationId,{
      status:'FAIL',durationMs:Math.max(0,Math.round(performance.now()-startedAt)),
      toolExecutionId:error.toolExecutionId||null,usageLedgerId:error.usageLedgerId||null,
      errorCode:error.code||'CAPABILITY_INVOCATION_ERROR',
      errorCategory:error.errorCategory||'CAPABILITY_RUNTIME',errorMessage:error.message,
      outputEvidence:{outputPersisted:false}
    },db);
    error.details={...(error.details||{}),capabilityInvocationId:invocationId};
    throw error;
  }
};
