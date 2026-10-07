import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5002';
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
     JOIN aigc_m289_gate_evaluations g ON g.project_id=p.id
    WHERE p.project_type='AIGC_CONTENT' AND g.gate_key='G-AIGC-IMAGE' AND g.status='PASS'
    ORDER BY g.as_of DESC,g.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.9 PASS project is required');
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

const [callSheets]=await db.execute(
  `SELECT cs.id,req.shot_id
     FROM aigc_asset_call_sheets cs
     JOIN aigc_shot_asset_requirements req ON req.id=cs.asset_requirement_id
    WHERE cs.project_id=? AND cs.breakdown_plan_id=? AND cs.status='READY'
    ORDER BY req.shot_id,cs.created_at,cs.id`,
  [projectId,breakdown.id]
);
const callSheetByShot=new Map();
for(const row of callSheets) if(!callSheetByShot.has(row.shot_id))callSheetByShot.set(row.shot_id,row.id);
assert.equal(shots.filter(x=>callSheetByShot.has(x.id)).length,71);

const [keyframes]=await db.execute(
  `SELECT c.id,c.candidate_key,c.shot_id
     FROM aigc_generation_candidates c
     JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
    WHERE c.project_id=? AND c.is_current=TRUE AND c.selection_status='SELECTED'
      AND j.generation_kind='KEYFRAME' AND j.status='PASS'
    ORDER BY c.shot_id`,
  [projectId]
);
assert.equal(keyframes.length,71);
const keyframeByShot=new Map(keyframes.map(x=>[x.shot_id,x]));

