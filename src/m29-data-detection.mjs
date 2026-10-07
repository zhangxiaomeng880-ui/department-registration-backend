import { createHash,randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-M29-DATA-DETECTION';
const SOURCE_ADAPTERS=new Set(['AIGC_PERFORMANCE','PRODUCT_OUTCOME']);
const SCOPE_TYPES=new Set(['PLATFORM','WORKSPACE','PROJECT']);
const DOMAINS=new Set(['PRODUCT','AIGC','PLATFORM','PORTFOLIO']);
const VALUE_TYPES=new Set(['RATE','COUNT','DURATION','COST','SCORE','NUMBER']);
const DIRECTIONS=new Set(['HIGHER_BETTER','LOWER_BETTER','NEUTRAL']);
const QUALITY=new Set(['PASS','WARN','FAIL']);
const OPERATORS=new Set(['GT','GTE','LT','LTE','EQ','BETWEEN','OUTSIDE']);
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);

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
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const secretKey=/token|secret|password|api[_-]?key|credential|authorization|bearer/i;
const rejectSecrets=(value,path='connectionRef')=>{
  if(value==null||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(secretKey.test(key))throw errorOf(
      'Connection references must not persist secrets',
      'M29_DATA_SOURCE_SECRET_NOT_ALLOWED',400,{field:path+'.'+key}
    );
    rejectSecrets(child,path+'.'+key);
  }
};
const getPath=(value,path)=>{
  if(path==null||path===''||path==='$')return value;
  return String(path).replace(/^\$\.?/,'').split('.').filter(Boolean)
    .reduce((acc,key)=>acc==null?undefined:acc[key],value);
};
const qualityRank=status=>({PASS:0,WARN:1,FAIL:2}[upper(status)]??99);
const qualityAllowed=(actual,required)=>qualityRank(actual)<=qualityRank(required);
const compare=(operator,value,threshold)=>{
  const op=upper(operator);
  if(op==='GT')return value>Number(threshold.value);
  if(op==='GTE')return value>=Number(threshold.value);
  if(op==='LT')return value<Number(threshold.value);
  if(op==='LTE')return value<=Number(threshold.value);
  if(op==='EQ')return value===Number(threshold.value);
  if(op==='BETWEEN')return value>=Number(threshold.min)&&value<=Number(threshold.max);
  if(op==='OUTSIDE')return value<Number(threshold.min)||value>Number(threshold.max);
  return false;
};

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    `SELECT p.id,p.workspace_id,w.tenant_id,p.project_type,p.project_key,p.name
       FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=?`,[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadSource=async(sourceId,db)=>{
  const [rows]=await db.execute('SELECT * FROM m29_data_sources WHERE id=?',[sourceId]);
  if(!rows.length)throw errorOf('Data source not found','M29_DATA_SOURCE_NOT_FOUND',404);
  return rows[0];
};
const loadMetric=async(metricId,db)=>{
  const [rows]=await db.execute(
    `SELECT m.*,s.adapter_key,s.scope_type,s.tenant_id,s.workspace_id,s.project_id AS source_project_id,
            s.status AS source_status,s.connection_ref_json,s.freshness_policy_json
       FROM m29_metric_definitions m JOIN m29_data_sources s ON s.id=m.source_id
      WHERE m.id=?`,[metricId]
  );
  if(!rows.length)throw errorOf('Metric definition not found','M29_METRIC_NOT_FOUND',404);
  return rows[0];
};
const assertSourceScope=(source,project)=>{
  if(source.scope_type==='PROJECT'&&source.source_project_id!==project.id)
    throw errorOf('Metric source is scoped to another project','M29_DATA_SOURCE_SCOPE_MISMATCH',409);
  if(source.scope_type==='WORKSPACE'&&source.workspace_id!==project.workspace_id)
    throw errorOf('Metric source is scoped to another workspace','M29_DATA_SOURCE_SCOPE_MISMATCH',409);
  if(source.tenant_id&&source.tenant_id!==project.tenant_id)
    throw errorOf('Metric source tenant mismatch','M29_DATA_SOURCE_SCOPE_MISMATCH',409);
};
const sourceObservation=async(db,adapterKey,projectId,sourceObjectId,extraction)=>{
  if(adapterKey==='AIGC_PERFORMANCE'){
    const [rows]=await db.execute(
      `SELECT id,metrics_json,dimensions_json,sample_size,data_quality_status,observed_at,evidence_json
         FROM aigc_performance_observations WHERE id=? AND project_id=?`,
      [sourceObjectId,projectId]
    );
    if(!rows.length)throw errorOf('AIGC performance source object not found','M29_SOURCE_OBJECT_NOT_FOUND',404);
    const row=rows[0],metrics=parseJson(row.metrics_json)||{};
    return {
      sourceObjectType:'AIGC_PERFORMANCE_OBSERVATION',
      value:getPath(metrics,extraction.path),
      dimensions:parseJson(row.dimensions_json)||{},
      sampleSize:row.sample_size==null?null:Number(row.sample_size),
      sourceQualityStatus:upper(row.data_quality_status||'PASS'),
      observedAt:new Date(row.observed_at),
      evidence:{adapterKey,sourceEvidence:parseJson(row.evidence_json)||null}
    };
  }
  if(adapterKey==='PRODUCT_OUTCOME'){
    const [rows]=await db.execute(
      `SELECT id,value_json,sample_size,data_quality_status,observed_at,evidence_json
         FROM product_outcome_observations WHERE id=? AND project_id=?`,
      [sourceObjectId,projectId]
    );
    if(!rows.length)throw errorOf('Product outcome source object not found','M29_SOURCE_OBJECT_NOT_FOUND',404);
    const row=rows[0],valueJson=parseJson(row.value_json);
    return {
      sourceObjectType:'PRODUCT_OUTCOME_OBSERVATION',
      value:getPath(valueJson,extraction.path),
      dimensions:extraction.dimensions||{},
      sampleSize:row.sample_size==null?null:Number(row.sample_size),
      sourceQualityStatus:upper(row.data_quality_status||'PASS'),
      observedAt:new Date(row.observed_at),
      evidence:{adapterKey,sourceEvidence:parseJson(row.evidence_json)||null}
    };
  }
  throw errorOf('Unsupported data source adapter','M29_DATA_SOURCE_ADAPTER_INVALID',409,{adapterKey});
};

export const resolveM29DataProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};

