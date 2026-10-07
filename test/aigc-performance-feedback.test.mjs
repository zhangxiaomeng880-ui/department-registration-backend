import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5008';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[pub]]=await db.execute(
  `SELECT r.id,r.project_id,i.platform_key,i.region,i.language
     FROM aigc_publication_records r
     JOIN aigc_release_plan_items i ON i.id=r.release_plan_item_id
     JOIN aigc_post_publish_verifications v ON v.publication_record_id=r.id AND v.status='PASS'
    WHERE r.status='PUBLISHED'
    ORDER BY v.verified_at DESC,v.created_at DESC LIMIT 1`
);
assert.ok(pub,'M28.14 verified publication is required');
const projectId=pub.project_id;

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_PERFORMANCE_SNAPSHOT,'表现数据快照');
assert.equal(modules.AIGC_PRODUCTION_METRICS,'生产效率指标');
assert.equal(modules.AIGC_EXPERIMENT_CANDIDATE,'实验候选');
assert.equal(modules.AIGC_FEEDBACK_SIGNAL,'反馈信号');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-PERFORMANCE').displayName,'表现 / 实验 / 反馈门禁');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PERFORMANCE/evaluate`,{
  asOf:'2026-10-09T00:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_PERFORMANCE_SNAPSHOT_REQUIRED'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_PRODUCTION_METRIC_SNAPSHOT_REQUIRED'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_EXPERIMENT_CANDIDATE_REQUIRED'));

