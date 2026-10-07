import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5010';
const token=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>assert.equal(r.status,status,JSON.stringify(r.body));
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});
const plusSeconds=(value,seconds)=>new Date(new Date(value).getTime()+seconds*1000).toISOString();

const [[aigcObs]]=await db.execute(
  `SELECT * FROM aigc_performance_observations
    WHERE data_quality_status='PASS' AND JSON_EXTRACT(metrics_json,'$.completionRate') IS NOT NULL
    ORDER BY observed_at DESC,created_at DESC LIMIT 1`
);
assert.ok(aigcObs,'AIGC performance observation from M28.15 required');
const [[productObs]]=await db.execute(
  `SELECT * FROM product_outcome_observations
    WHERE data_quality_status='PASS' AND JSON_EXTRACT(value_json,'$.value') IS NOT NULL
    ORDER BY observed_at DESC,created_at DESC LIMIT 1`
);
assert.ok(productObs,'Product outcome observation from M27 required');

// Chinese module registry and gate labels.
let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M29_DATA_SOURCE,'数据源');
assert.equal(modules.M29_METRIC_DEFINITION,'指标定义');
assert.equal(modules.M29_DATA_QUALITY,'数据质量');
assert.equal(modules.M29_DETECTION_RULE,'检测规则');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M29-DATA-DETECTION').displayName,'数据 / 指标 / 质量 / 检测门禁');

// Secret-shaped connection metadata is rejected.
r=await request('POST','/api/runtime/m29-data-sources',{
  sourceKey:'M291-BAD-SECRET',displayName:'bad',
  scopeType:'PROJECT',projectId:aigcObs.project_id,adapterKey:'AIGC_PERFORMANCE',
  connectionRef:{provider:'INTERNAL',apiKey:'forbidden'},
  schemaContract:{kind:'AIGC_PERFORMANCE'},freshnessPolicy:{maxAgeSeconds:3600},
  permissionPolicy:{mode:'PROJECT_RBAC'},evidence:{test:true}
});
expect(r,400);
assert.equal(r.body.error,'M29_DATA_SOURCE_SECRET_NOT_ALLOWED');

const createSource=async({key,name,projectId,adapter})=>{
  const x=await request('POST','/api/runtime/m29-data-sources',{
    sourceKey:key,displayName:name,scopeType:'PROJECT',projectId,adapterKey:adapter,
    connectionRef:{provider:'RUNTIME_INTERNAL',tableBacked:true},
    schemaContract:{adapter,readOnly:true},
    freshnessPolicy:{maxAgeSeconds:7200},
    permissionPolicy:{mode:'PROJECT_RBAC'},
    evidence:{test:true,source:'M29.1'}
  });
  expect(x,201);return x.body.data;
};
const aigcSource=await createSource({
  key:'M291-AIGC-PERF',name:'AIGC 表现事实源',projectId:aigcObs.project_id,adapter:'AIGC_PERFORMANCE'
});
const productSource=await createSource({
  key:'M291-PRODUCT-OUTCOME',name:'产品结果事实源',projectId:productObs.project_id,adapter:'PRODUCT_OUTCOME'
});

const createMetric=async body=>{
  const x=await request('POST','/api/runtime/m29-metric-definitions',body);
  expect(x,201);return x.body.data;
};
const aigcMetric=await createMetric({
  sourceId:aigcSource.id,metricKey:'AIGC_COMPLETION_RATE',displayName:'AIGC 完播率',
  domainKey:'AIGC',valueType:'RATE',unit:'ratio',direction:'HIGHER_BETTER',
  extraction:{path:'completionRate'},dimensions:{platform:true,region:true,language:true},
  qualityPolicy:{maxAgeSeconds:7200,minSampleSize:100},
  evidence:{test:true}
});
const productMetric=await createMetric({
  sourceId:productSource.id,metricKey:'PRODUCT_PRIMARY_VALUE',displayName:'产品主结果指标',
  domainKey:'PRODUCT',valueType:'RATE',unit:'ratio',direction:'HIGHER_BETTER',
  extraction:{path:'value'},dimensions:{release:true},
  qualityPolicy:{maxAgeSeconds:7200,minSampleSize:100},
  evidence:{test:true}
});

// Caller does not provide a metric value: Runtime extracts it from the existing Domain fact.
r=await request('POST',`/api/runtime/projects/${aigcObs.project_id}/m29-metric-observations`,{
  metricDefinitionId:aigcMetric.id,sourceObjectId:aigcObs.id,
  observationKey:'M291-AIGC-GOOD',
  asOf:plusSeconds(aigcObs.observed_at,60),
  evidence:{test:true}
});
expect(r,201);
const aigcGood=r.body.data;
assert.equal(aigcGood.dataQuality.status,'PASS');
assert.ok(aigcGood.numericValue>=0&&aigcGood.numericValue<=1);

r=await request('POST',`/api/runtime/projects/${productObs.project_id}/m29-metric-observations`,{
  metricDefinitionId:productMetric.id,sourceObjectId:productObs.id,
  observationKey:'M291-PRODUCT-GOOD',
  asOf:plusSeconds(productObs.observed_at,60),
  evidence:{test:true}
});
expect(r,201);
const productGood=r.body.data;
assert.equal(productGood.dataQuality.status,'PASS');
assert.ok(productGood.numericValue>=0&&productGood.numericValue<=1);

