import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value) throw new Error(`Missing ${name}`);
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

const [[publication]]=await db.execute(
  `SELECT p.id,p.project_id,p.published_at
     FROM aigc_publication_records p
     JOIN aigc_post_publish_verifications v ON v.publication_record_id=p.id
    WHERE p.status='PUBLISHED' AND v.status='PASS'
    ORDER BY v.verified_at DESC,p.created_at DESC LIMIT 1`
);
assert.ok(publication,'M28.14 verified published receipt is required');
const projectId=publication.project_id;

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_PERFORMANCE_OBSERVATION,'表现数据观测');
assert.equal(modules.AIGC_PRODUCTION_METRICS,'生产指标快照');
assert.equal(modules.AIGC_EXPERIMENT_CANDIDATE,'实验候选');
assert.equal(modules.AIGC_FEEDBACK_SIGNAL,'反馈信号');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-PERFORMANCE').displayName,'表现 / 实验 / 反馈门禁');
assert.equal(
  r.body.data.find(x=>x.labelType==='EXPERIMENT_SCOPE'&&x.stableKey==='DISTRIBUTION').displayName,
  '分发实验'
);

// Without post-publish observations and production metrics the gate must remain HOLD.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PERFORMANCE/evaluate`,{
  asOf:'2026-10-07T06:30:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_PERFORMANCE_OBSERVATION_COVERAGE_INCOMPLETE'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_PRODUCTION_METRIC_SNAPSHOT_REQUIRED'));
assert.equal(r.body.data.evidenceSnapshot.storyRuleChangesRequireStage14HumanGate,true);

// Rate metrics cannot exceed 1.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-performance-observations`,{
  publicationRecordId:publication.id,
  observationKey:'M2815-BAD-RATE',
  windowStart:'2026-10-08T03:00:00Z',
  windowEnd:'2026-10-08T04:00:00Z',
  metrics:{retention3s:1.2},
  dimensions:{platform:'YOUTUBE',region:'US',language:'en-US'},
  sampleSize:100,
  dataQualityStatus:'PASS',
  dataQuality:{sourceCoverage:'PASS'},
  source:{provider:'CI_MOCK'},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_PERFORMANCE_RATE_INVALID');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-performance-observations`,{
  publicationRecordId:publication.id,
  observationKey:'M2815-PERFORMANCE-OBS-001',
  windowStart:'2026-10-08T03:00:00Z',
  windowEnd:'2026-10-08T09:00:00Z',
  metrics:{
    entryRate:0.91,
    retention3s:0.72,
    retention5s:0.61,
    completionRate:0.48,
    watchTimeSeconds:88.4,
    likeRate:0.08,
    commentRate:0.02,
    saveRate:0.03,
    shareRate:0.015,
    followRate:0.01,
    profileRate:0.018,
    ctaConversionRate:0.006,
    nextEpisodeRate:0.37,
    continuousWatchRate:0.29,
    ostJumpRate:0.012,
    fullContentJumpRate:0.021
  },
  dimensions:{
    platform:'YOUTUBE',region:'US',language:'en-US',
    localizationLevel:'SUBTITLE',variant:'CHARACTER-POV-EN'
  },
  sampleSize:1200,
  dataQualityStatus:'PASS',
  dataQuality:{sourceCoverage:'PASS',dedupe:'PASS',freshness:'PASS'},
  source:{provider:'CI_MOCK',receipt:'M28.14'},
  evidence:{test:true,realExternalAnalytics:false}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const observationId=r.body.data.id;
assert.equal(r.body.data.dataQualityStatus,'PASS');
assert.equal(r.body.data.sampleSize,1200);

