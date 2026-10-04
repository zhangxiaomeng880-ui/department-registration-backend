import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SUBJECTS=new Set(['TENANT','WORKSPACE']);
const METRICS=new Set(['COST_AMOUNT','TOKEN_INPUT','TOKEN_OUTPUT','TOKEN_TOTAL','RUN_COUNT','TOOL_EXECUTION_COUNT']);
const PERIODS=new Set(['DAY','MONTH']);
const ACTIONS=new Set(['HOLD','BLOCK']);
const decisionRank={ALLOW:0,HOLD:1,BLOCK:2};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const decimal=value=>value==null?null:Number(value);
const normalizePolicy=row=>({
  id:row.id,tenantId:row.tenant_id,subjectType:row.subject_type,subjectId:row.subject_id,
  policyKey:row.policy_key,enabled:Boolean(row.enabled),metricKey:row.metric_key,
  periodType:row.period_type,currency:row.currency,softLimit:decimal(row.soft_limit),
  hardLimit:decimal(row.hard_limit),actionOnSoft:row.action_on_soft,actionOnHard:row.action_on_hard,
  metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at,
});

const periodBounds=(periodType,at=new Date())=>{
  const period=String(periodType||'MONTH').toUpperCase();
  if(!PERIODS.has(period)) throw errorOf('periodType must be DAY or MONTH','INVALID_QUOTA_PERIOD');
  const instant=new Date(at);
  if(Number.isNaN(instant.getTime())) throw errorOf('Invalid meter timestamp','INVALID_METER_TIMESTAMP');
  let start,end;
  if(period==='DAY'){
    start=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),instant.getUTCDate()));
    end=new Date(start);end.setUTCDate(end.getUTCDate()+1);
  }else{
    start=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),1));
    end=new Date(Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth()+1,1));
  }
  return {periodType:period,start,end};
};

