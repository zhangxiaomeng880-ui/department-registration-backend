import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const CAPABILITY_TYPES=new Set(['MODEL','TOOL','SKILL','MCP','CONNECTOR','AGENT']);
const CAPABILITY_STATUSES=new Set(['ACTIVE','DISABLED','DEPRECATED']);
const WORKFLOW_STATUSES=new Set(['DRAFT','SPEC_FROZEN','FROZEN','DEPRECATED']);
const ROUTING_MODES=new Set(['FIXED','POLICY','DEFERRED']);
const REQUIREMENT_MODES=new Set(['REQUIRED','OPTIONAL']);
const BINDING_MODES=new Set(['ALLOWED','DEFAULT']);
const secretPattern=/(api[_-]?key|secret|token|password|credential|authorization)/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableValue(value[k])]));
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?path+'.'+key:key;
      if(secretPattern.test(key)) throw errorOf(
        'Core Meta Registry must not persist secrets or credentials',
        'CORE_META_SECRET_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};
const normalizeProjectType=row=>({
  projectTypeKey:row.project_type_key,displayName:row.display_name,domainKey:row.domain_key||null,
  status:row.status,metadata:parseJson(row.metadata_json),createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeCapability=row=>({
  capabilityKey:row.capability_key,capabilityType:row.capability_type,displayName:row.display_name,
  version:row.version,status:row.status,routable:Boolean(row.routable),adapterKey:row.adapter_key||null,
  inputContract:parseJson(row.input_contract_json),outputContract:parseJson(row.output_contract_json),
  capabilities:parseJson(row.capabilities_json),policyTags:parseJson(row.policy_tags_json),
  metadata:parseJson(row.metadata_json),createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeWorkflow=row=>({
  id:row.id,projectTypeKey:row.project_type_key,templateKey:row.template_key,version:row.version,
  displayName:row.display_name,description:row.description||null,
  templateClass:row.template_class||'CUSTOM',status:row.status,
  executionReadiness:row.execution_readiness||(
    row.status==='FROZEN'?'EXECUTION_READY':row.status==='SPEC_FROZEN'?'SPEC_ONLY':'BUILDING'
  ),
  sourceSpecKey:row.source_spec_key||null,sourceSpecVersion:row.source_spec_version||null,
  definitionSha256:row.definition_sha256||null,metadata:parseJson(row.metadata_json),
  createdAt:row.created_at,frozenAt:row.frozen_at||null,updatedAt:row.updated_at
});
const normalizeMilestone=row=>({
  id:row.id,workflowTemplateId:row.workflow_template_id,milestoneKey:row.milestone_key,
  displayName:row.display_name,sequenceNo:Number(row.sequence_no),
  acceptance:parseJson(row.acceptance_json),metadata:parseJson(row.metadata_json)
});
const normalizeStage=row=>({
  id:row.id,workflowTemplateId:row.workflow_template_id,milestoneTemplateId:row.milestone_template_id||null,
  stageKey:row.stage_key,displayName:row.display_name,stageType:row.stage_type,
  sequenceNo:Number(row.sequence_no),defaultAgentCapabilityKey:row.default_agent_capability_key||null,
  gatePolicyKey:row.gate_policy_key||null,config:parseJson(row.config_json)
});
const normalizeRequirement=row=>({
  id:row.id,workflowStageId:row.workflow_stage_id,requirementKey:row.requirement_key,
  capabilityType:row.capability_type,capabilityKey:row.capability_key||null,routingMode:row.routing_mode,
  requirementMode:row.requirement_mode,priority:Number(row.priority),constraints:parseJson(row.constraints_json)
});
const normalizeKnowledgePolicy=row=>({
  id:row.id,workflowStageId:row.workflow_stage_id,policyKey:row.policy_key,sourceKey:row.source_key,
  queryTemplate:row.query_template,contextRole:row.context_role,required:Boolean(row.required),
  maxItems:Number(row.max_items),allowedStatuses:parseJson(row.allowed_statuses_json)||[],
  injectionMode:row.injection_mode,writebackMode:row.writeback_mode,
  writebackTargetPath:row.writeback_target_path||null,config:parseJson(row.config_json)
});
const normalizeStageAgentAssignment=row=>({
  id:row.id,workflowStageId:row.workflow_stage_id,agentCapabilityKey:row.agent_capability_key,
  assignmentRole:row.assignment_role,priority:Number(row.priority),
  conditional:parseJson(row.conditional_json)
});
const normalizeStageGateContract=row=>({
  id:row.id,workflowStageId:row.workflow_stage_id,gateKey:row.gate_key,
  gateRole:row.gate_role,required:Boolean(row.required),aggregationMode:row.aggregation_mode,
  sequenceNo:Number(row.sequence_no),appliesWhen:parseJson(row.applies_when_json),
  contract:parseJson(row.contract_json)
});

export const upsertProjectType=async input=>{
  if(!input?.projectTypeKey||!input?.displayName) throw errorOf(
    'projectTypeKey and displayName are required','INVALID_PROJECT_TYPE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO project_type_registry
      (project_type_key,display_name,domain_key,status,metadata_json)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       display_name=VALUES(display_name),domain_key=VALUES(domain_key),
       status=VALUES(status),metadata_json=VALUES(metadata_json)`,
    [input.projectTypeKey,input.displayName,input.domainKey||null,input.status||'ACTIVE',asJson(input.metadata||null)]
  );
  const [rows]=await db.execute('SELECT * FROM project_type_registry WHERE project_type_key=?',[input.projectTypeKey]);
  return normalizeProjectType(rows[0]);
};

export const listProjectTypes=async({status=null}={})=>{
  const db=getRuntimePool();
  const [rows]=status
    ? await db.execute('SELECT * FROM project_type_registry WHERE status=? ORDER BY project_type_key',[status])
    : await db.execute('SELECT * FROM project_type_registry ORDER BY project_type_key');
  return rows.map(normalizeProjectType);
};

export const upsertCapability=async input=>{
  if(!input?.capabilityKey||!input?.capabilityType||!input?.displayName) throw errorOf(
    'capabilityKey, capabilityType and displayName are required','INVALID_CAPABILITY'
  );
  rejectSecrets(input);
  const type=String(input.capabilityType).toUpperCase();
  const status=String(input.status||'ACTIVE').toUpperCase();
  if(!CAPABILITY_TYPES.has(type)) throw errorOf('Unsupported capabilityType','INVALID_CAPABILITY_TYPE');
  if(!CAPABILITY_STATUSES.has(status)) throw errorOf('Unsupported capability status','INVALID_CAPABILITY_STATUS');
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO capability_registry
      (capability_key,capability_type,display_name,version,status,routable,adapter_key,
       input_contract_json,output_contract_json,capabilities_json,policy_tags_json,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       capability_type=VALUES(capability_type),display_name=VALUES(display_name),
       version=VALUES(version),status=VALUES(status),routable=VALUES(routable),
       adapter_key=VALUES(adapter_key),input_contract_json=VALUES(input_contract_json),
       output_contract_json=VALUES(output_contract_json),capabilities_json=VALUES(capabilities_json),
       policy_tags_json=VALUES(policy_tags_json),metadata_json=VALUES(metadata_json)`,
    [
      input.capabilityKey,type,input.displayName,input.version||'1',status,input.routable===false?0:1,
      input.adapterKey||null,asJson(input.inputContract||null),asJson(input.outputContract||null),
      asJson(input.capabilities||null),asJson(input.policyTags||null),asJson(input.metadata||null)
    ]
  );
  const [rows]=await db.execute('SELECT * FROM capability_registry WHERE capability_key=?',[input.capabilityKey]);
  return normalizeCapability(rows[0]);
};

export const listCapabilities=async({capabilityType=null,status=null,routable=null}={})=>{
  const db=getRuntimePool(),where=[],params=[];
  if(capabilityType){where.push('capability_type=?');params.push(String(capabilityType).toUpperCase());}
  if(status){where.push('status=?');params.push(String(status).toUpperCase());}
  if(routable!=null){where.push('routable=?');params.push(routable?1:0);}
  const [rows]=await db.execute(
    `SELECT * FROM capability_registry ${where.length?'WHERE '+where.join(' AND '):''}
     ORDER BY capability_type,capability_key`,params
  );
  return rows.map(normalizeCapability);
};

export const syncModelCapability=async(providerKey,modelKey)=>{
  if(!providerKey||!modelKey) throw errorOf('providerKey and modelKey are required','INVALID_MODEL_CAPABILITY');
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT m.*,p.adapter_key,p.enabled AS provider_enabled
       FROM model_registry m JOIN provider_registry p ON p.provider_key=m.provider_key
      WHERE m.provider_key=? AND m.model_key=?`,
    [providerKey,modelKey]
  );
  if(!rows.length) throw errorOf('Model registry entry not found','MODEL_NOT_FOUND',404);
  const row=rows[0],capabilityKey=`MODEL:${providerKey}:${modelKey}`;
  const capability=await upsertCapability({
    capabilityKey,capabilityType:'MODEL',displayName:row.display_name,version:'model-registry-v1',
    status:Boolean(row.enabled)&&Boolean(row.provider_enabled)?'ACTIVE':'DISABLED',
    routable:true,adapterKey:row.adapter_key,capabilities:parseJson(row.capabilities_json),
    metadata:{system:true,source:'model_registry',providerKey,modelKey}
  });
  await db.execute(
    `INSERT INTO model_capability_bindings (capability_key,provider_key,model_key)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE provider_key=VALUES(provider_key),model_key=VALUES(model_key)`,
    [capabilityKey,providerKey,modelKey]
  );
  return capability;
};

const assertCapabilityType=async(capabilityKey,expectedType,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT capability_type,status FROM capability_registry WHERE capability_key=?',[capabilityKey]
  );
  if(!rows.length) throw errorOf('Capability not found','CAPABILITY_NOT_FOUND',404,{capabilityKey});
  if(expectedType&&rows[0].capability_type!==expectedType) throw errorOf(
    'Capability type does not match expected type','CAPABILITY_TYPE_MISMATCH',409,
    {capabilityKey,expectedType,actualType:rows[0].capability_type}
  );
  return rows[0];
};

export const upsertAgentProfile=async input=>{
  if(!input?.capabilityKey||!input?.roleKey) throw errorOf(
    'capabilityKey and roleKey are required','INVALID_AGENT_PROFILE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  await assertCapabilityType(input.capabilityKey,'AGENT',db);
  await db.execute(
    `INSERT INTO agent_profiles
      (capability_key,role_key,policy_mode,knowledge_scope_json,config_json)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_key=VALUES(role_key),policy_mode=VALUES(policy_mode),
       knowledge_scope_json=VALUES(knowledge_scope_json),config_json=VALUES(config_json)`,
    [input.capabilityKey,input.roleKey,input.policyMode||null,asJson(input.knowledgeScope||null),asJson(input.config||null)]
  );
  return {
    capabilityKey:input.capabilityKey,roleKey:input.roleKey,policyMode:input.policyMode||null,
    knowledgeScope:input.knowledgeScope||null,config:input.config||null
  };
};

export const grantAgentCapability=async input=>{
  if(!input?.agentCapabilityKey||!input?.childCapabilityKey) throw errorOf(
    'agentCapabilityKey and childCapabilityKey are required','INVALID_AGENT_CAPABILITY_GRANT'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  await assertCapabilityType(input.agentCapabilityKey,'AGENT',db);
  await assertCapabilityType(input.childCapabilityKey,null,db);
  await db.execute(
    `INSERT INTO agent_capability_grants
      (agent_capability_key,child_capability_key,requirement_mode,priority,constraints_json)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE requirement_mode=VALUES(requirement_mode),
       priority=VALUES(priority),constraints_json=VALUES(constraints_json)`,
    [input.agentCapabilityKey,input.childCapabilityKey,input.requirementMode||'ALLOWED',
     Number(input.priority??100),asJson(input.constraints||null)]
  );
  return {
    agentCapabilityKey:input.agentCapabilityKey,childCapabilityKey:input.childCapabilityKey,
    requirementMode:input.requirementMode||'ALLOWED',priority:Number(input.priority??100),
    constraints:input.constraints||null
  };
};

export const bindProjectTypeCapability=async input=>{
  if(!input?.projectTypeKey||!input?.capabilityKey) throw errorOf(
    'projectTypeKey and capabilityKey are required','INVALID_PROJECT_TYPE_CAPABILITY_BINDING'
  );
  rejectSecrets(input);
  const mode=String(input.bindingMode||'ALLOWED').toUpperCase();
  if(!BINDING_MODES.has(mode)) throw errorOf('Unsupported bindingMode','INVALID_CAPABILITY_BINDING_MODE');
  const db=getRuntimePool();
  const [types]=await db.execute('SELECT project_type_key FROM project_type_registry WHERE project_type_key=?',[input.projectTypeKey]);
  if(!types.length) throw errorOf('Project type not found','PROJECT_TYPE_NOT_FOUND',404);
  await assertCapabilityType(input.capabilityKey,null,db);
  await db.execute(
    `INSERT INTO project_type_capability_bindings
      (project_type_key,capability_key,binding_mode,priority,constraints_json)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE binding_mode=VALUES(binding_mode),
       priority=VALUES(priority),constraints_json=VALUES(constraints_json)`,
    [input.projectTypeKey,input.capabilityKey,mode,Number(input.priority??100),asJson(input.constraints||null)]
  );
  return {
    projectTypeKey:input.projectTypeKey,capabilityKey:input.capabilityKey,bindingMode:mode,
    priority:Number(input.priority??100),constraints:input.constraints||null
  };
};

export const createWorkflowTemplate=async input=>{
  if(!input?.projectTypeKey||!input?.templateKey||!input?.version||!input?.displayName) throw errorOf(
    'projectTypeKey, templateKey, version and displayName are required','INVALID_WORKFLOW_TEMPLATE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  const [types]=await db.execute(
    'SELECT project_type_key,status FROM project_type_registry WHERE project_type_key=?',[input.projectTypeKey]
  );
  if(!types.length) throw errorOf('Project type not found','PROJECT_TYPE_NOT_FOUND',404);
  if(types[0].status!=='ACTIVE') throw errorOf('Project type is not active','PROJECT_TYPE_NOT_ACTIVE',409);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO workflow_templates
      (id,project_type_key,template_key,version,display_name,description,template_class,status,
       execution_readiness,source_spec_key,source_spec_version,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,input.projectTypeKey,input.templateKey,input.version,input.displayName,input.description||null,
     input.templateClass||'CUSTOM',input.status||'DRAFT',input.executionReadiness||'BUILDING',
     input.sourceSpecKey||null,input.sourceSpecVersion||null,asJson(input.metadata||null)]
  );
  const [rows]=await db.execute('SELECT * FROM workflow_templates WHERE id=?',[id]);
  return normalizeWorkflow(rows[0]);
};

const assertWorkflowDraft=async(templateId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM workflow_templates WHERE id=?',[templateId]);
  if(!rows.length) throw errorOf('Workflow template not found','WORKFLOW_TEMPLATE_NOT_FOUND',404);
  if(rows[0].status!=='DRAFT') throw errorOf('Frozen workflow template is immutable','WORKFLOW_TEMPLATE_IMMUTABLE',409);
  return rows[0];
};

export const addWorkflowMilestone=async(templateId,input)=>{
  if(!input?.milestoneKey||!input?.displayName||input.sequenceNo==null) throw errorOf(
    'milestoneKey, displayName and sequenceNo are required','INVALID_WORKFLOW_MILESTONE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  await assertWorkflowDraft(templateId,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO workflow_template_milestones
      (id,workflow_template_id,milestone_key,display_name,sequence_no,acceptance_json,metadata_json)
     VALUES (?,?,?,?,?,?,?)`,
    [id,templateId,input.milestoneKey,input.displayName,Number(input.sequenceNo),
     asJson(input.acceptance||null),asJson(input.metadata||null)]
  );
  const [rows]=await db.execute('SELECT * FROM workflow_template_milestones WHERE id=?',[id]);
  return normalizeMilestone(rows[0]);
};

export const addWorkflowStage=async(templateId,input)=>{
  if(!input?.stageKey||!input?.displayName||input.sequenceNo==null) throw errorOf(
    'stageKey, displayName and sequenceNo are required','INVALID_WORKFLOW_STAGE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  await assertWorkflowDraft(templateId,db);
  if(input.milestoneTemplateId){
    const [milestones]=await db.execute(
      'SELECT id FROM workflow_template_milestones WHERE id=? AND workflow_template_id=?',
      [input.milestoneTemplateId,templateId]
    );
    if(!milestones.length) throw errorOf('Milestone does not belong to workflow template','WORKFLOW_MILESTONE_MISMATCH',409);
  }
  if(input.defaultAgentCapabilityKey) await assertCapabilityType(input.defaultAgentCapabilityKey,'AGENT',db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO workflow_template_stages
      (id,workflow_template_id,milestone_template_id,stage_key,display_name,stage_type,
       sequence_no,default_agent_capability_key,gate_policy_key,config_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id,templateId,input.milestoneTemplateId||null,input.stageKey,input.displayName,input.stageType||'EXECUTION',
     Number(input.sequenceNo),input.defaultAgentCapabilityKey||null,input.gatePolicyKey||null,asJson(input.config||null)]
  );
  const [rows]=await db.execute('SELECT * FROM workflow_template_stages WHERE id=?',[id]);
  return normalizeStage(rows[0]);
};

export const addStageCapabilityRequirement=async(stageId,input)=>{
  if(!input?.requirementKey||!input?.capabilityType) throw errorOf(
    'requirementKey and capabilityType are required','INVALID_STAGE_CAPABILITY_REQUIREMENT'
  );
  rejectSecrets(input);
  const type=String(input.capabilityType).toUpperCase();
  const routingMode=String(input.routingMode||'POLICY').toUpperCase();
  const requirementMode=String(input.requirementMode||'REQUIRED').toUpperCase();
  if(!CAPABILITY_TYPES.has(type)) throw errorOf('Unsupported capabilityType','INVALID_CAPABILITY_TYPE');
  if(!ROUTING_MODES.has(routingMode)) throw errorOf('Unsupported routingMode','INVALID_ROUTING_MODE');
  if(!REQUIREMENT_MODES.has(requirementMode)) throw errorOf('Unsupported requirementMode','INVALID_REQUIREMENT_MODE');
  if(routingMode==='FIXED'&&!input.capabilityKey) throw errorOf(
    'FIXED routing requires capabilityKey','FIXED_CAPABILITY_REQUIRED'
  );
  const db=getRuntimePool();
  const [stages]=await db.execute(
    `SELECT s.id,t.status AS template_status FROM workflow_template_stages s
       JOIN workflow_templates t ON t.id=s.workflow_template_id WHERE s.id=?`,[stageId]
  );
  if(!stages.length) throw errorOf('Workflow stage not found','WORKFLOW_STAGE_NOT_FOUND',404);
  if(stages[0].template_status!=='DRAFT') throw errorOf('Frozen workflow template is immutable','WORKFLOW_TEMPLATE_IMMUTABLE',409);
  if(input.capabilityKey) await assertCapabilityType(input.capabilityKey,type,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO stage_capability_requirements
      (id,workflow_stage_id,requirement_key,capability_type,capability_key,routing_mode,
       requirement_mode,priority,constraints_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,stageId,input.requirementKey,type,input.capabilityKey||null,routingMode,requirementMode,
     Number(input.priority??100),asJson(input.constraints||null)]
  );
  const [rows]=await db.execute('SELECT * FROM stage_capability_requirements WHERE id=?',[id]);
  return normalizeRequirement(rows[0]);
};

export const addStageKnowledgePolicy=async(stageId,input)=>{
  if(!input?.policyKey||!input?.sourceKey||!input?.queryTemplate) throw errorOf(
    'policyKey, sourceKey and queryTemplate are required','INVALID_STAGE_KNOWLEDGE_POLICY'
  );
  rejectSecrets(input);
  const allowedStatuses=Array.isArray(input.allowedStatuses)&&input.allowedStatuses.length
    ? input.allowedStatuses.map(value=>String(value).toUpperCase())
    : ['CURRENT','FACT','RULE','FINAL'];
  const executableStatuses=new Set(['CURRENT','FACT','RULE','FINAL']);
  if(allowedStatuses.some(status=>!executableStatuses.has(status))) throw errorOf(
    'Stage knowledge policy contains a source status that is not allowed for automatic execution',
    'KNOWLEDGE_POLICY_STATUS_NOT_EXECUTABLE',409,{allowedStatuses}
  );
  const injectionMode=String(input.injectionMode||'APPEND_CONTEXT').toUpperCase();
  const writebackMode=String(input.writebackMode||'NONE').toUpperCase();
  if(!['APPEND_CONTEXT','STRUCTURED_CONTEXT'].includes(injectionMode)) throw errorOf(
    'Unsupported knowledge injectionMode','INVALID_KNOWLEDGE_INJECTION_MODE'
  );
  if(!['NONE','PROPOSE'].includes(writebackMode)) throw errorOf(
    'Unsupported knowledge writebackMode','INVALID_KNOWLEDGE_WRITEBACK_MODE'
  );
  const db=getRuntimePool();
  const [stages]=await db.execute(
    `SELECT s.id,t.status AS template_status FROM workflow_template_stages s
       JOIN workflow_templates t ON t.id=s.workflow_template_id WHERE s.id=?`,[stageId]
  );
  if(!stages.length) throw errorOf('Workflow stage not found','WORKFLOW_STAGE_NOT_FOUND',404);
  if(stages[0].template_status!=='DRAFT') throw errorOf(
    'Frozen workflow template is immutable','WORKFLOW_TEMPLATE_IMMUTABLE',409
  );
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO stage_knowledge_policies
      (id,workflow_stage_id,policy_key,source_key,query_template,context_role,required,max_items,
       allowed_statuses_json,injection_mode,writeback_mode,writeback_target_path,config_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,stageId,input.policyKey,input.sourceKey,input.queryTemplate,input.contextRole||'REFERENCE',
      input.required===false?0:1,Math.max(1,Math.min(24,Number(input.maxItems)||12)),
      asJson(allowedStatuses),injectionMode,writebackMode,input.writebackTargetPath||null,
      asJson(input.config||null)
    ]
  );
  const [rows]=await db.execute('SELECT * FROM stage_knowledge_policies WHERE id=?',[id]);
  return normalizeKnowledgePolicy(rows[0]);
};

export const addStageAgentAssignment=async(stageId,input)=>{
  if(!input?.agentCapabilityKey||!input?.assignmentRole) throw errorOf(
    'agentCapabilityKey and assignmentRole are required','INVALID_STAGE_AGENT_ASSIGNMENT'
  );
  const role=String(input.assignmentRole).toUpperCase();
  if(!['PRIMARY','SUPPORTING'].includes(role)) throw errorOf(
    'assignmentRole must be PRIMARY or SUPPORTING','INVALID_STAGE_AGENT_ROLE'
  );
  rejectSecrets(input);
  const db=getRuntimePool();
  const [stages]=await db.execute(
    `SELECT s.id,t.status AS template_status FROM workflow_template_stages s
       JOIN workflow_templates t ON t.id=s.workflow_template_id WHERE s.id=?`,[stageId]
  );
  if(!stages.length) throw errorOf('Workflow stage not found','WORKFLOW_STAGE_NOT_FOUND',404);
  if(stages[0].template_status!=='DRAFT') throw errorOf(
    'Frozen workflow template is immutable','WORKFLOW_TEMPLATE_IMMUTABLE',409
  );
  await assertCapabilityType(input.agentCapabilityKey,'AGENT',db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO stage_agent_assignments
      (id,workflow_stage_id,agent_capability_key,assignment_role,priority,conditional_json)
     VALUES (?,?,?,?,?,?)`,
    [id,stageId,input.agentCapabilityKey,role,Number(input.priority??100),asJson(input.conditional||null)]
  );
  const [rows]=await db.execute('SELECT * FROM stage_agent_assignments WHERE id=?',[id]);
  return normalizeStageAgentAssignment(rows[0]);
};

export const addStageGateContract=async(stageId,input)=>{
  if(!input?.gateKey) throw errorOf('gateKey is required','INVALID_STAGE_GATE_CONTRACT');
  rejectSecrets(input);
  const db=getRuntimePool();
  const [stages]=await db.execute(
    `SELECT s.id,t.status AS template_status FROM workflow_template_stages s
       JOIN workflow_templates t ON t.id=s.workflow_template_id WHERE s.id=?`,[stageId]
  );
  if(!stages.length) throw errorOf('Workflow stage not found','WORKFLOW_STAGE_NOT_FOUND',404);
  if(stages[0].template_status!=='DRAFT') throw errorOf(
    'Frozen workflow template is immutable','WORKFLOW_TEMPLATE_IMMUTABLE',409
  );
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO stage_gate_contracts
      (id,workflow_stage_id,gate_key,gate_role,required,aggregation_mode,sequence_no,
       applies_when_json,contract_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,stageId,input.gateKey,input.gateRole||'PRIMARY',input.required===false?0:1,
      input.aggregationMode||'ALL_REQUIRED_PASS',Number(input.sequenceNo??1),
      asJson(input.appliesWhen||null),asJson(input.contract||null)
    ]
  );
  const [rows]=await db.execute('SELECT * FROM stage_gate_contracts WHERE id=?',[id]);
  return normalizeStageGateContract(rows[0]);
};

export const listWorkflowTemplates=async({projectTypeKey=null,status=null,templateClass=null}={})=>{
  const db=getRuntimePool(),where=[],params=[];
  if(projectTypeKey){where.push('project_type_key=?');params.push(projectTypeKey);}
  if(status){where.push('status=?');params.push(status);}
  if(templateClass){where.push('template_class=?');params.push(templateClass);}
  const [rows]=await db.execute(
    `SELECT * FROM workflow_templates ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY project_type_key,template_key,version`,params
  );
  return rows.map(normalizeWorkflow);
};

export const getWorkflowTemplate=async templateId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM workflow_templates WHERE id=?',[templateId]);
  if(!rows.length) throw errorOf('Workflow template not found','WORKFLOW_TEMPLATE_NOT_FOUND',404);
  const [milestoneRows]=await db.execute(
    'SELECT * FROM workflow_template_milestones WHERE workflow_template_id=? ORDER BY sequence_no,id',[templateId]
  );
  const [stageRows]=await db.execute(
    'SELECT * FROM workflow_template_stages WHERE workflow_template_id=? ORDER BY sequence_no,id',[templateId]
  );
  const stageIds=stageRows.map(x=>x.id);
  let requirementRows=[],knowledgePolicyRows=[],agentAssignmentRows=[],gateContractRows=[];
  if(stageIds.length){
    const placeholders=stageIds.map(()=>'?').join(',');
    [requirementRows]=await db.execute(
      `SELECT * FROM stage_capability_requirements WHERE workflow_stage_id IN (${placeholders})
       ORDER BY workflow_stage_id,priority,requirement_key`,stageIds
    );
    [knowledgePolicyRows]=await db.execute(
      `SELECT * FROM stage_knowledge_policies WHERE workflow_stage_id IN (${placeholders})
       ORDER BY workflow_stage_id,policy_key`,stageIds
    );
    [agentAssignmentRows]=await db.execute(
      `SELECT * FROM stage_agent_assignments WHERE workflow_stage_id IN (${placeholders})
       ORDER BY workflow_stage_id,
         CASE assignment_role WHEN 'PRIMARY' THEN 0 ELSE 1 END,priority,agent_capability_key`,stageIds
    );
    [gateContractRows]=await db.execute(
      `SELECT * FROM stage_gate_contracts WHERE workflow_stage_id IN (${placeholders})
       ORDER BY workflow_stage_id,sequence_no,gate_key`,stageIds
    );
  }
  const byStage=new Map(),knowledgeByStage=new Map(),agentsByStage=new Map(),gatesByStage=new Map();
  for(const row of requirementRows){
    if(!byStage.has(row.workflow_stage_id)) byStage.set(row.workflow_stage_id,[]);
    byStage.get(row.workflow_stage_id).push(normalizeRequirement(row));
  }
  for(const row of knowledgePolicyRows){
    if(!knowledgeByStage.has(row.workflow_stage_id)) knowledgeByStage.set(row.workflow_stage_id,[]);
    knowledgeByStage.get(row.workflow_stage_id).push(normalizeKnowledgePolicy(row));
  }
  for(const row of agentAssignmentRows){
    if(!agentsByStage.has(row.workflow_stage_id)) agentsByStage.set(row.workflow_stage_id,[]);
    agentsByStage.get(row.workflow_stage_id).push(normalizeStageAgentAssignment(row));
  }
  for(const row of gateContractRows){
    if(!gatesByStage.has(row.workflow_stage_id)) gatesByStage.set(row.workflow_stage_id,[]);
    gatesByStage.get(row.workflow_stage_id).push(normalizeStageGateContract(row));
  }
  return {
    ...normalizeWorkflow(rows[0]),
    milestones:milestoneRows.map(normalizeMilestone),
    stages:stageRows.map(row=>({
      ...normalizeStage(row),
      agentAssignments:agentsByStage.get(row.id)||[],
      gateContracts:gatesByStage.get(row.id)||[],
      requirements:byStage.get(row.id)||[],
      knowledgePolicies:knowledgeByStage.get(row.id)||[]
    }))
  };
};

export const freezeWorkflowTemplate=async templateId=>{
  const db=getRuntimePool();
  await assertWorkflowDraft(templateId,db);
  const definition=await getWorkflowTemplate(templateId);
  if(!definition.stages.length) throw errorOf('Workflow template requires at least one stage','WORKFLOW_TEMPLATE_EMPTY',409);

  const [bindingRows]=await db.execute(
    `SELECT b.capability_key,c.capability_type,c.status,c.routable
       FROM project_type_capability_bindings b
       JOIN capability_registry c ON c.capability_key=b.capability_key
      WHERE b.project_type_key=? AND b.binding_mode IN ('ALLOWED','DEFAULT')`,
    [definition.projectTypeKey]
  );
  const projectBindings=new Map(bindingRows.map(row=>[row.capability_key,row]));

  for(const stage of definition.stages){
    if(stage.defaultAgentCapabilityKey){
      await assertCapabilityType(stage.defaultAgentCapabilityKey,'AGENT',db);
      if(!projectBindings.has(stage.defaultAgentCapabilityKey)) throw errorOf(
        'Stage default Agent is not allowed for project type','WORKFLOW_AGENT_NOT_ALLOWED',409,
        {stageKey:stage.stageKey,agentCapabilityKey:stage.defaultAgentCapabilityKey,projectTypeKey:definition.projectTypeKey}
      );
    }
    for(const requirement of stage.requirements){
      if(requirement.capabilityKey){
        await assertCapabilityType(requirement.capabilityKey,requirement.capabilityType,db);
        if(!projectBindings.has(requirement.capabilityKey)) throw errorOf(
          'Fixed stage capability is not allowed for project type','WORKFLOW_CAPABILITY_NOT_ALLOWED',409,
          {stageKey:stage.stageKey,requirementKey:requirement.requirementKey,capabilityKey:requirement.capabilityKey}
        );
        if(stage.defaultAgentCapabilityKey){
          const [grants]=await db.execute(
            `SELECT 1 FROM agent_capability_grants
              WHERE agent_capability_key=? AND child_capability_key=? LIMIT 1`,
            [stage.defaultAgentCapabilityKey,requirement.capabilityKey]
          );
          if(!grants.length) throw errorOf(
            'Stage Agent is not granted the fixed capability','WORKFLOW_AGENT_CAPABILITY_NOT_GRANTED',409,
            {stageKey:stage.stageKey,requirementKey:requirement.requirementKey,capabilityKey:requirement.capabilityKey}
          );
        }
      }else if(requirement.routingMode==='POLICY'){
        let sql=`SELECT c.capability_key
                    FROM project_type_capability_bindings b
                    JOIN capability_registry c ON c.capability_key=b.capability_key`;
        const params=[];
        if(stage.defaultAgentCapabilityKey){
          sql+=` JOIN agent_capability_grants g
                    ON g.child_capability_key=c.capability_key AND g.agent_capability_key=?`;
          params.push(stage.defaultAgentCapabilityKey);
        }
        sql+=` WHERE b.project_type_key=? AND c.capability_type=?
                  AND b.binding_mode IN ('ALLOWED','DEFAULT')
                  AND c.status='ACTIVE' AND c.routable=TRUE
                ORDER BY b.priority,c.capability_key LIMIT 1`;
        params.push(definition.projectTypeKey,requirement.capabilityType);
        const [candidates]=await db.execute(sql,params);
        if(!candidates.length) throw errorOf(
          'Policy-routed stage capability has no allowed candidate','WORKFLOW_CAPABILITY_UNRESOLVED',409,
          {stageKey:stage.stageKey,requirementKey:requirement.requirementKey,capabilityType:requirement.capabilityType}
        );
      }
    }
  }
  const milestoneKeyById=new Map(definition.milestones.map(x=>[x.id,x.milestoneKey]));
  const hashMaterial={
    projectTypeKey:definition.projectTypeKey,templateKey:definition.templateKey,version:definition.version,
    milestones:definition.milestones.map(x=>({
      milestoneKey:x.milestoneKey,displayName:x.displayName,sequenceNo:x.sequenceNo,acceptance:x.acceptance
    })),
    stages:definition.stages.map(x=>({
      stageKey:x.stageKey,displayName:x.displayName,stageType:x.stageType,sequenceNo:x.sequenceNo,
      milestoneKey:x.milestoneTemplateId?milestoneKeyById.get(x.milestoneTemplateId)||null:null,
      defaultAgentCapabilityKey:x.defaultAgentCapabilityKey,
      gatePolicyKey:x.gatePolicyKey,config:x.config,
      agentAssignments:(x.agentAssignments||[]).map(a=>({
        agentCapabilityKey:a.agentCapabilityKey,assignmentRole:a.assignmentRole,
        priority:a.priority,conditional:a.conditional
      })),
      gateContracts:(x.gateContracts||[]).map(g=>({
        gateKey:g.gateKey,gateRole:g.gateRole,required:g.required,
        aggregationMode:g.aggregationMode,sequenceNo:g.sequenceNo,
        appliesWhen:g.appliesWhen,contract:g.contract
      })),
      requirements:x.requirements.map(r=>({
        requirementKey:r.requirementKey,capabilityType:r.capabilityType,capabilityKey:r.capabilityKey,
        routingMode:r.routingMode,requirementMode:r.requirementMode,priority:r.priority,constraints:r.constraints
      })),
      knowledgePolicies:(x.knowledgePolicies||[]).map(k=>({
        policyKey:k.policyKey,sourceKey:k.sourceKey,queryTemplate:k.queryTemplate,contextRole:k.contextRole,
        required:k.required,maxItems:k.maxItems,allowedStatuses:k.allowedStatuses,
        injectionMode:k.injectionMode,writebackMode:k.writebackMode,
        writebackTargetPath:k.writebackTargetPath,config:k.config
      }))
    }))
  };
  const definitionSha256=sha256(hashMaterial);
  await db.execute(
    `UPDATE workflow_templates SET status='FROZEN',execution_readiness='EXECUTION_READY',
      definition_sha256=?,frozen_at=CURRENT_TIMESTAMP(6)
      WHERE id=? AND status='DRAFT'`,
    [definitionSha256,templateId]
  );
  return await getWorkflowTemplate(templateId);
};

export const bindProjectWorkflow=async(projectId,templateId)=>{
  if(!projectId||!templateId) throw errorOf('projectId and templateId are required','INVALID_PROJECT_WORKFLOW_BINDING');
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [projects]=await conn.execute('SELECT * FROM projects WHERE id=? FOR UPDATE',[projectId]);
    if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
    const project=projects[0];
    const [templates]=await conn.execute('SELECT * FROM workflow_templates WHERE id=? FOR UPDATE',[templateId]);
    if(!templates.length) throw errorOf('Workflow template not found','WORKFLOW_TEMPLATE_NOT_FOUND',404);
    const template=templates[0];
    if(template.status!=='FROZEN'||template.execution_readiness!=='EXECUTION_READY') throw errorOf(
      'Project can only bind an execution-ready frozen workflow template',
      'WORKFLOW_TEMPLATE_NOT_EXECUTION_READY',409,
      {status:template.status,executionReadiness:template.execution_readiness}
    );
    if(project.project_type!==template.project_type_key) throw errorOf(
      'Project type does not match workflow template','PROJECT_WORKFLOW_TYPE_MISMATCH',409,
      {projectType:project.project_type,templateProjectType:template.project_type_key}
    );
    if(project.workflow_template_id&&project.workflow_template_id!==templateId) throw errorOf(
      'Project is already bound to another workflow template','PROJECT_WORKFLOW_ALREADY_BOUND',409
    );
    if(project.workflow_template_id===templateId){
      await conn.commit();
      return {...await getProjectLifecycle(projectId),idempotent:true};
    }

    const [milestones]=await conn.execute(
      'SELECT * FROM workflow_template_milestones WHERE workflow_template_id=? ORDER BY sequence_no,id',[templateId]
    );
    const [stages]=await conn.execute(
      'SELECT * FROM workflow_template_stages WHERE workflow_template_id=? ORDER BY sequence_no,id',[templateId]
    );
    if(!stages.length) throw errorOf('Frozen workflow template has no stages','WORKFLOW_TEMPLATE_EMPTY',409);

    const milestoneInstanceByTemplateId=new Map();
    for(const [index,row] of milestones.entries()){
      const id=randomUUID(),isFirst=index===0;
      milestoneInstanceByTemplateId.set(row.id,id);
      await conn.execute(
        `INSERT INTO project_milestones
          (id,project_id,workflow_template_milestone_id,milestone_key,display_name,sequence_no,status,
           acceptance_json,started_at)
         VALUES (?,?,?,?,?,?,?, ?,${isFirst?'CURRENT_TIMESTAMP(6)':'NULL'})`,
        [id,projectId,row.id,row.milestone_key,row.display_name,row.sequence_no,isFirst?'ACTIVE':'PENDING',row.acceptance_json]
      );
    }
    for(const [index,row] of stages.entries()){
      const id=randomUUID(),isFirst=index===0;
      await conn.execute(
        `INSERT INTO project_stage_instances
          (id,project_id,workflow_template_stage_id,milestone_id,stage_key,display_name,sequence_no,status,
           agent_capability_key,gate_policy_key,started_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,${isFirst?'CURRENT_TIMESTAMP(6)':'NULL'})`,
        [id,projectId,row.id,row.milestone_template_id?milestoneInstanceByTemplateId.get(row.milestone_template_id)||null:null,
         row.stage_key,row.display_name,row.sequence_no,isFirst?'ACTIVE':'PENDING',
         row.default_agent_capability_key,row.gate_policy_key]
      );
    }
    await conn.execute(
      `UPDATE projects
          SET workflow_template_id=?,current_workflow_version=?,current_stage_key=?,meta_model_version='core-meta-v1'
        WHERE id=?`,
      [templateId,template.version,stages[0].stage_key,projectId]
    );
    await conn.commit();
    return {...await getProjectLifecycle(projectId),idempotent:false};
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
};

export const getProjectLifecycle=async projectId=>{
  const db=getRuntimePool();
  const [projects]=await db.execute(
    `SELECT p.id,p.project_key,p.name,p.project_type,p.status,p.current_workflow_version,
            p.workflow_template_id,p.current_stage_key,p.meta_model_version,
            t.template_key,t.version AS template_version,t.definition_sha256
       FROM projects p
       LEFT JOIN workflow_templates t ON t.id=p.workflow_template_id
      WHERE p.id=?`,
    [projectId]
  );
  if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  const [milestones]=await db.execute(
    'SELECT * FROM project_milestones WHERE project_id=? ORDER BY sequence_no,id',[projectId]
  );
  const [stages]=await db.execute(
    'SELECT * FROM project_stage_instances WHERE project_id=? ORDER BY sequence_no,id',[projectId]
  );
  return {
    project:{
      id:projects[0].id,projectKey:projects[0].project_key,name:projects[0].name,
      projectType:projects[0].project_type,status:projects[0].status,
      currentWorkflowVersion:projects[0].current_workflow_version||null,
      workflowTemplateId:projects[0].workflow_template_id||null,
      currentStageKey:projects[0].current_stage_key||null,
      metaModelVersion:projects[0].meta_model_version||null
    },
    template:projects[0].workflow_template_id?{
      id:projects[0].workflow_template_id,templateKey:projects[0].template_key,
      version:projects[0].template_version,definitionSha256:projects[0].definition_sha256
    }:null,
    milestones:milestones.map(row=>({
      id:row.id,milestoneKey:row.milestone_key,displayName:row.display_name,sequenceNo:Number(row.sequence_no),
      status:row.status,acceptance:parseJson(row.acceptance_json),state:parseJson(row.state_json),
      startedAt:row.started_at||null,completedAt:row.completed_at||null
    })),
    stages:stages.map(row=>({
      id:row.id,workflowTemplateStageId:row.workflow_template_stage_id,milestoneId:row.milestone_id||null,
      stageKey:row.stage_key,displayName:row.display_name,sequenceNo:Number(row.sequence_no),status:row.status,
      attemptCount:Number(row.attempt_count||0),
      agentCapabilityKey:row.agent_capability_key||null,gatePolicyKey:row.gate_policy_key||null,
      lastGateResultId:row.last_gate_result_id||null,
      lastTransitionType:row.last_transition_type||null,
      blockedReason:row.blocked_reason||null,
      lastTransitionAt:row.last_transition_at||null,
      state:parseJson(row.state_json),startedAt:row.started_at||null,completedAt:row.completed_at||null
    }))
  };
};

export const CORE_META_MODEL_VERSION='core-meta-v1';
