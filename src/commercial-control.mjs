import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateRunQuota } from './quota-meter.mjs';

const PLAN_STATUS=new Set(['ACTIVE','INACTIVE']);
const RATE_SCOPE=new Set(['PLAN','TENANT','WORKSPACE']);
const RATE_ACTION=new Set(['HOLD','BLOCK']);
const RESERVATION_METRICS=new Set(['COST_AMOUNT','TOKEN_INPUT','TOKEN_OUTPUT','TOKEN_TOTAL','TOOL_EXECUTION_COUNT']);
const decisionRank={ALLOW:0,HOLD:1,BLOCK:2};
const safeSecretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const asJson=value=>value==null?null:JSON.stringify(value);
const num=value=>value==null?null:Number(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(safeSecretPattern.test(key)) throw errorOf(
        'Commercial control metadata must not persist credentials or secrets',
        'COMMERCIAL_METADATA_SECRET_NOT_ALLOWED',
        400,
        {field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};
const normalizePlan=row=>({
  planKey:row.plan_key,name:row.name,status:row.status,metadata:row.metadata_json,
  createdAt:row.created_at,updatedAt:row.updated_at,
});
const normalizeEntitlement=row=>({
  id:row.id,planKey:row.plan_key,entitlementKey:row.entitlement_key,
  enabled:Boolean(row.enabled),config:row.config_json,
  createdAt:row.created_at,updatedAt:row.updated_at,
});
const normalizeRatePolicy=row=>({
  id:row.id,scopeType:row.scope_type,planKey:row.plan_key,tenantId:row.tenant_id,
  workspaceId:row.workspace_id,policyKey:row.policy_key,operationKey:row.operation_key,
  enabled:Boolean(row.enabled),windowSeconds:Number(row.window_seconds),
  maxRequests:Number(row.max_requests),actionOnExceed:row.action_on_exceed,
  metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at,
});
const normalizeReservation=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,projectId:row.project_id,
  runId:row.run_id,planKey:row.plan_key,entitlementKey:row.entitlement_key,
  operationKey:row.operation_key,metricKey:row.metric_key,currency:row.currency,
  reservedAmount:Number(row.reserved_amount),actualAmount:num(row.actual_amount),
  status:row.status,expiresAt:row.expires_at,committedToolExecutionId:row.committed_tool_execution_id,
  reasonCode:row.reason_code,createdAt:row.created_at,updatedAt:row.updated_at,
});

const getRunScope=async(db,runId,{forUpdate=false}={})=>{
  const [rows]=await db.execute(
    `SELECT r.id,r.project_id,r.tenant_id,r.workspace_id,
            t.plan_key,t.status AS tenant_status,w.status AS workspace_status,
            p.status AS plan_status
     FROM runs r
     JOIN tenants t ON t.id=r.tenant_id
     JOIN workspaces w ON w.id=r.workspace_id
     LEFT JOIN plans p ON p.plan_key=t.plan_key
     WHERE r.id=?
     LIMIT 1${forUpdate?' FOR UPDATE':''}`,
    [runId]
  );
  if(!rows.length) throw errorOf('Run not found','RUN_NOT_FOUND',404);
  return rows[0];
};

export const createPlan=async input=>{
  if(!input?.planKey||!input?.name) throw errorOf('planKey and name are required','INVALID_PLAN');
  rejectSecrets(input.metadata||null);
  const status=String(input.status||'ACTIVE').toUpperCase();
  if(!PLAN_STATUS.has(status)) throw errorOf('status must be ACTIVE or INACTIVE','INVALID_PLAN_STATUS');
  const db=getRuntimePool();
  try{
    await db.execute(
      'INSERT INTO plans (plan_key,name,status,metadata_json) VALUES (?,?,?,?)',
      [input.planKey,input.name,status,asJson(input.metadata||null)]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('planKey already exists','PLAN_KEY_EXISTS',409);
    throw error;
  }
  const [rows]=await db.execute('SELECT * FROM plans WHERE plan_key=?',[input.planKey]);
  return normalizePlan(rows[0]);
};

export const listPlans=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM plans ORDER BY plan_key');
  return rows.map(normalizePlan);
};

