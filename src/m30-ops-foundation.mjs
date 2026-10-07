import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const HEALTH=new Set(['HEALTHY','DEGRADED','DOWN','UNKNOWN']);
const ENV_TYPES=new Set(['DEVELOPMENT','STAGING','PRODUCTION','TEST','PREVIEW']);
const GATE='G-M30-OPS-FOUNDATION';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const asJson=v=>JSON.stringify(v??null);
const parseJson=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const asDate=v=>{const d=v instanceof Date?v:new Date(v);if(Number.isNaN(d.getTime()))throw errorOf('Invalid date','INVALID_DATE');return d;};
const one=async(db,sql,params=[])=>((await db.execute(sql,params))[0][0]||null);
const list=async(db,sql,params=[])=>((await db.execute(sql,params))[0]);
const count=async(db,sql,params=[])=>Number((await db.execute(sql,params))[0][0]?.count||0);
const secretKeyPattern=/(api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;
const secretValuePattern=/^(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/i;

const rejectSecrets=(value,{allowCredentialRef=false}={})=>{
  const visit=(node,path='')=>{
    if(node==null)return;
    if(typeof node==='string'){
      if(secretValuePattern.test(node.trim()))throw errorOf(
        'Operations registry must not persist raw credentials or secrets',
        'M30_RAW_SECRET_NOT_ALLOWED',400,{field:path}
      );
      return;
    }
    if(typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      const next=path?path+'.'+key:key;
      if(secretKeyPattern.test(key)&&!(allowCredentialRef&&key==='credentialRef'))throw errorOf(
        'Operations registry must not persist raw credentials or secrets',
        'M30_RAW_SECRET_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};

const loadWorkspace=async(workspaceId,db=getRuntimePool())=>{
  const w=await one(db,'SELECT id,tenant_id,workspace_key,name,status FROM workspaces WHERE id=?',[workspaceId]);
  if(!w)throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return w;
};

export const resolveM30WorkspaceScope=async workspaceId=>{
  const w=await loadWorkspace(workspaceId);return {tenantId:w.tenant_id,workspaceId:w.id};
};

const normalizeEnvironment=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  environmentKey:row.environment_key,displayName:row.display_name,environmentType:row.environment_type,
  releaseChannel:row.release_channel,providerKey:row.provider_key,externalRef:parseJson(row.external_ref_json),
  healthStatus:row.health_status,status:row.status,metadata:parseJson(row.metadata_json),
  evidence:parseJson(row.evidence_json),lastHealthAt:row.last_health_at,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeConnection=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  connectionKey:row.connection_key,displayName:row.display_name,connectionType:row.connection_type,
  providerKey:row.provider_key,adapterKey:row.adapter_key,credentialRef:row.credential_ref,
  endpointRef:parseJson(row.endpoint_ref_json),capabilityScope:parseJson(row.capability_scope_json),
  healthStatus:row.health_status,status:row.status,metadata:parseJson(row.metadata_json),
  evidence:parseJson(row.evidence_json),lastHealthAt:row.last_health_at,createdAt:row.created_at,updatedAt:row.updated_at
});

export const upsertPlatformEnvironment=async(workspaceId,input={})=>{
  const db=getRuntimePool(),w=await loadWorkspace(workspaceId,db);
  if(!input.environmentKey||!input.displayName||!input.environmentType)
    throw errorOf('environmentKey, displayName and environmentType are required','INVALID_M30_ENVIRONMENT');
  const type=String(input.environmentType).toUpperCase();
  if(!ENV_TYPES.has(type))throw errorOf('Unsupported environmentType','INVALID_M30_ENVIRONMENT_TYPE');
  const health=String(input.healthStatus||'UNKNOWN').toUpperCase();
  if(!HEALTH.has(health))throw errorOf('Invalid healthStatus','INVALID_M30_HEALTH');
  rejectSecrets(input);
  const id=input.id||randomUUID();
  await db.execute(`INSERT INTO platform_environments
    (id,tenant_id,workspace_id,environment_key,display_name,environment_type,release_channel,provider_key,
     external_ref_json,health_status,status,metadata_json,evidence_json,last_health_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),environment_type=VALUES(environment_type),
      release_channel=VALUES(release_channel),provider_key=VALUES(provider_key),external_ref_json=VALUES(external_ref_json),
      status=VALUES(status),metadata_json=VALUES(metadata_json),evidence_json=VALUES(evidence_json)`,
    [id,w.tenant_id,w.id,input.environmentKey,input.displayName,type,input.releaseChannel||null,input.providerKey||null,
     asJson(input.externalRef||{}),health,input.status||'ACTIVE',asJson(input.metadata||{}),asJson(input.evidence||{}),
     input.lastHealthAt?asDate(input.lastHealthAt):null]);
  const row=await one(db,'SELECT * FROM platform_environments WHERE workspace_id=? AND environment_key=?',
    [workspaceId,input.environmentKey]);
  return normalizeEnvironment(row);
};

export const listPlatformEnvironments=async workspaceId=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  return (await list(db,'SELECT * FROM platform_environments WHERE workspace_id=? ORDER BY environment_type,environment_key',[workspaceId]))
    .map(normalizeEnvironment);
};

export const upsertPlatformConnection=async(workspaceId,input={})=>{
  const db=getRuntimePool(),w=await loadWorkspace(workspaceId,db);
  if(!input.connectionKey||!input.displayName||!input.connectionType||!input.adapterKey||!input.credentialRef)
    throw errorOf('connectionKey, displayName, connectionType, adapterKey and credentialRef are required',
      'INVALID_M30_CONNECTION');
  rejectSecrets(input,{allowCredentialRef:true});
  const credentialRef=String(input.credentialRef).trim();
  if(secretValuePattern.test(credentialRef)||credentialRef.length>512)
    throw errorOf('credentialRef must be an indirect reference, not a raw secret','M30_RAW_SECRET_NOT_ALLOWED',400,{field:'credentialRef'});
  const health=String(input.healthStatus||'UNKNOWN').toUpperCase();
  if(!HEALTH.has(health))throw errorOf('Invalid healthStatus','INVALID_M30_HEALTH');
  const id=input.id||randomUUID();
  await db.execute(`INSERT INTO platform_connections
    (id,tenant_id,workspace_id,connection_key,display_name,connection_type,provider_key,adapter_key,
     credential_ref,endpoint_ref_json,capability_scope_json,health_status,status,metadata_json,evidence_json,last_health_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),connection_type=VALUES(connection_type),
      provider_key=VALUES(provider_key),adapter_key=VALUES(adapter_key),credential_ref=VALUES(credential_ref),
      endpoint_ref_json=VALUES(endpoint_ref_json),capability_scope_json=VALUES(capability_scope_json),
      status=VALUES(status),metadata_json=VALUES(metadata_json),evidence_json=VALUES(evidence_json)`,
    [id,w.tenant_id,w.id,input.connectionKey,input.displayName,String(input.connectionType).toUpperCase(),
     input.providerKey||null,input.adapterKey,credentialRef,asJson(input.endpointRef||{}),
     asJson(input.capabilityScope||{}),health,input.status||'ACTIVE',asJson(input.metadata||{}),
     asJson(input.evidence||{}),input.lastHealthAt?asDate(input.lastHealthAt):null]);
  const row=await one(db,'SELECT * FROM platform_connections WHERE workspace_id=? AND connection_key=?',
    [workspaceId,input.connectionKey]);
  return normalizeConnection(row);
};

export const listPlatformConnections=async workspaceId=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  return (await list(db,'SELECT * FROM platform_connections WHERE workspace_id=? ORDER BY connection_type,connection_key',[workspaceId]))
    .map(normalizeConnection);
};

export const recordPlatformHealth=async(subjectType,subjectId,input={})=>{
  const type=String(subjectType||'').toUpperCase();
  if(!['ENVIRONMENT','CONNECTION'].includes(type))throw errorOf('Unsupported health subject','M30_HEALTH_SUBJECT_INVALID');
  const health=String(input.healthStatus||'').toUpperCase();
  if(!HEALTH.has(health))throw errorOf('Invalid healthStatus','INVALID_M30_HEALTH');
  if(!input.source||!input.evidence)throw errorOf('source and evidence are required','INVALID_M30_HEALTH_EVENT');
  rejectSecrets(input);
  const db=getRuntimePool();
  const table=type==='ENVIRONMENT'?'platform_environments':'platform_connections';
  const row=await one(db,`SELECT * FROM ${table} WHERE id=?`,[subjectId]);
  if(!row)throw errorOf('Health subject not found','M30_HEALTH_SUBJECT_NOT_FOUND',404);
  const observedAt=input.observedAt?asDate(input.observedAt):new Date();
  const id=randomUUID();
  await db.execute(`INSERT INTO platform_health_events
    (id,tenant_id,workspace_id,subject_type,subject_id,previous_status,health_status,reason_code,latency_ms,
     observed_at,source,evidence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,row.tenant_id,row.workspace_id,type,subjectId,row.health_status,health,input.reasonCode||null,
     input.latencyMs==null?null:Number(input.latencyMs),observedAt,input.source,asJson(input.evidence)]);
  await db.execute(`UPDATE ${table} SET health_status=?,last_health_at=? WHERE id=?`,[health,observedAt,subjectId]);
  return {id,subjectType:type,subjectId,previousStatus:row.health_status,healthStatus:health,
    reasonCode:input.reasonCode||null,latencyMs:input.latencyMs==null?null:Number(input.latencyMs),observedAt};
};

export const getWorkspaceOperationsWorkbench=async(workspaceId)=>{
  const db=getRuntimePool(),w=await loadWorkspace(workspaceId,db);
  const [
    projects,runs,runFailures,memberships,denies,usage,environments,connections,providers,m29
  ]=await Promise.all([
    count(db,"SELECT COUNT(*) count FROM projects WHERE workspace_id=? AND status<>'ARCHIVED'",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM runs WHERE workspace_id=?",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM runs WHERE workspace_id=? AND status IN ('FAILED','BLOCKED')",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM workspace_memberships WHERE workspace_id=? AND status='ACTIVE'",[workspaceId]),
    count(db,"SELECT COUNT(*) count FROM authorization_decisions WHERE workspace_id=? AND decision='DENY' AND created_at>=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 24 HOUR)",[workspaceId]),
    one(db,"SELECT COUNT(*) events,COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) cost_amount,COALESCE(SUM(token_input+token_output),0) tokens FROM usage_ledger WHERE workspace_id=?",[workspaceId]),
    list(db,'SELECT * FROM platform_environments WHERE workspace_id=? ORDER BY environment_type,environment_key',[workspaceId]),
    list(db,'SELECT * FROM platform_connections WHERE workspace_id=? ORDER BY connection_type,connection_key',[workspaceId]),
    list(db,`SELECT provider_key,display_name,enabled,health_status,updated_at FROM provider_registry
      WHERE enabled=TRUE ORDER BY priority,provider_key`),
    one(db,`SELECT implementation_status,blueprint_exit_status,as_of FROM m29_final_gate_evaluations
      WHERE scope_key='PLATFORM' AND gate_key='G-M29-FINAL' ORDER BY as_of DESC,created_at DESC LIMIT 1`)
  ]);
  const envs=environments.map(normalizeEnvironment),conns=connections.map(normalizeConnection);
  const healthSummary={
    environments:{
      total:envs.length,healthy:envs.filter(x=>x.healthStatus==='HEALTHY').length,
      degraded:envs.filter(x=>x.healthStatus==='DEGRADED').length,down:envs.filter(x=>x.healthStatus==='DOWN').length
    },
    connections:{
      total:conns.length,healthy:conns.filter(x=>x.healthStatus==='HEALTHY').length,
      degraded:conns.filter(x=>x.healthStatus==='DEGRADED').length,down:conns.filter(x=>x.healthStatus==='DOWN').length
    },
    providers:{
      total:providers.length,healthy:providers.filter(x=>x.health_status==='HEALTHY').length,
      degraded:providers.filter(x=>x.health_status==='DEGRADED').length,down:providers.filter(x=>x.health_status==='DOWN').length
    }
  };
  return {
    workspace:{id:w.id,tenantId:w.tenant_id,workspaceKey:w.workspace_key,name:w.name,status:w.status},
    frontend:{language:'zh-CN',title:'私有工作台',sections:['项目与运行','环境与连接','Provider 健康','权限与隔离','Usage / Cost','上游 Gate']},
    summary:{activeProjects:projects,totalRuns:runs,failedOrBlockedRuns:runFailures,activeMembers:memberships,
      deniedAuthorizationLast24h:denies,usageEvents:Number(usage?.events||0),costAmount:Number(usage?.cost_amount||0),
      tokens:Number(usage?.tokens||0)},
    healthSummary,environments:envs,connections:conns,
    providers:providers.map(x=>({providerKey:x.provider_key,displayName:x.display_name,enabled:Boolean(x.enabled),
      healthStatus:x.health_status,updatedAt:x.updated_at})),
    upstream:{m29ImplementationStatus:m29?.implementation_status||null,m29BlueprintExitStatus:m29?.blueprint_exit_status||null,
      m29AsOf:m29?.as_of||null}
  };
};

export const evaluateM30OpsFoundationGate=async(workspaceId,input={})=>{
  const db=getRuntimePool();await loadWorkspace(workspaceId,db);
  const asOf=input.asOf?asDate(input.asOf):new Date();
  const state=await getWorkspaceOperationsWorkbench(workspaceId);
  const reasons=[];
  if(state.upstream.m29ImplementationStatus!=='PASS')reasons.push('M30_M29_IMPLEMENTATION_PASS_REQUIRED');
  if(!state.environments.some(x=>x.status==='ACTIVE'&&x.healthStatus==='HEALTHY'))
    reasons.push('M30_HEALTHY_ENVIRONMENT_REQUIRED');
  if(!state.connections.some(x=>x.status==='ACTIVE'&&x.healthStatus==='HEALTHY'))
    reasons.push('M30_HEALTHY_CONNECTION_REQUIRED');
  if(state.summary.activeMembers<1)reasons.push('M30_WORKSPACE_MEMBERSHIP_REQUIRED');
  const linkedProviders=state.connections.filter(x=>x.providerKey).map(x=>x.providerKey);
  if(linkedProviders.length){
    const unhealthy=state.providers.filter(x=>linkedProviders.includes(x.providerKey)&&x.healthStatus!=='HEALTHY');
    if(unhealthy.length)reasons.push('M30_LINKED_PROVIDER_HEALTH_REQUIRED');
  }
  const healthEventCount=await count(db,`SELECT COUNT(*) count FROM platform_health_events
    WHERE workspace_id=? AND health_status='HEALTHY'`,[workspaceId]);
  if(healthEventCount<2)reasons.push('M30_HEALTH_EVIDENCE_REQUIRED');
  const evidence={
    m29ImplementationStatus:state.upstream.m29ImplementationStatus,
    environmentCount:state.environments.length,connectionCount:state.connections.length,
    healthEventCount,activeMembers:state.summary.activeMembers,
    healthSummary:state.healthSummary,workbenchReadable:true,secretPersistencePolicy:'REFERENCE_ONLY'
  };
  const status=reasons.length?'HOLD':'PASS',id=randomUUID();
  await db.execute(`INSERT INTO m30_ops_foundation_gate_evaluations
    (id,workspace_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
    VALUES (?,?,?,?,?,?,?)`,[id,workspaceId,GATE,status,asJson(reasons),asJson(evidence),asOf]);
  return {id,workspaceId,gateKey:GATE,status,reasonCodes:reasons,evidenceSnapshot:evidence,asOf};
};

export const getM30OpsFoundationState=async workspaceId=>{
  const db=getRuntimePool(),workbench=await getWorkspaceOperationsWorkbench(workspaceId);
  const gates=await list(db,`SELECT * FROM m30_ops_foundation_gate_evaluations
    WHERE workspace_id=? ORDER BY as_of DESC,created_at DESC`,[workspaceId]);
  return {workbench,latestGate:gates[0]?{
    id:gates[0].id,status:gates[0].status,reasonCodes:parseJson(gates[0].reason_codes_json),
    evidenceSnapshot:parseJson(gates[0].evidence_snapshot_json),asOf:gates[0].as_of
  }:null};
};
