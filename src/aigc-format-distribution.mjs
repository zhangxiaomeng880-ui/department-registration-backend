import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcBreakdownGate } from './aigc-breakdown.mjs';

const GATE='G-AIGC-FORMAT';
const LOCALIZATION_LEVELS=new Set(['NONE','SUBTITLE','VOICEOVER','FULL']);
const RELEASE_ROLES=new Set(['MASTER','FULL_VERSION','SERIES_VERSION','CLIP','TRAILER','SOCIAL_DERIVATIVE']);
const STATUS_FROZEN='FROZEN';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const upper=v=>v==null?null:String(v).trim().toUpperCase();
const asJson=v=>v==null?null:JSON.stringify(v);
const parseJson=v=>{
  if(v==null)return null;
  if(typeof v==='object')return v;
  try{return JSON.parse(v);}catch{return null;}
};
const nonEmpty=v=>{
  if(v==null)return false;
  if(Array.isArray(v))return v.length>0;
  if(typeof v==='object')return Object.keys(v).length>0;
  return String(v).trim().length>0;
};
const requireFields=(input,fields,code)=>{
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const requireObjectFields=(obj,fields,code,details={})=>{
  if(!obj||typeof obj!=='object')throw errorOf('Structured object is required',code,409,details);
  const missing=fields.filter(k=>obj[k]===undefined||obj[k]===null||obj[k]==='');
  if(missing.length)throw errorOf('Structured fields are missing',code,409,{...details,missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Format requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
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
const insertTrace=async(db,{projectId,sourceType,sourceId,targetType,targetId,linkType,evidence,actorId})=>{
  await db.execute(
    `INSERT INTO aigc_trace_links
      (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE evidence_json=VALUES(evidence_json)`,
    [randomUUID(),projectId,sourceType,sourceId,targetType,targetId,linkType,asJson(evidence||null),actorId||null]
  );
};

export const resolveAigcFormatProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

const validateMasterFormat=input=>{
  requireObjectFields(input,['aspectRatio','resolution','frameRate'],'AIGC_MASTER_FORMAT_INCOMPLETE');
  requireObjectFields(input.resolution,['width','height'],'AIGC_MASTER_RESOLUTION_INCOMPLETE');
  const width=Number(input.resolution.width),height=Number(input.resolution.height),frameRate=Number(input.frameRate);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    throw errorOf('Master resolution must be positive','AIGC_MASTER_RESOLUTION_INVALID',409);
  if(!Number.isFinite(frameRate)||frameRate<=0)
    throw errorOf('Master frameRate must be positive','AIGC_MASTER_FRAME_RATE_INVALID',409);
};

const validateDistributionProfile=(profile,masterAspect)=>{
  requireFields(profile,['profileKey','kind','aspectRatio','resolution','frameRate','purpose'],'INVALID_AIGC_DISTRIBUTION_PROFILE');
  if(upper(profile.kind)!=='DERIVATIVE')throw errorOf(
    'Distribution profile must be DERIVATIVE and cannot replace Master',
    'AIGC_DISTRIBUTION_PROFILE_MASTER_OVERWRITE_FORBIDDEN',409,{profileKey:profile.profileKey}
  );
  requireObjectFields(profile.resolution,['width','height'],'AIGC_DISTRIBUTION_PROFILE_RESOLUTION_INCOMPLETE',
    {profileKey:profile.profileKey});
  if(profile.profileKey==='MASTER'||profile.aspectRatio===undefined)
    throw errorOf('Distribution profile must be distinct from Master identity',
      'AIGC_DISTRIBUTION_PROFILE_INVALID',409,{profileKey:profile.profileKey});
  return {...profile,kind:'DERIVATIVE',masterAspectReference:masterAspect};
};

export const createAigcVisualFormatStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','masterFormat','safeZones','cropRecomposePolicy','subtitleSafeArea',
    'firstLastFrame','distributionProfiles','derivationPolicy','evidence'
  ],'INVALID_AIGC_VISUAL_FORMAT_STRATEGY');
  validateMasterFormat(input.masterFormat);
  if(!Array.isArray(input.distributionProfiles)||!input.distributionProfiles.length)
    throw errorOf('At least one distribution profile is required','AIGC_DISTRIBUTION_PROFILE_REQUIRED',409);
  const profiles=input.distributionProfiles.map(x=>validateDistributionProfile(x,input.masterFormat.aspectRatio));
  const keys=profiles.map(x=>x.profileKey);
  if(new Set(keys).size!==keys.length)throw errorOf('Duplicate distribution profileKey',
    'AIGC_DISTRIBUTION_PROFILE_DUPLICATE',409);

  const db=getRuntimePool();
  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{persist:false},actorId);
  if(breakdownGate.status!=='PASS')throw errorOf('G-AIGC-BREAKDOWN must PASS before Visual Format',
    'G_AIGC_BREAKDOWN_REQUIRED',409,{reasonCodes:breakdownGate.reasonCodes});
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown Plan required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);

  const conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute("UPDATE aigc_visual_format_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",
      [projectId]);
    await conn.execute(
      `INSERT INTO aigc_visual_format_strategies
        (id,project_id,breakdown_plan_id,strategy_key,master_format_json,safe_zones_json,
         crop_recompose_policy_json,subtitle_safe_area_json,first_last_frame_json,
         distribution_profiles_json,derivation_policy_json,status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [id,projectId,breakdown.id,input.strategyKey,asJson(input.masterFormat),asJson(input.safeZones),
       asJson(input.cropRecomposePolicy),asJson(input.subtitleSafeArea),asJson(input.firstLastFrame),
       asJson(profiles),asJson(input.derivationPolicy),asJson(input.evidence),actorId]
    );
    await insertTrace(conn,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:breakdown.id,
      targetType:'VISUAL_FORMAT_STRATEGY',targetId:id,linkType:'FORMATS_AS',actorId,
      evidence:{masterAspectRatio:input.masterFormat.aspectRatio}});
    await conn.commit();
    return {id,projectId,breakdownPlanId:breakdown.id,strategyKey:input.strategyKey,status:'FROZEN',
      masterAspectRatio:input.masterFormat.aspectRatio,distributionProfileCount:profiles.length};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const createAigcAudioStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','voiceMaster','dialogue','music','ost','sfx','ambience',
    'trackSeparation','loudnessExport','rights','evidence'
  ],'INVALID_AIGC_AUDIO_STRATEGY');
  requireObjectFields(input.voiceMaster,['policy','format'],'AIGC_AUDIO_VOICE_MASTER_INCOMPLETE');
  requireObjectFields(input.dialogue,['policy'],'AIGC_AUDIO_DIALOGUE_INCOMPLETE');
  requireObjectFields(input.music,['policy'],'AIGC_AUDIO_MUSIC_INCOMPLETE');
  requireObjectFields(input.ost,['policy'],'AIGC_AUDIO_OST_INCOMPLETE');
  requireObjectFields(input.sfx,['policy'],'AIGC_AUDIO_SFX_INCOMPLETE');
  requireObjectFields(input.ambience,['policy'],'AIGC_AUDIO_AMBIENCE_INCOMPLETE');
  requireObjectFields(input.trackSeparation,['tracks'],'AIGC_AUDIO_TRACK_SEPARATION_INCOMPLETE');
  requireObjectFields(input.loudnessExport,['target','exportSpec'],'AIGC_AUDIO_LOUDNESS_EXPORT_INCOMPLETE');
  requireObjectFields(input.rights,['dialogue','music','ost','sfx','disclosure'],'AIGC_AUDIO_RIGHTS_INCOMPLETE');

  const db=getRuntimePool();
  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{persist:false},actorId);
  if(breakdownGate.status!=='PASS')throw errorOf('G-AIGC-BREAKDOWN must PASS before Audio Strategy',
    'G_AIGC_BREAKDOWN_REQUIRED',409,{reasonCodes:breakdownGate.reasonCodes});
  const conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute("UPDATE aigc_audio_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",
      [projectId]);
    await conn.execute(
      `INSERT INTO aigc_audio_strategies
        (id,project_id,strategy_key,voice_master_json,dialogue_json,music_json,ost_json,sfx_json,
         ambience_json,track_separation_json,loudness_export_json,rights_json,status,evidence_json,
         created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [id,projectId,input.strategyKey,asJson(input.voiceMaster),asJson(input.dialogue),asJson(input.music),
       asJson(input.ost),asJson(input.sfx),asJson(input.ambience),asJson(input.trackSeparation),
       asJson(input.loudnessExport),asJson(input.rights),asJson(input.evidence),actorId]
    );
    await conn.commit();
    return {id,projectId,strategyKey:input.strategyKey,status:'FROZEN'};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const validateDistributionTarget=target=>{
  requireFields(target,[
    'targetKey','channel','market','language','localizationLevel','platformSpec',
    'aiDisclosure','rightsBoundary','releaseRole'
  ],'INVALID_AIGC_DISTRIBUTION_TARGET');
  const level=upper(target.localizationLevel),role=upper(target.releaseRole);
  if(!LOCALIZATION_LEVELS.has(level))throw errorOf('Unsupported localization level',
    'AIGC_LOCALIZATION_LEVEL_INVALID',409,{targetKey:target.targetKey,localizationLevel:level});
  if(!RELEASE_ROLES.has(role))throw errorOf('Unsupported release role',
    'AIGC_RELEASE_ROLE_INVALID',409,{targetKey:target.targetKey,releaseRole:role});
  requireObjectFields(target.platformSpec,['aspectRatio','resolution','frameRate'],'AIGC_PLATFORM_SPEC_INCOMPLETE',
    {targetKey:target.targetKey});
  requireObjectFields(target.aiDisclosure,['policy'],'AIGC_AI_DISCLOSURE_POLICY_REQUIRED',{targetKey:target.targetKey});
  requireObjectFields(target.rightsBoundary,['status','scope'],'AIGC_DISTRIBUTION_RIGHTS_BOUNDARY_REQUIRED',{targetKey:target.targetKey});
  return {...target,localizationLevel:level,releaseRole:role};
};

export const createAigcDistributionStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','visualFormatStrategyId','audioStrategyId','targets',
    'localizationMatrix','releasePackaging','rightsBoundary','aiDisclosurePolicy','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_STRATEGY');
  if(!Array.isArray(input.targets)||!input.targets.length)
    throw errorOf('Distribution Strategy requires at least one target','AIGC_DISTRIBUTION_TARGET_REQUIRED',409);
  const targets=input.targets.map(validateDistributionTarget);
  const keys=targets.map(x=>x.targetKey);
  if(new Set(keys).size!==keys.length)throw errorOf('Duplicate distribution targetKey',
    'AIGC_DISTRIBUTION_TARGET_DUPLICATE',409);

  const db=getRuntimePool();
  const [visualRows,audioRows]=await Promise.all([
    db.execute("SELECT * FROM aigc_visual_format_strategies WHERE id=? AND project_id=? AND status='FROZEN'",
      [input.visualFormatStrategyId,projectId]).then(x=>x[0]),
    db.execute("SELECT * FROM aigc_audio_strategies WHERE id=? AND project_id=? AND status='FROZEN'",
      [input.audioStrategyId,projectId]).then(x=>x[0])
  ]);
  const visual=visualRows[0],audio=audioRows[0];
  if(!visual)throw errorOf('Current frozen Visual Format Strategy required','AIGC_VISUAL_FORMAT_STRATEGY_INVALID',409);
  if(!audio)throw errorOf('Current frozen Audio Strategy required','AIGC_AUDIO_STRATEGY_INVALID',409);
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown||visual.breakdown_plan_id!==breakdown.id)throw errorOf(
    'Visual Format Strategy is stale for current Breakdown','AIGC_VISUAL_FORMAT_BREAKDOWN_STALE',409);

  const profiles=parseJson(visual.distribution_profiles_json)||[];
  const profileKeys=new Set(profiles.map(x=>x.profileKey));
  for(const target of targets){
    if(target.profileKey&&!profileKeys.has(target.profileKey))throw errorOf(
      'Distribution target references unknown visual distribution profile',
      'AIGC_DISTRIBUTION_PROFILE_LINK_INVALID',409,{targetKey:target.targetKey,profileKey:target.profileKey}
    );
  }

  const conn=await db.getConnection(),id=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute("UPDATE aigc_distribution_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",
      [projectId]);
    await conn.execute(
      `INSERT INTO aigc_distribution_strategies
        (id,project_id,visual_format_strategy_id,audio_strategy_id,strategy_key,targets_json,
         localization_matrix_json,release_packaging_json,rights_boundary_json,
         ai_disclosure_policy_json,status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [id,projectId,visual.id,audio.id,input.strategyKey,asJson(targets),asJson(input.localizationMatrix),
       asJson(input.releasePackaging),asJson(input.rightsBoundary),asJson(input.aiDisclosurePolicy),
       asJson(input.evidence),actorId]
    );
    await insertTrace(conn,{projectId,sourceType:'VISUAL_FORMAT_STRATEGY',sourceId:visual.id,
      targetType:'DISTRIBUTION_STRATEGY',targetId:id,linkType:'DISTRIBUTES_AS',actorId,
      evidence:{targetCount:targets.length}});
    await insertTrace(conn,{projectId,sourceType:'AUDIO_STRATEGY',sourceId:audio.id,
      targetType:'DISTRIBUTION_STRATEGY',targetId:id,linkType:'AUDIO_FOR',actorId,
      evidence:{targetCount:targets.length}});
    await conn.commit();
    return {id,projectId,strategyKey:input.strategyKey,status:'FROZEN',
      visualFormatStrategyId:visual.id,audioStrategyId:audio.id,targetCount:targets.length};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateAigcFormatGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{asOf,persist:false},actorId);
  if(breakdownGate.status!=='PASS')reasons.push('G_AIGC_BREAKDOWN_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.breakdownPlanId=breakdown?.id||null;

  const [visualRows,audioRows,distributionRows]=await Promise.all([
    listRows(db,"SELECT * FROM aigc_visual_format_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId]),
    listRows(db,"SELECT * FROM aigc_audio_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId]),
    listRows(db,"SELECT * FROM aigc_distribution_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId])
  ]);
  const visual=visualRows[0]||null,audio=audioRows[0]||null,distribution=distributionRows[0]||null;
  evidence.visualFormatStrategyId=visual?.id||null;
  evidence.audioStrategyId=audio?.id||null;
  evidence.distributionStrategyId=distribution?.id||null;
  if(!visual)reasons.push('AIGC_VISUAL_FORMAT_STRATEGY_REQUIRED');
  else{
    if(!breakdown||visual.breakdown_plan_id!==breakdown.id)reasons.push('AIGC_VISUAL_FORMAT_BREAKDOWN_STALE');
    const master=parseJson(visual.master_format_json)||{};
    if(!master.aspectRatio||!master.resolution||!master.frameRate)reasons.push('AIGC_MASTER_FORMAT_INCOMPLETE');
    const profiles=parseJson(visual.distribution_profiles_json)||[];
    if(!profiles.length)reasons.push('AIGC_DISTRIBUTION_PROFILE_REQUIRED');
    if(profiles.some(x=>upper(x.kind)!=='DERIVATIVE'))reasons.push('AIGC_DISTRIBUTION_PROFILE_MASTER_OVERWRITE_FORBIDDEN');
    evidence.masterAspectRatio=master.aspectRatio||null;
    evidence.distributionProfileCount=profiles.length;
  }
  if(!audio)reasons.push('AIGC_AUDIO_STRATEGY_REQUIRED');
  else{
    const rights=parseJson(audio.rights_json)||{};
    for(const key of ['dialogue','music','ost','sfx','disclosure'])if(!nonEmpty(rights[key]))
      reasons.push('AIGC_AUDIO_RIGHTS_INCOMPLETE:'+key);
  }
  if(!distribution)reasons.push('AIGC_DISTRIBUTION_STRATEGY_REQUIRED');
  else{
    if(!visual||distribution.visual_format_strategy_id!==visual.id)reasons.push('AIGC_DISTRIBUTION_VISUAL_STALE');
    if(!audio||distribution.audio_strategy_id!==audio.id)reasons.push('AIGC_DISTRIBUTION_AUDIO_STALE');
    const targets=parseJson(distribution.targets_json)||[];
    if(!targets.length)reasons.push('AIGC_DISTRIBUTION_TARGET_REQUIRED');
    for(const target of targets){
      for(const key of ['channel','market','language','localizationLevel','platformSpec','aiDisclosure','rightsBoundary','releaseRole']){
        if(!nonEmpty(target[key]))reasons.push('AIGC_DISTRIBUTION_TARGET_INCOMPLETE:'+String(target.targetKey||'UNKNOWN')+':'+key);
      }
    }
    evidence.distributionTargetCount=targets.length;
    evidence.channels=[...new Set(targets.map(x=>x.channel))];
    evidence.markets=[...new Set(targets.map(x=>x.market))];
    evidence.languages=[...new Set(targets.map(x=>x.language))];
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m287_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcFormatState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [visual,audio,distribution,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_visual_format_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_audio_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_distribution_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m287_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['视觉格式策略','音频策略','分发策略','格式交付矩阵'],
      gateName:'格式 / 音频 / 分发门禁',
      formatKindLabels:{MASTER:'母版',DERIVATIVE:'派生版本'}
    },
    visualStrategies:visual.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,strategyKey:x.strategy_key,
      masterFormat:parseJson(x.master_format_json),safeZones:parseJson(x.safe_zones_json),
      cropRecomposePolicy:parseJson(x.crop_recompose_policy_json),
      subtitleSafeArea:parseJson(x.subtitle_safe_area_json),firstLastFrame:parseJson(x.first_last_frame_json),
      distributionProfiles:parseJson(x.distribution_profiles_json),derivationPolicy:parseJson(x.derivation_policy_json),
      status:x.status
    })),
    audioStrategies:audio.map(x=>({
      id:x.id,strategyKey:x.strategy_key,voiceMaster:parseJson(x.voice_master_json),
      dialogue:parseJson(x.dialogue_json),music:parseJson(x.music_json),ost:parseJson(x.ost_json),
      sfx:parseJson(x.sfx_json),ambience:parseJson(x.ambience_json),
      trackSeparation:parseJson(x.track_separation_json),loudnessExport:parseJson(x.loudness_export_json),
      rights:parseJson(x.rights_json),status:x.status
    })),
    distributionStrategies:distribution.map(x=>({
      id:x.id,visualFormatStrategyId:x.visual_format_strategy_id,audioStrategyId:x.audio_strategy_id,
      strategyKey:x.strategy_key,targets:parseJson(x.targets_json),
      localizationMatrix:parseJson(x.localization_matrix_json),
      releasePackaging:parseJson(x.release_packaging_json),
      rightsBoundary:parseJson(x.rights_boundary_json),
      aiDisclosurePolicy:parseJson(x.ai_disclosure_policy_json),status:x.status
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