export const upsertPlanEntitlement=async input=>{
  if(!input?.planKey||!input?.entitlementKey) throw errorOf('planKey and entitlementKey are required','INVALID_ENTITLEMENT');
  rejectSecrets(input.config||null);
  const db=getRuntimePool();
  const [plans]=await db.execute('SELECT plan_key FROM plans WHERE plan_key=?',[input.planKey]);
  if(!plans.length) throw errorOf('Plan not found','PLAN_NOT_FOUND',404);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO plan_entitlements (id,plan_key,entitlement_key,enabled,config_json)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),config_json=VALUES(config_json)`,
    [id,input.planKey,input.entitlementKey,input.enabled===false?0:1,asJson(input.config||null)]
  );
  const [rows]=await db.execute(
    'SELECT * FROM plan_entitlements WHERE plan_key=? AND entitlement_key=?',
    [input.planKey,input.entitlementKey]
  );
  return normalizeEntitlement(rows[0]);
};

export const listPlanEntitlements=async planKey=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM plan_entitlements WHERE plan_key=? ORDER BY entitlement_key',
    [planKey]
  );
  return rows.map(normalizeEntitlement);
};

export const assignTenantPlan=async({tenantId,planKey})=>{
  if(!tenantId||!planKey) throw errorOf('tenantId and planKey are required','INVALID_TENANT_PLAN');
  const db=getRuntimePool();
  const [plans]=await db.execute('SELECT plan_key,status FROM plans WHERE plan_key=?',[planKey]);
  if(!plans.length) throw errorOf('Plan not found','PLAN_NOT_FOUND',404);
  if(plans[0].status!=='ACTIVE') throw errorOf('Plan is not active','PLAN_NOT_ACTIVE',409);
  const [result]=await db.execute('UPDATE tenants SET plan_key=? WHERE id=?',[planKey,tenantId]);
  if(!result.affectedRows) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
  return {tenantId,planKey};
};

export const evaluateEntitlement=async({
  runId,entitlementKey,persist=true,source='RUNTIME'
}={})=>{
  if(!runId||!entitlementKey) throw errorOf('runId and entitlementKey are required','INVALID_ENTITLEMENT_EVALUATION');
  const db=getRuntimePool();
  const scope=await getRunScope(db,runId);
  const [rows]=await db.execute(
    'SELECT * FROM plan_entitlements WHERE plan_key=? AND entitlement_key=? LIMIT 1',
    [scope.plan_key,entitlementKey]
  );
  let decision='DENY',reasonCode='ENTITLEMENT_NOT_FOUND',config=null;
  if(scope.tenant_status!=='ACTIVE') reasonCode='TENANT_NOT_ACTIVE';
  else if(scope.workspace_status!=='ACTIVE') reasonCode='WORKSPACE_NOT_ACTIVE';
  else if(scope.plan_status!=='ACTIVE') reasonCode='PLAN_NOT_ACTIVE';
  else if(rows.length){
    config=rows[0].config_json;
    if(Boolean(rows[0].enabled)){decision='ALLOW';reasonCode=null;}
    else reasonCode='ENTITLEMENT_DISABLED';
  }
  if(persist){
    await db.execute(
      `INSERT INTO entitlement_evaluations (
        id,tenant_id,workspace_id,run_id,plan_key,entitlement_key,decision,
        reason_code,config_snapshot_json,evaluated_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(),scope.tenant_id,scope.workspace_id,runId,scope.plan_key,entitlementKey,
       decision,reasonCode,asJson(config),source]
    );
  }
  return {
    runId,tenantId:scope.tenant_id,workspaceId:scope.workspace_id,planKey:scope.plan_key,
    entitlementKey,decision,allowed:decision==='ALLOW',reasonCode,config,
  };
};

