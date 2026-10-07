import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5001';
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
     JOIN aigc_m288_gate_evaluations g ON g.project_id=p.id
    WHERE p.project_type='AIGC_CONTENT' AND g.gate_key='G-AIGC-ASSET' AND g.status='PASS'
    ORDER BY g.as_of DESC,g.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.8 PASS project is required');
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

const [requiredCallSheetRefs]=await db.execute(
  `SELECT b.call_sheet_id,b.reference_asset_version_id,b.reference_role,v.version_key
     FROM aigc_call_sheet_reference_bindings b
     JOIN aigc_asset_versions v ON v.id=b.reference_asset_version_id
    WHERE b.project_id=? AND b.required=TRUE AND b.status='READY'
    ORDER BY b.call_sheet_id,b.reference_role,b.reference_asset_version_id`,
  [projectId]
);
const refsByCallSheet=new Map();
for(const row of requiredCallSheetRefs){
  const refs=refsByCallSheet.get(row.call_sheet_id)||[];
  refs.push({referenceId:row.reference_asset_version_id,role:row.reference_role,versionKey:row.version_key});
  refsByCallSheet.set(row.call_sheet_id,refs);
}
assert.equal(shots.filter(x=>(refsByCallSheet.get(callSheetByShot.get(x.id))||[]).length>0).length,71);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_GENERATION_JOB,'生成任务');
assert.equal(modules.AIGC_GENERATION_CANDIDATE,'生成候选');
assert.equal(modules.AIGC_CANDIDATE_SELECTION,'候选选择、恢复与锁定');
assert.equal(modules.AIGC_IMAGE_KEYFRAME,'图像 / 关键帧 / 分镜生产');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-IMAGE').displayName,'图像 / 关键帧门禁');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-IMAGE/evaluate`,{
  asOf:'2026-10-07T04:20:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_KEYFRAME_GENERATION_COVERAGE_INCOMPLETE'));
assert.ok(r.body.data.reasonCodes.includes('AIGC_KEYFRAME_CURRENT_SELECTION_INCOMPLETE'));

const qaPass=()=>({
  identity:'PASS',look:'PASS',sceneProp:'PASS',actionPose:'PASS',expressionPerformance:'PASS',
  gazeBlocking:'PASS',anatomyHands:'PASS',spatialScalePerspective:'PASS',
  compositionCamera:'PASS',lightingColor:'PASS',textUi:'PASS',multiFormatSafety:'PASS',
  technicalIntegrity:'PASS'
});
const qaFail=()=>({...qaPass(),expressionPerformance:'FAIL'});
const shaFor=(index,char='a')=>String(index).padStart(4,'0').repeat(16).slice(0,64).replace(/[^0-9a-f]/g,char);
const stableSha=(n)=>n.toString(16).padStart(64,'0').slice(-64);