const [[assetVersion]]=await db.execute(
  `SELECT id,version_key,state
     FROM aigc_asset_versions
    WHERE owner_project_id=? AND state IN ('PASS','CURRENT','LOCKED','FROZEN')
    ORDER BY FIELD(state,'LOCKED','FROZEN','CURRENT','PASS'),created_at LIMIT 1`,
  [projectId]
);
assert.ok(assetVersion);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_VIDEO_MOTION_PRODUCTION,'视频与动作生产');
assert.equal(modules.AIGC_DIALOGUE_VOICE_PRODUCTION,'对白与声音生产');
assert.equal(modules.AIGC_MUSIC_SFX_PRODUCTION,'音乐与音效生产');
assert.equal(modules.AIGC_PRODUCTION_FAILURE_RERUN,'生产失败与局部重跑');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-PRODUCTION').displayName,'视频 / 音频生产门禁');
assert.equal(r.body.data.find(x=>x.labelType==='PRODUCTION_STATUS'&&x.stableKey==='N_A').displayName,'不适用');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PRODUCTION/evaluate`,{
  asOf:'2026-10-07T04:40:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_PRODUCTION_REQUIREMENT_COVERAGE_INCOMPLETE'));

const firstShot=shots[0];
const requirements=[];
for(const shot of shots){
  for(const type of ['VIDEO','DIALOGUE','VOICE','MUSIC','SFX']){
    const required=type==='VIDEO'||shot.id===firstShot.id;
    requirements.push({
      requirementKey:`PROD-${shot.shot_key}-${type}`,
      shotId:shot.id,productionType:type,applicability:required?'REQUIRED':'N_A',
      sourceSpec:{
        shotKey:shot.shot_key,
        source:type==='VIDEO'?'CURRENT KEYFRAME + Shot spec':'Script/Audio strategy + Shot spec'
      },
      qaPolicy:{
        requiredDimensions:type==='VIDEO'
          ?['characterSceneContinuity','actionTrajectory','cameraMovement','timingDuration','frameArtifact','temporalContinuity','technicalIntegrity']
          :['media-specific QA matrix']
      },
      rationale:required
        ?(type==='VIDEO'?'每个 Shot 必须生成视频':'首镜头用于验证对白/声音/音乐/音效正式生产链')
        :'当前镜头该媒体类型不适用，显式 N_A',
      evidence:{source:'M28.10 production applicability matrix'}
    });
  }
}
assert.equal(requirements.length,355);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-production-requirements`,{
  requirements,evidence:{source:'M28.10 71-shot media applicability matrix'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.requirementCount,355);
assert.equal(r.body.data.requiredCount,75);
assert.equal(r.body.data.notApplicableCount,280);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-video-audio-production`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'视频 / 音频生产门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,
  ['视频与动作生产','对白与声音生产','音乐与音效生产','生产失败与局部重跑']);
assert.equal(r.body.data.requirements.length,355);

const reqByPair=new Map(r.body.data.requirements.map(x=>[`${x.shotId}|${x.productionType}`,x]));
const stableSha=n=>Number(n).toString(16).padStart(64,'0').slice(-64);
const videoQa=()=>({
  characterSceneContinuity:'PASS',actionTrajectory:'PASS',cameraMovement:'PASS',
  timingDuration:'PASS',frameArtifact:'PASS',temporalContinuity:'PASS',technicalIntegrity:'PASS'
});
const voiceQa=()=>({
  voiceIdentity:'PASS',pronunciation:'PASS',performance:'PASS',lipSync:'N_A',
  clippingNoise:'PASS',technicalIntegrity:'PASS'
});
const audioQa=()=>({
  sourceRights:'PASS',cueTiming:'PASS',mixIntent:'PASS',loudness:'PASS',technicalIntegrity:'PASS'
});

const createJob=async({shot,type,suffix='A',status='RUNNING',candidateRef=true,index=1})=>{
  const refs=[];
  if(type==='VIDEO'&&candidateRef){
    const kf=keyframeByShot.get(shot.id);
    refs.push({
      referenceId:kf.id,referenceType:'GENERATION_CANDIDATE',role:'FIRST_FRAME',versionKey:kf.candidate_key
    });
  }else{
    refs.push({
      referenceId:assetVersion.id,referenceType:'ASSET_VERSION',role:'AUDIO',versionKey:assetVersion.version_key
    });
  }
  const res=await request('POST',`/api/runtime/projects/${projectId}/aigc-generation-jobs`,{
    jobKey:`M2810-${shot.shot_key}-${type}-${suffix}`,
    generationKind:type,shotId:shot.id,parentCallSheetId:callSheetByShot.get(shot.id),
    provider:'CI_TEST_PROVIDER',modelTool:`CI ${type} Generator`,modelToolVersion:'m28.10-test',
    toolKey:`TOOL:CI_${type}`,prompt:`Produce ${type} for ${shot.shot_key} from locked upstream references.`,
    negativePrompt:'no story fact mutation; no unapproved identity/scene change',promptVersion:'M28.10-PROMPT-V1',
    referenceBindings:refs,parameters:{durationSeconds:type==='VIDEO'?6:4,seed:index},
    inputFingerprintSha256:stableSha(10000+index+(suffix==='B'?1000:0)),
    requestedOutputCount:1,status,retry:{maxAttempts:2,currentAttempt:1},
    safety:{status:'PASS'},provenance:{source:'M28.10 structural production test'},
    evidence:{shotKey:shot.shot_key,type}
  });
  return res;
};
const addCandidate=async(jobId,shot,type,index)=>{
  const qa=type==='VIDEO'?videoQa():(['DIALOGUE','VOICE'].includes(type)?voiceQa():audioQa());
  const res=await request('POST',`/api/runtime/aigc-generation-jobs/${jobId}/candidates`,{
    candidateKey:`${shot.shot_key}-${type}-CAND-A`,outputIndex:1,candidateVersionNo:1,
    contentLocator:{provider:'CI_TEST',ref:`ci://m2810/${shot.shot_key}/${type}`},
    outputFingerprintSha256:stableSha(20000+index),qa,
    compareGroup:`M2810-${shot.shot_key}-${type}`,safety:{status:'PASS'},
    evidence:{test:true,type}
  });
  assert.equal(res.status,201,JSON.stringify(res.body));
  return res.body.data.id;
};
const completePass=async jobId=>{
  const res=await request('POST',`/api/runtime/aigc-generation-jobs/${jobId}/complete`,{
    status:'PASS',usage:{credits:1},cost:{currency:'CNY',amount:1},
    safety:{status:'PASS'},provenance:{providerResponse:'CI_TEST'},
    retry:{maxAttempts:2,currentAttempt:1},evidence:{result:'PASS'}
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
};
const select=async candidateId=>{
  const res=await request('POST',`/api/runtime/aigc-generation-candidates/${candidateId}/select`,{
    eventType:'SELECT',reason:'M28.10 media QA PASS',evidence:{test:true}
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
};
const lock=async(req,jobId,candidateId,index)=>{
  const res=await request('POST',`/api/runtime/aigc-production-requirements/${req.id}/lock`,{
    generationJobId:jobId,candidateId,lockKey:`LOCK-${req.requirementKey}`,
    rights:{status:'APPROVED',scope:'PROJECT'},
    timing:{source:'shot timing',locked:true,index},
    evidence:{test:true,requirementKey:req.requirementKey}
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(res.body.data.status,'LOCKED');
};

// VIDEO without same-shot CURRENT KEYFRAME reference must be rejected.
r=await createJob({shot:firstShot,type:'VIDEO',suffix:'NO-KF',candidateRef:false,index:1});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_VIDEO_KEYFRAME_REFERENCE_REQUIRED');

// Persist a failed first VIDEO attempt and prove only that affected scope is rerun.
r=await createJob({shot:firstShot,type:'VIDEO',suffix:'FAIL',candidateRef:true,index:2});
assert.equal(r.status,201,JSON.stringify(r.body));
const failedVideoJobId=r.body.data.id;
r=await request('POST',`/api/runtime/aigc-generation-jobs/${failedVideoJobId}/complete`,{
  status:'FAIL',usage:{credits:1},cost:{currency:'CNY',amount:1},
  safety:{status:'PASS'},provenance:{providerResponse:'CI_TEST'},
  errorCode:'MOTION_TRAJECTORY_FAIL',errorMessage:'action trajectory drift',
  retry:{maxAttempts:2,currentAttempt:1},evidence:{frameRange:'00:02-00:04'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FAIL');

r=await request('POST',`/api/runtime/aigc-generation-jobs/${failedVideoJobId}/failure-analysis`,{
  failureCategory:'MOTION',
  affectedScope:{shotId:firstShot.id,shotKey:firstShot.shot_key,frameRange:'00:02-00:04'},
  rerunScope:{shotId:firstShot.id,productionType:'VIDEO',onlyAffectedRange:true},
  rootEvidence:{reason:'motion trajectory drift; keyframe identity remains valid'},
  evidence:{policy:'只重跑受影响范围'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const failureAnalysisId=r.body.data.id;

// Gate must HOLD while the failure analysis is unresolved and required outputs remain unlocked.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PRODUCTION/evaluate`,{
  asOf:'2026-10-07T04:40:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_REQUIRED_PRODUCTION_OUTPUT_UNLOCKED'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_PRODUCTION_FAILURE_UNRESOLVED'));

const requiredReqs=r.body.data.evidenceSnapshot.requiredCount;
assert.equal(requiredReqs,75);

let generationIndex=10;
for(const shot of shots){
  const types=shot.id===firstShot.id?['VIDEO','DIALOGUE','VOICE','MUSIC','SFX']:['VIDEO'];
  for(const type of types){
    const req=reqByPair.get(`${shot.id}|${type}`);
    assert.ok(req);
    const suffix=shot.id===firstShot.id&&type==='VIDEO'?'RERUN':'A';
    r=await createJob({shot,type,suffix,candidateRef:true,index:generationIndex++});
    assert.equal(r.status,201,JSON.stringify(r.body));
    const jobId=r.body.data.id;
    const candidateId=await addCandidate(jobId,shot,type,generationIndex++);
    await completePass(jobId);
    await select(candidateId);
    await lock(req,jobId,candidateId,generationIndex);
    if(shot.id===firstShot.id&&type==='VIDEO'){
      r=await request('POST',`/api/runtime/aigc-production-failures/${failureAnalysisId}/resolve`,{
        replacementGenerationJobId:jobId,
        resolution:{result:'局部重跑通过',affectedRange:'00:02-00:04',upstreamKeyframeReused:true},
        evidence:{test:true}
      });
      assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.data.status,'RESOLVED');
    }
  }
}

// Image Gate must remain PASS after VIDEO/AUDIO selections; media selections may not evict KEYFRAME current.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-IMAGE/evaluate`,{
  asOf:'2026-10-07T04:40:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.currentSelectedShotCount,71);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PRODUCTION/evaluate`,{
  asOf:'2026-10-07T04:40:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.shotCount,71);
assert.equal(r.body.data.evidenceSnapshot.requirementCount,355);
assert.equal(r.body.data.evidenceSnapshot.requiredCount,75);
assert.equal(r.body.data.evidenceSnapshot.notApplicableCount,280);
assert.equal(r.body.data.evidenceSnapshot.lockedRequiredCount,75);
assert.equal(r.body.data.evidenceSnapshot.videoRequiredCount,71);
assert.equal(r.body.data.evidenceSnapshot.lockCountsByType.VIDEO,71);
assert.equal(r.body.data.evidenceSnapshot.lockCountsByType.DIALOGUE,1);
assert.equal(r.body.data.evidenceSnapshot.lockCountsByType.VOICE,1);
assert.equal(r.body.data.evidenceSnapshot.lockCountsByType.MUSIC,1);
assert.equal(r.body.data.evidenceSnapshot.lockCountsByType.SFX,1);
assert.equal(r.body.data.evidenceSnapshot.failedOrBlockedJobCount,1);
assert.equal(r.body.data.evidenceSnapshot.failureAnalysisCount,1);
assert.equal(r.body.data.evidenceSnapshot.unresolvedFailureCount,0);
assert.equal(r.body.data.evidenceSnapshot.productionReady,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-video-audio-production`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'视频 / 音频生产门禁');
assert.equal(r.body.data.requirements.length,355);
assert.equal(r.body.data.locks.length,75);
assert.equal(r.body.data.failures.length,1);
assert.equal(r.body.data.failures[0].status,'RESOLVED');

// Current candidate uniqueness is per Shot + Generation Kind.
const [currentFirstShot]=await db.execute(
  `SELECT j.generation_kind,COUNT(*) count
     FROM aigc_generation_candidates c
     JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
    WHERE c.project_id=? AND c.shot_id=? AND c.is_current=TRUE AND c.selection_status='SELECTED'
    GROUP BY j.generation_kind ORDER BY j.generation_kind`,
  [projectId,firstShot.id]
);
const currentByKind=Object.fromEntries(currentFirstShot.map(x=>[x.generation_kind,Number(x.count)]));
assert.equal(currentByKind.KEYFRAME,1);
assert.equal(currentByKind.VIDEO,1);
assert.equal(currentByKind.DIALOGUE,1);
assert.equal(currentByKind.VOICE,1);
assert.equal(currentByKind.MUSIC,1);
assert.equal(currentByKind.SFX,1);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_shot_production_requirements WHERE project_id=?) requirements,
    (SELECT COUNT(*) FROM aigc_shot_production_requirements WHERE project_id=? AND applicability='REQUIRED') required_count,
    (SELECT COUNT(*) FROM aigc_production_locks WHERE project_id=? AND status='LOCKED') locks_count,
    (SELECT COUNT(*) FROM aigc_production_failure_analyses WHERE project_id=? AND status='RESOLVED') resolved_failures,
    (SELECT COUNT(*) FROM aigc_generation_jobs WHERE project_id=? AND generation_kind='VIDEO' AND status='PASS') pass_video_jobs,
    (SELECT COUNT(*) FROM aigc_generation_candidates c JOIN aigc_generation_jobs j ON j.id=c.generation_job_id
      WHERE c.project_id=? AND j.generation_kind='KEYFRAME' AND c.is_current=TRUE AND c.selection_status='SELECTED') current_keyframes`,
  [projectId,projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.requirements),355);
assert.equal(Number(truth.required_count),75);
assert.equal(Number(truth.locks_count),75);
assert.equal(Number(truth.resolved_failures),1);
assert.equal(Number(truth.pass_video_jobs),71);
assert.equal(Number(truth.current_keyframes),71);

await db.end();
console.log('M28_10_AIGC_VIDEO_AUDIO_PRODUCTION_PASS');
