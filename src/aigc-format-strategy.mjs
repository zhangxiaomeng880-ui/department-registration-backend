import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcBreakdownGate } from './aigc-breakdown.mjs';

const GATE='G-AIGC-FORMAT';
const FORMAT_POLICIES=new Set(['SAFE_CROP','RECOMPOSE_REQUIRED','MASTER_ONLY']);
const LOCALIZATION_LEVELS=new Set(['NONE','SUBTITLE','DUB','REEDIT']);

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
const sameSet=(a,b)=>{
  const aa=[...new Set(a||[])].sort(),bb=[...new Set(b||[])].sort();
  return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);
};

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',[projectId]
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

const validateAudioStrategy=audio=>{
  requireObjectFields(audio,[
    'voiceMaster','dialogue','music','ost','sfx','ambience','trackSeparation',
    'loudnessExport','rights'
  ],'AIGC_AUDIO_STRATEGY_INCOMPLETE');
  if(audio.trackSeparation.separateDialogue!==true||
     audio.trackSeparation.separateMusic!==true||
     audio.trackSeparation.separateAmbience!==true)
    throw errorOf('Dialogue, music and ambience must be separable',
      'AIGC_AUDIO_TRACK_SEPARATION_REQUIRED',409);
  if(!nonEmpty(audio.loudnessExport.spec)||!nonEmpty(audio.loudnessExport.exportProfiles))
    throw errorOf('Audio loudness/export spec is required','AIGC_AUDIO_EXPORT_SPEC_REQUIRED',409);
  if(audio.rights.cleared!==true&&!nonEmpty(audio.rights.policy))
    throw errorOf('Audio rights boundary is required','AIGC_AUDIO_RIGHTS_REQUIRED',409);
};