const resolveRateScope=async(db,input)=>{
  const scopeType=String(input.scopeType||'').toUpperCase();
  if(!RATE_SCOPE.has(scopeType)) throw errorOf('scopeType must be PLAN, TENANT or WORKSPACE','INVALID_RATE_SCOPE');
  if(scopeType==='PLAN'){
    if(!input.planKey) throw errorOf('planKey is required for PLAN scope','INVALID_RATE_SCOPE');
    const [rows]=await db.execute('SELECT plan_key FROM plans WHERE plan_key=?',[input.planKey]);
    if(!rows.length) throw errorOf('Plan not found','PLAN_NOT_FOUND',404);
    return {scopeType,planKey:input.planKey,tenantId:null,workspaceId:null};
  }
  if(scopeType==='TENANT'){
    if(!input.tenantId) throw errorOf('tenantId is required for TENANT scope','INVALID_RATE_SCOPE');
    const [rows]=await db.execute('SELECT id FROM tenants WHERE id=?',[input.tenantId]);
    if(!rows.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
    return {scopeType,planKey:null,tenantId:input.tenantId,workspaceId:null};
  }
  if(!input.workspaceId) throw errorOf('workspaceId is required for WORKSPACE scope','INVALID_RATE_SCOPE');
  const [rows]=await db.execute('SELECT id,tenant_id FROM workspaces WHERE id=?',[input.workspaceId]);
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return {scopeType,planKey:null,tenantId:rows[0].tenant_id,workspaceId:input.workspaceId};
};

export const upsertRateLimitPolicy=async input=>{
  if(!input?.policyKey||!input?.operationKey) throw errorOf('policyKey and operationKey are required','INVALID_RATE_POLICY');
  const windowSeconds=Number(input.windowSeconds);
  const maxRequests=Number(input.maxRequests);
  if(!Number.isInteger(windowSeconds)||windowSeconds<1||windowSeconds>86400) throw errorOf('windowSeconds must be an integer from 1 to 86400','INVALID_RATE_WINDOW');
  if(!Number.isInteger(maxRequests)||maxRequests<1) throw errorOf('maxRequests must be a positive integer','INVALID_RATE_LIMIT');
  const action=String(input.actionOnExceed||'BLOCK').toUpperCase();
  if(!RATE_ACTION.has(action)) throw errorOf('actionOnExceed must be HOLD or BLOCK','INVALID_RATE_ACTION');
  rejectSecrets(input.metadata||null);
  const db=getRuntimePool();
  const scope=await resolveRateScope(db,input);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO rate_limit_policies (
      id,scope_type,plan_key,tenant_id,workspace_id,policy_key,operation_key,
      enabled,window_seconds,max_requests,action_on_exceed,metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      operation_key=VALUES(operation_key),enabled=VALUES(enabled),
      window_seconds=VALUES(window_seconds),max_requests=VALUES(max_requests),
      action_on_exceed=VALUES(action_on_exceed),metadata_json=VALUES(metadata_json)`,
    [id,scope.scopeType,scope.planKey,scope.tenantId,scope.workspaceId,input.policyKey,input.operationKey,
     input.enabled===false?0:1,windowSeconds,maxRequests,action,asJson(input.metadata||null)]
  );
  const [rows]=await db.execute(
    'SELECT * FROM rate_limit_policies WHERE scope_guard=? AND policy_key=?',
    [
      scope.scopeType==='PLAN'?`PLAN:${scope.planKey}`:
        scope.scopeType==='TENANT'?`TENANT:${scope.tenantId}`:`WORKSPACE:${scope.workspaceId}`,
      input.policyKey
    ]
  );
  return normalizeRatePolicy(rows[0]);
};

export const listRateLimitPolicies=async({operationKey=null}={})=>{
  const db=getRuntimePool();
  const [rows]=operationKey
    ? await db.execute('SELECT * FROM rate_limit_policies WHERE operation_key=? ORDER BY scope_type,policy_key',[operationKey])
    : await db.execute('SELECT * FROM rate_limit_policies ORDER BY operation_key,scope_type,policy_key');
  return rows.map(normalizeRatePolicy);
};

const fixedWindow=(seconds,at=new Date())=>{
  const instant=new Date(at);
  if(Number.isNaN(instant.getTime())) throw errorOf('Invalid rate-limit timestamp','INVALID_RATE_TIMESTAMP');
  const size=seconds*1000;
  const startMs=Math.floor(instant.getTime()/size)*size;
  return {start:new Date(startMs),end:new Date(startMs+size)};
};

export const consumeRateLimit=async({runId,operationKey,at=new Date()}={})=>{
  if(!runId||!operationKey) throw errorOf('runId and operationKey are required','INVALID_RATE_CHECK');
  const db=getRuntimePool();
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const scope=await getRunScope(connection,runId,{forUpdate:true});
    const [policies]=await connection.execute(
      `SELECT * FROM rate_limit_policies
       WHERE enabled=TRUE AND operation_key=? AND (
         (scope_type='PLAN' AND plan_key=?) OR
         (scope_type='TENANT' AND tenant_id=?) OR
         (scope_type='WORKSPACE' AND workspace_id=?)
       )
       ORDER BY scope_type,policy_key
       FOR UPDATE`,
      [operationKey,scope.plan_key,scope.tenant_id,scope.workspace_id]
    );
    if(!policies.length){
      await connection.commit();
      return {runId,operationKey,decision:'ALLOW',policyCount:0,decisions:[]};
    }

    const snapshots=[];
    for(const policy of policies){
      const window=fixedWindow(Number(policy.window_seconds),at);
      await connection.execute(
        'INSERT IGNORE INTO rate_limit_buckets (policy_id,window_start,used_count) VALUES (?,?,0)',
        [policy.id,window.start]
      );
      const [buckets]=await connection.execute(
        'SELECT used_count FROM rate_limit_buckets WHERE policy_id=? AND window_start=? FOR UPDATE',
        [policy.id,window.start]
      );
      const used=Number(buckets[0]?.used_count||0);
      const exceeded=used>=Number(policy.max_requests);
      snapshots.push({policy,window,used,decision:exceeded?policy.action_on_exceed:'ALLOW'});
    }

    const finalDecision=snapshots.reduce(
      (best,item)=>decisionRank[item.decision]>decisionRank[best]?item.decision:best,
      'ALLOW'
    );

    if(finalDecision==='ALLOW'){
      for(const item of snapshots){
        await connection.execute(
          'UPDATE rate_limit_buckets SET used_count=used_count+1 WHERE policy_id=? AND window_start=?',
          [item.policy.id,item.window.start]
        );
      }
    }

    for(const item of snapshots){
      await connection.execute(
        `INSERT INTO rate_limit_decisions (
          id,tenant_id,workspace_id,run_id,policy_id,decision,operation_key,
          window_start,window_end,used_before,max_requests,reason_code
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),scope.tenant_id,scope.workspace_id,runId,item.policy.id,item.decision,operationKey,
         item.window.start,item.window.end,item.used,Number(item.policy.max_requests),
         item.decision==='ALLOW'?null:'RATE_LIMIT_REACHED']
      );
    }

    await connection.commit();
    return {
      runId,tenantId:scope.tenant_id,workspaceId:scope.workspace_id,planKey:scope.plan_key,
      operationKey,decision:finalDecision,policyCount:snapshots.length,
      decisions:snapshots.map(item=>({
        policyId:item.policy.id,policyKey:item.policy.policy_key,scopeType:item.policy.scope_type,
        decision:item.decision,usedBefore:item.used,maxRequests:Number(item.policy.max_requests),
        windowStart:item.window.start,windowEnd:item.window.end,
      }))
    };
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{
    connection.release();
  }
};

