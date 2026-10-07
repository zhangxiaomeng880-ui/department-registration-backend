import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcBreakdownGate } from './aigc-breakdown.mjs';

const GATE='G-AIGC-FORMAT';
const LOCALIZATION_LEVELS=new Set(['NONE','SUBTITLE','COPY_LOCALIZATION','DUB','RE_EDIT','RE_COMPOSE','MULTI']);
const TARGET_STATUSES=new Set(['CANDIDATE','APPROVED']);

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
  const missing=fields.filter(k=>!nonEmpty(input?.[k]));
  if(missing.length)throw errorOf('Required fields are missing',code,400,{missing});
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Format Strategy requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
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

const validateVisualFormat=visual=>{
  requireFields(visual,[
    'masterAspectRatio','resolution','frameRate','safeZones','cropRecomposePolicy',
    'subtitleSafeArea','firstLastFrameRequirement'
  ],'INVALID_AIGC_VISUAL_FORMAT');
  if(!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(String(visual.masterAspectRatio)))
    throw errorOf('masterAspectRatio must be W:H','AIGC_MASTER_ASPECT_INVALID',409);
  const width=Number(visual.resolution?.width),height=Number(visual.resolution?.height);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)
    throw errorOf('resolution width/height must be positive integers','AIGC_MASTER_RESOLUTION_INVALID',409);
  const frameRate=Number(visual.frameRate);
  if(!Number.isFinite(frameRate)||frameRate<=0)
    throw errorOf('frameRate must be positive','AIGC_FRAME_RATE_INVALID',409);
  return {
    ...visual,
    masterAspectRatio:String(visual.masterAspectRatio),
    resolution:{...visual.resolution,width,height},
    frameRate
  };
};
const validateAudioStrategy=audio=>{
  requireFields(audio,[
    'voiceMaster','dialogue','musicOst','sfxAmbience','trackSeparation',
    'loudnessExportSpec','rights'
  ],'INVALID_AIGC_AUDIO_STRATEGY');
  return audio;
};
const validateTarget=(target,index)=>{
  requireFields(target,[
    'targetKey','channel','marketRegion','language','localizationLevel',
    'platformSpec','aiDisclosure','rightsBoundary','evidence'
  ],'INVALID_AIGC_DISTRIBUTION_TARGET');
  const localizationLevel=upper(target.localizationLevel);
  if(!LOCALIZATION_LEVELS.has(localizationLevel))throw errorOf(
    'Unsupported localization level','AIGC_LOCALIZATION_LEVEL_INVALID',409,
    {targetKey:target.targetKey,localizationLevel}
  );
  const status=upper(target.status||'CANDIDATE');
  if(!TARGET_STATUSES.has(status))throw errorOf(
    'Unsupported distribution target status','AIGC_DISTRIBUTION_TARGET_STATUS_INVALID',409,
    {targetKey:target.targetKey,status}
  );
  if(!nonEmpty(target.platformSpec.aspect)&&!nonEmpty(target.platformSpec.resolution)&&!nonEmpty(target.platformSpec.delivery))
    throw errorOf(
      'platformSpec must declare aspect, resolution or delivery contract',
      'AIGC_PLATFORM_SPEC_REQUIRED',409,{targetKey:target.targetKey,index}
    );
  return {...target,localizationLevel,status};
};

export const resolveAigcFormatProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