const createJob=async(shot,index,requestedOutputCount=1,suffix='A',referenceBindings=null)=>{
  const res=await request('POST',`/api/runtime/projects/${projectId}/aigc-generation-jobs`,{
    jobKey:`M289-${shot.shot_key}-${suffix}`,
    generationKind:'KEYFRAME',
    shotId:shot.id,
    parentCallSheetId:callSheetByShot.get(shot.id),
    provider:'CI_TEST_PROVIDER',
    modelTool:'CI Keyframe Generator',
    modelToolVersion:'m28.9-test',
    toolKey:'TOOL:CI_KEYFRAME',
    skillKey:'SKILL:AIGC_KEYFRAME_PRODUCTION',
    prompt:`Generate locked keyframe for ${shot.shot_key}; preserve all upstream Story/Asset locks.`,
    negativePrompt:'no identity drift; no invented story fact; no scene redesign',
    promptVersion:'M28.9-PROMPT-V1',
    referenceBindings:referenceBindings||refsByCallSheet.get(callSheetByShot.get(shot.id)),
    parameters:{aspect:'1.85:1',resolution:{width:1998,height:1080},fps:24,seed:index},
    inputFingerprintSha256:stableSha(1000+index+(suffix==='B'?1000:0)),
    requestedOutputCount,
    status:'RUNNING',
    retry:{maxAttempts:2,currentAttempt:1},
    safety:{policy:'CI structural validation'},
    provenance:{test:true,source:'M28.8 Asset System PASS'},
    evidence:{purpose:'M28.9 structural generation validation'}
  });
  assert.equal(res.status,201,JSON.stringify(res.body));
  assert.equal(res.body.data.preflight.status,'PASS');
  assert.equal(res.body.data.preflight.requiredInheritedReferenceCount,(refsByCallSheet.get(callSheetByShot.get(shot.id))||[]).length);
  return res.body.data.id;
};
const addCandidate=async(jobId,shot,index,qa,outputIndex=1,keySuffix='A')=>{
  const res=await request('POST',`/api/runtime/aigc-generation-jobs/${jobId}/candidates`,{
    candidateKey:`${shot.shot_key}-CAND-${keySuffix}`,
    outputIndex,
    candidateVersionNo:1,
    contentLocator:{provider:'CI_TEST',ref:`ci://m289/${shot.shot_key}/${keySuffix}`},
    outputFingerprintSha256:stableSha(5000+index*10+outputIndex+(keySuffix==='B'?1:0)),
    qa,
    compareGroup:`M289-${shot.shot_key}`,
    safety:{status:'PASS',moderation:'PASS'},
    evidence:{test:true,shotKey:shot.shot_key}
  });
  assert.equal(res.status,201,JSON.stringify(res.body));
  return res.body.data.id;
};
const completeJob=async jobId=>{
  const res=await request('POST',`/api/runtime/aigc-generation-jobs/${jobId}/complete`,{
    status:'PASS',
    usage:{token:0,credits:1},
    cost:{currency:'CNY',amount:0},
    safety:{status:'PASS'},
    provenance:{providerResponse:'CI_TEST'},
    retry:{maxAttempts:2,currentAttempt:1},
    evidence:{test:true,result:'STRUCTURAL_PASS'}
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(res.body.data.status,'PASS');
};
const selectCandidate=async(candidateId,eventType='SELECT',reason='QA PASS')=>{
  const res=await request('POST',`/api/runtime/aigc-generation-candidates/${candidateId}/select`,{
    eventType,reason,evidence:{test:true,eventType}
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
  return res.body.data;
};

const firstShot=shots[0];
const firstShotRefs=refsByCallSheet.get(callSheetByShot.get(firstShot.id));
assert.ok(firstShotRefs.length>0);
const wrongRole=firstShotRefs[0].role==='AUDIO'?'STYLE':'AUDIO';
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-generation-jobs`,{
  jobKey:'M2891-MISSING-INHERITED-REF',generationKind:'KEYFRAME',shotId:firstShot.id,
  parentCallSheetId:callSheetByShot.get(firstShot.id),provider:'CI_TEST_PROVIDER',
  modelTool:'CI Keyframe Generator',modelToolVersion:'m28.9.1-test',
  prompt:'negative inherited-reference test',promptVersion:'M28.9.1-PROMPT-V1',
  referenceBindings:[{...firstShotRefs[0],role:wrongRole}],
  parameters:{aspect:'1.85:1'},inputFingerprintSha256:stableSha(999999),requestedOutputCount:1,
  status:'RUNNING',retry:{maxAttempts:1,currentAttempt:1},safety:{policy:'CI'},
  provenance:{test:true},evidence:{test:'required inherited reference missing'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_GENERATION_REQUIRED_REFERENCE_NOT_INHERITED');

const firstJob=await createJob(firstShot,1,2,'A');
const badCandidate=await addCandidate(firstJob,firstShot,1,qaFail(),1,'BAD');
const goodCandidate=await addCandidate(firstJob,firstShot,1,qaPass(),2,'GOOD');
await completeJob(firstJob);

r=await request('POST',`/api/runtime/aigc-generation-candidates/${badCandidate}/select`,{
  eventType:'SELECT',reason:'should fail',evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_CANDIDATE_QA_PASS_REQUIRED');

let selection=await selectCandidate(goodCandidate,'SELECT','initial current');
assert.equal(selection.isCurrent,true);
assert.equal(selection.eventType,'SELECT');

const secondJob=await createJob(firstShot,1,1,'B');
const secondCandidate=await addCandidate(secondJob,firstShot,101,qaPass(),1,'B');
await completeJob(secondJob);
selection=await selectCandidate(secondCandidate,'SELECT','compare group winner');
assert.equal(selection.previousCandidateId,goodCandidate);

selection=await selectCandidate(goodCandidate,'RESTORE','restore prior approved candidate');
assert.equal(selection.eventType,'RESTORE');
assert.equal(selection.previousCandidateId,secondCandidate);

selection=await selectCandidate(goodCandidate,'LOCK','lock restored formal keyframe');
assert.equal(selection.eventType,'LOCK');
assert.equal(selection.selectionStatus,'LOCKED');
assert.equal(selection.isCurrent,true);

r=await request('POST',`/api/runtime/aigc-generation-candidates/${secondCandidate}/select`,{
  eventType:'SELECT',reason:'locked candidate must not be silently replaced',evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_LOCKED_CANDIDATE_REPLACEMENT_FORBIDDEN');

r=await request('POST',`/api/runtime/aigc-generation-candidates/${badCandidate}/reject`,{
  reason:'expression/performance QA failed',evidence:{test:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.selectionStatus,'REJECTED');

for(let i=1;i<shots.length;i++){
  const shot=shots[i];
  const jobId=await createJob(shot,i+1,1,'A');
  const candidateId=await addCandidate(jobId,shot,i+1,qaPass(),1,'A');
  await completeJob(jobId);
  const selected=await selectCandidate(candidateId,'SELECT','M28.9 full shot keyframe coverage');
  assert.equal(selected.isCurrent,true);
}

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-IMAGE/evaluate`,{
  asOf:'2026-10-07T04:20:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.shotCount,71);
assert.equal(r.body.data.evidenceSnapshot.passKeyframeShotCount,71);
assert.equal(r.body.data.evidenceSnapshot.currentSelectedShotCount,71);
assert.equal(r.body.data.evidenceSnapshot.lockedKeyframeCount,1);
assert.equal(r.body.data.evidenceSnapshot.qaFailedCandidateIds.length,0);
assert.equal(r.body.data.evidenceSnapshot.safetyFailedCandidateIds.length,0);
assert.equal(r.body.data.evidenceSnapshot.missingLocatorCandidateIds.length,0);
assert.equal(r.body.data.evidenceSnapshot.videoReferenceReady,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-generation-image`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'图像 / 关键帧门禁');
assert.deepEqual(
  r.body.data.frontend.moduleNames,
  ['生成任务','生成候选','候选选择、恢复与锁定','图像 / 关键帧 / 分镜生产']
);
assert.equal(r.body.data.currentBreakdownPlanId,breakdown.id);
assert.equal(r.body.data.jobs.filter(x=>x.generationKind==='KEYFRAME'&&x.status==='PASS').length,72);
assert.equal(r.body.data.candidates.filter(x=>x.isCurrent&&['SELECTED','LOCKED'].includes(x.selectionStatus)).length,71);
assert.equal(r.body.data.candidates.filter(x=>x.isCurrent&&x.selectionStatus==='LOCKED').length,1);
assert.ok(r.body.data.candidates.find(x=>x.id===goodCandidate).lockedAt);
assert.ok(r.body.data.selectionEvents.some(x=>x.eventType==='LOCK'));
assert.ok(r.body.data.selectionEvents.some(x=>x.eventType==='RESTORE'));

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_generation_jobs WHERE project_id=? AND generation_kind='KEYFRAME' AND status='PASS') pass_jobs,
    (SELECT COUNT(*) FROM aigc_generation_jobs WHERE project_id=? AND JSON_UNQUOTE(JSON_EXTRACT(preflight_json,'$.status'))='PASS') preflight_pass_jobs,
    (SELECT COUNT(*) FROM aigc_generation_candidates WHERE project_id=? AND is_current=TRUE AND selection_status IN ('SELECTED','LOCKED')) current_candidates,
    (SELECT COUNT(*) FROM aigc_generation_candidates WHERE project_id=? AND is_current=TRUE AND selection_status='LOCKED') locked_candidates,
    (SELECT COUNT(*) FROM aigc_candidate_selection_events WHERE project_id=? AND event_type='RESTORE') restore_events,
    (SELECT COUNT(*) FROM aigc_candidate_selection_events WHERE project_id=? AND event_type='LOCK') lock_events,
    (SELECT COUNT(*) FROM aigc_generation_candidates WHERE id=? AND selection_status='LOCKED' AND is_current=TRUE AND locked_at IS NOT NULL) restored_locked_current,
    (SELECT COUNT(*) FROM aigc_generation_candidates WHERE id=? AND selection_status='HISTORICAL' AND is_current=FALSE) replaced_historical,
    (SELECT COUNT(*) FROM aigc_generation_candidates WHERE id=? AND selection_status='REJECTED' AND is_current=FALSE) rejected_bad`,
  [projectId,projectId,projectId,projectId,projectId,projectId,goodCandidate,secondCandidate,badCandidate]
);
assert.equal(Number(truth.pass_jobs),72);
assert.equal(Number(truth.preflight_pass_jobs),72);
assert.equal(Number(truth.current_candidates),71);
assert.equal(Number(truth.locked_candidates),1);
assert.equal(Number(truth.restore_events),1);
assert.equal(Number(truth.lock_events),1);
assert.equal(Number(truth.restored_locked_current),1);
assert.equal(Number(truth.replaced_historical),1);
assert.equal(Number(truth.rejected_bad),1);

await db.end();
console.log('M28_9_1_AIGC_GENERATION_LOCK_PREFLIGHT_PASS');