const periodBounds=(periodType,at=new Date())=>{
  const period=String(periodType||'MONTH').toUpperCase();
  const instant=new Date(at);
  if(Number.isNaN(instant.getTime())) throw errorOf('Invalid reservation timestamp','INVALID_RESERVATION_TIMESTAMP');
  if(period==='DAY'){
    const start=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),instant.getUTCDate()));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+1);
    return {start,end};
  }
  if(period==='MONTH'){
    return {
      start:new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),1)),
      end:new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth()+1,1)),
    };
  }
  throw errorOf('Unsupported quota period','INVALID_QUOTA_PERIOD');
};

const usageValueForPolicy=async(connection,{policy,scope,at})=>{
  const bounds=periodBounds(policy.period_type,at);
  const scopeColumn=policy.subject_type==='TENANT'?'tenant_id':'workspace_id';
  const scopeId=policy.subject_type==='TENANT'?scope.tenant_id:scope.workspace_id;
  const [[usage]]=await connection.execute(
    `SELECT COUNT(*) AS usage_count,
            COALESCE(SUM(token_input),0) AS token_input,
            COALESCE(SUM(token_output),0) AS token_output,
            COALESCE(SUM(token_input+token_output),0) AS token_total,
            SUM(CASE WHEN cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_cost_count,
            COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) AS estimated_cost,
            GROUP_CONCAT(DISTINCT CASE WHEN cost_status='CALCULATED' THEN cost_currency END ORDER BY cost_currency) AS currencies
     FROM usage_ledger
     WHERE ${scopeColumn}=? AND recorded_at>=? AND recorded_at<?`,
    [scopeId,bounds.start,bounds.end]
  );
  const [[reserved]]=await connection.execute(
    `SELECT COALESCE(SUM(reserved_amount),0) AS reserved_amount
     FROM usage_reservations
     WHERE ${scopeColumn}=?
       AND metric_key=?
       AND created_at>=? AND created_at<?
       AND (
         (status='RESERVED' AND expires_at>CURRENT_TIMESTAMP(6)) OR
         (status='COMMITTED' AND committed_tool_execution_id IS NULL)
       )`,
    [scopeId,policy.metric_key,bounds.start,bounds.end]
  );
  const currencies=usage.currencies?String(usage.currencies).split(',').filter(Boolean):[];
  let current=0;
  if(policy.metric_key==='COST_AMOUNT') current=Number(usage.estimated_cost||0);
  else if(policy.metric_key==='TOKEN_INPUT') current=Number(usage.token_input||0);
  else if(policy.metric_key==='TOKEN_OUTPUT') current=Number(usage.token_output||0);
  else if(policy.metric_key==='TOKEN_TOTAL') current=Number(usage.token_total||0);
  else if(policy.metric_key==='TOOL_EXECUTION_COUNT') current=Number(usage.usage_count||0);
  return {
    bounds,current,reserved:Number(reserved.reserved_amount||0),
    unknownCostCount:Number(usage.unknown_cost_count||0),currencies,
  };
};

