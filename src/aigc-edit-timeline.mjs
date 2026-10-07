import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcProductionGate } from './aigc-video-audio-production.mjs';

const GATE='G-AIGC-EDIT';
const TRACK_TYPES=new Set(['VIDEO','DIALOGUE','VOICE','MUSIC','SFX','AMBIENCE','CAPTION','GRAPHIC']);
const SOURCE_TYPES=new Set(['PRODUCTION_LOCK','ASSET_VERSION']);
const ANCHOR_TYPES=new Set(['TIMECODE','SHOT','ASSET']);
const EXPORT_TYPES=new Set(['PREVIEW','EDIT_MASTER']);
const EXPORT_STATUSES=new Set(['PASS','FAIL']);
const SHA64=/^[0-9a-f]{64}$/i;
const POST_FIELDS=['editRhythm','compositing','colorGrade','audioMix','subtitlesCaptions','graphicsUi','deterministicText','vfxFix'];

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

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Edit requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentBreakdown=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
};
const currentTimeline=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_timeline_versions WHERE project_id=? AND is_current=TRUE AND status='LOCKED' ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
};
const validatePostPlan=plan=>{
  if(!plan||typeof plan!=='object')throw errorOf(
    'Post-production plan is required','AIGC_POST_PRODUCTION_PLAN_REQUIRED',409
  );
  const missing=POST_FIELDS.filter(k=>!nonEmpty(plan[k]));
  if(missing.length)throw errorOf(
    'Post-production plan is incomplete','AIGC_POST_PRODUCTION_PLAN_INCOMPLETE',409,{missing}
  );
};
const compatibleTrack=(trackType,productionType)=>{
  if(trackType===productionType)return true;
  if(trackType==='AMBIENCE'&&productionType==='SFX')return true;
  return false;
};
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO aigc_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};