export const createM29DataSource=async(input={})=>{
  requireFields(input,[
    'sourceKey','displayName','scopeType','adapterKey','connectionRef','schemaContract',
    'freshnessPolicy','permissionPolicy','evidence'
  ],'INVALID_M29_DATA_SOURCE');
  const scopeType=upper(input.scopeType),adapterKey=upper(input.adapterKey);
  if(!SCOPE_TYPES.has(scopeType))throw errorOf('Unsupported source scope','M29_DATA_SOURCE_SCOPE_INVALID',409);
  if(!SOURCE_ADAPTERS.has(adapterKey))throw errorOf('Unsupported source adapter','M29_DATA_SOURCE_ADAPTER_INVALID',409,{adapterKey});
  rejectSecrets(input.connectionRef);
  if(scopeType==='PROJECT'&&!input.projectId)throw errorOf('PROJECT source needs projectId','M29_DATA_SOURCE_PROJECT_REQUIRED',409);
  if(scopeType==='WORKSPACE'&&!input.workspaceId)throw errorOf('WORKSPACE source needs workspaceId','M29_DATA_SOURCE_WORKSPACE_REQUIRED',409);
  const db=getRuntimePool();
  let tenantId=input.tenantId||null,workspaceId=input.workspaceId||null,projectId=input.projectId||null;
  if(projectId){
    const project=await loadProject(projectId,db);
    if(workspaceId&&workspaceId!==project.workspace_id)throw errorOf('Source workspace/project mismatch','M29_DATA_SOURCE_SCOPE_MISMATCH',409);
    if(tenantId&&tenantId!==project.tenant_id)throw errorOf('Source tenant/project mismatch','M29_DATA_SOURCE_SCOPE_MISMATCH',409);
    workspaceId=project.workspace_id;tenantId=project.tenant_id;
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_data_sources
      (id,source_key,display_name,scope_type,tenant_id,workspace_id,project_id,adapter_key,
       connection_ref_json,schema_contract_json,freshness_policy_json,permission_policy_json,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?)`,
    [id,input.sourceKey,input.displayName,scopeType,tenantId,workspaceId,projectId,adapterKey,
     asJson(input.connectionRef),asJson(input.schemaContract),asJson(input.freshnessPolicy),
     asJson(input.permissionPolicy),asJson(input.evidence)]
  );
  return {id,sourceKey:input.sourceKey,displayName:input.displayName,scopeType,adapterKey,status:'ACTIVE'};
};

export const createM29MetricDefinition=async(input={})=>{
  requireFields(input,[
    'sourceId','metricKey','displayName','domainKey','valueType','unit','direction',
    'extraction','dimensions','qualityPolicy','evidence'
  ],'INVALID_M29_METRIC_DEFINITION');
  const domain=upper(input.domainKey),valueType=upper(input.valueType),direction=upper(input.direction);
  if(!DOMAINS.has(domain))throw errorOf('Unsupported metric domain','M29_METRIC_DOMAIN_INVALID',409,{domain});
  if(!VALUE_TYPES.has(valueType))throw errorOf('Unsupported metric value type','M29_METRIC_VALUE_TYPE_INVALID',409,{valueType});
  if(!DIRECTIONS.has(direction))throw errorOf('Unsupported metric direction','M29_METRIC_DIRECTION_INVALID',409,{direction});
  if(!nonEmpty(input.extraction.path))throw errorOf('Metric extraction path is required','M29_METRIC_EXTRACTION_REQUIRED',409);
  const db=getRuntimePool(),source=await loadSource(input.sourceId,db);
  if(source.status!=='ACTIVE')throw errorOf('Metric source is not active','M29_DATA_SOURCE_NOT_ACTIVE',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_metric_definitions
      (id,source_id,metric_key,display_name,domain_key,value_type,unit,direction,
       extraction_json,dimensions_json,quality_policy_json,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
    [id,source.id,input.metricKey,input.displayName,domain,valueType,input.unit,direction,
     asJson(input.extraction),asJson(input.dimensions),asJson(input.qualityPolicy),asJson(input.evidence)]
  );
  return {id,sourceId:source.id,metricKey:input.metricKey,displayName:input.displayName,
    domainKey:domain,valueType,direction,status:'ACTIVE'};
};

export const captureM29MetricObservation=async(projectId,input={})=>{
  requireFields(input,['metricDefinitionId','sourceObjectId','observationKey','evidence'],
    'INVALID_M29_METRIC_OBSERVATION');
  const db=getRuntimePool(),project=await loadProject(projectId,db),metric=await loadMetric(input.metricDefinitionId,db);
  if(metric.status!=='ACTIVE'||metric.source_status!=='ACTIVE')throw errorOf('Metric/source is not active','M29_METRIC_NOT_ACTIVE',409);
  assertSourceScope(metric,project);
  const extraction=parseJson(metric.extraction_json)||{};
  const source=await sourceObservation(db,metric.adapter_key,projectId,input.sourceObjectId,extraction);
  const numericValue=Number(source.value);
  if(!Number.isFinite(numericValue))throw errorOf(
    'Extracted metric value is not numeric','M29_METRIC_VALUE_NOT_NUMERIC',409,
    {path:extraction.path,sourceObjectId:input.sourceObjectId}
  );
  if(metric.value_type==='RATE'&&(numericValue<0||numericValue>1))
    throw errorOf('RATE observation must be in [0,1]','M29_METRIC_RATE_INVALID',409,{numericValue});
  const observedAt=source.observedAt,asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_metric_observations
      (id,project_id,metric_definition_id,source_object_type,source_object_id,observation_key,
       numeric_value,dimensions_json,source_quality_status,sample_size,observed_at,source_evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,metric.id,source.sourceObjectType,input.sourceObjectId,input.observationKey,
     numericValue,asJson({...source.dimensions,...(input.dimensions||{})}),source.sourceQualityStatus,
     source.sampleSize,observedAt,asJson({...source.evidence,captureEvidence:input.evidence})]
  );
  const policy=parseJson(metric.quality_policy_json)||{};
  const ageSeconds=Math.max(0,(asOf-observedAt)/1000);
  const maxAge=Number(policy.maxAgeSeconds??86400),minSample=Number(policy.minSampleSize??0);
  const freshnessStatus=ageSeconds<=maxAge?'PASS':'WARN';
  const completenessStatus='PASS';
  const sampleStatus=source.sampleSize==null||source.sampleSize>=minSample?'PASS':'FAIL';
  const sourceQualityStatus=QUALITY.has(source.sourceQualityStatus)?source.sourceQualityStatus:'FAIL';
  const overall=[freshnessStatus,completenessStatus,sampleStatus,sourceQualityStatus].includes('FAIL')
    ?'FAIL':[freshnessStatus,sourceQualityStatus].includes('WARN')?'WARN':'PASS';
  const reasonCodes=[];
  if(freshnessStatus!=='PASS')reasonCodes.push('M29_DATA_STALE');
  if(sampleStatus!=='PASS')reasonCodes.push('M29_SAMPLE_TOO_SMALL');
  if(sourceQualityStatus!=='PASS')reasonCodes.push('M29_UPSTREAM_QUALITY_'+sourceQualityStatus);
  const qualityId=randomUUID();
  await db.execute(
    `INSERT INTO m29_data_quality_evaluations
      (id,project_id,metric_observation_id,status,freshness_status,completeness_status,
       sample_status,source_quality_status,checks_json,reason_codes_json,evaluated_at,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [qualityId,projectId,id,overall,freshnessStatus,completenessStatus,sampleStatus,sourceQualityStatus,
     asJson({ageSeconds,maxAgeSeconds:maxAge,minSampleSize:minSample}),asJson(reasonCodes),asOf,asJson(input.evidence)]
  );
  return {id,projectId,metricDefinitionId:metric.id,observationKey:input.observationKey,
    numericValue,dataQuality:{id:qualityId,status:overall,reasonCodes},observedAt};
};

export const createM29DetectionRule=async(projectId,input={})=>{
  requireFields(input,[
    'metricDefinitionId','ruleKey','displayName','operator','threshold',
    'requiredQualityStatus','severity','decisionPolicy','evidence'
  ],'INVALID_M29_DETECTION_RULE');
  const operator=upper(input.operator),quality=upper(input.requiredQualityStatus),severity=upper(input.severity);
  if(!OPERATORS.has(operator))throw errorOf('Unsupported detection operator','M29_DETECTION_OPERATOR_INVALID',409,{operator});
  if(!QUALITY.has(quality))throw errorOf('Unsupported quality requirement','M29_DETECTION_QUALITY_INVALID',409,{quality});
  if(!SEVERITIES.has(severity))throw errorOf('Unsupported signal severity','M29_DETECTION_SEVERITY_INVALID',409,{severity});
  const db=getRuntimePool(),project=await loadProject(projectId,db),metric=await loadMetric(input.metricDefinitionId,db);
  assertSourceScope(metric,project);
  const threshold=input.threshold||{};
  const required=operator==='BETWEEN'||operator==='OUTSIDE'?['min','max']:['value'];
  if(required.some(k=>!Number.isFinite(Number(threshold[k]))))
    throw errorOf('Detection threshold invalid','M29_DETECTION_THRESHOLD_INVALID',409,{operator,threshold});
  const id=randomUUID();
  await db.execute(
    `INSERT INTO m29_detection_rules
      (id,project_id,metric_definition_id,rule_key,display_name,operator,threshold_json,
       required_quality_status,severity,dedupe_window_seconds,decision_policy_json,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
    [id,projectId,metric.id,input.ruleKey,input.displayName,operator,asJson(threshold),quality,severity,
     Number(input.dedupeWindowSeconds??3600),asJson(input.decisionPolicy),asJson(input.evidence)]
  );
  return {id,projectId,metricDefinitionId:metric.id,ruleKey:input.ruleKey,
    displayName:input.displayName,operator,requiredQualityStatus:quality,severity,status:'ACTIVE'};
};

export const evaluateM29DetectionRule=async(ruleId,input={})=>{
  requireFields(input,['metricObservationId','evidence'],'INVALID_M29_DETECTION_EVALUATION');
  const db=getRuntimePool();
  const [rules]=await db.execute('SELECT * FROM m29_detection_rules WHERE id=?',[ruleId]);
  const rule=rules[0];
  if(!rule)throw errorOf('Detection rule not found','M29_DETECTION_RULE_NOT_FOUND',404);
  if(rule.status!=='ACTIVE')throw errorOf('Detection rule is not active','M29_DETECTION_RULE_NOT_ACTIVE',409);
  const [rows]=await db.execute(
    `SELECT o.*,q.id AS quality_id,q.status AS quality_status
       FROM m29_metric_observations o
       JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
      WHERE o.id=? AND o.project_id=? AND o.metric_definition_id=?`,
    [input.metricObservationId,rule.project_id,rule.metric_definition_id]
  );
  const obs=rows[0];
  if(!obs)throw errorOf('Observation does not match rule scope','M29_DETECTION_OBSERVATION_SCOPE_INVALID',409);
  const threshold=parseJson(rule.threshold_json)||{};
  const allowed=qualityAllowed(obs.quality_status,rule.required_quality_status);
  const matched=allowed&&compare(rule.operator,Number(obs.numeric_value),threshold);
  const evaluatedAt=input.evaluatedAt?new Date(input.evaluatedAt):new Date();
  if(Number.isNaN(evaluatedAt.getTime()))throw errorOf('Invalid evaluatedAt','INVALID_DATE');
  const evalId=randomUUID();
  await db.execute(
    `INSERT INTO m29_detection_evaluations
      (id,project_id,detection_rule_id,metric_observation_id,data_quality_evaluation_id,
       matched,evaluated_value,comparison_json,quality_status,evaluated_at,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [evalId,rule.project_id,rule.id,obs.id,obs.quality_id,matched?1:0,obs.numeric_value,
     asJson({operator:rule.operator,threshold,qualityRequired:rule.required_quality_status}),
     obs.quality_status,evaluatedAt,asJson(input.evidence)]
  );
  let signal=null;
  if(matched){
    const bucket=Math.floor(evaluatedAt.getTime()/1000/Math.max(1,Number(rule.dedupe_window_seconds||3600)));
    const dedupeKey=sha256([rule.id,obs.id,bucket].join('|'));
    const signalId=randomUUID();
    await db.execute(
      `INSERT IGNORE INTO m29_detected_signals
        (id,project_id,detection_rule_id,detection_evaluation_id,metric_observation_id,
         signal_key,severity,signal_payload_json,dedupe_key,status,evidence_json,detected_at)
       VALUES (?,?,?,?,?,?,?,?,?,'DETECTED',?,?)`,
      [signalId,rule.project_id,rule.id,evalId,obs.id,
       rule.rule_key+':'+obs.observation_key,rule.severity,
       asJson({ruleKey:rule.rule_key,value:Number(obs.numeric_value),operator:rule.operator,threshold}),
       dedupeKey,asJson(input.evidence),evaluatedAt]
    );
    const [signals]=await db.execute('SELECT * FROM m29_detected_signals WHERE dedupe_key=?',[dedupeKey]);
    signal=signals[0]?{id:signals[0].id,signalKey:signals[0].signal_key,severity:signals[0].severity,status:signals[0].status}:null;
  }
  return {id:evalId,projectId:rule.project_id,detectionRuleId:rule.id,
    metricObservationId:obs.id,matched,qualityStatus:obs.quality_status,
    blockedByQuality:!allowed,signal};
};

export const evaluateM29DataDetectionGate=async(projectId,input={})=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[];
  const [sources,metrics,observations,qualities,rules,signals]=await Promise.all([
    listRows(db,`SELECT * FROM m29_data_sources WHERE status='ACTIVE'
      AND (scope_type='PLATFORM' OR project_id=? OR workspace_id=(SELECT workspace_id FROM projects WHERE id=?))`,[projectId,projectId]),
    listRows(db,`SELECT m.* FROM m29_metric_definitions m JOIN m29_data_sources s ON s.id=m.source_id
      WHERE m.status='ACTIVE' AND s.status='ACTIVE'
      AND (s.scope_type='PLATFORM' OR s.project_id=? OR s.workspace_id=(SELECT workspace_id FROM projects WHERE id=?))`,[projectId,projectId]),
    listRows(db,'SELECT * FROM m29_metric_observations WHERE project_id=?',[projectId]),
    listRows(db,'SELECT q.* FROM m29_data_quality_evaluations q WHERE q.project_id=?',[projectId]),
    listRows(db,'SELECT * FROM m29_detection_rules WHERE project_id=? AND status="ACTIVE"',[projectId]),
    listRows(db,'SELECT * FROM m29_detected_signals WHERE project_id=?',[projectId])
  ]);
  if(!sources.length)reasons.push('M29_DATA_SOURCE_REQUIRED');
  if(!metrics.length)reasons.push('M29_METRIC_DEFINITION_REQUIRED');
  if(!observations.length)reasons.push('M29_METRIC_OBSERVATION_REQUIRED');
  if(observations.length!==qualities.length)reasons.push('M29_DATA_QUALITY_COVERAGE_INCOMPLETE');
  if(qualities.some(x=>x.status==='FAIL'))reasons.push('M29_DATA_QUALITY_FAIL');
  if(!rules.length)reasons.push('M29_DETECTION_RULE_REQUIRED');
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const evidence={
    dataSourceCount:sources.length,metricDefinitionCount:metrics.length,
    metricObservationCount:observations.length,dataQualityEvaluationCount:qualities.length,
    dataQualityFailCount:qualities.filter(x=>x.status==='FAIL').length,
    detectionRuleCount:rules.length,detectedSignalCount:signals.length,
    adapters:[...new Set(sources.map(x=>x.adapter_key))].sort(),
    readyForDecisionLayer:reasons.length===0
  };
  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO m29_data_detection_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of)
     VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf]
  );
  return result;
};