export const reserveUsage=async({
  runId,entitlementKey='MODEL_EXECUTION',operationKey='MODEL_EXECUTION',
  metricKey='TOOL_EXECUTION_COUNT',amount=1,currency='USD',ttlSeconds=300,at=new Date()
}={})=>{
  if(!runId) throw errorOf('runId is required','INVALID_USAGE_RESERVATION');
  const metric=String(metricKey).toUpperCase();
  if(!RESERVATION_METRICS.has(metric)) throw errorOf('Unsupported reservation metric','INVALID_RESERVATION_METRIC');
  const requested=Number(amount);
  if(!Number.isFinite(requested)||requested<=0) throw errorOf('amount must be a positive number','INVALID_RESERVATION_AMOUNT');
  const ttl=Number(ttlSeconds);
  if(!Number.isInteger(ttl)||ttl<1||ttl>3600) throw errorOf('ttlSeconds must be an integer from 1 to 3600','INVALID_RESERVATION_TTL');
  const normalizedCurrency=String(currency||'USD').toUpperCase();
  if(metric==='COST_AMOUNT'&&!/^[A-Z]{3}$/.test(normalizedCurrency)) throw errorOf('currency must be a 3-letter code','INVALID_RESERVATION_CURRENCY');

  const db=getRuntimePool();
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const scope=await getRunScope(connection,runId,{forUpdate:true});
    const [policies]=await connection.execute(
      `SELECT * FROM quota_policies
       WHERE enabled=TRUE AND metric_key=? AND tenant_id=? AND (
         (subject_type='TENANT' AND subject_id=?) OR
         (subject_type='WORKSPACE' AND subject_id=?)
       )
       ORDER BY subject_type,policy_key
       FOR UPDATE`,
      [metric,scope.tenant_id,scope.tenant_id,scope.workspace_id]
    );

    const evaluations=[];
    for(const policy of policies){
      const meter=await usageValueForPolicy(connection,{policy,scope,at});
      let decision='ALLOW',reasonCode=null;
      const projected=meter.current+meter.reserved+requested;
      if(metric==='COST_AMOUNT'){
        if(meter.unknownCostCount>0){decision='HOLD';reasonCode='QUOTA_COST_UNKNOWN';}
        else if(meter.currencies.length>1){decision='HOLD';reasonCode='QUOTA_MIXED_CURRENCY';}
        else if(meter.currencies.length===1&&meter.currencies[0]!==policy.currency){
          decision='HOLD';reasonCode='QUOTA_CURRENCY_MISMATCH';
        }else if(normalizedCurrency!==policy.currency){
          decision='HOLD';reasonCode='RESERVATION_CURRENCY_MISMATCH';
        }
      }
      if(decision==='ALLOW'&&policy.hard_limit!=null&&projected>Number(policy.hard_limit)){
        decision=policy.action_on_hard;reasonCode='HARD_LIMIT_WOULD_EXCEED';
      }
      if(decision==='ALLOW'&&policy.soft_limit!=null&&projected>=Number(policy.soft_limit)){
        decision=policy.action_on_soft;reasonCode='SOFT_LIMIT_WOULD_REACH';
      }
      evaluations.push({
        policyId:policy.id,policyKey:policy.policy_key,subjectType:policy.subject_type,
        decision,reasonCode,currentUsage:meter.current,activeReserved:meter.reserved,
        projectedUsage:projected,softLimit:num(policy.soft_limit),hardLimit:num(policy.hard_limit),
        periodStart:meter.bounds.start,periodEnd:meter.bounds.end,
      });
    }

    const decision=evaluations.reduce(
      (best,item)=>decisionRank[item.decision]>decisionRank[best]?item.decision:best,
      'ALLOW'
    );
    if(decision!=='ALLOW'){
      await connection.rollback();
      return {
        runId,tenantId:scope.tenant_id,workspaceId:scope.workspace_id,planKey:scope.plan_key,
        decision,metricKey:metric,requestedAmount:requested,reservation:null,evaluations,
      };
    }

    const id=randomUUID();
    const expiresAt=new Date(new Date(at).getTime()+ttl*1000);
    await connection.execute(
      `INSERT INTO usage_reservations (
        id,tenant_id,workspace_id,project_id,run_id,plan_key,entitlement_key,operation_key,
        metric_key,currency,reserved_amount,status,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'RESERVED',?)`,
      [id,scope.tenant_id,scope.workspace_id,scope.project_id,runId,scope.plan_key,
       entitlementKey,operationKey,metric,metric==='COST_AMOUNT'?normalizedCurrency:null,requested,expiresAt]
    );
    await connection.commit();
    return {
      runId,tenantId:scope.tenant_id,workspaceId:scope.workspace_id,planKey:scope.plan_key,
      decision:'ALLOW',metricKey:metric,requestedAmount:requested,
      reservation:{id,status:'RESERVED',expiresAt},evaluations,
    };
  }catch(error){
    try{await connection.rollback();}catch{}
    throw error;
  }finally{
    connection.release();
  }
};