// Snapshot is derived from actual CI generation/candidate history, not caller-supplied KPI numbers.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-production-metric-snapshots`,{
  snapshotKey:'M2815-PRODUCTION-SNAPSHOT-001',
  windowStart:'2026-10-01T00:00:00Z',
  windowEnd:'2026-10-08T23:59:59Z',
  evidence:{source:'runtime-generation-history',test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const snapshotId=r.body.data.id;
const pm=r.body.data.metrics;
assert.ok(pm.generationCount>0,JSON.stringify(pm));
assert.ok(pm.candidateCount>0,JSON.stringify(pm));
assert.ok(pm.selectedCount>0,JSON.stringify(pm));
assert.ok(pm.candidateToSelectedRate>=0&&pm.candidateToSelectedRate<=1,JSON.stringify(pm));
assert.ok(pm.firstPassQaRate>=0&&pm.firstPassQaRate<=1,JSON.stringify(pm));
assert.ok(pm.failureBlockedRate>=0&&pm.failureBlockedRate<=1,JSON.stringify(pm));
assert.ok(pm.assetReuseRate>=0&&pm.assetReuseRate<=1,JSON.stringify(pm));
assert.equal(typeof pm.modelToolSuccessRate,'object');

// Stage 13 may not auto-promote a Story Rule.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  candidateKey:'M2815-STORY-RULE-FORBIDDEN',
  experimentScope:'CREATIVE',
  sourceObservationIds:[observationId],
  sourceSnapshotIds:[snapshotId],
  hypothesis:{statement:'Try to promote a story rule directly'},
  control:{variant:'CURRENT'},
  treatment:{variant:'STORY_RULE_CHANGE'},
  targetMetrics:{completionRate:'HIGHER_BETTER'},
  guardrails:{rights:'NO_CHANGE'},
  expectedLearning:{question:'forbidden path'},
  risk:{level:'HIGH'},
  requestedPromotion:'STORY_RULE',
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_STORY_RULE_REVIEW_HUMAN_GATE_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-experiment-candidates`,{
  candidateKey:'M2815-DISTRIBUTION-EXP-001',
  experimentScope:'DISTRIBUTION',
  sourceObservationIds:[observationId],
  sourceSnapshotIds:[snapshotId],
  hypothesis:{statement:'Shorter opening hook may improve 3s retention without changing story fact'},
  control:{hookSeconds:5,source:'CURRENT_DISTRIBUTION_VERSION'},
  treatment:{hookSeconds:3,source:'DERIVED_VARIANT_ONLY'},
  targetMetrics:{retention3s:'HIGHER_BETTER',completionRate:'NO_REGRESSION'},
  guardrails:{storyFact:'NO_CHANGE',rights:'NO_CHANGE',disclosure:'PASS'},
  expectedLearning:{question:'Does a shorter hook improve entry retention?'},
  risk:{level:'LOW',externalPublishRequiresStage12:true},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const experimentId=r.body.data.id;
assert.equal(r.body.data.experimentScope,'DISTRIBUTION');
assert.equal(r.body.data.status,'CANDIDATE');
assert.equal(r.body.data.storyRulePromotionAllowed,false);

// Story-change feedback is allowed only as a signal routed to Stage 14 review.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-feedback-signals`,{
  feedbackKey:'M2815-FEEDBACK-STORY-REVIEW',
  sourceType:'PERFORMANCE',
  sourceRef:{observationId,experimentCandidateId:experimentId},
  summary:'表现数据提示某个剧情节奏值得复盘，但不能在 Stage 13 自动改 Story Rule。',
  severity:'MEDIUM',
  classification:{type:'STORY_REVIEW_CANDIDATE',confidence:0.72},
  recommendedScope:'CREATIVE',
  storyRuleChangeRequested:true,
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.recommendedScope,'STORY_REVIEW');
assert.equal(r.body.data.requiresStage14HumanGate,true);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PERFORMANCE/evaluate`,{
  asOf:'2026-10-07T06:40:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.verifiedPublicationCount,1);
assert.equal(r.body.data.evidenceSnapshot.observedVerifiedPublicationCount,1);
assert.equal(r.body.data.evidenceSnapshot.productionSnapshotCount,1);
assert.equal(r.body.data.evidenceSnapshot.experimentCandidateCount,1);
assert.equal(r.body.data.evidenceSnapshot.feedbackSignalCount,1);
assert.equal(r.body.data.evidenceSnapshot.storyRuleChangeFeedbackCount,1);
assert.equal(r.body.data.evidenceSnapshot.storyRuleChangesRequireStage14HumanGate,true);
assert.equal(r.body.data.evidenceSnapshot.readyForReview,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-performance`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'表现 / 实验 / 反馈门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,
  ['表现数据观测','生产指标快照','实验候选','反馈信号']);
assert.match(r.body.data.frontend.storyRulePolicy,/人工门禁/);
assert.equal(r.body.data.observations.length,1);
assert.equal(r.body.data.productionSnapshots.length,1);
assert.equal(r.body.data.experimentCandidates.length,1);
assert.equal(r.body.data.feedbackSignals.length,1);
assert.equal(r.body.data.feedbackSignals[0].recommendedScope,'STORY_REVIEW');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_performance_observations WHERE project_id=?) observations,
    (SELECT COUNT(*) FROM aigc_production_metric_snapshots WHERE project_id=?) snapshots,
    (SELECT COUNT(*) FROM aigc_experiment_candidates WHERE project_id=? AND experiment_scope IN ('DISTRIBUTION','PRODUCTION','CREATIVE')) candidates,
    (SELECT COUNT(*) FROM aigc_feedback_signals WHERE project_id=? AND story_rule_change_requested=TRUE AND recommended_scope='STORY_REVIEW') story_review_signals,
    (SELECT COUNT(*) FROM aigc_m2815_gate_evaluations WHERE project_id=? AND gate_key='G-AIGC-PERFORMANCE' AND status='PASS') gate_pass`,
  [projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.observations),1);
assert.equal(Number(truth.snapshots),1);
assert.equal(Number(truth.candidates),1);
assert.equal(Number(truth.story_review_signals),1);
assert.equal(Number(truth.gate_pass),1);

await db.end();
console.log('M28_15_AIGC_PERFORMANCE_EXPERIMENT_PASS');
