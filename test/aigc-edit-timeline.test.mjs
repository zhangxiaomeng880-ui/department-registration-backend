import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5003';
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

const [[project]]=await db.execute(
  `SELECT p.id,p.project_key,p.name
     FROM projects p
     JOIN aigc_m2810_gate_evaluations g ON g.project_id=p.id
    WHERE p.project_type='AIGC_CONTENT' AND g.gate_key='G-AIGC-PRODUCTION' AND g.status='PASS'
    ORDER BY g.as_of DESC,g.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.10 PASS project is required');
const projectId=project.id;

const [[breakdown]]=await db.execute(
  "SELECT id FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
  [projectId]
);
assert.ok(breakdown);

const [shots]=await db.execute(
  'SELECT id,shot_key FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY shot_key',[breakdown.id]
);
assert.equal(shots.length,71);
const shotIndex=new Map(shots.map((x,i)=>[x.id,i]));

const [locks]=await db.execute(
  `SELECT l.id,l.lock_key,r.shot_id,r.production_type
     FROM aigc_production_locks l
     JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
    WHERE l.project_id=? AND r.breakdown_plan_id=? AND r.applicability='REQUIRED'
      AND r.status='LOCKED' AND l.status='LOCKED'
    ORDER BY FIELD(r.production_type,'VIDEO','DIALOGUE','VOICE','MUSIC','SFX'),r.shot_id`,
  [projectId,breakdown.id]
);
assert.equal(locks.length,75);
assert.equal(locks.filter(x=>x.production_type==='VIDEO').length,71);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_TIMELINE_VERSION,'时间线与序列版本');
assert.equal(modules.AIGC_POST_PRODUCTION,'合成与后期');
assert.equal(modules.AIGC_CREATIVE_REVIEW,'创作审阅');
assert.equal(modules.AIGC_RENDER_EXPORT,'渲染与导出记录');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-EDIT').displayName,'剪辑 / 时间线门禁');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-EDIT/evaluate`,{
  asOf:'2026-10-07T05:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_CURRENT_LOCKED_TIMELINE_REQUIRED'));

const tracks=[
  {trackKey:'TRACK-VIDEO',trackType:'VIDEO',sequenceNo:1,displayName:'视频主轨',trackSettings:{role:'MASTER_VIDEO'},evidence:{source:'M28.11'}},
  {trackKey:'TRACK-DIALOGUE',trackType:'DIALOGUE',sequenceNo:2,displayName:'对白轨',trackSettings:{role:'DIALOGUE'},evidence:{source:'M28.11'}},
  {trackKey:'TRACK-VOICE',trackType:'VOICE',sequenceNo:3,displayName:'声音轨',trackSettings:{role:'VOICE'},evidence:{source:'M28.11'}},
  {trackKey:'TRACK-MUSIC',trackType:'MUSIC',sequenceNo:4,displayName:'音乐轨',trackSettings:{role:'MUSIC'},evidence:{source:'M28.11'}},
  {trackKey:'TRACK-SFX',trackType:'SFX',sequenceNo:5,displayName:'音效轨',trackSettings:{role:'SFX'},evidence:{source:'M28.11'}}
];
const trackByType=Object.fromEntries(tracks.map(x=>[x.trackType,x.trackKey]));
const seqByTrack=new Map();
const clips=[];
for(const lock of locks){
  const idx=shotIndex.get(lock.shot_id);
  assert.notEqual(idx,undefined);
  const isVideo=lock.production_type==='VIDEO';
  const start=isVideo?idx*6000:0;
  const end=isVideo?start+6000:4000;
  const current=(seqByTrack.get(lock.production_type)||0)+1;
  seqByTrack.set(lock.production_type,current);
  clips.push({
    clipKey:`CLIP-${lock.production_type}-${String(current).padStart(3,'0')}`,
    trackKey:trackByType[lock.production_type],sequenceNo:current,shotId:lock.shot_id,
    sourceType:'PRODUCTION_LOCK',productionLockId:lock.id,sourceVersionKey:lock.lock_key,
    sourceInMs:0,sourceOutMs:isVideo?6000:4000,timelineStartMs:start,timelineEndMs:end,speed:1,
    transition:{type:isVideo?'CUT':'NONE'},
    lineage:{productionLockId:lock.id,breakdownPlanId:breakdown.id,productionType:lock.production_type},
    evidence:{source:'M28.10 locked production output'}
  });
}
assert.equal(clips.length,75);