const resolveScope=async(db,{tenantId=null,workspaceId=null})=>{
  if(workspaceId){
    const [rows]=await db.execute(
      `SELECT w.id AS workspace_id,w.tenant_id,w.status AS workspace_status,t.status AS tenant_status
       FROM workspaces w JOIN tenants t ON t.id=w.tenant_id WHERE w.id=?`,
      [workspaceId]
    );
    if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
    if(tenantId&&tenantId!==rows[0].tenant_id) throw errorOf('Workspace does not belong to tenant','WORKSPACE_TENANT_MISMATCH',409);
    return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
  }
  if(!tenantId) throw errorOf('tenantId or workspaceId is required','METER_SCOPE_REQUIRED');
  const [rows]=await db.execute('SELECT id FROM tenants WHERE id=?',[tenantId]);
  if(!rows.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
  return {tenantId,workspaceId:null};
};

export const getUsageMeter=async({tenantId=null,workspaceId=null,periodType='MONTH',at=new Date()}={})=>{
  const db=getRuntimePool();
  const scope=await resolveScope(db,{tenantId,workspaceId});
  const bounds=periodBounds(periodType,at);
  const clauses=['tenant_id=?','recorded_at>=?','recorded_at<?'];
  const values=[scope.tenantId,bounds.start,bounds.end];
  if(scope.workspaceId){clauses.push('workspace_id=?');values.push(scope.workspaceId);}
  const [[row]]=await db.execute(
    `SELECT COUNT(*) AS usage_count,
            COUNT(DISTINCT run_id) AS run_count,
            COALESCE(SUM(token_input),0) AS token_input,
            COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
            COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
            COALESCE(SUM(token_output),0) AS token_output,
            COALESCE(SUM(token_input + token_output),0) AS token_total,
            SUM(CASE WHEN cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_cost_count,
            COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) AS estimated_cost,
            GROUP_CONCAT(DISTINCT CASE WHEN cost_status='CALCULATED' THEN cost_currency END ORDER BY cost_currency) AS currencies
     FROM usage_ledger
     WHERE ${clauses.join(' AND ')}`,
    values
  );
  const currencies=row.currencies?String(row.currencies).split(',').filter(Boolean):[];
  const unknownCostCount=Number(row.unknown_cost_count||0);
  return {
    tenantId:scope.tenantId,workspaceId:scope.workspaceId,periodType:bounds.periodType,
    periodStart:bounds.start,periodEnd:bounds.end,
    usageCount:Number(row.usage_count||0),runCount:Number(row.run_count||0),
    tokenInput:Number(row.token_input||0),cachedInputTokens:Number(row.cached_input_tokens||0),
    cacheWriteTokens:Number(row.cache_write_tokens||0),tokenOutput:Number(row.token_output||0),
    tokenTotal:Number(row.token_total||0),unknownCostCount,
    estimatedCost:Number(row.estimated_cost||0),currencies,
    currency:currencies.length===1?currencies[0]:null,
    costStatus:unknownCostCount>0?'UNKNOWN':currencies.length>1?'MIXED_CURRENCY':'CALCULATED',
  };
};

const resolvePolicySubject=async(db,input)=>{
  const subjectType=String(input.subjectType||'').toUpperCase();
  if(!SUBJECTS.has(subjectType)) throw errorOf('subjectType must be TENANT or WORKSPACE','INVALID_QUOTA_SUBJECT');
  if(!input.subjectId) throw errorOf('subjectId is required','INVALID_QUOTA_SUBJECT');
  if(subjectType==='TENANT'){
    const [rows]=await db.execute('SELECT id FROM tenants WHERE id=?',[input.subjectId]);
    if(!rows.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
    return {subjectType,subjectId:input.subjectId,tenantId:input.subjectId};
  }
  const [rows]=await db.execute('SELECT id,tenant_id FROM workspaces WHERE id=?',[input.subjectId]);
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return {subjectType,subjectId:input.subjectId,tenantId:rows[0].tenant_id};
};

export const upsertQuotaPolicy=async input=>{
  if(!input?.policyKey||!input?.metricKey) throw errorOf('policyKey and metricKey are required','INVALID_QUOTA_POLICY');
  const metricKey=String(input.metricKey).toUpperCase();
  if(!METRICS.has(metricKey)) throw errorOf('Unsupported metricKey','INVALID_QUOTA_METRIC');
  const periodType=String(input.periodType||'MONTH').toUpperCase();
  if(!PERIODS.has(periodType)) throw errorOf('periodType must be DAY or MONTH','INVALID_QUOTA_PERIOD');
  const soft=input.softLimit==null?null:Number(input.softLimit);
  const hard=input.hardLimit==null?null:Number(input.hardLimit);
  if(soft==null&&hard==null) throw errorOf('At least one of softLimit or hardLimit is required','QUOTA_LIMIT_REQUIRED');
  if((soft!=null&&(!Number.isFinite(soft)||soft<0))||(hard!=null&&(!Number.isFinite(hard)||hard<0))) throw errorOf('Quota limits must be non-negative numbers','INVALID_QUOTA_LIMIT');
  if(soft!=null&&hard!=null&&soft>hard) throw errorOf('softLimit must not exceed hardLimit','INVALID_QUOTA_LIMIT_ORDER');
  const actionOnSoft=String(input.actionOnSoft||'HOLD').toUpperCase();
  const actionOnHard=String(input.actionOnHard||'BLOCK').toUpperCase();
  if(!ACTIONS.has(actionOnSoft)||!ACTIONS.has(actionOnHard)) throw errorOf('Quota actions must be HOLD or BLOCK','INVALID_QUOTA_ACTION');
  const currency=String(input.currency||'USD').toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw errorOf('currency must be a 3-letter code','INVALID_QUOTA_CURRENCY');

  const db=getRuntimePool();
  const subject=await resolvePolicySubject(db,input);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO quota_policies (
      id,tenant_id,subject_type,subject_id,policy_key,enabled,metric_key,period_type,currency,
      soft_limit,hard_limit,action_on_soft,action_on_hard,metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      enabled=VALUES(enabled),metric_key=VALUES(metric_key),period_type=VALUES(period_type),
      currency=VALUES(currency),soft_limit=VALUES(soft_limit),hard_limit=VALUES(hard_limit),
      action_on_soft=VALUES(action_on_soft),action_on_hard=VALUES(action_on_hard),
      metadata_json=VALUES(metadata_json)`,
    [id,subject.tenantId,subject.subjectType,subject.subjectId,input.policyKey,input.enabled===false?0:1,
     metricKey,periodType,currency,soft,hard,actionOnSoft,actionOnHard,asJson(input.metadata||null)]
  );
  const [rows]=await db.execute(
    'SELECT * FROM quota_policies WHERE subject_type=? AND subject_id=? AND policy_key=?',
    [subject.subjectType,subject.subjectId,input.policyKey]
  );
  return normalizePolicy(rows[0]);
};

export const listQuotaPolicies=async({tenantId=null,workspaceId=null,enabledOnly=false}={})=>{
  const db=getRuntimePool();
  const clauses=[],values=[];
  if(workspaceId){
    const scope=await resolveScope(db,{tenantId,workspaceId});
    clauses.push('tenant_id=?','((subject_type=\'TENANT\' AND subject_id=?) OR (subject_type=\'WORKSPACE\' AND subject_id=?))');
    values.push(scope.tenantId,scope.tenantId,scope.workspaceId);
  }else if(tenantId){
    clauses.push('tenant_id=?');values.push(tenantId);
  }
  if(enabledOnly) clauses.push('enabled=TRUE');
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const [rows]=await db.execute(`SELECT * FROM quota_policies ${where} ORDER BY subject_type,subject_id,policy_key`,values);
  return rows.map(normalizePolicy);
};

const metricValue=(metric,meter)=>{
  if(metric==='COST_AMOUNT') return meter.estimatedCost;
  if(metric==='TOKEN_INPUT') return meter.tokenInput;
  if(metric==='TOKEN_OUTPUT') return meter.tokenOutput;
  if(metric==='TOKEN_TOTAL') return meter.tokenTotal;
  if(metric==='RUN_COUNT') return meter.runCount;
  if(metric==='TOOL_EXECUTION_COUNT') return meter.usageCount;
  return null;
};

const evaluateOne=(policy,meter)=>{
  if(policy.metricKey==='COST_AMOUNT'){
    if(meter.unknownCostCount>0) return {decision:'HOLD',usageValue:meter.estimatedCost,reasonCode:'QUOTA_COST_UNKNOWN'};
    if(meter.currencies.length>1) return {decision:'HOLD',usageValue:meter.estimatedCost,reasonCode:'QUOTA_MIXED_CURRENCY'};
    if(meter.currency&&meter.currency!==policy.currency) return {decision:'HOLD',usageValue:meter.estimatedCost,reasonCode:'QUOTA_CURRENCY_MISMATCH'};
  }
  const value=metricValue(policy.metricKey,meter);
  if(policy.hardLimit!=null&&value>=policy.hardLimit) return {decision:policy.actionOnHard,usageValue:value,reasonCode:'HARD_LIMIT_REACHED'};
  if(policy.softLimit!=null&&value>=policy.softLimit) return {decision:policy.actionOnSoft,usageValue:value,reasonCode:'SOFT_LIMIT_REACHED'};
  return {decision:'ALLOW',usageValue:value,reasonCode:null};
};

export const evaluateRunQuota=async({runId,persist=true,source='RUNTIME',at=new Date()}={})=>{
  if(!runId) throw errorOf('runId is required','INVALID_QUOTA_EVALUATION');
  const db=getRuntimePool();
  const [runs]=await db.execute('SELECT id,tenant_id,workspace_id FROM runs WHERE id=?',[runId]);
  if(!runs.length) throw errorOf('Run not found','RUN_NOT_FOUND',404);
  const run=runs[0];
  const policies=await listQuotaPolicies({tenantId:run.tenant_id,workspaceId:run.workspace_id,enabledOnly:true});
  if(!policies.length) return {runId,tenantId:run.tenant_id,workspaceId:run.workspace_id,decision:'ALLOW',policyCount:0,evaluations:[]};

  const meterCache=new Map();
  const evaluations=[];
  for(const policy of policies){
    const scopeKey=policy.subjectType==='TENANT'?`TENANT:${policy.tenantId}`:`WORKSPACE:${policy.subjectId}`;
    const cacheKey=`${scopeKey}:${policy.periodType}`;
    let meter=meterCache.get(cacheKey);
    if(!meter){
      meter=await getUsageMeter({
        tenantId:policy.tenantId,
        workspaceId:policy.subjectType==='WORKSPACE'?policy.subjectId:null,
        periodType:policy.periodType,
        at,
      });
      meterCache.set(cacheKey,meter);
    }
    const result=evaluateOne(policy,meter);
    const evaluation={
      policyId:policy.id,policyKey:policy.policyKey,subjectType:policy.subjectType,subjectId:policy.subjectId,
      metricKey:policy.metricKey,periodType:policy.periodType,periodStart:meter.periodStart,periodEnd:meter.periodEnd,
      decision:result.decision,usageValue:result.usageValue,softLimit:policy.softLimit,hardLimit:policy.hardLimit,
      reasonCode:result.reasonCode,
    };
    evaluations.push(evaluation);
    if(persist){
      await db.execute(
        `INSERT INTO quota_evaluations (
          id,tenant_id,workspace_id,run_id,policy_id,decision,metric_key,period_type,
          period_start,period_end,usage_value,soft_limit,hard_limit,reason_code,evaluated_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),run.tenant_id,run.workspace_id,runId,policy.id,result.decision,policy.metricKey,policy.periodType,
         meter.periodStart,meter.periodEnd,result.usageValue,policy.softLimit,policy.hardLimit,result.reasonCode,source]
      );
    }
  }
  const decision=evaluations.reduce((best,item)=>decisionRank[item.decision]>decisionRank[best]?item.decision:best,'ALLOW');
  return {runId,tenantId:run.tenant_id,workspaceId:run.workspace_id,decision,policyCount:policies.length,evaluations};
};
