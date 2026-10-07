import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcBreakdownGate } from './aigc-breakdown.mjs';

const GATE='G-AIGC-FORMAT';
const LOC_LEVELS=new Set(['NONE','SUBTITLE','VOICEOVER','FULL']);

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
  const missing=fields.filter(k=>!nonEmpty(input[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const requireObjectFields=(obj,fields,code,details={})=>{
  if(!obj||typeof obj!=='object')throw errorOf('Structured object required',code,409,details);
  const missing=fields.filter(k=>obj[k]===undefined||obj[k]===null||obj[k]==='');
  if(missing.length)throw errorOf('Structured fields missing',code,409,{...details,missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf('AIGC format domain requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409);
  return rows[0];
};
const currentBreakdown=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",[projectId]
  );
  return rows[0]||null;
};

export const resolveAigcFormatProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createAigcVisualFormatStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','breakdownPlanId','masterFormat','safeZones','cropRecomposePolicy',
    'subtitleSafeArea','firstLastFrame','distributionProfiles','derivationPolicy','evidence'
  ],'INVALID_AIGC_VISUAL_FORMAT_STRATEGY');
  requireObjectFields(input.masterFormat,['aspectRatio','resolution','frameRate'],'AIGC_MASTER_FORMAT_INCOMPLETE');
  requireObjectFields(input.cropRecomposePolicy,['masterProtected','cropAllowed','recomposeAllowed'],'AIGC_CROP_RECOMPOSE_POLICY_INCOMPLETE');
  requireObjectFields(input.derivationPolicy,['masterImmutable','deriveFromMaster','historyPreserved'],'AIGC_DERIVATION_POLICY_INCOMPLETE');
  if(input.derivationPolicy.masterImmutable!==true||input.derivationPolicy.deriveFromMaster!==true||
     input.derivationPolicy.historyPreserved!==true)
    throw errorOf('Distribution formats must derive from immutable master','AIGC_MASTER_DERIVATION_POLICY_REQUIRED',409);
  if(!Array.isArray(input.distributionProfiles)||!input.distributionProfiles.length)
    throw errorOf('At least one distribution format profile is required','AIGC_DISTRIBUTION_PROFILE_REQUIRED',409);
  const profileKeys=new Set();
  for(const p of input.distributionProfiles){
    requireFields(p,['profileKey','displayName','aspectRatio','resolution','safeAreaPolicy'],'INVALID_AIGC_DISTRIBUTION_PROFILE');
    if(profileKeys.has(p.profileKey))throw errorOf('Duplicate distribution profile','AIGC_DISTRIBUTION_PROFILE_DUPLICATE',409,{profileKey:p.profileKey});
    profileKeys.add(p.profileKey);
  }
  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  if(!breakdown||breakdown.id!==input.breakdownPlanId)throw errorOf(
    'Visual strategy must bind current frozen Breakdown Plan','AIGC_FORMAT_BREAKDOWN_STALE',409,
    {currentBreakdownPlanId:breakdown?.id||null,providedBreakdownPlanId:input.breakdownPlanId}
  );
  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{persist:false},actorId);
  if(breakdownGate.status!=='PASS')throw errorOf('G-AIGC-BREAKDOWN must PASS before format strategy',
    'G_AIGC_BREAKDOWN_REQUIRED',409,{reasonCodes:breakdownGate.reasonCodes});
  await db.execute("UPDATE aigc_visual_format_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",[projectId]);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_visual_format_strategies
      (id,project_id,breakdown_plan_id,strategy_key,master_format_json,safe_zones_json,crop_recompose_policy_json,
       subtitle_safe_area_json,first_last_frame_json,distribution_profiles_json,derivation_policy_json,
       status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
    [id,projectId,input.breakdownPlanId,input.strategyKey,asJson(input.masterFormat),asJson(input.safeZones),
     asJson(input.cropRecomposePolicy),asJson(input.subtitleSafeArea),asJson(input.firstLastFrame),
     asJson(input.distributionProfiles),asJson(input.derivationPolicy),asJson(input.evidence),actorId]
  );
  return {id,projectId,strategyKey:input.strategyKey,status:'FROZEN',masterFormat:input.masterFormat,
    distributionProfiles:input.distributionProfiles};
};