const validateDistributionProfile=profile=>{
  requireFields(profile,[
    'profileKey','channel','channelType','market','language','localizationLevel',
    'distributionAspectRatio','platformSpec','adaptation','aiDisclosure','rightsBoundary','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_PROFILE');
  const level=upper(profile.localizationLevel);
  if(!LOCALIZATION_LEVELS.has(level))throw errorOf(
    'Unsupported localization level','AIGC_LOCALIZATION_LEVEL_INVALID',409,
    {profileKey:profile.profileKey,localizationLevel:level}
  );
  if(profile.adaptation.storyFactMutation===true||profile.adaptation.rewriteStoryForPlatform===true)
    throw errorOf('Distribution adaptation cannot mutate Story Fact',
      'AIGC_DISTRIBUTION_STORY_FACT_MUTATION_FORBIDDEN',409,{profileKey:profile.profileKey});
  requireObjectFields(profile.platformSpec,['status'],'AIGC_PLATFORM_SPEC_INCOMPLETE',{profileKey:profile.profileKey});
  requireObjectFields(profile.aiDisclosure,['policy'],'AIGC_AI_DISCLOSURE_REQUIRED',{profileKey:profile.profileKey});
  requireObjectFields(profile.rightsBoundary,['status'],'AIGC_DISTRIBUTION_RIGHTS_REQUIRED',{profileKey:profile.profileKey});
  return {...profile,localizationLevel:level,channelType:upper(profile.channelType)};
};

const validateShotPolicy=policy=>{
  requireFields(policy,[
    'policyKey','shotId','formatPolicy','protectedWindow','cropSafeArea',
    'subtitleSafeArea','firstLastFrame','rationale','evidence'
  ],'INVALID_AIGC_SHOT_FORMAT_POLICY');
  const formatPolicy=upper(policy.formatPolicy);
  if(!FORMAT_POLICIES.has(formatPolicy))throw errorOf(
    'Unsupported shot format policy','AIGC_SHOT_FORMAT_POLICY_INVALID',409,
    {policyKey:policy.policyKey,formatPolicy}
  );
  if(formatPolicy==='SAFE_CROP'&&!nonEmpty(policy.cropSafeArea))
    throw errorOf('SAFE_CROP requires crop safe area','AIGC_SAFE_CROP_AREA_REQUIRED',409,{policyKey:policy.policyKey});
  if(formatPolicy==='MASTER_ONLY'&&policy.protectedWindow.allowCrop===true)
    throw errorOf('MASTER_ONLY cannot allow crop','AIGC_MASTER_ONLY_CROP_CONFLICT',409,{policyKey:policy.policyKey});
  return {...policy,formatPolicy};
};

export const createAigcFormatStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','versionNo','breakdownPlanId','masterAspectRatio','masterResolution',
    'frameRate','safeZones','cropRecomposePolicy','subtitleSafeArea','firstLastFrame',
    'audioStrategy','shotPolicies','distributionProfiles','evidence'
  ],'INVALID_AIGC_FORMAT_STRATEGY');
  if(input.storyFactMutation===true)throw errorOf(
    'Format strategy cannot mutate Story Fact','AIGC_FORMAT_STORY_FACT_MUTATION_FORBIDDEN',409
  );
  if(input.cropRecomposePolicy.forceMasterToDistribution===true)
    throw errorOf('Master format cannot be forced to distribution format',
      'AIGC_MASTER_DISTRIBUTION_COUPLING_FORBIDDEN',409);
  requireObjectFields(input.masterResolution,['width','height'],'AIGC_MASTER_RESOLUTION_INCOMPLETE');
  requireObjectFields(input.frameRate,['fps'],'AIGC_FRAME_RATE_INCOMPLETE');
  requireObjectFields(input.safeZones,['action','text'],'AIGC_SAFE_ZONES_INCOMPLETE');
  requireObjectFields(input.subtitleSafeArea,['policy'],'AIGC_SUBTITLE_SAFE_AREA_INCOMPLETE');
  requireObjectFields(input.firstLastFrame,['firstFrame','lastFrame'],'AIGC_FIRST_LAST_FRAME_INCOMPLETE');
  validateAudioStrategy(input.audioStrategy);
  if(!Array.isArray(input.shotPolicies)||!input.shotPolicies.length)
    throw errorOf('Shot format policies are required','AIGC_SHOT_FORMAT_POLICY_REQUIRED',409);
  if(!Array.isArray(input.distributionProfiles)||!input.distributionProfiles.length)
    throw errorOf('Distribution profiles are required','AIGC_DISTRIBUTION_PROFILE_REQUIRED',409);

  const db=getRuntimePool(),breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current Breakdown is required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  if(breakdown.id!==input.breakdownPlanId)throw errorOf(
    'Format Strategy must bind current Breakdown','AIGC_FORMAT_BREAKDOWN_STALE',409,
    {currentBreakdownPlanId:breakdown.id,providedBreakdownPlanId:input.breakdownPlanId}
  );
  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{persist:false},actorId);
  if(breakdownGate.status!=='PASS')throw errorOf(
    'G-AIGC-BREAKDOWN must PASS before Format Strategy','G_AIGC_BREAKDOWN_REQUIRED',409,
    {reasonCodes:breakdownGate.reasonCodes}
  );

  const shots=await listRows(db,'SELECT id,shot_key FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY id',[breakdown.id]);
  const shotIds=shots.map(x=>x.id);
  const normalizedPolicies=input.shotPolicies.map(validateShotPolicy);
  if(!sameSet(normalizedPolicies.map(x=>x.shotId),shotIds))throw errorOf(
    'Every current Breakdown shot must have exactly one format policy',
    'AIGC_SHOT_FORMAT_COVERAGE_INCOMPLETE',409,
    {expectedShotCount:shotIds.length,actualPolicyCount:new Set(normalizedPolicies.map(x=>x.shotId)).size}
  );
  const duplicates=normalizedPolicies.length!==new Set(normalizedPolicies.map(x=>x.shotId)).size;
  if(duplicates)throw errorOf('Duplicate shot format policy','AIGC_SHOT_FORMAT_POLICY_DUPLICATE',409);
  const normalizedProfiles=input.distributionProfiles.map(validateDistributionProfile);
  if(normalizedProfiles.length!==new Set(normalizedProfiles.map(x=>x.profileKey)).size)
    throw errorOf('Duplicate distribution profile key','AIGC_DISTRIBUTION_PROFILE_DUPLICATE',409);

  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Format strategy versionNo must be positive integer','AIGC_FORMAT_VERSION_INVALID',409
  );

  const conn=await db.getConnection(),strategyId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_format_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",[projectId]
    );
    await conn.execute(
      `INSERT INTO aigc_format_strategies
        (id,project_id,breakdown_plan_id,strategy_key,version_no,master_aspect_ratio,
         master_resolution_json,frame_rate_json,safe_zones_json,crop_recompose_policy_json,
         subtitle_safe_area_json,first_last_frame_json,audio_strategy_json,master_locked,
         story_fact_mutation,status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,FALSE,'FROZEN',?,?)`,
      [strategyId,projectId,breakdown.id,input.strategyKey,versionNo,input.masterAspectRatio,
       asJson(input.masterResolution),asJson(input.frameRate),asJson(input.safeZones),
       asJson(input.cropRecomposePolicy),asJson(input.subtitleSafeArea),asJson(input.firstLastFrame),
       asJson(input.audioStrategy),input.masterLocked===true?1:0,asJson(input.evidence),actorId]
    );
    for(const policy of normalizedPolicies){
      const id=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_shot_format_policies
          (id,project_id,format_strategy_id,shot_id,policy_key,format_policy,protected_window_json,
           crop_safe_area_json,subtitle_safe_area_json,first_last_frame_json,rationale,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,strategyId,policy.shotId,policy.policyKey,policy.formatPolicy,
         asJson(policy.protectedWindow),asJson(policy.cropSafeArea),asJson(policy.subtitleSafeArea),
         asJson(policy.firstLastFrame),policy.rationale,asJson(policy.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'SHOT',sourceId:policy.shotId,
        targetType:'SHOT_FORMAT_POLICY',targetId:id,linkType:'FORMATTED_BY',actorId,
        evidence:{formatPolicy:policy.formatPolicy}});
    }
    for(const profile of normalizedProfiles){
      const id=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_distribution_profiles
          (id,project_id,format_strategy_id,profile_key,channel,channel_type,market,language,
           localization_level,distribution_aspect_ratio,platform_spec_json,adaptation_json,
           ai_disclosure_json,rights_boundary_json,status,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CANDIDATE',?)`,
        [id,projectId,strategyId,profile.profileKey,profile.channel,profile.channelType,profile.market,
         profile.language,profile.localizationLevel,profile.distributionAspectRatio,
         asJson(profile.platformSpec),asJson(profile.adaptation),asJson(profile.aiDisclosure),
         asJson(profile.rightsBoundary),asJson(profile.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'FORMAT_STRATEGY',sourceId:strategyId,
        targetType:'DISTRIBUTION_PROFILE',targetId:id,linkType:'DISTRIBUTES_AS',actorId,
        evidence:{channel:profile.channel,market:profile.market,language:profile.language}});
    }
    await insertTrace(conn,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:breakdown.id,
      targetType:'FORMAT_STRATEGY',targetId:strategyId,linkType:'FORMATS_AS',actorId,
      evidence:{masterAspectRatio:input.masterAspectRatio,masterLocked:input.masterLocked===true}});
    await conn.commit();
    return {
      id:strategyId,projectId,breakdownPlanId:breakdown.id,strategyKey:input.strategyKey,
      versionNo,status:'FROZEN',masterAspectRatio:input.masterAspectRatio,
      masterLocked:input.masterLocked===true,shotPolicyCount:normalizedPolicies.length,
      distributionProfileCount:normalizedProfiles.length
    };
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

  const [rows]=await db.execute(
    "SELECT * FROM aigc_format_strategies WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  const strategy=rows[0]||null;
  evidence.formatStrategyId=strategy?.id||null;
  if(!strategy)reasons.push('AIGC_FORMAT_STRATEGY_REQUIRED');
  else if(!breakdown||strategy.breakdown_plan_id!==breakdown.id)reasons.push('AIGC_FORMAT_BREAKDOWN_STALE');
  else{
    const [shots,policies,profiles]=await Promise.all([
      listRows(db,'SELECT id FROM aigc_shots WHERE breakdown_plan_id=?',[breakdown.id]),
      listRows(db,'SELECT * FROM aigc_shot_format_policies WHERE format_strategy_id=?',[strategy.id]),
      listRows(db,'SELECT * FROM aigc_distribution_profiles WHERE format_strategy_id=?',[strategy.id])
    ]);
    const audio=parseJson(strategy.audio_strategy_json)||{};
    if(Boolean(strategy.story_fact_mutation))reasons.push('AIGC_FORMAT_STORY_FACT_MUTATION_FORBIDDEN');
    if(!sameSet(policies.map(x=>x.shot_id),shots.map(x=>x.id)))
      reasons.push('AIGC_SHOT_FORMAT_COVERAGE_INCOMPLETE');
    if(!profiles.length)reasons.push('AIGC_DISTRIBUTION_PROFILE_REQUIRED');
    if(!audio.trackSeparation||audio.trackSeparation.separateDialogue!==true||
       audio.trackSeparation.separateMusic!==true||audio.trackSeparation.separateAmbience!==true)
      reasons.push('AIGC_AUDIO_TRACK_SEPARATION_REQUIRED');
    if(!nonEmpty(audio.loudnessExport?.spec)||!nonEmpty(audio.loudnessExport?.exportProfiles))
      reasons.push('AIGC_AUDIO_EXPORT_SPEC_REQUIRED');
    if(!nonEmpty(audio.rights))reasons.push('AIGC_AUDIO_RIGHTS_REQUIRED');
    for(const p of profiles){
      const adaptation=parseJson(p.adaptation_json)||{};
      if(adaptation.storyFactMutation===true||adaptation.rewriteStoryForPlatform===true)
        reasons.push('AIGC_DISTRIBUTION_STORY_FACT_MUTATION_FORBIDDEN');
      if(!nonEmpty(parseJson(p.platform_spec_json)))reasons.push('AIGC_PLATFORM_SPEC_INCOMPLETE');
      if(!nonEmpty(parseJson(p.ai_disclosure_json)))reasons.push('AIGC_AI_DISCLOSURE_REQUIRED');
      if(!nonEmpty(parseJson(p.rights_boundary_json)))reasons.push('AIGC_DISTRIBUTION_RIGHTS_REQUIRED');
    }
    evidence.masterAspectRatio=strategy.master_aspect_ratio;
    evidence.masterLocked=Boolean(strategy.master_locked);
    evidence.shotPolicyCount=policies.length;
    evidence.distributionProfileCount=profiles.length;
    evidence.distributionProfiles=profiles.map(p=>({
      profileKey:p.profile_key,channel:p.channel,channelType:p.channel_type,market:p.market,
      language:p.language,localizationLevel:p.localization_level,
      distributionAspectRatio:p.distribution_aspect_ratio,status:p.status
    }));
    evidence.formatPolicies={
      safeCrop:policies.filter(x=>x.format_policy==='SAFE_CROP').length,
      recomposeRequired:policies.filter(x=>x.format_policy==='RECOMPOSE_REQUIRED').length,
      masterOnly:policies.filter(x=>x.format_policy==='MASTER_ONLY').length
    };
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m286_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcFormatState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [strategies,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_format_strategies WHERE project_id=? ORDER BY version_no,created_at',[projectId]),
    listRows(db,'SELECT * FROM aigc_m286_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  const current=strategies.filter(x=>x.status==='FROZEN').at(-1)||null;
  let policies=[],profiles=[];
  if(current)[policies,profiles]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_shot_format_policies WHERE format_strategy_id=? ORDER BY shot_id,id',[current.id]),
    listRows(db,'SELECT * FROM aigc_distribution_profiles WHERE format_strategy_id=? ORDER BY profile_key,id',[current.id])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['视觉格式策略','音频策略','分发策略','镜头多画幅策略'],
      gateName:'格式 / 音频 / 分发策略门禁',
      formatPolicyLabels:{SAFE_CROP:'可安全裁切',RECOMPOSE_REQUIRED:'需要重新构图',MASTER_ONLY:'仅保留母版'}
    },
    strategies:strategies.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,strategyKey:x.strategy_key,versionNo:Number(x.version_no),
      masterAspectRatio:x.master_aspect_ratio,masterResolution:parseJson(x.master_resolution_json),
      frameRate:parseJson(x.frame_rate_json),safeZones:parseJson(x.safe_zones_json),
      cropRecomposePolicy:parseJson(x.crop_recompose_policy_json),subtitleSafeArea:parseJson(x.subtitle_safe_area_json),
      firstLastFrame:parseJson(x.first_last_frame_json),audioStrategy:parseJson(x.audio_strategy_json),
      masterLocked:Boolean(x.master_locked),storyFactMutation:Boolean(x.story_fact_mutation),status:x.status
    })),
    current:current?{
      strategyId:current.id,
      shotPolicies:policies.map(x=>({
        id:x.id,shotId:x.shot_id,policyKey:x.policy_key,formatPolicy:x.format_policy,
        protectedWindow:parseJson(x.protected_window_json),cropSafeArea:parseJson(x.crop_safe_area_json),
        subtitleSafeArea:parseJson(x.subtitle_safe_area_json),firstLastFrame:parseJson(x.first_last_frame_json),
        rationale:x.rationale
      })),
      distributionProfiles:profiles.map(x=>({
        id:x.id,profileKey:x.profile_key,channel:x.channel,channelType:x.channel_type,
        market:x.market,language:x.language,localizationLevel:x.localization_level,
        distributionAspectRatio:x.distribution_aspect_ratio,platformSpec:parseJson(x.platform_spec_json),
        adaptation:parseJson(x.adaptation_json),aiDisclosure:parseJson(x.ai_disclosure_json),
        rightsBoundary:parseJson(x.rights_boundary_json),status:x.status
      }))
    }:null,
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
