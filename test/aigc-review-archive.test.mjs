import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5009';
const token=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[perfGate]]=await db.execute(
  `SELECT * FROM aigc_m2815_gate_evaluations
    WHERE gate_key='G-AIGC-PERFORMANCE' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`
);
assert.ok(perfGate,'M28.15 PASS performance gate required');
const projectId=perfGate.project_id;

const [[master]]=await db.execute(
  "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
const [[pkg]]=await db.execute(
  "SELECT * FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
const [[release]]=await db.execute(
  "SELECT * FROM aigc_release_plans WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
const [[storyFeedback]]=await db.execute(
  "SELECT * FROM aigc_feedback_signals WHERE project_id=? AND story_rule_change_requested=TRUE ORDER BY collected_at DESC LIMIT 1",
  [projectId]
);
assert.ok(master&&pkg&&release&&storyFeedback);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_REVIEW_CYCLE,'复盘周期');
assert.equal(modules.AIGC_KNOWLEDGE_RECORD,'知识沉淀');
assert.equal(modules.AIGC_IMPROVEMENT_BACKLOG,'改进待办');
assert.equal(modules.AIGC_NEXT_VERSION_PROPOSAL,'下一版本候选');
assert.equal(modules.AIGC_DELIVERY_ARCHIVE,'交付 / 归档包');

const reviewDimensions={
  plannedVsActual:{status:'REVIEWED'},assetCoverageReuse:{status:'REVIEWED'},
  generationFailureModes:{status:'REVIEWED'},modelToolQualityCostLatency:{status:'REVIEWED'},
  firstPassRegenerationQa:{status:'REVIEWED'},timelineEditingRework:{status:'REVIEWED'},
  distributionPerformance:{status:'REVIEWED'},localizationRoi:{status:'REVIEWED'},
  rightsCompliance:{status:'REVIEWED'},agentSkillPromptWorkflow:{status:'REVIEWED'}
};
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-review-cycles`,{
  reviewKey:'M2816-REVIEW',versionNo:1,performanceGateEvaluationId:perfGate.id,
  reviewWindow:{start:'2026-10-01T00:00:00Z',end:'2026-10-08T00:00:00Z'},
  plannedActual:{milestone:'M28',plannedStages:15,actualStages:15},
  reviewDimensions,
  findings:{summary:'M28 structural lifecycle review'},
  improvementSummary:{focus:['asset reuse','generation reliability','distribution learning']},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const reviewId=r.body.data.id;

const domains=['STORY','VISUAL','AUDIO','PRODUCTION','DISTRIBUTION','PERFORMANCE'];
for(const [i,domain] of domains.entries()){
  r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/knowledge`,{
    knowledgeKey:`M2816-${domain}`,domainKey:domain,
    knowledgeType:i===1?'PATTERN':i===2?'ANTI_PATTERN':'KNOWLEDGE',
    statement:`${domain} knowledge from verified M28 execution evidence`,
    applicability:{scope:'PROJECT',version:'V2.8'},
    evidenceRefs:[{type:'GATE',ref:perfGate.id}],
    confidence:{level:0.9,evidenceStrength:'HIGH'},
    evidence:{test:true}
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/improvements`,{
  itemKey:'M2816-IMPROVE-REUSE',improvementType:'WORKFLOW',
  title:'提高资产复用可观测性',
  problem:{signal:'asset reuse needs explicit trend'},
  recommendation:{action:'carry reuse metrics into next cycle'},
  priority:'P1',acceptance:{metric:'assetReuseRate',condition:'tracked'},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/next-version-proposals`,{
  proposalKey:'M2816-DIST-EXP',proposalType:'DISTRIBUTION_EXPERIMENT',
  sourceRefs:{performanceGateId:perfGate.id},
  title:'下一轮分发 Hook 实验',
  hypothesis:{statement:'shorter hook may improve retention'},
  proposedChange:{scope:'DISTRIBUTION_ONLY'},
  guardrails:{storyFact:'NO_CHANGE',rights:'NO_CHANGE'},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/next-version-proposals`,{
  proposalKey:'M2816-STORY-REVIEW',proposalType:'STORY_RULE_CHANGE',
  sourceRefs:{feedbackSignalIds:[storyFeedback.id]},
  title:'Story Rule 复盘候选',
  hypothesis:{statement:'performance signal suggests review only'},
  proposedChange:{scope:'STORY_RULE',automatic:false},
  guardrails:{humanGate:'REQUIRED'},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const storyProposalId=r.body.data.id;
assert.equal(r.body.data.humanGateRequired,true);

r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/archive-packages`,{
  archiveKey:'M2816-ARCHIVE',versionNo:1,
  masterVersionId:master.id,distributionPackageId:pkg.id,releasePlanId:release.id,
  finalAssets:{masterVersionId:master.id,distributionPackageId:pkg.id},
  reconstructableSources:{timeline:true,projectSources:true},
  manifests:{
    script:{status:'CAPTURED'},shot:{status:'CAPTURED'},timeline:{status:'CAPTURED'},
    caption:{status:'CAPTURED'},audioTracks:{status:'CAPTURED'}
  },
  selectedAssetProvenance:{status:'CAPTURED'},
  qaEvalEvidence:{status:'CAPTURED',performanceGateId:perfGate.id},
  rightsEvidence:{status:'CAPTURED'},
  publicationPerformanceSnapshot:{status:'CAPTURED'},
  retentionPolicy:{failedGenerationMetadata:'AUDIT_METADATA_ONLY',selectedCandidates:'RETAIN'},
  restoreVerification:{status:'PASS',evidence:{mode:'CI_STRUCTURAL_RESTORE_TEST'}},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const archiveId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-REVIEW/evaluate`,{
  reviewCycleId:reviewId,asOf:'2026-10-07T07:10:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_STORY_RULE_HUMAN_REVIEW_UNRESOLVED'));
assert.equal(r.body.data.evidenceSnapshot.unresolvedStoryRuleFeedbackIds.length,1);

// Structural Human Gate fixture: proves Runtime cannot resolve Story Rule without explicit HUMAN decision.
r=await request('POST',`/api/runtime/aigc-next-version-proposals/${storyProposalId}/decide`,{
  decision:{
    mode:'HUMAN',decision:'REJECTED',decidedByRef:'CI_HUMAN_REVIEW_FIXTURE',
    decidedAt:'2026-10-07T07:11:00Z',reason:'Keep story rule unchanged; retain signal as knowledge only'
  },
  evidence:{test:true,structuralFixture:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'REJECTED');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-REVIEW/evaluate`,{
  reviewCycleId:reviewId,asOf:'2026-10-07T07:12:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.deepEqual(r.body.data.evidenceSnapshot.missingKnowledgeDomains,[]);
assert.equal(r.body.data.evidenceSnapshot.knowledgeDomains.length,6);
assert.equal(r.body.data.evidenceSnapshot.backlogCount,1);
assert.equal(r.body.data.evidenceSnapshot.nextVersionProposalCount,2);
assert.equal(r.body.data.evidenceSnapshot.storyRuleFeedbackCount,1);
assert.equal(r.body.data.evidenceSnapshot.resolvedStoryRuleFeedbackCount,1);
assert.equal(r.body.data.evidenceSnapshot.storyRuleChangesRequireHumanGate,true);
assert.equal(r.body.data.evidenceSnapshot.archivePackageId,archiveId);
assert.equal(r.body.data.evidenceSnapshot.archiveRestoreVerified,true);
assert.equal(r.body.data.evidenceSnapshot.readyToCloseVersion,true);

r=await request('POST',`/api/runtime/aigc-review-cycles/${reviewId}/freeze`,{
  archivePackageId:archiveId,
  approval:{mode:'GATE_PASS',gate:'G-AIGC-REVIEW'},
  evidence:{test:true,version:'M28'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.archiveStatus,'FROZEN');
assert.equal(r.body.data.versionClosed,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-review`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'复盘 / 知识 / 下一版本门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,
  ['复盘周期','知识沉淀','改进待办','下一版本候选','交付 / 归档包']);
assert.match(r.body.data.frontend.storyRulePolicy,/人工批准或拒绝/);
assert.equal(r.body.data.knowledge.length,6);
assert.equal(r.body.data.improvementBacklog.length,1);
assert.equal(r.body.data.nextVersionProposals.length,2);
assert.equal(r.body.data.archives.length,1);
assert.equal(r.body.data.archives[0].status,'FROZEN');
assert.equal(r.body.data.archives[0].isCurrent,true);
assert.equal(r.body.data.reviews[0].status,'FROZEN');
assert.equal(r.body.data.reviews[0].isCurrent,true);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(DISTINCT domain_key) FROM aigc_knowledge_records WHERE review_cycle_id=? AND status='APPROVED') knowledge_domains,
    (SELECT COUNT(*) FROM aigc_improvement_backlog WHERE review_cycle_id=?) backlog,
    (SELECT COUNT(*) FROM aigc_next_version_proposals WHERE review_cycle_id=?) proposals,
    (SELECT COUNT(*) FROM aigc_next_version_proposals WHERE id=? AND status='REJECTED' AND JSON_UNQUOTE(JSON_EXTRACT(human_decision_json,'$.mode'))='HUMAN') story_human_decision,
    (SELECT COUNT(*) FROM aigc_archive_packages WHERE id=? AND status='FROZEN' AND is_current=TRUE) frozen_archive,
    (SELECT COUNT(*) FROM aigc_review_cycles WHERE id=? AND status='FROZEN' AND is_current=TRUE) frozen_review,
    (SELECT COUNT(*) FROM aigc_m2816_gate_evaluations WHERE review_cycle_id=? AND gate_key='G-AIGC-REVIEW' AND status='PASS') gate_pass`,
  [reviewId,reviewId,reviewId,storyProposalId,archiveId,reviewId,reviewId]
);
assert.equal(Number(truth.knowledge_domains),6);
assert.equal(Number(truth.backlog),1);
assert.equal(Number(truth.proposals),2);
assert.equal(Number(truth.story_human_decision),1);
assert.equal(Number(truth.frozen_archive),1);
assert.equal(Number(truth.frozen_review),1);
assert.equal(Number(truth.gate_pass),1);

await db.end();
console.log('M28_16_AIGC_REVIEW_ARCHIVE_PASS');