// Same immutable source fact can be observed later; freshness degrades and must block a PASS-quality rule.
r=await request('POST',`/api/runtime/projects/${aigcObs.project_id}/m29-metric-observations`,{
  metricDefinitionId:aigcMetric.id,sourceObjectId:aigcObs.id,
  observationKey:'M291-AIGC-STALE',
  asOf:plusSeconds(aigcObs.observed_at,10800),
  evidence:{test:true,reason:'freshness-check'}
});
expect(r,201);
const aigcStale=r.body.data;
assert.equal(aigcStale.dataQuality.status,'WARN');
assert.ok(aigcStale.dataQuality.reasonCodes.includes('M29_DATA_STALE'));

const createRule=async(projectId,body)=>{
  const x=await request('POST',`/api/runtime/projects/${projectId}/m29-detection-rules`,body);
  expect(x,201);return x.body.data;
};
const aigcRule=await createRule(aigcObs.project_id,{
  metricDefinitionId:aigcMetric.id,ruleKey:'M291-AIGC-COMPLETION-LOW',
  displayName:'AIGC 完播率低于阈值',operator:'LT',threshold:{value:0.6},
  requiredQualityStatus:'PASS',severity:'MEDIUM',
  decisionPolicy:{nextLayer:'DECISION_CANDIDATE',automaticAction:false},
  evidence:{test:true}
});
const productRule=await createRule(productObs.project_id,{
  metricDefinitionId:productMetric.id,ruleKey:'M291-PRODUCT-PRIMARY-HIGH',
  displayName:'产品主结果指标达到阈值',operator:'GTE',threshold:{value:0.95},
  requiredQualityStatus:'PASS',severity:'LOW',
  decisionPolicy:{nextLayer:'DECISION_CANDIDATE',automaticAction:false},
  evidence:{test:true}
});

r=await request('POST',`/api/runtime/m29-detection-rules/${aigcRule.id}/evaluate`,{
  metricObservationId:aigcStale.id,evidence:{test:true}
});
expect(r,200);
assert.equal(r.body.data.matched,false);
assert.equal(r.body.data.blockedByQuality,true);
assert.equal(r.body.data.signal,null);

r=await request('POST',`/api/runtime/m29-detection-rules/${aigcRule.id}/evaluate`,{
  metricObservationId:aigcGood.id,evidence:{test:true}
});
expect(r,200);
assert.equal(r.body.data.blockedByQuality,false);
// M28.15 fixture completionRate is 0.48, so the signal is deterministic.
assert.equal(r.body.data.matched,true,JSON.stringify(r.body));
assert.ok(r.body.data.signal);

r=await request('POST',`/api/runtime/m29-detection-rules/${productRule.id}/evaluate`,{
  metricObservationId:productGood.id,evidence:{test:true}
});
expect(r,200);
assert.equal(r.body.data.matched,true,JSON.stringify(r.body));
assert.ok(r.body.data.signal);

// Both Domain adapters independently pass the unified Data / Quality / Detection gate.
for(const projectId of [aigcObs.project_id,productObs.project_id]){
  r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-DATA-DETECTION/evaluate`,{
    asOf:'2026-10-07T08:00:00Z'
  });
  expect(r,200);
  assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
  assert.equal(r.body.data.evidenceSnapshot.readyForDecisionLayer,true);
  assert.ok(r.body.data.evidenceSnapshot.dataSourceCount>=1);
  assert.ok(r.body.data.evidenceSnapshot.metricObservationCount>=1);
  assert.ok(r.body.data.evidenceSnapshot.detectionRuleCount>=1);
}

r=await request('GET',`/api/runtime/projects/${aigcObs.project_id}/m29-data-detection`);
expect(r,200);
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'数据 / 指标 / 质量 / 检测门禁');
assert.match(r.body.data.frontend.principle,/不能直接提交观测数值/);
assert.equal(r.body.data.sources.length,1);
assert.equal(r.body.data.metrics.length,1);
assert.equal(r.body.data.observations.length,2);
assert.equal(r.body.data.qualityEvaluations.length,2);
assert.equal(r.body.data.detectionRules.length,1);
assert.ok(r.body.data.signals.length>=1);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_data_sources WHERE source_key IN ('M291-AIGC-PERF','M291-PRODUCT-OUTCOME')) sources,
    (SELECT COUNT(*) FROM m29_metric_definitions WHERE metric_key IN ('AIGC_COMPLETION_RATE','PRODUCT_PRIMARY_VALUE')) metrics,
    (SELECT COUNT(*) FROM m29_metric_observations WHERE observation_key IN ('M291-AIGC-GOOD','M291-AIGC-STALE','M291-PRODUCT-GOOD')) observations,
    (SELECT COUNT(*) FROM m29_data_quality_evaluations q JOIN m29_metric_observations o ON o.id=q.metric_observation_id
      WHERE o.observation_key='M291-AIGC-STALE' AND q.status='WARN') stale_warn,
    (SELECT COUNT(*) FROM m29_detected_signals WHERE status='DETECTED') signals,
    (SELECT COUNT(DISTINCT project_id) FROM m29_data_detection_gate_evaluations
      WHERE gate_key='G-M29-DATA-DETECTION' AND status='PASS') gate_projects`
);
assert.equal(Number(truth.sources),2);
assert.equal(Number(truth.metrics),2);
assert.equal(Number(truth.observations),3);
assert.equal(Number(truth.stale_warn),1);
assert.ok(Number(truth.signals)>=2);
assert.equal(Number(truth.gate_projects),2);

await db.end();
console.log('M29_1_DATA_DETECTION_PASS');