export const commitUsageReservation=async(reservationId,{
  actualAmount=null,toolExecutionId=null
}={})=>{
  const db=getRuntimePool();
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.execute(
      'SELECT * FROM usage_reservations WHERE id=? FOR UPDATE',
      [reservationId]
    );
    if(!rows.length) throw errorOf('Usage reservation not found','RESERVATION_NOT_FOUND',404);
    const row=rows[0];
    if(row.status==='COMMITTED'){
      await connection.commit();
      return normalizeReservation(row);
    }
    if(row.status==='RELEASED'||row.status==='EXPIRED') throw errorOf('Usage reservation is not committable','RESERVATION_NOT_COMMITTABLE',409);
    if(new Date(row.expires_at).getTime()<=Date.now()){
      await connection.execute("UPDATE usage_reservations SET status='EXPIRED',reason_code='RESERVATION_EXPIRED' WHERE id=?",[reservationId]);
      await connection.commit();
      throw errorOf('Usage reservation expired','RESERVATION_EXPIRED',409);
    }
    const actual=actualAmount==null?Number(row.reserved_amount):Number(actualAmount);
    if(!Number.isFinite(actual)||actual<0) throw errorOf('actualAmount must be a non-negative number','INVALID_ACTUAL_AMOUNT');
    if(toolExecutionId){
      const [tools]=await connection.execute('SELECT id,run_id FROM tool_executions WHERE id=?',[toolExecutionId]);
      if(!tools.length) throw errorOf('Tool execution not found','TOOL_EXECUTION_NOT_FOUND',404);
      if(tools[0].run_id!==row.run_id) throw errorOf('Tool execution run does not match reservation','RESERVATION_TOOL_RUN_MISMATCH',409);
    }
    const reason=actual>Number(row.reserved_amount)?'RESERVATION_OVERRUN':null;
    await connection.execute(
      `UPDATE usage_reservations
       SET status='COMMITTED',actual_amount=?,committed_tool_execution_id=?,reason_code=?
       WHERE id=?`,
      [actual,toolExecutionId||null,reason,reservationId]
    );
    const [updated]=await connection.execute('SELECT * FROM usage_reservations WHERE id=?',[reservationId]);
    await connection.commit();
    return normalizeReservation(updated[0]);
  }catch(error){
    try{await connection.rollback();}catch{}
    throw error;
  }finally{
    connection.release();
  }
};