export const createAigcAudioStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','voiceMaster','dialogue','music','ost','sfx','ambience',
    'trackSeparation','loudnessExport','rights','evidence'
  ],'INVALID_AIGC_AUDIO_STRATEGY');
  requireObjectFields(input.loudnessExport,['targetLufs','truePeakDbtp','exportSpec'],'AIGC_AUDIO_EXPORT_INCOMPLETE');
  requireObjectFields(input.rights,['voice','music','ost','sfx','ambience'],'AIGC_AUDIO_RIGHTS_INCOMPLETE');
  for(const [k,v] of Object.entries(input.rights)){
    if(!nonEmpty(v))throw errorOf('Audio rights boundary cannot be empty','AIGC_AUDIO_RIGHTS_INCOMPLETE',409,{field:k});
  }
  const db=getRuntimePool();
  await db.execute("UPDATE aigc_audio_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",[projectId]);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_audio_strategies
      (id,project_id,strategy_key,voice_master_json,dialogue_json,music_json,ost_json,sfx_json,
       ambience_json,track_separation_json,loudness_export_json,rights_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'FROZEN',?,?)`,
    [id,projectId,input.strategyKey,asJson(input.voiceMaster),asJson(input.dialogue),asJson(input.music),
     asJson(input.ost),asJson(input.sfx),asJson(input.ambience),asJson(input.trackSeparation),
     asJson(input.loudnessExport),asJson(input.rights),asJson(input.evidence),actorId]
  );
  return {id,projectId,strategyKey:input.strategyKey,status:'FROZEN'};
};

export const createAigcDistributionStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','visualFormatStrategyId','audioStrategyId','targets',
    'localizationMatrix','releasePackaging','rightsBoundary','aiDisclosurePolicy','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_STRATEGY');
  if(!Array.isArray(input.targets)||!input.targets.length)throw errorOf(
    'Distribution strategy requires targets','AIGC_DISTRIBUTION_TARGET_REQUIRED',409
  );
  const db=getRuntimePool();
  const [visualRows,audioRows]=await Promise.all([
    db.execute("SELECT * FROM aigc_visual_format_strategies WHERE id=?",[input.visualFormatStrategyId]).then(x=>x[0]),
    db.execute("SELECT * FROM aigc_audio_strategies WHERE id=?",[input.audioStrategyId]).then(x=>x[0])
  ]);
  const visual=visualRows[0],audio=audioRows[0];
  if(!visual||visual.project_id!==projectId||visual.status!=='FROZEN')
    throw errorOf('Current frozen Visual Format Strategy required','AIGC_VISUAL_FORMAT_STRATEGY_INVALID',409);
  if(!audio||audio.project_id!==projectId||audio.status!=='FROZEN')
    throw errorOf('Current frozen Audio Strategy required','AIGC_AUDIO_STRATEGY_INVALID',409);
  const profiles=parseJson(visual.distribution_profiles_json)||[];
  const profileKeys=new Set(profiles.map(x=>x.profileKey));
  const targetKeys=new Set();
  for(const t of input.targets){
    requireFields(t,[
      'targetKey','channel','market','language','localizationLevel','platformSpec',
      'formatProfileKey','aiDisclosure','rightsBoundary'
    ],'INVALID_AIGC_DISTRIBUTION_TARGET');
    if(targetKeys.has(t.targetKey))throw errorOf('Duplicate distribution target','AIGC_DISTRIBUTION_TARGET_DUPLICATE',409,{targetKey:t.targetKey});
    targetKeys.add(t.targetKey);
    if(!LOC_LEVELS.has(upper(t.localizationLevel)))throw errorOf('Invalid localization level','AIGC_LOCALIZATION_LEVEL_INVALID',409,{targetKey:t.targetKey});
    if(!profileKeys.has(t.formatProfileKey))throw errorOf(
      'Distribution target references unknown format profile','AIGC_DISTRIBUTION_FORMAT_PROFILE_INVALID',409,
      {targetKey:t.targetKey,formatProfileKey:t.formatProfileKey}
    );
    if(!nonEmpty(t.aiDisclosure)||!nonEmpty(t.rightsBoundary))
      throw errorOf('Distribution target requires AI disclosure and rights boundary',
        'AIGC_DISTRIBUTION_POLICY_INCOMPLETE',409,{targetKey:t.targetKey});
  }
  await db.execute("UPDATE aigc_distribution_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",[projectId]);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_distribution_strategies
      (id,project_id,visual_format_strategy_id,audio_strategy_id,strategy_key,targets_json,
       localization_matrix_json,release_packaging_json,rights_boundary_json,ai_disclosure_policy_json,
       status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
    [id,projectId,visual.id,audio.id,input.strategyKey,asJson(input.targets),asJson(input.localizationMatrix),
     asJson(input.releasePackaging),asJson(input.rightsBoundary),asJson(input.aiDisclosurePolicy),
     asJson(input.evidence),actorId]
  );
  return {id,projectId,strategyKey:input.strategyKey,status:'FROZEN',targetCount:input.targets.length};
};

export const evaluateAigcFormatGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};
  const breakdown=await evaluateAigcBreakdownGate(projectId,{asOf,persist:false},actorId);
  if(breakdown.status!=='PASS')reasons.push('G_AIGC_BREAKDOWN_NOT_PASS');

  const [visuals,audios,distributions]=await Promise.all([
    listRows(db,"SELECT * FROM aigc_visual_format_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId]),
    listRows(db,"SELECT * FROM aigc_audio_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId]),
    listRows(db,"SELECT * FROM aigc_distribution_strategies WHERE project_id=? AND status='FROZEN' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId])
  ]);
  const visual=visuals[0]||null,audio=audios[0]||null,distribution=distributions[0]||null;
  evidence.visualFormatStrategyId=visual?.id||null;
  evidence.audioStrategyId=audio?.id||null;
  evidence.distributionStrategyId=distribution?.id||null;
  if(!visual)reasons.push('AIGC_VISUAL_FORMAT_STRATEGY_REQUIRED');
  else{
    const master=parseJson(visual.master_format_json)||{};
    const profiles=parseJson(visual.distribution_profiles_json)||[];
    const derivation=parseJson(visual.derivation_policy_json)||{};
    evidence.masterFormat=master;
    evidence.distributionProfiles=profiles;
    if(!nonEmpty(master.aspectRatio)||!nonEmpty(master.resolution)||!nonEmpty(master.frameRate))
      reasons.push('AIGC_MASTER_FORMAT_INCOMPLETE');
    if(!profiles.length)reasons.push('AIGC_DISTRIBUTION_PROFILE_REQUIRED');
    if(derivation.masterImmutable!==true||derivation.deriveFromMaster!==true||derivation.historyPreserved!==true)
      reasons.push('AIGC_MASTER_DERIVATION_POLICY_REQUIRED');
  }
  if(!audio)reasons.push('AIGC_AUDIO_STRATEGY_REQUIRED');
  else{
    const rights=parseJson(audio.rights_json)||{};
    const loudness=parseJson(audio.loudness_export_json)||{};
    if(['voice','music','ost','sfx','ambience'].some(k=>!nonEmpty(rights[k])))
      reasons.push('AIGC_AUDIO_RIGHTS_INCOMPLETE');
    if(!nonEmpty(loudness.targetLufs)||!nonEmpty(loudness.truePeakDbtp)||!nonEmpty(loudness.exportSpec))
      reasons.push('AIGC_AUDIO_EXPORT_INCOMPLETE');
  }
  if(!distribution)reasons.push('AIGC_DISTRIBUTION_STRATEGY_REQUIRED');
  else{
    if(visual&&distribution.visual_format_strategy_id!==visual.id)reasons.push('AIGC_DISTRIBUTION_VISUAL_STALE');
    if(audio&&distribution.audio_strategy_id!==audio.id)reasons.push('AIGC_DISTRIBUTION_AUDIO_STALE');
    const targets=parseJson(distribution.targets_json)||[];
    evidence.distributionTargetCount=targets.length;
    evidence.distributionTargets=targets.map(t=>({
      targetKey:t.targetKey,channel:t.channel,market:t.market,language:t.language,
      localizationLevel:t.localizationLevel,formatProfileKey:t.formatProfileKey
    }));
    if(!targets.length)reasons.push('AIGC_DISTRIBUTION_TARGET_REQUIRED');
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
  const project=await loadProject(projectId),db=getRuntimePool();
  const [visuals,audios,distributions,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_visual_format_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_audio_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_distribution_strategies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m287_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  return {
    project:{id:project.id,name:project.name,projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{language:'zh-CN',moduleNames:['视觉格式策略','音频策略','分发策略','格式交付矩阵'],
      gateName:'格式 / 音频 / 分发门禁'},
    visualFormats:visuals.map(x=>({id:x.id,strategyKey:x.strategy_key,breakdownPlanId:x.breakdown_plan_id,
      masterFormat:parseJson(x.master_format_json),safeZones:parseJson(x.safe_zones_json),
      cropRecomposePolicy:parseJson(x.crop_recompose_policy_json),subtitleSafeArea:parseJson(x.subtitle_safe_area_json),
      firstLastFrame:parseJson(x.first_last_frame_json),distributionProfiles:parseJson(x.distribution_profiles_json),
      derivationPolicy:parseJson(x.derivation_policy_json),status:x.status})),
    audioStrategies:audios.map(x=>({id:x.id,strategyKey:x.strategy_key,voiceMaster:parseJson(x.voice_master_json),
      dialogue:parseJson(x.dialogue_json),music:parseJson(x.music_json),ost:parseJson(x.ost_json),
      sfx:parseJson(x.sfx_json),ambience:parseJson(x.ambience_json),trackSeparation:parseJson(x.track_separation_json),
      loudnessExport:parseJson(x.loudness_export_json),rights:parseJson(x.rights_json),status:x.status})),
    distributionStrategies:distributions.map(x=>({id:x.id,strategyKey:x.strategy_key,
      visualFormatStrategyId:x.visual_format_strategy_id,audioStrategyId:x.audio_strategy_id,
      targets:parseJson(x.targets_json),localizationMatrix:parseJson(x.localization_matrix_json),
      releasePackaging:parseJson(x.release_packaging_json),rightsBoundary:parseJson(x.rights_boundary_json),
      aiDisclosurePolicy:parseJson(x.ai_disclosure_policy_json),status:x.status})),
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