export const resolveAigcEditProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveAigcTimelineScope=async timelineVersionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT t.project_id,p.workspace_id
       FROM aigc_timeline_versions t JOIN projects p ON p.id=t.project_id
      WHERE t.id=?`,[timelineVersionId]
  );
  if(!rows.length)throw errorOf('Timeline version not found','AIGC_TIMELINE_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveAigcReviewThreadScope=async threadId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.project_id,p.workspace_id
       FROM aigc_timeline_review_threads r JOIN projects p ON p.id=r.project_id
      WHERE r.id=?`,[threadId]
  );
  if(!rows.length)throw errorOf('Review thread not found','AIGC_TIMELINE_REVIEW_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcTimelineVersion=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'timelineKey','versionNo','title','durationMs','postProductionPlan','tracks','clips','evidence'
  ],'INVALID_AIGC_TIMELINE_VERSION');
  validatePostPlan(input.postProductionPlan);
  const versionNo=Number(input.versionNo),durationMs=Number(input.durationMs);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Timeline versionNo must be positive integer','AIGC_TIMELINE_VERSION_INVALID',409
  );
  if(!Number.isInteger(durationMs)||durationMs<=0)throw errorOf(
    'Timeline durationMs must be positive integer','AIGC_TIMELINE_DURATION_INVALID',409
  );
  if(!Array.isArray(input.tracks)||!input.tracks.length||!Array.isArray(input.clips)||!input.clips.length)
    throw errorOf('Timeline requires tracks and clips','AIGC_TIMELINE_CONTENT_REQUIRED',409);

  const db=getRuntimePool();
  const productionGate=await evaluateAigcProductionGate(projectId,{persist:false},actorId);
  if(productionGate.status!=='PASS')throw errorOf(
    'G-AIGC-PRODUCTION must PASS before edit timeline','G_AIGC_PRODUCTION_REQUIRED',409,
    {reasonCodes:productionGate.reasonCodes}
  );
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);

  const previous=await currentTimeline(projectId,db);
  if(previous){
    if(input.parentTimelineVersionId!==previous.id)throw errorOf(
      'Timeline revision must derive from current locked timeline','AIGC_TIMELINE_PARENT_CURRENT_REQUIRED',409,
      {currentTimelineVersionId:previous.id}
    );
    if(upper(input.changeRef?.status)!=='APPROVED'||!nonEmpty(input.changeRef?.reference))
      throw errorOf(
        'Locked timeline revision requires approved Change/Decision',
        'AIGC_TIMELINE_CHANGE_DECISION_REQUIRED',409
      );
  }else if(input.parentTimelineVersionId){
    throw errorOf('Initial timeline must not have parent','AIGC_INITIAL_TIMELINE_PARENT_FORBIDDEN',409);
  }

  const trackKeys=new Set(),trackSeq=new Set(),normalizedTracks=[];
  for(const track of input.tracks){
    requireFields(track,['trackKey','trackType','sequenceNo','displayName','trackSettings','evidence'],
      'INVALID_AIGC_TIMELINE_TRACK');
    const trackType=upper(track.trackType),sequenceNo=Number(track.sequenceNo);
    if(!TRACK_TYPES.has(trackType))throw errorOf(
      'Unsupported timeline track type','AIGC_TIMELINE_TRACK_TYPE_INVALID',409,{trackType}
    );
    if(!Number.isInteger(sequenceNo)||sequenceNo<1)throw errorOf(
      'Track sequenceNo must be positive integer','AIGC_TIMELINE_TRACK_SEQUENCE_INVALID',409
    );
    if(trackKeys.has(track.trackKey)||trackSeq.has(sequenceNo))throw errorOf(
      'Timeline track key/sequence must be unique','AIGC_TIMELINE_TRACK_DUPLICATE',409,
      {trackKey:track.trackKey,sequenceNo}
    );
    trackKeys.add(track.trackKey);trackSeq.add(sequenceNo);
    normalizedTracks.push({...track,trackType,sequenceNo});
  }

  const clipKeys=new Set(),clipSeqByTrack=new Map(),normalizedClips=[];
  for(const clip of input.clips){
    requireFields(clip,[
      'clipKey','trackKey','sequenceNo','sourceType','sourceVersionKey','sourceInMs','sourceOutMs',
      'timelineStartMs','timelineEndMs','speed','transition','lineage','evidence'
    ],'INVALID_AIGC_TIMELINE_CLIP');
    if(!trackKeys.has(clip.trackKey))throw errorOf(
      'Clip references unknown track','AIGC_TIMELINE_CLIP_TRACK_INVALID',409,{clipKey:clip.clipKey}
    );
    const sourceType=upper(clip.sourceType);
    if(!SOURCE_TYPES.has(sourceType))throw errorOf(
      'Unsupported clip source type','AIGC_TIMELINE_CLIP_SOURCE_INVALID',409,{sourceType}
    );
    const sequenceNo=Number(clip.sequenceNo),sourceInMs=Number(clip.sourceInMs),
      sourceOutMs=Number(clip.sourceOutMs),timelineStartMs=Number(clip.timelineStartMs),
      timelineEndMs=Number(clip.timelineEndMs),speed=Number(clip.speed);
    if(!Number.isInteger(sequenceNo)||sequenceNo<1||
       !Number.isInteger(sourceInMs)||!Number.isInteger(sourceOutMs)||sourceInMs<0||sourceOutMs<=sourceInMs||
       !Number.isInteger(timelineStartMs)||!Number.isInteger(timelineEndMs)||timelineStartMs<0||
       timelineEndMs<=timelineStartMs||timelineEndMs>durationMs||!Number.isFinite(speed)||speed<=0)
      throw errorOf('Clip timing is invalid','AIGC_TIMELINE_CLIP_TIMING_INVALID',409,{clipKey:clip.clipKey});
    if(clipKeys.has(clip.clipKey))throw errorOf(
      'Duplicate clip key','AIGC_TIMELINE_CLIP_DUPLICATE',409,{clipKey:clip.clipKey}
    );
    const seqKey=clip.trackKey+'|'+sequenceNo;
    if(clipSeqByTrack.has(seqKey))throw errorOf(
      'Duplicate clip sequence in track','AIGC_TIMELINE_CLIP_SEQUENCE_DUPLICATE',409,{seqKey}
    );
    if(sourceType==='PRODUCTION_LOCK'&&!nonEmpty(clip.productionLockId))throw errorOf(
      'PRODUCTION_LOCK source requires productionLockId','AIGC_TIMELINE_PRODUCTION_LOCK_REQUIRED',409,{clipKey:clip.clipKey}
    );
    if(sourceType==='ASSET_VERSION'&&!nonEmpty(clip.assetVersionId))throw errorOf(
      'ASSET_VERSION source requires assetVersionId','AIGC_TIMELINE_ASSET_VERSION_REQUIRED',409,{clipKey:clip.clipKey}
    );
    clipKeys.add(clip.clipKey);clipSeqByTrack.set(seqKey,true);
    normalizedClips.push({
      ...clip,sourceType,sequenceNo,sourceInMs,sourceOutMs,timelineStartMs,timelineEndMs,speed
    });
  }

  for(const track of normalizedTracks){
    const clips=normalizedClips.filter(x=>x.trackKey===track.trackKey)
      .sort((a,b)=>a.timelineStartMs-b.timelineStartMs);
    for(let i=1;i<clips.length;i++){
      if(clips[i].timelineStartMs<clips[i-1].timelineEndMs)throw errorOf(
        'Clips cannot overlap within the same track','AIGC_TIMELINE_TRACK_OVERLAP',409,
        {trackKey:track.trackKey,previousClip:clips[i-1].clipKey,clipKey:clips[i].clipKey}
      );
    }
  }

  const prodLockIds=normalizedClips.filter(x=>x.sourceType==='PRODUCTION_LOCK').map(x=>x.productionLockId);
  const assetVersionIds=normalizedClips.filter(x=>x.sourceType==='ASSET_VERSION').map(x=>x.assetVersionId);
  const [prodLocks,assetVersions,requiredLocks]=await Promise.all([
    prodLockIds.length?listRows(db,
      `SELECT l.id,l.lock_key,l.project_id,r.breakdown_plan_id,r.shot_id,r.production_type,r.applicability,r.status AS requirement_status,
              c.is_current,c.selection_status,j.status AS job_status,j.generation_kind
         FROM aigc_production_locks l
         JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
         JOIN aigc_generation_candidates c ON c.id=l.candidate_id
         JOIN aigc_generation_jobs j ON j.id=l.generation_job_id
        WHERE l.project_id=? AND l.id IN (${prodLockIds.map(()=>'?').join(',')})`,
      [projectId,...prodLockIds]):[],
    assetVersionIds.length?listRows(db,
      `SELECT id,version_key,state,owner_project_id FROM aigc_asset_versions
        WHERE owner_project_id=? AND id IN (${assetVersionIds.map(()=>'?').join(',')})`,
      [projectId,...assetVersionIds]):[],
    listRows(db,
      `SELECT l.id,l.lock_key,r.shot_id,r.production_type
         FROM aigc_production_locks l
         JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
        WHERE l.project_id=? AND r.breakdown_plan_id=? AND r.applicability='REQUIRED' AND r.status='LOCKED'
          AND l.status='LOCKED'`,[projectId,breakdown.id])
  ]);
  const prodMap=new Map(prodLocks.map(x=>[x.id,x])),assetMap=new Map(assetVersions.map(x=>[x.id,x]));
  for(const clip of normalizedClips){
    const track=normalizedTracks.find(x=>x.trackKey===clip.trackKey);
    if(clip.sourceType==='PRODUCTION_LOCK'){
      const lock=prodMap.get(clip.productionLockId);
      if(!lock||lock.breakdown_plan_id!==breakdown.id||lock.requirement_status!=='LOCKED'||
         !lock.is_current||lock.selection_status!=='SELECTED'||lock.job_status!=='PASS'||
         lock.generation_kind!==lock.production_type||!compatibleTrack(track.trackType,lock.production_type)||
         clip.sourceVersionKey!==lock.lock_key)
        throw errorOf('Clip production source is stale or incompatible',
          'AIGC_TIMELINE_PRODUCTION_SOURCE_INVALID',409,{clipKey:clip.clipKey}
        );
      if(clip.shotId&&clip.shotId!==lock.shot_id)throw errorOf(
        'Clip shot does not match production source','AIGC_TIMELINE_CLIP_SHOT_MISMATCH',409,{clipKey:clip.clipKey}
      );
    }else{
      const asset=assetMap.get(clip.assetVersionId);
      if(!asset||!['PASS','CURRENT','LOCKED','FROZEN'].includes(asset.state)||
         asset.version_key!==clip.sourceVersionKey)
        throw errorOf('Clip asset source is not exact approved version',
          'AIGC_TIMELINE_ASSET_SOURCE_INVALID',409,{clipKey:clip.clipKey}
        );
      if(!['CAPTION','GRAPHIC'].includes(track.trackType))throw errorOf(
        'Direct asset clips are restricted to caption/graphic tracks',
        'AIGC_TIMELINE_ASSET_TRACK_INVALID',409,{clipKey:clip.clipKey,trackType:track.trackType}
      );
    }
  }

  const usedProdLocks=new Set(prodLockIds);
  const missingRequired=requiredLocks.filter(x=>!usedProdLocks.has(x.id));
  if(missingRequired.length)throw errorOf(
    'Timeline must consume every REQUIRED production lock',
    'AIGC_TIMELINE_REQUIRED_PRODUCTION_COVERAGE_INCOMPLETE',409,
    {missingLockIds:missingRequired.map(x=>x.id)}
  );
  const duplicateRequired=requiredLocks.filter(x=>prodLockIds.filter(id=>id===x.id).length!==1);
  if(duplicateRequired.length)throw errorOf(
    'Each REQUIRED production lock must appear exactly once in initial timeline',
    'AIGC_TIMELINE_PRODUCTION_LOCK_DUPLICATE',409,{lockIds:duplicateRequired.map(x=>x.id)}
  );

  const conn=await db.getConnection(),timelineId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO aigc_timeline_versions
        (id,project_id,breakdown_plan_id,timeline_key,version_no,title,duration_ms,post_production_plan_json,
         parent_timeline_version_id,change_ref_json,status,is_current,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,'DRAFT',FALSE,?,?)`,
      [timelineId,projectId,breakdown.id,input.timelineKey,versionNo,input.title,durationMs,
       asJson(input.postProductionPlan),previous?.id||null,input.changeRef?asJson(input.changeRef):null,
       asJson(input.evidence),actorId]
    );
    const trackIdByKey=new Map();
    for(const track of normalizedTracks){
      const id=randomUUID();trackIdByKey.set(track.trackKey,id);
      await conn.execute(
        `INSERT INTO aigc_timeline_tracks
          (id,project_id,timeline_version_id,track_key,track_type,sequence_no,display_name,
           track_settings_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id,projectId,timelineId,track.trackKey,track.trackType,track.sequenceNo,track.displayName,
         asJson(track.trackSettings),asJson(track.evidence)]
      );
    }
    for(const clip of normalizedClips){
      const id=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_timeline_clips
          (id,project_id,timeline_version_id,track_id,clip_key,sequence_no,shot_id,source_type,
           production_lock_id,asset_version_id,source_version_key,source_in_ms,source_out_ms,
           timeline_start_ms,timeline_end_ms,speed,transition_json,lineage_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,timelineId,trackIdByKey.get(clip.trackKey),clip.clipKey,clip.sequenceNo,
         clip.shotId||null,clip.sourceType,clip.productionLockId||null,clip.assetVersionId||null,
         clip.sourceVersionKey,clip.sourceInMs,clip.sourceOutMs,clip.timelineStartMs,clip.timelineEndMs,
         clip.speed,asJson(clip.transition),asJson(clip.lineage),asJson(clip.evidence)]
      );
      if(clip.productionLockId)await insertTrace(conn,{projectId,sourceType:'PRODUCTION_LOCK',
        sourceId:clip.productionLockId,targetType:'TIMELINE_CLIP',targetId:id,linkType:'PLACED_AS',
        actorId,evidence:{timelineVersionId:timelineId,clipKey:clip.clipKey}});
      if(clip.assetVersionId)await insertTrace(conn,{projectId,sourceType:'ASSET_VERSION',
        sourceId:clip.assetVersionId,targetType:'TIMELINE_CLIP',targetId:id,linkType:'PLACED_AS',
        actorId,evidence:{timelineVersionId:timelineId,clipKey:clip.clipKey}});
    }
    await insertTrace(conn,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:breakdown.id,
      targetType:'TIMELINE_VERSION',targetId:timelineId,linkType:'EDITED_INTO',actorId,
      evidence:{timelineKey:input.timelineKey,versionNo}});
    await conn.commit();
    return {id:timelineId,projectId,breakdownPlanId:breakdown.id,timelineKey:input.timelineKey,
      versionNo,status:'DRAFT',isCurrent:false,trackCount:normalizedTracks.length,
      clipCount:normalizedClips.length,requiredProductionLockCount:requiredLocks.length};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createAigcTimelineReviewThread=async(timelineVersionId,input={},actorId=null)=>{
  requireFields(input,['threadKey','anchorType','reviewer','approvalRole','comment','evidence'],
    'INVALID_AIGC_TIMELINE_REVIEW');
  const anchorType=upper(input.anchorType),db=getRuntimePool();
  if(!ANCHOR_TYPES.has(anchorType))throw errorOf(
    'Unsupported review anchor type','AIGC_TIMELINE_REVIEW_ANCHOR_INVALID',409,{anchorType}
  );
  const [rows]=await db.execute('SELECT * FROM aigc_timeline_versions WHERE id=?',[timelineVersionId]);
  const timeline=rows[0];
  if(!timeline)throw errorOf('Timeline version not found','AIGC_TIMELINE_NOT_FOUND',404);
  if(timeline.status!=='DRAFT')throw errorOf(
    'Review threads can only be added to DRAFT timeline','AIGC_TIMELINE_REVIEW_STATE_INVALID',409
  );
  let shotId=null,assetVersionId=null,timecodeMs=null;
  if(anchorType==='TIMECODE'){
    timecodeMs=Number(input.timecodeMs);
    if(!Number.isInteger(timecodeMs)||timecodeMs<0||timecodeMs>Number(timeline.duration_ms))
      throw errorOf('Review timecode is invalid','AIGC_TIMELINE_REVIEW_TIMECODE_INVALID',409);
  }
  if(anchorType==='SHOT'){
    if(!nonEmpty(input.shotId))throw errorOf('SHOT anchor requires shotId','AIGC_TIMELINE_REVIEW_SHOT_REQUIRED',409);
    const [shots]=await db.execute(
      'SELECT id FROM aigc_shots WHERE id=? AND project_id=? AND breakdown_plan_id=?',
      [input.shotId,timeline.project_id,timeline.breakdown_plan_id]
    );
    if(!shots.length)throw errorOf('Review shot is outside timeline breakdown','AIGC_TIMELINE_REVIEW_SHOT_INVALID',409);
    shotId=input.shotId;
    if(input.timecodeMs!=null)timecodeMs=Number(input.timecodeMs);
  }
  if(anchorType==='ASSET'){
    if(!nonEmpty(input.assetVersionId))throw errorOf(
      'ASSET anchor requires assetVersionId','AIGC_TIMELINE_REVIEW_ASSET_REQUIRED',409
    );
    const [assets]=await db.execute(
      'SELECT id FROM aigc_asset_versions WHERE id=? AND owner_project_id=?',[input.assetVersionId,timeline.project_id]
    );
    if(!assets.length)throw errorOf('Review asset is outside project','AIGC_TIMELINE_REVIEW_ASSET_INVALID',409);
    assetVersionId=input.assetVersionId;
    if(input.timecodeMs!=null)timecodeMs=Number(input.timecodeMs);
  }
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_timeline_review_threads
      (id,project_id,timeline_version_id,thread_key,anchor_type,anchor_shot_id,anchor_asset_version_id,
       timecode_ms,reviewer_json,approval_role,comment_text,requested_change_json,status,evidence_json,
       created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'OPEN',?,?)`,
    [id,timeline.project_id,timelineVersionId,input.threadKey,anchorType,shotId,assetVersionId,timecodeMs,
     asJson(input.reviewer),input.approvalRole,input.comment,input.requestedChange?asJson(input.requestedChange):null,
     asJson(input.evidence),actorId]
  );
  await db.execute(
    `INSERT INTO aigc_timeline_review_events
      (id,project_id,review_thread_id,event_type,event_payload_json,evidence_json,actor_identity_id)
     VALUES (?,?,?,'COMMENT',?,?,?)`,
    [randomUUID(),timeline.project_id,id,asJson({comment:input.comment,anchorType,timecodeMs,shotId,assetVersionId}),
     asJson(input.evidence),actorId]
  );
  return {id,timelineVersionId,threadKey:input.threadKey,anchorType,status:'OPEN'};
};

export const resolveAigcTimelineReviewThread=async(threadId,input={},actorId=null)=>{
  requireFields(input,['resolution','evidence'],'INVALID_AIGC_TIMELINE_REVIEW_RESOLUTION');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_timeline_review_threads WHERE id=?',[threadId]);
  const thread=rows[0];
  if(!thread)throw errorOf('Review thread not found','AIGC_TIMELINE_REVIEW_NOT_FOUND',404);
  if(thread.status!=='OPEN')throw errorOf(
    'Only OPEN review thread can be resolved','AIGC_TIMELINE_REVIEW_STATE_INVALID',409,{status:thread.status}
  );
  const requestedChange=parseJson(thread.requested_change_json);
  if(nonEmpty(requestedChange)){
    if(upper(input.decisionRef?.status)!=='APPROVED'||!nonEmpty(input.decisionRef?.reference))
      throw errorOf(
        'Requested Change requires approved Change/Decision; comment alone cannot modify Current',
        'AIGC_TIMELINE_REVIEW_DECISION_REQUIRED',409
      );
  }
  await db.execute(
    `UPDATE aigc_timeline_review_threads
        SET status='RESOLVED',decision_ref_json=?,resolved_at=CURRENT_TIMESTAMP(6)
      WHERE id=?`,
    [input.decisionRef?asJson(input.decisionRef):null,threadId]
  );
  await db.execute(
    `INSERT INTO aigc_timeline_review_events
      (id,project_id,review_thread_id,event_type,event_payload_json,evidence_json,actor_identity_id)
     VALUES (?,?,?,'RESOLVE',?,?,?)`,
    [randomUUID(),thread.project_id,threadId,asJson({resolution:input.resolution,decisionRef:input.decisionRef||null}),
     asJson(input.evidence),actorId]
  );
  return {id:threadId,status:'RESOLVED',decisionRef:input.decisionRef||null};
};

export const reopenAigcTimelineReviewThread=async(threadId,input={},actorId=null)=>{
  requireFields(input,['reason','evidence'],'INVALID_AIGC_TIMELINE_REVIEW_REOPEN');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_timeline_review_threads WHERE id=?',[threadId]);
  const thread=rows[0];
  if(!thread)throw errorOf('Review thread not found','AIGC_TIMELINE_REVIEW_NOT_FOUND',404);
  if(thread.status!=='RESOLVED')throw errorOf(
    'Only RESOLVED review thread can be reopened','AIGC_TIMELINE_REVIEW_STATE_INVALID',409,{status:thread.status}
  );
  await db.execute(
    "UPDATE aigc_timeline_review_threads SET status='OPEN',resolved_at=NULL WHERE id=?",[threadId]
  );
  await db.execute(
    `INSERT INTO aigc_timeline_review_events
      (id,project_id,review_thread_id,event_type,event_payload_json,evidence_json,actor_identity_id)
     VALUES (?,?,?,'REOPEN',?,?,?)`,
    [randomUUID(),thread.project_id,threadId,asJson({reason:input.reason}),asJson(input.evidence),actorId]
  );
  return {id:threadId,status:'OPEN'};
};

export const lockAigcTimelineVersion=async(timelineVersionId,input={},actorId=null)=>{
  requireFields(input,['approval','evidence'],'INVALID_AIGC_TIMELINE_LOCK');
  if(upper(input.approval.status)!=='APPROVED'||!nonEmpty(input.approval.approver))
    throw errorOf('Timeline lock requires explicit approval','AIGC_TIMELINE_LOCK_APPROVAL_REQUIRED',409);
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_timeline_versions WHERE id=?',[timelineVersionId]);
  const timeline=rows[0];
  if(!timeline)throw errorOf('Timeline version not found','AIGC_TIMELINE_NOT_FOUND',404);
  if(timeline.status!=='DRAFT')throw errorOf('Only DRAFT timeline can be locked','AIGC_TIMELINE_LOCK_STATE_INVALID',409);
  const productionGate=await evaluateAigcProductionGate(timeline.project_id,{persist:false},actorId);
  if(productionGate.status!=='PASS')throw errorOf(
    'G-AIGC-PRODUCTION must remain PASS before timeline lock','G_AIGC_PRODUCTION_REQUIRED',409,
    {reasonCodes:productionGate.reasonCodes}
  );
  const [openRows]=await db.execute(
    "SELECT id FROM aigc_timeline_review_threads WHERE timeline_version_id=? AND status='OPEN'",[timelineVersionId]
  );
  if(openRows.length)throw errorOf(
    'All Creative Review threads must be RESOLVED before timeline lock',
    'AIGC_TIMELINE_REVIEW_OPEN',409,{threadIds:openRows.map(x=>x.id)}
  );

  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_timeline_versions SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND is_current=TRUE AND status='LOCKED'",
      [timeline.project_id]
    );
    await conn.execute(
      "UPDATE aigc_timeline_versions SET status='LOCKED',is_current=TRUE,locked_at=CURRENT_TIMESTAMP(6) WHERE id=?",
      [timelineVersionId]
    );
    await insertTrace(conn,{projectId:timeline.project_id,sourceType:'TIMELINE_VERSION',sourceId:timelineVersionId,
      targetType:'TIMELINE_VERSION',targetId:timelineVersionId,linkType:'LOCKED_AS_CURRENT',actorId,
      evidence:{approval:input.approval}});
    await conn.commit();
    return {id:timelineVersionId,projectId:timeline.project_id,status:'LOCKED',isCurrent:true};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createAigcRenderExport=async(timelineVersionId,input={},actorId=null)=>{
  requireFields(input,[
    'exportKey','exportVersionNo','exportType','contentLocator','renderSpec',
    'sourceFingerprintSha256','status','evidence'
  ],'INVALID_AIGC_RENDER_EXPORT');
  const exportType=upper(input.exportType),status=upper(input.status),versionNo=Number(input.exportVersionNo);
  if(!EXPORT_TYPES.has(exportType))throw errorOf('Unsupported export type','AIGC_RENDER_EXPORT_TYPE_INVALID',409,{exportType});
  if(!EXPORT_STATUSES.has(status))throw errorOf('Export status must be PASS/FAIL','AIGC_RENDER_EXPORT_STATUS_INVALID',409);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf('Export version invalid','AIGC_RENDER_EXPORT_VERSION_INVALID',409);
  if(!SHA64.test(String(input.sourceFingerprintSha256||'')))throw errorOf(
    'Export source fingerprint must be SHA-256','AIGC_RENDER_EXPORT_SHA_INVALID',409
  );
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_timeline_versions WHERE id=?',[timelineVersionId]);
  const timeline=rows[0];
  if(!timeline)throw errorOf('Timeline version not found','AIGC_TIMELINE_NOT_FOUND',404);
  if(exportType==='EDIT_MASTER'&&(timeline.status!=='LOCKED'||!timeline.is_current))
    throw errorOf('EDIT_MASTER requires current locked timeline','AIGC_EDIT_MASTER_LOCK_REQUIRED',409);
  if(exportType==='PREVIEW'&&!['DRAFT','LOCKED'].includes(timeline.status))
    throw errorOf('PREVIEW requires active timeline','AIGC_PREVIEW_TIMELINE_STATE_INVALID',409);

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_render_exports
      (id,project_id,timeline_version_id,export_key,export_version_no,export_type,content_locator_json,
       render_spec_json,source_fingerprint_sha256,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,timeline.project_id,timelineVersionId,input.exportKey,versionNo,exportType,
     asJson(input.contentLocator),asJson(input.renderSpec),String(input.sourceFingerprintSha256).toLowerCase(),
     status,asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId:timeline.project_id,sourceType:'TIMELINE_VERSION',sourceId:timelineVersionId,
    targetType:'RENDER_EXPORT',targetId:id,linkType:'RENDERED_AS',actorId,
    evidence:{exportKey:input.exportKey,exportType,status}});
  return {id,timelineVersionId,exportKey:input.exportKey,exportVersionNo:versionNo,exportType,status};
};

export const evaluateAigcEditGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const productionGate=await evaluateAigcProductionGate(projectId,{asOf,persist:false},actorId);
  if(productionGate.status!=='PASS')reasons.push('G_AIGC_PRODUCTION_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.currentBreakdownPlanId=breakdown?.id||null;
  const timeline=await currentTimeline(projectId,db);
  evidence.currentTimelineVersionId=timeline?.id||null;
  if(!timeline)reasons.push('AIGC_CURRENT_LOCKED_TIMELINE_REQUIRED');
  else if(!breakdown||timeline.breakdown_plan_id!==breakdown.id)reasons.push('AIGC_TIMELINE_BREAKDOWN_STALE');
  else{
    const [tracks,clips,reviews,exports,requiredLocks]=await Promise.all([
      listRows(db,'SELECT * FROM aigc_timeline_tracks WHERE timeline_version_id=? ORDER BY sequence_no,id',[timeline.id]),
      listRows(db,
        `SELECT c.*,t.track_type,l.status AS production_lock_status,
                gc.is_current,gc.selection_status,j.status AS job_status,j.generation_kind,
                r.production_type
           FROM aigc_timeline_clips c
           JOIN aigc_timeline_tracks t ON t.id=c.track_id
           LEFT JOIN aigc_production_locks l ON l.id=c.production_lock_id
           LEFT JOIN aigc_generation_candidates gc ON gc.id=l.candidate_id
           LEFT JOIN aigc_generation_jobs j ON j.id=l.generation_job_id
           LEFT JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
          WHERE c.timeline_version_id=? ORDER BY t.sequence_no,c.sequence_no,c.id`,[timeline.id]),
      listRows(db,'SELECT * FROM aigc_timeline_review_threads WHERE timeline_version_id=? ORDER BY created_at,id',[timeline.id]),
      listRows(db,'SELECT * FROM aigc_render_exports WHERE timeline_version_id=? ORDER BY export_version_no,id',[timeline.id]),
      listRows(db,
        `SELECT l.id,r.shot_id,r.production_type
           FROM aigc_production_locks l
           JOIN aigc_shot_production_requirements r ON r.id=l.production_requirement_id
          WHERE l.project_id=? AND r.breakdown_plan_id=? AND r.applicability='REQUIRED'
            AND r.status='LOCKED' AND l.status='LOCKED'`,[projectId,breakdown.id])
    ]);
    validatePostPlan(parseJson(timeline.post_production_plan_json)||{});
    const usedLocks=new Set(clips.filter(x=>x.production_lock_id).map(x=>x.production_lock_id));
    const missingLocks=requiredLocks.filter(x=>!usedLocks.has(x.id));
    if(missingLocks.length)reasons.push('AIGC_TIMELINE_REQUIRED_PRODUCTION_COVERAGE_INCOMPLETE');

    const staleClips=clips.filter(x=>{
      if(x.source_type==='PRODUCTION_LOCK')return x.production_lock_status!=='LOCKED'||!x.is_current||
        x.selection_status!=='SELECTED'||x.job_status!=='PASS'||x.generation_kind!==x.production_type||
        !compatibleTrack(x.track_type,x.production_type);
      if(x.source_type==='ASSET_VERSION')return !x.asset_version_id;
      return true;
    });
    if(staleClips.length)reasons.push('AIGC_TIMELINE_CLIP_SOURCE_STALE');

    const openReviews=reviews.filter(x=>x.status==='OPEN');
    if(openReviews.length)reasons.push('AIGC_TIMELINE_REVIEW_OPEN');
    const passedMaster=exports.filter(x=>x.export_type==='EDIT_MASTER'&&x.status==='PASS');
    if(!passedMaster.length)reasons.push('AIGC_EDIT_MASTER_EXPORT_REQUIRED');

    evidence.trackCount=tracks.length;
    evidence.clipCount=clips.length;
    evidence.requiredProductionLockCount=requiredLocks.length;
    evidence.usedRequiredProductionLockCount=requiredLocks.filter(x=>usedLocks.has(x.id)).length;
    evidence.openReviewCount=openReviews.length;
    evidence.reviewThreadCount=reviews.length;
    evidence.editMasterPassCount=passedMaster.length;
    evidence.exportCount=exports.length;
    evidence.timelineReady=missingLocks.length===0&&staleClips.length===0&&openReviews.length===0&&passedMaster.length>0;
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m2811_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcEditState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [timelines,tracks,clips,reviews,events,exports,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_timeline_versions WHERE project_id=? ORDER BY version_no,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_timeline_tracks WHERE project_id=? ORDER BY timeline_version_id,sequence_no,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_timeline_clips WHERE project_id=? ORDER BY timeline_version_id,track_id,sequence_no,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_timeline_review_threads WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_timeline_review_events WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_render_exports WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2811_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['时间线与序列版本','合成与后期','创作审阅','渲染与导出记录'],
      gateName:'剪辑 / 时间线门禁',
      trackTypeLabels:{VIDEO:'视频轨',DIALOGUE:'对白轨',VOICE:'声音轨',MUSIC:'音乐轨',SFX:'音效轨',
        AMBIENCE:'环境声轨',CAPTION:'字幕轨',GRAPHIC:'图形轨'},
      reviewStatusLabels:{OPEN:'待处理',RESOLVED:'已解决'},
      exportTypeLabels:{PREVIEW:'预览导出',EDIT_MASTER:'剪辑母版导出'}
    },
    timelines:timelines.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,timelineKey:x.timeline_key,versionNo:Number(x.version_no),
      title:x.title,durationMs:Number(x.duration_ms),postProductionPlan:parseJson(x.post_production_plan_json),
      parentTimelineVersionId:x.parent_timeline_version_id||null,changeRef:parseJson(x.change_ref_json),
      status:x.status,isCurrent:Boolean(x.is_current),lockedAt:x.locked_at
    })),
    tracks:tracks.map(x=>({
      id:x.id,timelineVersionId:x.timeline_version_id,trackKey:x.track_key,trackType:x.track_type,
      sequenceNo:Number(x.sequence_no),displayName:x.display_name,trackSettings:parseJson(x.track_settings_json)
    })),
    clips:clips.map(x=>({
      id:x.id,timelineVersionId:x.timeline_version_id,trackId:x.track_id,clipKey:x.clip_key,
      sequenceNo:Number(x.sequence_no),shotId:x.shot_id||null,sourceType:x.source_type,
      productionLockId:x.production_lock_id||null,assetVersionId:x.asset_version_id||null,
      sourceVersionKey:x.source_version_key,sourceInMs:Number(x.source_in_ms),sourceOutMs:Number(x.source_out_ms),
      timelineStartMs:Number(x.timeline_start_ms),timelineEndMs:Number(x.timeline_end_ms),speed:Number(x.speed),
      transition:parseJson(x.transition_json),lineage:parseJson(x.lineage_json)
    })),
    reviews:reviews.map(x=>({
      id:x.id,timelineVersionId:x.timeline_version_id,threadKey:x.thread_key,anchorType:x.anchor_type,
      anchorShotId:x.anchor_shot_id||null,anchorAssetVersionId:x.anchor_asset_version_id||null,
      timecodeMs:x.timecode_ms==null?null:Number(x.timecode_ms),reviewer:parseJson(x.reviewer_json),
      approvalRole:x.approval_role,comment:x.comment_text,requestedChange:parseJson(x.requested_change_json),
      decisionRef:parseJson(x.decision_ref_json),status:x.status,resolvedAt:x.resolved_at
    })),
    reviewEvents:events.map(x=>({
      id:x.id,reviewThreadId:x.review_thread_id,eventType:x.event_type,
      eventPayload:parseJson(x.event_payload_json),evidence:parseJson(x.evidence_json),createdAt:x.created_at
    })),
    exports:exports.map(x=>({
      id:x.id,timelineVersionId:x.timeline_version_id,exportKey:x.export_key,
      exportVersionNo:Number(x.export_version_no),exportType:x.export_type,
      contentLocator:parseJson(x.content_locator_json),renderSpec:parseJson(x.render_spec_json),
      sourceFingerprintSha256:x.source_fingerprint_sha256,status:x.status
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