export const releaseUsageReservation=async(reservationId,{reasonCode='RELEASED'}={})=>{
  const db=getRuntimePool();
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.execute('SELECT * FROM usage_reservations WHERE id=? FOR UPDATE',[reservationId]);
    if(!rows.length) throw errorOf('Usage reservation not found','RESERVATION_NOT_FOUND',404);
    const row=rows[0];
    if(row.status==='RELEASED'||row.status==='EXPIRED'){
      await connection.commit();
      return normalizeReservation(row);
    }
    if(row.status==='COMMITTED') throw errorOf('Committed reservation cannot be released','RESERVATION_ALREADY_COMMITTED',409);
    await connection.execute(
      "UPDATE usage_reservations SET status='RELEASED',reason_code=? WHERE id=?",
      [reasonCode,reservationId]
    );
    const [updated]=await connection.execute('SELECT * FROM usage_reservations WHERE id=?',[reservationId]);
    await connection.commit();
    return normalizeReservation(updated[0]);
  }catch(error){
    try{await connection.rollback();}catch{}
    throw error;
  }finally{
    connection.release();
  }
};

export const listUsageReservations=async({runId=null}={})=>{
  const db=getRuntimePool();
  const [rows]=runId
    ? await db.execute('SELECT * FROM usage_reservations WHERE run_id=? ORDER BY created_at,id',[runId])
    : await db.execute('SELECT * FROM usage_reservations ORDER BY created_at,id');
  return rows.map(normalizeReservation);
};

const decisionError=(decision,prefix,details)=>{
  const block=decision==='BLOCK';
  return errorOf(
    block?`${prefix} blocked execution`:`${prefix} requires hold`,
    block?`${prefix}_BLOCKED`:`${prefix}_HOLD`,
    block?429:409,
    {decision,...(details||{})}
  );
};

export const authorizeCommercialExecution=async({
  runId,entitlementKey='MODEL_EXECUTION',operationKey='MODEL_EXECUTION',
  reservationMetric='TOOL_EXECUTION_COUNT',reservationAmount=1,
  reservationCurrency='USD',reservationTtlSeconds=300,source='RUNTIME'
}={})=>{
  const entitlement=await evaluateEntitlement({runId,entitlementKey,persist:true,source});
  if(!entitlement.allowed){
    throw errorOf('Plan entitlement denied execution','ENTITLEMENT_DENIED',403,{
      runId,planKey:entitlement.planKey,entitlementKey,reasonCode:entitlement.reasonCode,
    });
  }

  const quota=await evaluateRunQuota({runId,persist:true,source:`${source}:QUOTA`});
  if(quota.decision!=='ALLOW'){
    throw decisionError(quota.decision,'QUOTA',{
      runId,tenantId:quota.tenantId,workspaceId:quota.workspaceId,policyCount:quota.policyCount,
    });
  }

  const reservation=await reserveUsage({
    runId,entitlementKey,operationKey,metricKey:reservationMetric,amount:reservationAmount,
    currency:reservationCurrency,ttlSeconds:reservationTtlSeconds,
  });
  if(reservation.decision!=='ALLOW'){
    throw decisionError(reservation.decision,'QUOTA',{
      runId,tenantId:reservation.tenantId,workspaceId:reservation.workspaceId,
      metricKey:reservation.metricKey,evaluations:reservation.evaluations,
    });
  }

  const rate=await consumeRateLimit({runId,operationKey});
  if(rate.decision!=='ALLOW'){
    await releaseUsageReservation(reservation.reservation.id,{reasonCode:'RATE_LIMIT_REJECTED'});
    throw decisionError(rate.decision,'RATE_LIMIT',{
      runId,tenantId:rate.tenantId,workspaceId:rate.workspaceId,
      operationKey,decisions:rate.decisions,
    });
  }

  return {
    runId,tenantId:entitlement.tenantId,workspaceId:entitlement.workspaceId,planKey:entitlement.planKey,
    entitlementKey,operationKey,decision:'ALLOW',
    reservationId:reservation.reservation.id,reservationExpiresAt:reservation.reservation.expiresAt,
    entitlement,quota,rate,
  };
};