export const getM29DataDetectionState=async projectId=>{
  const project=await loadProject(projectId),db=getRuntimePool();
  const [sources,metrics,observations,qualities,rules,evaluations,signals,gates]=await Promise.all([
    listRows(db,`SELECT * FROM m29_data_sources WHERE scope_type='PLATFORM' OR project_id=? OR workspace_id=? ORDER BY source_key`,[projectId,project.workspace_id]),
    listRows(db,`SELECT m.* FROM m29_metric_definitions m JOIN m29_data_sources s ON s.id=m.source_id
      WHERE s.scope_type='PLATFORM' OR s.project_id=? OR s.workspace_id=? ORDER BY m.metric_key`,[projectId,project.workspace_id]),
    listRows(db,'SELECT * FROM m29_metric_observations WHERE project_id=? ORDER BY observed_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_data_quality_evaluations WHERE project_id=? ORDER BY evaluated_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_detection_rules WHERE project_id=? ORDER BY rule_key',[projectId]),
    listRows(db,'SELECT * FROM m29_detection_evaluations WHERE project_id=? ORDER BY evaluated_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_detected_signals WHERE project_id=? ORDER BY detected_at,id',[projectId]),
    listRows(db,'SELECT * FROM m29_data_detection_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,projectType:project.project_type},
    frontend:{
      language:'zh-CN',
      moduleNames:['数据源','指标定义','数据质量','检测规则'],
      gateName:'数据 / 指标 / 质量 / 检测门禁',
      principle:'统一层只读取 Domain 事实源；调用方不能直接提交观测数值'
    },
    sources:sources.map(x=>({id:x.id,sourceKey:x.source_key,displayName:x.display_name,scopeType:x.scope_type,adapterKey:x.adapter_key,status:x.status})),
    metrics:metrics.map(x=>({id:x.id,sourceId:x.source_id,metricKey:x.metric_key,displayName:x.display_name,domainKey:x.domain_key,valueType:x.value_type,unit:x.unit,direction:x.direction,status:x.status})),
    observations:observations.map(x=>({id:x.id,metricDefinitionId:x.metric_definition_id,sourceObjectType:x.source_object_type,sourceObjectId:x.source_object_id,observationKey:x.observation_key,numericValue:Number(x.numeric_value),dimensions:parseJson(x.dimensions_json),sourceQualityStatus:x.source_quality_status,sampleSize:x.sample_size==null?null:Number(x.sample_size),observedAt:x.observed_at})),
    qualityEvaluations:qualities.map(x=>({id:x.id,metricObservationId:x.metric_observation_id,status:x.status,reasonCodes:parseJson(x.reason_codes_json),checks:parseJson(x.checks_json),evaluatedAt:x.evaluated_at})),
    detectionRules:rules.map(x=>({id:x.id,metricDefinitionId:x.metric_definition_id,ruleKey:x.rule_key,displayName:x.display_name,operator:x.operator,threshold:parseJson(x.threshold_json),requiredQualityStatus:x.required_quality_status,severity:x.severity,status:x.status})),
    detectionEvaluations:evaluations.map(x=>({id:x.id,detectionRuleId:x.detection_rule_id,metricObservationId:x.metric_observation_id,matched:Boolean(x.matched),evaluatedValue:Number(x.evaluated_value),qualityStatus:x.quality_status,evaluatedAt:x.evaluated_at})),
    signals:signals.map(x=>({id:x.id,detectionRuleId:x.detection_rule_id,detectionEvaluationId:x.detection_evaluation_id,metricObservationId:x.metric_observation_id,signalKey:x.signal_key,severity:x.severity,payload:parseJson(x.signal_payload_json),status:x.status,detectedAt:x.detected_at})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