const postProductionPlan={
  editRhythm:{status:'PASS',intent:'真实关系节奏，避免短平快强剪'},
  compositing:{status:'PASS',policy:'只做必要合成，不重构空间'},
  colorGrade:{status:'PASS',intent:'台湾生活质感 / 自然光'},
  audioMix:{status:'PASS',intent:'对白优先，音乐不过度抢情绪'},
  subtitlesCaptions:{status:'PASS',policy:'字幕由确定性文本渲染'},
  graphicsUi:{status:'N_A',rationale:'当前母时间线无额外图形 UI'},
  deterministicText:{status:'PASS',policy:'关键中文不由图像模型自由生成'},
  vfxFix:{status:'N_A',rationale:'当前验证版无额外 VFX 修复'}
};

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-timeline-versions`,{
  timelineKey:'LX-EDIT-TIMELINE-V1',versionNo:1,title:'《你好，那年夏天》剪辑时间线 V1',
  durationMs:71*6000,postProductionPlan,tracks,clips,
  evidence:{source:'M28.10 production locks',purpose:'M28.11 edit timeline validation'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const timelineId=r.body.data.id;
assert.equal(r.body.data.status,'DRAFT');
assert.equal(r.body.data.trackCount,5);
assert.equal(r.body.data.clipCount,75);
assert.equal(r.body.data.requiredProductionLockCount,75);

// Preview export is allowed during DRAFT and is kept as history.
r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/render-exports`,{
  exportKey:'LX-EDIT-PREVIEW-V1',exportVersionNo:1,exportType:'PREVIEW',
  contentLocator:{provider:'CI_TEST',ref:'ci://m2811/preview/v1'},
  renderSpec:{resolution:'1998x1080',fps:24,aspect:'1.85:1',codec:'H264'},
  sourceFingerprintSha256:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status:'PASS',evidence:{purpose:'creative review preview'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

// Requested Change comment cannot be resolved without formal approved decision.
r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/review-threads`,{
  threadKey:'REVIEW-001',anchorType:'TIMECODE',timecodeMs:12000,
  reviewer:{role:'导演 / 最终审核人'},approvalRole:'CREATIVE_APPROVER',
  comment:'这一处停顿再短一点，保持自然但不要拖。',
  requestedChange:{scope:'TIMELINE',action:'TRIM',affectedRange:{startMs:12000,endMs:12500}},
  evidence:{review:'timecode anchored'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const review1=r.body.data.id;

r=await request('POST',`/api/runtime/aigc-timeline-review-threads/${review1}/resolve`,{
  resolution:{result:'按正式决策执行'},evidence:{test:'decision required'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_TIMELINE_REVIEW_DECISION_REQUIRED');

r=await request('POST',`/api/runtime/aigc-timeline-review-threads/${review1}/resolve`,{
  resolution:{result:'批准将该处缩短 500ms'},
  decisionRef:{status:'APPROVED',reference:'DECISION:EDIT-TRIM-001'},
  evidence:{approval:'creative reviewer'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RESOLVED');

// Plain review can resolve without a Change Decision.
r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/review-threads`,{
  threadKey:'REVIEW-002',anchorType:'SHOT',shotId:shots[0].id,timecodeMs:1000,
  reviewer:{role:'QA Reviewer'},approvalRole:'CREATIVE_REVIEWER',
  comment:'首镜头身份、场景和声音连续性确认。',
  evidence:{review:'shot anchored'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const review2=r.body.data.id;
r=await request('POST',`/api/runtime/aigc-timeline-review-threads/${review2}/resolve`,{
  resolution:{result:'确认，无需修改'},evidence:{review:'PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));

// Reopen is auditable and blocks lock until resolved again.
r=await request('POST',`/api/runtime/aigc-timeline-review-threads/${review1}/reopen`,{
  reason:'二次复核要求确认缩短后与对白同步',evidence:{review:'second pass'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'OPEN');

r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/lock`,{
  approval:{status:'APPROVED',approver:'导演 / 最终审核人'},evidence:{test:'open review must block'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_TIMELINE_REVIEW_OPEN');

r=await request('POST',`/api/runtime/aigc-timeline-review-threads/${review1}/resolve`,{
  resolution:{result:'对白同步复核通过，维持批准的 500ms 缩短'},
  decisionRef:{status:'APPROVED',reference:'DECISION:EDIT-TRIM-001'},
  evidence:{review:'second pass PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/lock`,{
  approval:{status:'APPROVED',approver:'导演 / 最终审核人'},
  evidence:{review:'all threads resolved',source:'M28.11'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'LOCKED');
assert.equal(r.body.data.isCurrent,true);

// Gate remains HOLD until a PASS Edit Master export exists.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-EDIT/evaluate`,{
  asOf:'2026-10-07T05:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_EDIT_MASTER_EXPORT_REQUIRED'));

r=await request('POST',`/api/runtime/aigc-timeline-versions/${timelineId}/render-exports`,{
  exportKey:'LX-EDIT-MASTER-V1',exportVersionNo:2,exportType:'EDIT_MASTER',
  contentLocator:{provider:'CI_TEST',ref:'ci://m2811/edit-master/v1'},
  renderSpec:{resolution:'1998x1080',fps:24,aspect:'1.85:1',codec:'ProRes-compatible-test',audio:'48kHz'},
  sourceFingerprintSha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  status:'PASS',evidence:{render:'timeline locked + review resolved'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

// Locked timeline cannot silently branch without approved Change/Decision.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-timeline-versions`,{
  timelineKey:'LX-EDIT-TIMELINE-V2',versionNo:2,title:'《你好，那年夏天》剪辑时间线 V2',
  durationMs:71*6000,postProductionPlan,tracks,clips,parentTimelineVersionId:timelineId,
  evidence:{test:'silent post-lock revision'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_TIMELINE_CHANGE_DECISION_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-EDIT/evaluate`,{
  asOf:'2026-10-07T05:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.trackCount,5);
assert.equal(r.body.data.evidenceSnapshot.clipCount,75);
assert.equal(r.body.data.evidenceSnapshot.requiredProductionLockCount,75);
assert.equal(r.body.data.evidenceSnapshot.usedRequiredProductionLockCount,75);
assert.equal(r.body.data.evidenceSnapshot.openReviewCount,0);
assert.equal(r.body.data.evidenceSnapshot.reviewThreadCount,2);
assert.equal(r.body.data.evidenceSnapshot.editMasterPassCount,1);
assert.equal(r.body.data.evidenceSnapshot.exportCount,2);
assert.equal(r.body.data.evidenceSnapshot.timelineReady,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-edit-timeline`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'剪辑 / 时间线门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,['时间线与序列版本','合成与后期','创作审阅','渲染与导出记录']);
assert.equal(r.body.data.timelines.length,1);
assert.equal(r.body.data.timelines[0].status,'LOCKED');
assert.equal(r.body.data.timelines[0].isCurrent,true);
assert.equal(r.body.data.tracks.length,5);
assert.equal(r.body.data.clips.length,75);
assert.equal(r.body.data.reviews.length,2);
assert.equal(r.body.data.reviews.filter(x=>x.status==='RESOLVED').length,2);
assert.equal(r.body.data.reviewEvents.filter(x=>x.reviewThreadId===review1).length,4);
assert.equal(r.body.data.exports.length,2);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_timeline_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE) current_timeline,
    (SELECT COUNT(*) FROM aigc_timeline_tracks WHERE project_id=?) tracks,
    (SELECT COUNT(*) FROM aigc_timeline_clips WHERE project_id=?) clips,
    (SELECT COUNT(DISTINCT production_lock_id) FROM aigc_timeline_clips WHERE project_id=? AND production_lock_id IS NOT NULL) unique_prod_locks,
    (SELECT COUNT(*) FROM aigc_timeline_review_threads WHERE project_id=? AND status='OPEN') open_reviews,
    (SELECT COUNT(*) FROM aigc_timeline_review_events WHERE project_id=? AND event_type='REOPEN') reopen_events,
    (SELECT COUNT(*) FROM aigc_render_exports WHERE project_id=?) exports,
    (SELECT COUNT(*) FROM aigc_render_exports WHERE project_id=? AND export_type='EDIT_MASTER' AND status='PASS') master_pass`,
  [projectId,projectId,projectId,projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.current_timeline),1);
assert.equal(Number(truth.tracks),5);
assert.equal(Number(truth.clips),75);
assert.equal(Number(truth.unique_prod_locks),75);
assert.equal(Number(truth.open_reviews),0);
assert.equal(Number(truth.reopen_events),1);
assert.equal(Number(truth.exports),2);
assert.equal(Number(truth.master_pass),1);

await db.end();
console.log('M28_11_AIGC_EDIT_TIMELINE_PASS');