export const createAigcFormatStrategy=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'strategyKey','versionNo','breakdownPlanId','visualFormat','audioStrategy',
    'distributionSummary','distributionTargets','evidence'
  ],'INVALID_AIGC_FORMAT_STRATEGY');
  if(!Array.isArray(input.distributionTargets)||!input.distributionTargets.length)
    throw errorOf('At least one distribution target is required','AIGC_DISTRIBUTION_TARGET_REQUIRED',409);

  const db=getRuntimePool();
  const breakdown=await currentBreakdown(projectId,db);
  if(!breakdown)throw errorOf('Current frozen Breakdown is required','AIGC_BREAKDOWN_PLAN_REQUIRED',409);
  if(input.breakdownPlanId!==breakdown.id)throw errorOf(
    'Format Strategy must bind current frozen Breakdown','AIGC_FORMAT_BREAKDOWN_STALE',409,
    {currentBreakdownPlanId:breakdown.id,providedBreakdownPlanId:input.breakdownPlanId}
  );
  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{persist:false},actorId);
  if(breakdownGate.status!=='PASS')throw errorOf(
    'G-AIGC-BREAKDOWN must PASS before Format Strategy','G_AIGC_BREAKDOWN_REQUIRED',409,
    {reasonCodes:breakdownGate.reasonCodes}
  );

  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)
    throw errorOf('versionNo must be a positive integer','AIGC_FORMAT_VERSION_INVALID',409);
  const visualFormat=validateVisualFormat(input.visualFormat);
  const audioStrategy=validateAudioStrategy(input.audioStrategy);
  if(!nonEmpty(input.distributionSummary))throw errorOf(
    'distributionSummary is required','AIGC_DISTRIBUTION_SUMMARY_REQUIRED',409
  );

  const targetKeys=new Set();
  const targets=input.distributionTargets.map((target,index)=>{
    const normalized=validateTarget(target,index);
    if(targetKeys.has(normalized.targetKey))throw errorOf(
      'Duplicate distribution target key','AIGC_DISTRIBUTION_TARGET_DUPLICATE',409,
      {targetKey:normalized.targetKey}
    );
    targetKeys.add(normalized.targetKey);
    return normalized;
  });

  const strategyId=randomUUID(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_format_strategies SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",
      [projectId]
    );
    await conn.execute(
      `INSERT INTO aigc_format_strategies
        (id,project_id,breakdown_plan_id,strategy_key,version_no,visual_format_json,audio_strategy_json,
         distribution_summary_json,status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [
        strategyId,projectId,breakdown.id,input.strategyKey,versionNo,asJson(visualFormat),
        asJson(audioStrategy),asJson(input.distributionSummary),asJson(input.evidence),actorId
      ]
    );
    await insertTrace(conn,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:breakdown.id,
      targetType:'FORMAT_STRATEGY',targetId:strategyId,linkType:'FORMATS_AS',actorId,
      evidence:{strategyKey:input.strategyKey,versionNo}});
    for(const target of targets){
      const id=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_distribution_targets
          (id,project_id,format_strategy_id,target_key,channel,market_region,language,
           localization_level,platform_spec_json,ai_disclosure_json,rights_boundary_json,
           status,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,projectId,strategyId,target.targetKey,target.channel,target.marketRegion,target.language,
          target.localizationLevel,asJson(target.platformSpec),asJson(target.aiDisclosure),
          asJson(target.rightsBoundary),target.status,asJson(target.evidence)
        ]
      );
      await insertTrace(conn,{projectId,sourceType:'FORMAT_STRATEGY',sourceId:strategyId,
        targetType:'DISTRIBUTION_TARGET',targetId:id,linkType:'TARGETS',actorId,
        evidence:{targetKey:target.targetKey,channel:target.channel,marketRegion:target.marketRegion}});
    }
    await conn.commit();
    return {
      id:strategyId,projectId,breakdownPlanId:breakdown.id,strategyKey:input.strategyKey,
      versionNo,status:'FROZEN',distributionTargetCount:targets.length
    };
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

const validateStoredVisual=(visual,reasons)=>{
  for(const field of [
    'masterAspectRatio','resolution','frameRate','safeZones','cropRecomposePolicy',
    'subtitleSafeArea','firstLastFrameRequirement'
  ]) if(!nonEmpty(visual?.[field]))reasons.push('AIGC_VISUAL_FORMAT_REQUIRED:'+field);
};
const validateStoredAudio=(audio,reasons)=>{
  for(const field of [
    'voiceMaster','dialogue','musicOst','sfxAmbience','trackSeparation',
    'loudnessExportSpec','rights'
  ]) if(!nonEmpty(audio?.[field]))reasons.push('AIGC_AUDIO_STRATEGY_REQUIRED:'+field);
};

export const evaluateAigcFormatGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const breakdownGate=await evaluateAigcBreakdownGate(projectId,{asOf,persist:false},actorId);
  if(breakdownGate.status!=='PASS')reasons.push('G_AIGC_BREAKDOWN_NOT_PASS');
  const breakdown=await currentBreakdown(projectId,db);
  evidence.currentBreakdownPlanId=breakdown?.id||null;

  const [strategies]=await db.execute(
    "SELECT * FROM aigc_format_strategies WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  const strategy=strategies[0]||null;
  evidence.formatStrategyId=strategy?.id||null;
  if(!strategy)reasons.push('AIGC_FORMAT_STRATEGY_REQUIRED');
  else if(!breakdown||strategy.breakdown_plan_id!==breakdown.id)reasons.push('AIGC_FORMAT_BREAKDOWN_STALE');
  else{
    const visual=parseJson(strategy.visual_format_json)||{};
    const audio=parseJson(strategy.audio_strategy_json)||{};
    validateStoredVisual(visual,reasons);
    validateStoredAudio(audio,reasons);
    if(!nonEmpty(parseJson(strategy.distribution_summary_json)))
      reasons.push('AIGC_DISTRIBUTION_SUMMARY_REQUIRED');

    const targets=await listRows(db,
      'SELECT * FROM aigc_distribution_targets WHERE format_strategy_id=? ORDER BY target_key,id',[strategy.id]
    );
    evidence.distributionTargetCount=targets.length;
    if(!targets.length)reasons.push('AIGC_DISTRIBUTION_TARGET_REQUIRED');
    for(const target of targets){
      if(!LOCALIZATION_LEVELS.has(target.localization_level))
        reasons.push('AIGC_LOCALIZATION_LEVEL_INVALID:'+target.target_key);
      if(!nonEmpty(parseJson(target.platform_spec_json)))
        reasons.push('AIGC_PLATFORM_SPEC_REQUIRED:'+target.target_key);
      if(!nonEmpty(parseJson(target.ai_disclosure_json)))
        reasons.push('AIGC_AI_DISCLOSURE_REQUIRED:'+target.target_key);
      if(!nonEmpty(parseJson(target.rights_boundary_json)))
        reasons.push('AIGC_RIGHTS_BOUNDARY_REQUIRED:'+target.target_key);
    }

    const shots=await listRows(db,'SELECT id,multi_format_json FROM aigc_shots WHERE breakdown_plan_id=?',[breakdown.id]);
    evidence.shotCount=shots.length;
    evidence.multiFormatShotCount=shots.filter(x=>nonEmpty(parseJson(x.multi_format_json))).length;
    if(evidence.multiFormatShotCount!==evidence.shotCount)
      reasons.push('AIGC_SHOT_MULTI_FORMAT_COVERAGE_INCOMPLETE');

    evidence.masterAspectRatio=visual.masterAspectRatio||null;
    evidence.masterResolution=visual.resolution||null;
    evidence.frameRate=visual.frameRate||null;
  }

  const result={
    projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf
  };
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
  const [strategies,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_format_strategies WHERE project_id=? ORDER BY version_no,created_at',[projectId]),
    listRows(db,'SELECT * FROM aigc_m287_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  const current=strategies.filter(x=>x.status==='FROZEN').at(-1)||null;
  const targets=current
    ?await listRows(db,'SELECT * FROM aigc_distribution_targets WHERE format_strategy_id=? ORDER BY target_key,id',[current.id])
    :[];
  return {
    project:{
      id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key
    },
    frontend:{
      language:'zh-CN',
      moduleNames:['视觉格式','音频策略','分发策略'],
      gateName:'格式与分发策略门禁',
      localizationLabels:{
        NONE:'不本地化',SUBTITLE:'字幕本地化',COPY_LOCALIZATION:'文案本地化',
        DUB:'配音本地化',RE_EDIT:'重新剪辑',RE_COMPOSE:'重新构图',MULTI:'组合本地化'
      }
    },
    strategies:strategies.map(x=>({
      id:x.id,breakdownPlanId:x.breakdown_plan_id,strategyKey:x.strategy_key,
      versionNo:Number(x.version_no),visualFormat:parseJson(x.visual_format_json),
      audioStrategy:parseJson(x.audio_strategy_json),
      distributionSummary:parseJson(x.distribution_summary_json),status:x.status
    })),
    current:current?{
      id:current.id,breakdownPlanId:current.breakdown_plan_id,strategyKey:current.strategy_key,
      versionNo:Number(current.version_no),visualFormat:parseJson(current.visual_format_json),
      audioStrategy:parseJson(current.audio_strategy_json),
      distributionSummary:parseJson(current.distribution_summary_json),
      distributionTargets:targets.map(x=>({
        id:x.id,targetKey:x.target_key,channel:x.channel,marketRegion:x.market_region,
        language:x.language,localizationLevel:x.localization_level,
        platformSpec:parseJson(x.platform_spec_json),aiDisclosure:parseJson(x.ai_disclosure_json),
        rightsBoundary:parseJson(x.rights_boundary_json),status:x.status
      }))
    }:null,
    gateEvaluations:gates.map(x=>({
      id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),
      evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
