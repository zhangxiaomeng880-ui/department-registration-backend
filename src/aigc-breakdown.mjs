import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { evaluateAigcScriptGate } from './aigc-story-script.mjs';

const GATE='G-AIGC-BREAKDOWN';
const ASSET_READINESS=new Set(['READY','MISSING','PENDING','N_A']);
const CRITICALITY=new Set(['REQUIRED','OPTIONAL']);
const PRIORITIES=new Set(['P0','P1','P2','P3','HIGH','MEDIUM','LOW']);

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
const exactIntRange=(start,end)=>Array.from({length:end-start+1},(_,i)=>start+i);
const sameNumbers=(a,b)=>{
  const aa=[...new Set(a.map(Number))].sort((x,y)=>x-y);
  const bb=[...new Set(b.map(Number))].sort((x,y)=>x-y);
  return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);
};
const listRows=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute(
    'SELECT id,workspace_id,project_key,name,project_type,project_subtype_key FROM projects WHERE id=?',
    [projectId]
  );
  if(!rows.length)throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  if(rows[0].project_type!=='AIGC_CONTENT')throw errorOf(
    'AIGC Breakdown requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentLockedScript=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_script_versions WHERE project_id=? AND is_current=TRUE AND status='LOCKED' ORDER BY version_no DESC LIMIT 1",
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

export const resolveAigcBreakdownProjectScope=async projectId=>{
  const p=await loadProject(projectId);
  return {projectId,workspaceId:p.workspace_id};
};

const normalizeAssetRequirement=(req,shotKey)=>{
  requireFields(req,['requirementKey','requirementType','criticality','readinessStatus','requirement','revalidation','evidence'],
    'INVALID_AIGC_ASSET_REQUIREMENT');
  const criticality=upper(req.criticality),readinessStatus=upper(req.readinessStatus);
  if(!CRITICALITY.has(criticality))throw errorOf('Unsupported asset requirement criticality',
    'AIGC_ASSET_REQUIREMENT_CRITICALITY_INVALID',409,{shotKey,requirementKey:req.requirementKey,criticality});
  if(!ASSET_READINESS.has(readinessStatus))throw errorOf('Unsupported asset readiness',
    'AIGC_ASSET_READINESS_INVALID',409,{shotKey,requirementKey:req.requirementKey,readinessStatus});
  if(criticality==='REQUIRED'&&readinessStatus==='N_A')throw errorOf(
    'Required asset cannot be N_A','AIGC_REQUIRED_ASSET_NA_FORBIDDEN',409,{shotKey,requirementKey:req.requirementKey}
  );
  if(readinessStatus==='READY'&&!nonEmpty(req.sourceRef))throw errorOf(
    'READY asset requirement needs a source reference','AIGC_READY_ASSET_SOURCE_REQUIRED',409,
    {shotKey,requirementKey:req.requirementKey}
  );
  if(['MISSING','PENDING'].includes(readinessStatus)&&(!nonEmpty(req.missingReason)||!nonEmpty(req.revalidation)))
    throw errorOf('Missing/Pending asset requires reason and revalidation',
      'AIGC_BLOCKED_ASSET_DETAIL_REQUIRED',409,{shotKey,requirementKey:req.requirementKey});
  return {...req,criticality,readinessStatus,requirementType:upper(req.requirementType)};
};

const validateShot=(shot)=>{
  requireFields(shot,[
    'shotKey','sceneKey','sequenceNo','shotPurpose','charactersLooks','scenePropUi',
    'actionExpressionPerformance','dialogueVoiceOstSfx','camera','timing','referenceRequirements',
    'generationStrategy','multiFormat','continuityDependency','priorityCostRetry','qaCriteria',
    'assetRequirements','evidence'
  ],'INVALID_AIGC_SHOT');
  if(!Number.isInteger(Number(shot.sequenceNo))||Number(shot.sequenceNo)<1)
    throw errorOf('Shot sequenceNo must be positive integer','AIGC_SHOT_SEQUENCE_INVALID',409,{shotKey:shot.shotKey});
  for(const field of [
    'shotPurpose','charactersLooks','scenePropUi','actionExpressionPerformance','dialogueVoiceOstSfx',
    'camera','timing','referenceRequirements','generationStrategy','multiFormat',
    'continuityDependency','priorityCostRetry','qaCriteria'
  ]) if(!nonEmpty(shot[field]))throw errorOf(
    'Shot planning dimension cannot be empty','AIGC_SHOT_DIMENSION_REQUIRED',409,{shotKey:shot.shotKey,field}
  );
  if(!Array.isArray(shot.assetRequirements)||!shot.assetRequirements.length)
    throw errorOf('Shot requires explicit asset requirements','AIGC_SHOT_ASSET_REQUIREMENT_REQUIRED',409,{shotKey:shot.shotKey});
  if(shot.priorityCostRetry.priority&&!PRIORITIES.has(upper(shot.priorityCostRetry.priority)))
    throw errorOf('Unsupported shot priority','AIGC_SHOT_PRIORITY_INVALID',409,{shotKey:shot.shotKey});
  const requirements=shot.assetRequirements.map(req=>normalizeAssetRequirement(req,shot.shotKey));
  const blocked=requirements.filter(r=>r.criticality==='REQUIRED'&&['MISSING','PENDING'].includes(r.readinessStatus));
  return {
    ...shot,
    assetRequirements:requirements,
    readinessStatus:blocked.length?'BLOCKED':'READY',
    blockingReasons:blocked.map(r=>({
      requirementKey:r.requirementKey,
      requirementType:r.requirementType,
      readinessStatus:r.readinessStatus,
      reason:r.missingReason
    }))
  };
};

export const createAigcBreakdownPlan=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,['planKey','versionNo','scriptVersionId','units','scenes','shots','evidence'],
    'INVALID_AIGC_BREAKDOWN_PLAN');
  if(!Array.isArray(input.units)||!input.units.length||
     !Array.isArray(input.scenes)||!input.scenes.length||
     !Array.isArray(input.shots)||!input.shots.length)
    throw errorOf('Breakdown requires non-empty units, scenes and shots','AIGC_BREAKDOWN_CONTENT_REQUIRED',409);

  const db=getRuntimePool(),script=await currentLockedScript(projectId,db);
  if(!script)throw errorOf('Current locked script is required','AIGC_CURRENT_LOCKED_SCRIPT_REQUIRED',409);
  if(input.scriptVersionId!==script.id)throw errorOf(
    'Breakdown must bind current locked script','AIGC_BREAKDOWN_SCRIPT_STALE',409,
    {currentScriptVersionId:script.id,providedScriptVersionId:input.scriptVersionId}
  );
  const scriptGate=await evaluateAigcScriptGate(projectId,{persist:false},actorId);
  if(scriptGate.status!=='PASS')throw errorOf('G-AIGC-SCRIPT must PASS before Breakdown',
    'G_AIGC_SCRIPT_REQUIRED',409,{reasonCodes:scriptGate.reasonCodes});

  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Breakdown versionNo must be positive integer','AIGC_BREAKDOWN_VERSION_INVALID',409
  );

  const unitKeys=new Set(),unitSceneRanges=[];
  for(const unit of input.units){
    requireFields(unit,['unitKey','title','sequenceNo','sceneStart','sceneEnd','purpose','continuity','evidence'],
      'INVALID_AIGC_UNIT');
    if(unitKeys.has(unit.unitKey))throw errorOf('Duplicate unitKey','AIGC_UNIT_DUPLICATE',409,{unitKey:unit.unitKey});
    unitKeys.add(unit.unitKey);
    const start=Number(unit.sceneStart),end=Number(unit.sceneEnd);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<Number(script.scene_start)||end>Number(script.scene_end)||end<start)
      throw errorOf('Unit scene range invalid','AIGC_UNIT_SCENE_RANGE_INVALID',409,{unitKey:unit.unitKey});
    unitSceneRanges.push({unitKey:unit.unitKey,start,end});
  }

  const sceneKeys=new Set(),sceneNos=[];
  for(const scene of input.scenes){
    requireFields(scene,['sceneKey','sceneNo','unitKey','title','scriptScope','locationTime','purpose','continuity','evidence'],
      'INVALID_AIGC_SCENE');
    if(sceneKeys.has(scene.sceneKey))throw errorOf('Duplicate sceneKey','AIGC_SCENE_DUPLICATE',409,{sceneKey:scene.sceneKey});
    if(!unitKeys.has(scene.unitKey))throw errorOf('Scene references unknown unit','AIGC_SCENE_UNIT_INVALID',409,{sceneKey:scene.sceneKey});
    const sceneNo=Number(scene.sceneNo);
    if(!Number.isInteger(sceneNo))throw errorOf('sceneNo must be integer','AIGC_SCENE_NO_INVALID',409,{sceneKey:scene.sceneKey});
    const range=unitSceneRanges.find(x=>x.unitKey===scene.unitKey);
    if(sceneNo<range.start||sceneNo>range.end)throw errorOf('Scene lies outside unit range','AIGC_SCENE_OUTSIDE_UNIT_RANGE',409,{sceneKey:scene.sceneKey});
    sceneKeys.add(scene.sceneKey);sceneNos.push(sceneNo);
  }
  const expectedSceneNos=exactIntRange(Number(script.scene_start),Number(script.scene_end));
  if(!sameNumbers(sceneNos,expectedSceneNos))throw errorOf(
    'Breakdown scenes must exactly cover locked script scene range','AIGC_BREAKDOWN_SCENE_COVERAGE_INCOMPLETE',409,
    {expectedStart:Number(script.scene_start),expectedEnd:Number(script.scene_end),expectedCount:Number(script.scene_count),
     actualSceneNos:[...new Set(sceneNos)].sort((a,b)=>a-b)}
  );

  const normalizedShots=input.shots.map(validateShot);
  const shotKeys=new Set(),shotsByScene=new Map();
  for(const shot of normalizedShots){
    if(shotKeys.has(shot.shotKey))throw errorOf('Duplicate shotKey','AIGC_SHOT_DUPLICATE',409,{shotKey:shot.shotKey});
    if(!sceneKeys.has(shot.sceneKey))throw errorOf('Shot references unknown scene','AIGC_SHOT_SCENE_INVALID',409,{shotKey:shot.shotKey});
    shotKeys.add(shot.shotKey);
    const arr=shotsByScene.get(shot.sceneKey)||[];arr.push(shot);shotsByScene.set(shot.sceneKey,arr);
  }
  const scenesWithoutShots=[...sceneKeys].filter(k=>!(shotsByScene.get(k)||[]).length);
  if(scenesWithoutShots.length)throw errorOf('Every scene requires at least one shot',
    'AIGC_SCENE_SHOT_COVERAGE_INCOMPLETE',409,{sceneKeys:scenesWithoutShots});

  const reqKeys=new Set();
  for(const shot of normalizedShots)for(const req of shot.assetRequirements){
    if(reqKeys.has(req.requirementKey))throw errorOf('Duplicate asset requirement key',
      'AIGC_ASSET_REQUIREMENT_DUPLICATE',409,{requirementKey:req.requirementKey});
    reqKeys.add(req.requirementKey);
  }

  const readyShots=normalizedShots.filter(x=>x.readinessStatus==='READY').length;
  const blockedShots=normalizedShots.length-readyShots;
  const allReqs=normalizedShots.flatMap(x=>x.assetRequirements);
  const missingRequired=allReqs.filter(r=>r.criticality==='REQUIRED'&&r.readinessStatus==='MISSING').length;
  const pendingRequired=allReqs.filter(r=>r.criticality==='REQUIRED'&&r.readinessStatus==='PENDING').length;
  const coverageSnapshot={
    scriptVersionId:script.id,
    sceneRange:{start:Number(script.scene_start),end:Number(script.scene_end),count:Number(script.scene_count)},
    coveredSceneCount:input.scenes.length,
    unitCount:input.units.length,
    shotCount:normalizedShots.length,
    assetRequirementCount:allReqs.length,
    readyShotCount:readyShots,
    blockedShotCount:blockedShots,
    missingRequiredAssetCount:missingRequired,
    pendingRequiredAssetCount:pendingRequired
  };
  const readinessSummary={
    totalShots:normalizedShots.length,readyShots,blockedShots,
    totalAssetRequirements:allReqs.length,missingRequired,pendingRequired
  };

  const conn=await db.getConnection(),planId=randomUUID();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_breakdown_plans SET status='HISTORICAL' WHERE project_id=? AND status='FROZEN'",
      [projectId]
    );
    await conn.execute(
      `INSERT INTO aigc_breakdown_plans
        (id,project_id,script_version_id,plan_key,version_no,scene_start,scene_end,scene_count,
         unit_count,shot_count,asset_requirement_count,readiness_summary_json,coverage_snapshot_json,
         status,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'FROZEN',?,?)`,
      [planId,projectId,script.id,input.planKey,versionNo,Number(script.scene_start),Number(script.scene_end),
       Number(script.scene_count),input.units.length,normalizedShots.length,allReqs.length,
       asJson(readinessSummary),asJson(coverageSnapshot),asJson(input.evidence),actorId]
    );

    const unitIdByKey=new Map();
    for(const unit of input.units){
      const id=randomUUID();unitIdByKey.set(unit.unitKey,id);
      await conn.execute(
        `INSERT INTO aigc_units
          (id,project_id,breakdown_plan_id,unit_key,title,sequence_no,scene_start,scene_end,
           purpose_json,continuity_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,planId,unit.unitKey,unit.title,Number(unit.sequenceNo),Number(unit.sceneStart),
         Number(unit.sceneEnd),asJson(unit.purpose),asJson(unit.continuity),asJson(unit.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'BREAKDOWN_PLAN',sourceId:planId,
        targetType:'UNIT',targetId:id,linkType:'CONTAINS',actorId,evidence:{unitKey:unit.unitKey}});
    }

    const sceneIdByKey=new Map();
    for(const scene of input.scenes){
      const id=randomUUID();sceneIdByKey.set(scene.sceneKey,id);
      await conn.execute(
        `INSERT INTO aigc_scenes
          (id,project_id,breakdown_plan_id,unit_id,scene_key,scene_no,title,script_scope_json,
           location_time_json,purpose_json,continuity_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,projectId,planId,unitIdByKey.get(scene.unitKey),scene.sceneKey,Number(scene.sceneNo),scene.title,
         asJson(scene.scriptScope),asJson(scene.locationTime),asJson(scene.purpose),
         asJson(scene.continuity),asJson(scene.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'UNIT',sourceId:unitIdByKey.get(scene.unitKey),
        targetType:'SCENE',targetId:id,linkType:'CONTAINS',actorId,evidence:{sceneKey:scene.sceneKey}});
    }

    for(const shot of normalizedShots){
      const shotId=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_shots
          (id,project_id,breakdown_plan_id,scene_id,shot_key,sequence_no,shot_purpose_json,
           characters_looks_json,scene_prop_ui_json,action_expression_performance_json,
           dialogue_voice_ost_sfx_json,camera_json,timing_json,reference_requirements_json,
           generation_strategy_json,multi_format_json,continuity_dependency_json,
           priority_cost_retry_json,qa_criteria_json,readiness_status,blocking_reasons_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [shotId,projectId,planId,sceneIdByKey.get(shot.sceneKey),shot.shotKey,Number(shot.sequenceNo),
         asJson(shot.shotPurpose),asJson(shot.charactersLooks),asJson(shot.scenePropUi),
         asJson(shot.actionExpressionPerformance),asJson(shot.dialogueVoiceOstSfx),asJson(shot.camera),
         asJson(shot.timing),asJson(shot.referenceRequirements),asJson(shot.generationStrategy),
         asJson(shot.multiFormat),asJson(shot.continuityDependency),asJson(shot.priorityCostRetry),
         asJson(shot.qaCriteria),shot.readinessStatus,asJson(shot.blockingReasons),asJson(shot.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'SCENE',sourceId:sceneIdByKey.get(shot.sceneKey),
        targetType:'SHOT',targetId:shotId,linkType:'CONTAINS',actorId,
        evidence:{shotKey:shot.shotKey,readinessStatus:shot.readinessStatus}});
      for(const req of shot.assetRequirements){
        const reqId=randomUUID();
        await conn.execute(
          `INSERT INTO aigc_shot_asset_requirements
            (id,project_id,breakdown_plan_id,shot_id,requirement_key,requirement_type,criticality,
             readiness_status,requirement_json,source_ref_json,missing_reason,revalidation_json,evidence_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [reqId,projectId,planId,shotId,req.requirementKey,req.requirementType,req.criticality,
           req.readinessStatus,asJson(req.requirement),req.sourceRef?asJson(req.sourceRef):null,
           req.missingReason||null,asJson(req.revalidation),asJson(req.evidence)]
        );
        await insertTrace(conn,{projectId,sourceType:'SHOT',sourceId:shotId,
          targetType:'ASSET_REQUIREMENT',targetId:reqId,linkType:'REQUIRES',actorId,
          evidence:{requirementType:req.requirementType,criticality:req.criticality,readinessStatus:req.readinessStatus}});
      }
    }
    await insertTrace(conn,{projectId,sourceType:'SCRIPT_VERSION',sourceId:script.id,
      targetType:'BREAKDOWN_PLAN',targetId:planId,linkType:'BREAKS_DOWN_INTO',actorId,
      evidence:{planKey:input.planKey,coverageSnapshot}});
    await conn.commit();
    return {id:planId,projectId,scriptVersionId:script.id,planKey:input.planKey,versionNo,
      status:'FROZEN',readinessSummary,coverageSnapshot};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const evaluateAigcBreakdownGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  const db=getRuntimePool(),reasons=[],evidence={};

  const scriptGate=await evaluateAigcScriptGate(projectId,{asOf,persist:false},actorId);
  if(scriptGate.status!=='PASS')reasons.push('G_AIGC_SCRIPT_NOT_PASS');
  const script=await currentLockedScript(projectId,db);
  evidence.currentScriptVersionId=script?.id||null;

  const [plans]=await db.execute(
    "SELECT * FROM aigc_breakdown_plans WHERE project_id=? AND status='FROZEN' ORDER BY version_no DESC,created_at DESC LIMIT 1",
    [projectId]
  );
  const plan=plans[0]||null;
  evidence.breakdownPlanId=plan?.id||null;
  if(!plan)reasons.push('AIGC_BREAKDOWN_PLAN_REQUIRED');
  else if(!script||plan.script_version_id!==script.id)reasons.push('AIGC_BREAKDOWN_SCRIPT_STALE');
  else{
    const [units,scenes,shots,requirements]=await Promise.all([
      listRows(db,'SELECT * FROM aigc_units WHERE breakdown_plan_id=? ORDER BY sequence_no,id',[plan.id]),
      listRows(db,'SELECT * FROM aigc_scenes WHERE breakdown_plan_id=? ORDER BY scene_no,id',[plan.id]),
      listRows(db,'SELECT * FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY scene_id,sequence_no,id',[plan.id]),
      listRows(db,'SELECT * FROM aigc_shot_asset_requirements WHERE breakdown_plan_id=? ORDER BY shot_id,requirement_key',[plan.id])
    ]);
    const expected=exactIntRange(Number(script.scene_start),Number(script.scene_end));
    if(!sameNumbers(scenes.map(x=>x.scene_no),expected))reasons.push('AIGC_BREAKDOWN_SCENE_COVERAGE_INCOMPLETE');
    const shotSceneIds=new Set(shots.map(x=>x.scene_id));
    if(scenes.some(x=>!shotSceneIds.has(x.id)))reasons.push('AIGC_SCENE_SHOT_COVERAGE_INCOMPLETE');
    const reqShotIds=new Set(requirements.map(x=>x.shot_id));
    if(shots.some(x=>!reqShotIds.has(x.id)))reasons.push('AIGC_SHOT_ASSET_REQUIREMENT_REQUIRED');
    const invalidReady=requirements.filter(x=>x.readiness_status==='READY'&&!nonEmpty(parseJson(x.source_ref_json)));
    if(invalidReady.length)reasons.push('AIGC_READY_ASSET_SOURCE_REQUIRED');
    const invalidBlocked=requirements.filter(x=>
      ['MISSING','PENDING'].includes(x.readiness_status)&&(!nonEmpty(x.missing_reason)||!nonEmpty(parseJson(x.revalidation_json)))
    );
    if(invalidBlocked.length)reasons.push('AIGC_BLOCKED_ASSET_DETAIL_REQUIRED');

    const computedBlockedShots=new Set(
      requirements.filter(x=>x.criticality==='REQUIRED'&&['MISSING','PENDING'].includes(x.readiness_status)).map(x=>x.shot_id)
    );
    if(shots.some(x=>(x.readiness_status==='BLOCKED')!==computedBlockedShots.has(x.id)))
      reasons.push('AIGC_SHOT_READINESS_MISMATCH');

    evidence.unitCount=units.length;
    evidence.sceneCount=scenes.length;
    evidence.shotCount=shots.length;
    evidence.assetRequirementCount=requirements.length;
    evidence.readyShotCount=shots.filter(x=>x.readiness_status==='READY').length;
    evidence.blockedShotCount=shots.filter(x=>x.readiness_status==='BLOCKED').length;
    evidence.missingRequiredAssetCount=requirements.filter(x=>x.criticality==='REQUIRED'&&x.readiness_status==='MISSING').length;
    evidence.pendingRequiredAssetCount=requirements.filter(x=>x.criticality==='REQUIRED'&&x.readiness_status==='PENDING').length;
    evidence.coverageComplete=
      evidence.sceneCount===Number(script.scene_count)&&
      evidence.shotCount>=evidence.sceneCount&&
      evidence.assetRequirementCount>=evidence.shotCount;
  }

  const result={projectId,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m285_gate_evaluations
      (id,project_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const getAigcBreakdownState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [plans,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_breakdown_plans WHERE project_id=? ORDER BY version_no,created_at',[projectId]),
    listRows(db,'SELECT * FROM aigc_m285_gate_evaluations WHERE project_id=? ORDER BY as_of,id',[projectId])
  ]);
  const current=plans.filter(x=>x.status==='FROZEN').at(-1)||null;
  let units=[],scenes=[],shots=[],requirements=[];
  if(current){
    [units,scenes,shots,requirements]=await Promise.all([
      listRows(db,'SELECT * FROM aigc_units WHERE breakdown_plan_id=? ORDER BY sequence_no,id',[current.id]),
      listRows(db,'SELECT * FROM aigc_scenes WHERE breakdown_plan_id=? ORDER BY scene_no,id',[current.id]),
      listRows(db,'SELECT * FROM aigc_shots WHERE breakdown_plan_id=? ORDER BY scene_id,sequence_no,id',[current.id]),
      listRows(db,'SELECT * FROM aigc_shot_asset_requirements WHERE breakdown_plan_id=? ORDER BY shot_id,requirement_key',[current.id])
    ]);
  }
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{language:'zh-CN',moduleNames:['制作拆解','镜头规划','资产需求与覆盖','镜头生产就绪'],
      gateName:'制作拆解门禁',readinessLabels:{READY:'可直接生产',BLOCKED:'缺失资产阻塞'}},
    plans:plans.map(x=>({id:x.id,scriptVersionId:x.script_version_id,planKey:x.plan_key,
      versionNo:Number(x.version_no),sceneStart:Number(x.scene_start),sceneEnd:Number(x.scene_end),
      sceneCount:Number(x.scene_count),unitCount:Number(x.unit_count),shotCount:Number(x.shot_count),
      assetRequirementCount:Number(x.asset_requirement_count),readinessSummary:parseJson(x.readiness_summary_json),
      coverageSnapshot:parseJson(x.coverage_snapshot_json),status:x.status})),
    currentCoverage:current?{
      planId:current.id,
      units:units.map(x=>({id:x.id,unitKey:x.unit_key,title:x.title,sequenceNo:Number(x.sequence_no),
        sceneStart:Number(x.scene_start),sceneEnd:Number(x.scene_end),purpose:parseJson(x.purpose_json),
        continuity:parseJson(x.continuity_json)})),
      scenes:scenes.map(x=>({id:x.id,unitId:x.unit_id,sceneKey:x.scene_key,sceneNo:Number(x.scene_no),
        title:x.title,scriptScope:parseJson(x.script_scope_json),locationTime:parseJson(x.location_time_json),
        purpose:parseJson(x.purpose_json),continuity:parseJson(x.continuity_json)})),
      shots:shots.map(x=>({id:x.id,sceneId:x.scene_id,shotKey:x.shot_key,sequenceNo:Number(x.sequence_no),
        shotPurpose:parseJson(x.shot_purpose_json),charactersLooks:parseJson(x.characters_looks_json),
        scenePropUi:parseJson(x.scene_prop_ui_json),actionExpressionPerformance:parseJson(x.action_expression_performance_json),
        dialogueVoiceOstSfx:parseJson(x.dialogue_voice_ost_sfx_json),camera:parseJson(x.camera_json),
        timing:parseJson(x.timing_json),referenceRequirements:parseJson(x.reference_requirements_json),
        generationStrategy:parseJson(x.generation_strategy_json),multiFormat:parseJson(x.multi_format_json),
        continuityDependency:parseJson(x.continuity_dependency_json),priorityCostRetry:parseJson(x.priority_cost_retry_json),
        qaCriteria:parseJson(x.qa_criteria_json),readinessStatus:x.readiness_status,
        blockingReasons:parseJson(x.blocking_reasons_json)})),
      assetRequirements:requirements.map(x=>({id:x.id,shotId:x.shot_id,requirementKey:x.requirement_key,
        requirementType:x.requirement_type,criticality:x.criticality,readinessStatus:x.readiness_status,
        requirement:parseJson(x.requirement_json),sourceRef:parseJson(x.source_ref_json),
        missingReason:x.missing_reason||null,revalidation:parseJson(x.revalidation_json)}))
    }:null,
    gateEvaluations:gates.map(x=>({id:x.id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of}))
  };
};