// Secrets/credentials never belong in analytics source metadata.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-performance-snapshots`,{
  publicationRecordId:pub.id,snapshotKey:'BAD-SECRET',platformKey:pub.platform_key,
  region:pub.region,language:pub.language,
  windowStart:'2026-10-08T03:00:00Z',windowEnd:'2026-10-08T04:00:00Z',
  metrics:{entry:100,retention3s:0.8},
  sampleSize:100,dataQualityStatus:'PASS',dataQuality:{coverage:'PASS'},
  source:{provider:'CI_ANALYTICS',token:'forbidden'},
  confidence:'HIGH',limitations:{test:true},evidence:{test:true},
  observedAt:'2026-10-08T04:05:00Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_PERFORMANCE_SOURCE_CREDENTIAL_FORBIDDEN');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-performance-snapshots`,{
  publicationRecordId:pub.id,snapshotKey:'M2815-PERF-01',platformKey:pub.platform_key,
  region:pub.region,language:pub.language,
  windowStart:'2026-10-08T03:00:00Z',windowEnd:'2026-10-08T08:00:00Z',
  metrics:{
    entry:1000,retention3s:0.72,retention5s:0.61,completionRate:0.42,
    watchTimeSeconds:18600,likeCount:88,commentCount:21,saveCount:35,shareCount:17,
    followCount:12,profileVisits:49,ctaConversions:6
  },
  sampleSize:1000,dataQualityStatus:'PASS',
  dataQuality:{coverage:'PASS',freshness:'PASS',classification:'CI_STRUCTURAL_FIXTURE'},
  source:{provider:'CI_ANALYTICS_RECEIPT',receiptId:'m2815-perf-01',externalFetch:false},
  confidence:'HIGH',limitations:{sample:'CI structural fixture; not real audience data'},
  evidence:{source:'M28.15 performance contract validation'},
  observedAt:'2026-10-08T08:05:00Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const performanceId=r.body.data.id;
assert.equal(r.body.data.publicationRecordId,pub.id);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-production-metric-snapshots`,{
  snapshotKey:'M2815-PRODUCTION-01',asOf:'2026-10-08T08:10:00Z',
  evidence:{source:'Runtime generation/candidate aggregate'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const productionId=r.body.data.id;
assert.ok(r.body.data.metrics.generationCount>0);
assert.ok(r.body.data.metrics.candidateCount>0);
assert.ok(r.body.data.metrics.selectedCurrentCount>0);
assert.ok(r.body.data.metrics.modelToolSuccessRate.length>0);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-feedback-signals`,{
  performanceSnapshotId:performanceId,signalKey:'M2815-FEEDBACK-01',
  feedbackType:'QUALITATIVE',subject:'hook',
  signal:{theme:'前5秒情绪进入速度',observation:'保留当前母内容，仅测试不同开场切片'},
  source:{provider:'CI_REVIEW',receiptId:'feedback-01'},confidence:'MEDIUM',
  severity:'MEDIUM',recommendedScope:'CREATIVE',storyRuleChangeRequested:false,
  limitation:{notRepresentativeOfPopulation:true},collectedAt:'2026-10-08T08:06:00Z',
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const feedbackId=r.body.data.id;

// Stage 13 may not invent a STORY_RULE experiment type.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  experimentKey:'BAD-STORY-RULE',experimentType:'STORY_RULE',
  hypothesis:'should be rejected',
  sourcePerformanceSnapshotIds:[performanceId],target:{stage:'STORY'},variant:{proposalOnly:true},
  successMetrics:{evidenceStrength:'TEST'},guardrails:{currentStoryRule:'IMMUTABLE'},evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_EXPERIMENT_TYPE_INVALID');

// Nor can it auto-apply Story Rule changes through a Creative candidate.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  experimentKey:'BAD-AUTO-STORY',experimentType:'CREATIVE',
  hypothesis:'should be rejected',
  sourcePerformanceSnapshotIds:[performanceId],target:{surface:'hook'},variant:{hook:'B'},
  successMetrics:{retention3s:'UP'},guardrails:{storyFact:'IMMUTABLE'},
  storyRuleEscalation:{requested:true,reason:'test',reviewGate:'G-AIGC-REVIEW',autoApply:true},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_STORY_RULE_AUTO_APPLY_FORBIDDEN');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  experimentKey:'M2815-DISTRIBUTION-EXP-01',experimentType:'DISTRIBUTION',
  hypothesis:'Shorter opening packaging may improve 3s retention without changing mother content',
  sourcePerformanceSnapshotIds:[performanceId],
  sourceProductionMetricSnapshotIds:[productionId],
  sourceFeedbackSignalIds:[feedbackId],
  target:{surface:'HOOK',platformKey:pub.platform_key,region:pub.region,language:pub.language},
  variant:{type:'ALTERNATE_OPENING_DERIVATIVE',motherContentImmutable:true},
  successMetrics:{retention3s:{direction:'UP'},completionRate:{direction:'NON_DECREASE'}},
  guardrails:{storyFact:'IMMUTABLE',masterVersion:'UNCHANGED',externalPublish:'SEPARATE_HUMAN_GATE'},
  storyRuleEscalation:{requested:false},
  evidence:{source:'M28.15 evidence-backed experiment candidate'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'CANDIDATE');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  experimentKey:'M2815-CREATIVE-REVIEW-01',experimentType:'CREATIVE',
  hypothesis:'Repeated performance evidence may justify reviewing a future Story Rule',
  sourcePerformanceSnapshotIds:[performanceId],
  sourceFeedbackSignalIds:[feedbackId],
  target:{surface:'FUTURE_VERSION_REVIEW'},variant:{proposalOnly:true},
  successMetrics:{evidenceStrength:'REQUIRES_REVIEW'},
  guardrails:{currentStoryFact:'IMMUTABLE',currentScript:'IMMUTABLE'},
  storyRuleEscalation:{
    requested:true,reason:'Only propose for Stage 14 review; do not change current story',
    reviewGate:'G-AIGC-REVIEW',humanGateRequired:true,applied:false
  },
  evidence:{source:'M28.15 review-required escalation validation'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'REVIEW_REQUIRED');
assert.equal(r.body.data.storyRuleEscalationRequested,true);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PERFORMANCE/evaluate`,{
  asOf:'2026-10-08T08:30:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.verifiedPublicationCount>=1,true);
assert.equal(r.body.data.evidenceSnapshot.performanceSnapshotCount,1);
assert.equal(r.body.data.evidenceSnapshot.productionMetricSnapshotCount,1);
assert.equal(r.body.data.evidenceSnapshot.feedbackSignalCount,1);
assert.equal(r.body.data.evidenceSnapshot.experimentCandidateCount,2);
assert.equal(r.body.data.evidenceSnapshot.distributionExperimentCount,1);
assert.equal(r.body.data.evidenceSnapshot.creativeExperimentCount,1);
assert.equal(r.body.data.evidenceSnapshot.reviewRequiredStoryEscalationCount,1);
assert.equal(r.body.data.evidenceSnapshot.storyRuleAppliedCount,0);
assert.equal(r.body.data.evidenceSnapshot.storyRuleAutoMutationExecuted,false);
assert.equal(r.body.data.evidenceSnapshot.coveredPublicationCount,r.body.data.evidenceSnapshot.verifiedPublicationCount);
assert.deepEqual(r.body.data.evidenceSnapshot.dataQualityFailSnapshotIds,[]);
assert.equal(r.body.data.evidenceSnapshot.readyForReviewAndKnowledge,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-performance-feedback`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'表现 / 实验 / 反馈门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,['表现数据快照','生产效率指标','实验候选','反馈信号']);
assert.match(r.body.data.frontend.storyRulePolicy,/Story Rule.*人工门禁/);
assert.equal(r.body.data.performanceSnapshots.length,1);
assert.equal(r.body.data.performanceSnapshots[0].sampleSize,1000);
assert.equal(r.body.data.performanceSnapshots[0].dataQualityStatus,'PASS');
assert.equal(r.body.data.productionMetricSnapshots.length,1);
assert.equal(r.body.data.feedbackSignals.length,1);
assert.equal(r.body.data.feedbackSignals[0].severity,'MEDIUM');
assert.equal(r.body.data.feedbackSignals[0].recommendedScope,'CREATIVE');
assert.equal(r.body.data.experimentCandidates.length,2);
assert.equal(
  r.body.data.experimentCandidates.find(x=>x.experimentKey==='M2815-CREATIVE-REVIEW-01').storyRuleEscalation.applied,
  false
);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_performance_snapshots WHERE project_id=?) performance_snapshots,
    (SELECT COUNT(*) FROM aigc_production_metric_snapshots WHERE project_id=?) production_snapshots,
    (SELECT COUNT(*) FROM aigc_feedback_signals WHERE project_id=?) feedback_signals,
    (SELECT COUNT(*) FROM aigc_experiment_candidates WHERE project_id=? AND status='CANDIDATE') candidates,
    (SELECT COUNT(*) FROM aigc_experiment_candidates WHERE project_id=? AND status='REVIEW_REQUIRED') review_required,
    (SELECT COUNT(*) FROM aigc_m2815_gate_evaluations WHERE project_id=? AND gate_key='G-AIGC-PERFORMANCE' AND status='PASS') gate_pass`,
  [projectId,projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.performance_snapshots),1);
assert.equal(Number(truth.production_snapshots),1);
assert.equal(Number(truth.feedback_signals),1);
assert.equal(Number(truth.candidates),1);
assert.equal(Number(truth.review_required),1);
assert.equal(Number(truth.gate_pass),1);

await db.end();
console.log('M28_15_AIGC_PERFORMANCE_FEEDBACK_PASS');
