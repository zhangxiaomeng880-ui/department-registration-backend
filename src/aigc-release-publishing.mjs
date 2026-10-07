import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const GATE='G-AIGC-PUBLISH';
const CHANNEL_RISKS=new Set(['LOW','HIGH']);
const CHANNEL_STATUSES=new Set(['CONNECTED','DISCONNECTED']);
const PUBLICATION_STATUSES=new Set(['PUBLISHED','FAILED']);
const VERIFY_STATUSES=new Set(['PASS','FAIL']);

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
    'Release Publishing requires AIGC_CONTENT project','AIGC_PROJECT_TYPE_REQUIRED',409
  );
  return rows[0];
};
const currentPackage=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
    [projectId]
  );
  return rows[0]||null;
};
const currentReleasePlan=async(projectId,db)=>{
  const [rows]=await db.execute(
    "SELECT * FROM aigc_release_plans WHERE project_id=? AND status='FROZEN' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
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
const rightsPass=rights=>['APPROVED','CLEARED','PASS'].includes(upper(rights?.status));
const disclosurePass=disclosure=>['APPROVED','READY','PASS','N_A'].includes(upper(disclosure?.status));

export const resolveAigcReleaseProjectScope=async projectId=>{
  const p=await loadProject(projectId);return {projectId,workspaceId:p.workspace_id};
};
export const resolveAigcReleasePlanScope=async releasePlanId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.project_id,p.workspace_id FROM aigc_release_plans r
      JOIN projects p ON p.id=r.project_id WHERE r.id=?`,[releasePlanId]
  );
  if(!rows.length)throw errorOf('Release plan not found','AIGC_RELEASE_PLAN_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveAigcReleaseItemScope=async releaseItemId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT p.project_id,pr.workspace_id FROM aigc_release_plan_items i
      JOIN aigc_release_plans p ON p.id=i.release_plan_id
      JOIN projects pr ON pr.id=p.project_id WHERE i.id=?`,[releaseItemId]
  );
  if(!rows.length)throw errorOf('Release plan item not found','AIGC_RELEASE_ITEM_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};
export const resolveAigcPublicationScope=async publicationId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.project_id,p.workspace_id FROM aigc_publication_records r
      JOIN projects p ON p.id=r.project_id WHERE r.id=?`,[publicationId]
  );
  if(!rows.length)throw errorOf('Publication record not found','AIGC_PUBLICATION_NOT_FOUND',404);
  return {projectId:rows[0].project_id,workspaceId:rows[0].workspace_id};
};

export const createAigcChannelConnection=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'connectionKey','platformKey','accountRef','connectionRef','regions','languages',
    'riskLevel','rightsBoundary','disclosurePolicy','status','evidence'
  ],'INVALID_AIGC_CHANNEL_CONNECTION');
  const riskLevel=upper(input.riskLevel),status=upper(input.status);
  if(!CHANNEL_RISKS.has(riskLevel))throw errorOf(
    'Channel risk must be LOW or HIGH','AIGC_CHANNEL_RISK_INVALID',409
  );
  if(!CHANNEL_STATUSES.has(status))throw errorOf(
    'Channel status must be CONNECTED or DISCONNECTED','AIGC_CHANNEL_STATUS_INVALID',409
  );
  if(!Array.isArray(input.regions)||!input.regions.length||!Array.isArray(input.languages)||!input.languages.length)
    throw errorOf('Channel regions and languages are required','AIGC_CHANNEL_SCOPE_REQUIRED',409);
  if(input.connectionRef?.credential||input.connectionRef?.token||input.connectionRef?.secret)
    throw errorOf('Credentials must not be stored in channel metadata','AIGC_CHANNEL_CREDENTIAL_FORBIDDEN',409);

  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_channel_connections
      (id,project_id,connection_key,platform_key,account_ref,connection_ref_json,regions_json,languages_json,
       risk_level,rights_boundary_json,disclosure_policy_json,status,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.connectionKey,upper(input.platformKey),input.accountRef,asJson(input.connectionRef),
     asJson(input.regions),asJson(input.languages),riskLevel,asJson(input.rightsBoundary),
     asJson(input.disclosurePolicy),status,asJson(input.evidence),actorId]
  );
  return {id,projectId,connectionKey:input.connectionKey,platformKey:upper(input.platformKey),
    accountRef:input.accountRef,riskLevel,status};
};

export const createAigcReleasePlan=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  requireFields(input,[
    'planKey','versionNo','title','distributionPackageId','releaseWindow','calendar',
    'rights','disclosure','items','evidence'
  ],'INVALID_AIGC_RELEASE_PLAN');
  if(!Array.isArray(input.items)||!input.items.length)throw errorOf(
    'Release plan items are required','AIGC_RELEASE_ITEMS_REQUIRED',409
  );
  const versionNo=Number(input.versionNo);
  if(!Number.isInteger(versionNo)||versionNo<1)throw errorOf(
    'Release plan versionNo must be positive integer','AIGC_RELEASE_VERSION_INVALID',409
  );
  if(!rightsPass(input.rights)||!disclosurePass(input.disclosure))throw errorOf(
    'Release plan rights/disclosure must be ready','AIGC_RELEASE_PLAN_COMPLIANCE_REQUIRED',409
  );

  const db=getRuntimePool(),pkg=await currentPackage(projectId,db);
  if(!pkg||pkg.id!==input.distributionPackageId)throw errorOf(
    'Release plan must bind current frozen Distribution Package',
    'AIGC_CURRENT_DISTRIBUTION_PACKAGE_REQUIRED',409,{currentPackageId:pkg?.id||null}
  );

  const packageItems=await listRows(db,
    `SELECT i.distribution_version_id,v.status,v.platform_json
       FROM aigc_distribution_package_items i
       JOIN aigc_content_derivation_versions v ON v.id=i.distribution_version_id
      WHERE i.package_id=?`,[pkg.id]
  );
  const packageVersionMap=new Map(packageItems.map(x=>[x.distribution_version_id,x]));

  const current=await currentReleasePlan(projectId,db);
  if(current){
    if(input.parentReleasePlanId!==current.id)throw errorOf(
      'Release plan revision must derive from current frozen plan',
      'AIGC_RELEASE_PLAN_PARENT_REQUIRED',409,{currentReleasePlanId:current.id}
    );
    if(upper(input.changeRef?.status)!=='APPROVED'||!nonEmpty(input.changeRef?.reference))
      throw errorOf('Release plan revision requires approved Change/Decision',
        'AIGC_RELEASE_PLAN_CHANGE_REQUIRED',409);
  }else if(input.parentReleasePlanId){
    throw errorOf('Initial release plan cannot have a parent',
      'AIGC_RELEASE_INITIAL_PARENT_FORBIDDEN',409);
  }

  const channelIds=[...new Set(input.items.map(x=>x.channelConnectionId))];
  const [channels]=await db.query(
    `SELECT * FROM aigc_channel_connections
      WHERE project_id=? AND id IN (${channelIds.map(()=>'?').join(',')})`,
    [projectId,...channelIds]
  );
  const channelMap=new Map(channels.map(x=>[x.id,x]));
  if(channels.length!==channelIds.length)throw errorOf(
    'Release item channel scope invalid','AIGC_RELEASE_CHANNEL_SCOPE_INVALID',409
  );

  const normalized=[],itemKeys=new Set();
  for(const item of input.items){
    requireFields(item,[
      'itemKey','distributionVersionId','channelConnectionId','region','language',
      'scheduledPublishAt','rights','disclosure','evidence'
    ],'INVALID_AIGC_RELEASE_ITEM');
    if(itemKeys.has(item.itemKey))throw errorOf(
      'Release item key duplicated','AIGC_RELEASE_ITEM_DUPLICATE',409,{itemKey:item.itemKey}
    );
    itemKeys.add(item.itemKey);
    const version=packageVersionMap.get(item.distributionVersionId);
    if(!version||version.status!=='READY')throw errorOf(
      'Release item must use READY version from current Distribution Package',
      'AIGC_RELEASE_VERSION_NOT_READY',409,{distributionVersionId:item.distributionVersionId}
    );
    const channel=channelMap.get(item.channelConnectionId);
    if(!channel||channel.status!=='CONNECTED')throw errorOf(
      'Release channel must be CONNECTED','AIGC_RELEASE_CHANNEL_NOT_CONNECTED',409
    );
    const regions=parseJson(channel.regions_json)||[],languages=parseJson(channel.languages_json)||[];
    if(!regions.includes(item.region)||!languages.includes(item.language))throw errorOf(
      'Release item region/language outside Channel scope','AIGC_RELEASE_CHANNEL_SCOPE_DENIED',409,
      {region:item.region,language:item.language}
    );
    const platform=upper(item.platformKey||channel.platform_key);
    if(platform!==channel.platform_key)throw errorOf(
      'Release item platform must match Channel','AIGC_RELEASE_PLATFORM_MISMATCH',409
    );
    if(!rightsPass(item.rights)||!disclosurePass(item.disclosure))throw errorOf(
      'Release item rights/disclosure must be ready','AIGC_RELEASE_ITEM_COMPLIANCE_REQUIRED',409
    );
    const scheduled=new Date(item.scheduledPublishAt);
    if(Number.isNaN(scheduled.getTime()))throw errorOf(
      'Release item scheduledPublishAt invalid','AIGC_RELEASE_SCHEDULE_INVALID',409
    );
    normalized.push({...item,platform,scheduled,channel,
      status:channel.risk_level==='HIGH'?'APPROVAL_REQUIRED':'PLANNED'});
  }

  const conn=await db.getConnection(),id=randomUUID(),createdItems=[];
  try{
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO aigc_release_plans
        (id,project_id,distribution_package_id,parent_release_plan_id,plan_key,version_no,title,
         release_window_json,calendar_json,rights_json,disclosure_json,change_ref_json,status,is_current,
         approval_json,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CANDIDATE',FALSE,NULL,?,?)`,
      [id,projectId,pkg.id,input.parentReleasePlanId||null,input.planKey,versionNo,input.title,
       asJson(input.releaseWindow),asJson(input.calendar),asJson(input.rights),asJson(input.disclosure),
       input.changeRef?asJson(input.changeRef):null,asJson(input.evidence),actorId]
    );
    for(const item of normalized){
      const itemId=randomUUID();
      await conn.execute(
        `INSERT INTO aigc_release_plan_items
          (id,release_plan_id,distribution_version_id,channel_connection_id,item_key,platform_key,
           region,language,scheduled_publish_at,rights_json,disclosure_json,status,human_approval_json,evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
        [itemId,id,item.distributionVersionId,item.channelConnectionId,item.itemKey,item.platform,
         item.region,item.language,item.scheduled,asJson(item.rights),asJson(item.disclosure),
         item.status,asJson(item.evidence)]
      );
      await insertTrace(conn,{projectId,sourceType:'DISTRIBUTION_VERSION',sourceId:item.distributionVersionId,
        targetType:'RELEASE_PLAN_ITEM',targetId:itemId,linkType:'SCHEDULED_FOR',actorId,
        evidence:{platform:item.platform,region:item.region,language:item.language,
          scheduledPublishAt:item.scheduled.toISOString(),riskLevel:item.channel.risk_level}});
      createdItems.push({id:itemId,itemKey:item.itemKey,status:item.status,
        riskLevel:item.channel.risk_level,platformKey:item.platform});
    }
    await insertTrace(conn,{projectId,sourceType:'DISTRIBUTION_PACKAGE',sourceId:pkg.id,
      targetType:'RELEASE_PLAN',targetId:id,linkType:'PLANNED_AS',actorId,
      evidence:{planKey:input.planKey,versionNo}});
    await conn.commit();
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
  return {id,projectId,distributionPackageId:pkg.id,planKey:input.planKey,versionNo,
    itemCount:createdItems.length,status:'CANDIDATE',isCurrent:false,items:createdItems};
};

export const approveAigcReleasePlanItem=async(releaseItemId,input={},actorId=null)=>{
  requireFields(input,['approval','evidence'],'INVALID_AIGC_RELEASE_HUMAN_APPROVAL');
  const approval=input.approval||{};
  if(upper(approval.mode)!=='HUMAN'||upper(approval.decision)!=='APPROVED'||
     !nonEmpty(approval.approvedByRef)||!nonEmpty(approval.approvedAt))
    throw errorOf('High-risk release requires explicit HUMAN approval evidence',
      'AIGC_RELEASE_HUMAN_APPROVAL_REQUIRED',409);
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT i.*,c.risk_level,p.project_id,p.status AS plan_status
       FROM aigc_release_plan_items i
       JOIN aigc_channel_connections c ON c.id=i.channel_connection_id
       JOIN aigc_release_plans p ON p.id=i.release_plan_id
      WHERE i.id=?`,[releaseItemId]
  );
  const item=rows[0];
  if(!item)throw errorOf('Release plan item not found','AIGC_RELEASE_ITEM_NOT_FOUND',404);
  if(item.risk_level!=='HIGH')throw errorOf(
    'Human approval endpoint is only required for HIGH-risk channels',
    'AIGC_RELEASE_HUMAN_APPROVAL_NOT_REQUIRED',409
  );
  if(item.plan_status!=='CANDIDATE')throw errorOf(
    'Human approval must occur before plan freeze','AIGC_RELEASE_PLAN_STATE_INVALID',409
  );
  if(item.status==='APPROVED')return {id:item.id,status:'APPROVED',idempotent:true};
  if(item.status!=='APPROVAL_REQUIRED')throw errorOf(
    'Release item is not awaiting approval','AIGC_RELEASE_ITEM_STATE_INVALID',409,{status:item.status}
  );
  await db.execute(
    "UPDATE aigc_release_plan_items SET status='APPROVED',human_approval_json=? WHERE id=?",
    [asJson({...approval,evidence:input.evidence}),item.id]
  );
  return {id:item.id,releasePlanId:item.release_plan_id,status:'APPROVED',
    approvalMode:'HUMAN',idempotent:false};
};

export const evaluateAigcPublishGate=async(projectId,input={},actorId=null)=>{
  await loadProject(projectId);
  const db=getRuntimePool(),reasons=[],evidence={};
  let releasePlanId=input.releasePlanId;
  if(!releasePlanId){
    const [rows]=await db.execute(
      "SELECT id FROM aigc_release_plans WHERE project_id=? AND status='CANDIDATE' ORDER BY version_no DESC,created_at DESC LIMIT 1",
      [projectId]
    );
    releasePlanId=rows[0]?.id||null;
  }
  if(!releasePlanId)throw errorOf('Release plan is required','AIGC_RELEASE_PLAN_REQUIRED',409);
  const [plans]=await db.execute(
    'SELECT * FROM aigc_release_plans WHERE id=? AND project_id=?',[releasePlanId,projectId]
  );
  const plan=plans[0];
  if(!plan)throw errorOf('Release plan not found','AIGC_RELEASE_PLAN_NOT_FOUND',404);

  const pkg=await currentPackage(projectId,db);
  if(!pkg||plan.distribution_package_id!==pkg.id)reasons.push('AIGC_RELEASE_DISTRIBUTION_PACKAGE_STALE');
  if(!rightsPass(parseJson(plan.rights_json))||!disclosurePass(parseJson(plan.disclosure_json)))
    reasons.push('AIGC_RELEASE_PLAN_COMPLIANCE_NOT_READY');

  const items=await listRows(db,
    `SELECT i.*,c.status AS channel_status,c.risk_level,c.regions_json,c.languages_json,
            v.status AS version_status,pi.package_id
       FROM aigc_release_plan_items i
       JOIN aigc_channel_connections c ON c.id=i.channel_connection_id
       JOIN aigc_content_derivation_versions v ON v.id=i.distribution_version_id
       LEFT JOIN aigc_distribution_package_items pi
         ON pi.distribution_version_id=i.distribution_version_id AND pi.package_id=?
      WHERE i.release_plan_id=? ORDER BY i.scheduled_publish_at,i.id`,
    [pkg?.id||'',plan.id]
  );
  if(!items.length)reasons.push('AIGC_RELEASE_PLAN_EMPTY');
  const disconnected=items.filter(x=>x.channel_status!=='CONNECTED');
  const staleVersions=items.filter(x=>x.package_id!==pkg?.id||x.version_status!=='READY');
  const complianceInvalid=items.filter(x=>
    !rightsPass(parseJson(x.rights_json))||!disclosurePass(parseJson(x.disclosure_json))
  );
  const highRiskApprovalMissing=items.filter(x=>
    x.risk_level==='HIGH'&&(x.status!=='APPROVED'||!nonEmpty(parseJson(x.human_approval_json)))
  );
  if(disconnected.length)reasons.push('AIGC_RELEASE_CHANNEL_NOT_CONNECTED');
  if(staleVersions.length)reasons.push('AIGC_RELEASE_VERSION_NOT_IN_CURRENT_PACKAGE');
  if(complianceInvalid.length)reasons.push('AIGC_RELEASE_ITEM_COMPLIANCE_NOT_READY');
  if(highRiskApprovalMissing.length)reasons.push('AIGC_RELEASE_HUMAN_APPROVAL_REQUIRED');

  const asOf=input.asOf?new Date(input.asOf):new Date();
  if(Number.isNaN(asOf.getTime()))throw errorOf('Invalid asOf','INVALID_DATE');
  evidence.distributionPackageId=pkg?.id||null;
  evidence.releasePlanId=plan.id;
  evidence.itemCount=items.length;
  evidence.highRiskItemCount=items.filter(x=>x.risk_level==='HIGH').length;
  evidence.highRiskApprovedCount=items.filter(x=>x.risk_level==='HIGH'&&x.status==='APPROVED').length;
  evidence.disconnectedItemIds=disconnected.map(x=>x.id);
  evidence.staleVersionItemIds=staleVersions.map(x=>x.id);
  evidence.complianceInvalidItemIds=complianceInvalid.map(x=>x.id);
  evidence.highRiskApprovalMissingItemIds=highRiskApprovalMissing.map(x=>x.id);
  evidence.externalPublishExecuted=false;
  evidence.readyForExternalPublish=reasons.length===0;

  const result={projectId,releasePlanId:plan.id,gateKey:GATE,status:reasons.length?'HOLD':'PASS',
    reasonCodes:[...new Set(reasons)],evidenceSnapshot:evidence,asOf};
  if(input.persist!==false)await db.execute(
    `INSERT INTO aigc_m2814_gate_evaluations
      (id,project_id,release_plan_id,gate_key,status,reason_codes_json,evidence_snapshot_json,as_of,evaluated_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),projectId,plan.id,GATE,result.status,asJson(result.reasonCodes),asJson(evidence),asOf,actorId]
  );
  return result;
};

export const freezeAigcReleasePlan=async(releasePlanId,input={},actorId=null)=>{
  requireFields(input,['evidence'],'INVALID_AIGC_RELEASE_PLAN_FREEZE');
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_release_plans WHERE id=?',[releasePlanId]);
  const plan=rows[0];
  if(!plan)throw errorOf('Release plan not found','AIGC_RELEASE_PLAN_NOT_FOUND',404);
  if(plan.status==='FROZEN'&&plan.is_current)return {
    id:plan.id,projectId:plan.project_id,status:'FROZEN',isCurrent:true,idempotent:true
  };
  if(plan.status!=='CANDIDATE')throw errorOf(
    'Only CANDIDATE release plan can be frozen','AIGC_RELEASE_PLAN_STATE_INVALID',409,{status:plan.status}
  );
  const [gates]=await db.execute(
    `SELECT * FROM aigc_m2814_gate_evaluations
      WHERE release_plan_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [plan.id,GATE]
  );
  if(!gates.length||gates[0].status!=='PASS')throw errorOf(
    'G-AIGC-PUBLISH must PASS before release plan freeze','G_AIGC_PUBLISH_REQUIRED',409
  );
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE aigc_release_plans SET status='HISTORICAL',is_current=FALSE WHERE project_id=? AND status='FROZEN' AND is_current=TRUE",
      [plan.project_id]
    );
    await conn.execute(
      `UPDATE aigc_release_plans
          SET status='FROZEN',is_current=TRUE,approval_json=?,frozen_at=CURRENT_TIMESTAMP(6)
        WHERE id=?`,
      [asJson(input.approval||{mode:'GATE_PASS'}),plan.id]
    );
    await insertTrace(conn,{projectId:plan.project_id,sourceType:'RELEASE_PLAN',sourceId:plan.id,
      targetType:'RELEASE_PLAN',targetId:plan.id,linkType:'FROZEN_AS_CURRENT',actorId,evidence:input.evidence});
    await conn.commit();
    return {id:plan.id,projectId:plan.project_id,status:'FROZEN',isCurrent:true,idempotent:false};
  }catch(e){try{await conn.rollback();}catch{}throw e;}finally{conn.release();}
};

export const recordAigcPublicationReceipt=async(releaseItemId,input={},actorId=null)=>{
  requireFields(input,['attemptNo','status','executionMode','providerReceipt','evidence'],
    'INVALID_AIGC_PUBLICATION_RECEIPT');
  if(upper(input.executionMode)!=='EXTERNAL_RECEIPT')throw errorOf(
    'Publication API records external execution receipts only',
    'AIGC_PUBLICATION_EXTERNAL_RECEIPT_ONLY',409
  );
  const status=upper(input.status);
  if(!PUBLICATION_STATUSES.has(status))throw errorOf(
    'Publication status must be PUBLISHED or FAILED','AIGC_PUBLICATION_STATUS_INVALID',409
  );
  const attemptNo=Number(input.attemptNo);
  if(!Number.isInteger(attemptNo)||attemptNo<1)throw errorOf(
    'Publication attemptNo invalid','AIGC_PUBLICATION_ATTEMPT_INVALID',409
  );
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT i.*,p.project_id,p.status AS plan_status,p.is_current,p.id AS plan_id,
            c.risk_level
       FROM aigc_release_plan_items i
       JOIN aigc_release_plans p ON p.id=i.release_plan_id
       JOIN aigc_channel_connections c ON c.id=i.channel_connection_id
      WHERE i.id=?`,[releaseItemId]
  );
  const item=rows[0];
  if(!item)throw errorOf('Release plan item not found','AIGC_RELEASE_ITEM_NOT_FOUND',404);
  if(item.plan_status!=='FROZEN'||!item.is_current)throw errorOf(
    'Publication receipt requires current frozen Release Plan','AIGC_CURRENT_RELEASE_PLAN_REQUIRED',409
  );
  const [gates]=await db.execute(
    `SELECT status FROM aigc_m2814_gate_evaluations
      WHERE release_plan_id=? AND gate_key=? ORDER BY as_of DESC,created_at DESC LIMIT 1`,
    [item.plan_id,GATE]
  );
  if(!gates.length||gates[0].status!=='PASS')throw errorOf(
    'Publication receipt requires G-AIGC-PUBLISH PASS','G_AIGC_PUBLISH_REQUIRED',409
  );
  if(item.risk_level==='HIGH'&&item.status!=='APPROVED')throw errorOf(
    'High-risk publication requires approved release item','AIGC_RELEASE_HUMAN_APPROVAL_REQUIRED',409
  );
  if(status==='PUBLISHED'&&(!nonEmpty(input.externalId)&&!nonEmpty(input.publishedUrl)))
    throw errorOf('Published receipt requires externalId or publishedUrl',
      'AIGC_PUBLICATION_EXTERNAL_REFERENCE_REQUIRED',409);
  const publishedAt=status==='PUBLISHED'?(input.publishedAt?new Date(input.publishedAt):new Date()):null;
  if(publishedAt&&Number.isNaN(publishedAt.getTime()))throw errorOf(
    'publishedAt invalid','AIGC_PUBLICATION_DATE_INVALID',409
  );

  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_publication_records
      (id,project_id,release_plan_item_id,attempt_no,status,external_id,published_url,published_at,
       provider_receipt_json,error_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,item.project_id,item.id,attemptNo,status,input.externalId||null,input.publishedUrl||null,publishedAt,
     asJson(input.providerReceipt),input.error?asJson(input.error):null,asJson(input.evidence),actorId]
  );
  await insertTrace(db,{projectId:item.project_id,sourceType:'RELEASE_PLAN_ITEM',sourceId:item.id,
    targetType:'PUBLICATION_RECORD',targetId:id,linkType:'PUBLISHED_AS_RECEIPT',actorId,
    evidence:{status,attemptNo,externalId:input.externalId||null}});
  return {id,projectId:item.project_id,releasePlanItemId:item.id,attemptNo,status,
    externalId:input.externalId||null,publishedUrl:input.publishedUrl||null,publishedAt};
};

export const verifyAigcPublication=async(publicationId,input={},actorId=null)=>{
  requireFields(input,['status','checks','observed','evidence'],'INVALID_AIGC_PUBLICATION_VERIFICATION');
  const status=upper(input.status);
  if(!VERIFY_STATUSES.has(status))throw errorOf(
    'Verification status must be PASS or FAIL','AIGC_PUBLICATION_VERIFY_STATUS_INVALID',409
  );
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM aigc_publication_records WHERE id=?',[publicationId]);
  const pub=rows[0];
  if(!pub)throw errorOf('Publication record not found','AIGC_PUBLICATION_NOT_FOUND',404);
  if(pub.status!=='PUBLISHED')throw errorOf(
    'Only PUBLISHED receipt can be post-publish verified','AIGC_PUBLICATION_PUBLISHED_REQUIRED',409
  );
  const requiredChecks=['accessible','versionMatch','regionLanguage','disclosure','contentIntegrity'];
  const missing=requiredChecks.filter(k=>!['PASS','FAIL'].includes(upper(input.checks?.[k])));
  if(missing.length)throw errorOf('Post-publish checks incomplete',
    'AIGC_POST_PUBLISH_CHECKS_INCOMPLETE',409,{missing});
  const derivedStatus=requiredChecks.every(k=>upper(input.checks[k])==='PASS')?'PASS':'FAIL';
  if(status!==derivedStatus)throw errorOf('Verification status must match check results',
    'AIGC_POST_PUBLISH_STATUS_MISMATCH',409,{derivedStatus,status});
  const id=randomUUID();
  await db.execute(
    `INSERT INTO aigc_post_publish_verifications
      (id,project_id,publication_record_id,status,checks_json,observed_json,evidence_json,verified_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id,pub.project_id,pub.id,status,asJson(input.checks),asJson(input.observed),asJson(input.evidence),actorId]
  );
  return {id,projectId:pub.project_id,publicationRecordId:pub.id,status};
};

export const getAigcReleasePublishingState=async projectId=>{
  const project=await loadProject(projectId);
  const db=getRuntimePool();
  const [channels,plans,items,publications,verifications,gates]=await Promise.all([
    listRows(db,'SELECT * FROM aigc_channel_connections WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_release_plans WHERE project_id=? ORDER BY version_no,id',[projectId]),
    listRows(db,
      `SELECT i.*,p.project_id,c.risk_level FROM aigc_release_plan_items i
        JOIN aigc_release_plans p ON p.id=i.release_plan_id
        JOIN aigc_channel_connections c ON c.id=i.channel_connection_id
       WHERE p.project_id=? ORDER BY i.scheduled_publish_at,i.id`,[projectId]),
    listRows(db,'SELECT * FROM aigc_publication_records WHERE project_id=? ORDER BY created_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_post_publish_verifications WHERE project_id=? ORDER BY verified_at,id',[projectId]),
    listRows(db,'SELECT * FROM aigc_m2814_gate_evaluations WHERE project_id=? ORDER BY as_of,created_at,id',[projectId])
  ]);
  return {
    project:{id:project.id,projectKey:project.project_key,name:project.name,
      projectType:project.project_type,projectSubtypeKey:project.project_subtype_key},
    frontend:{
      language:'zh-CN',
      moduleNames:['渠道 / 账号连接','发布计划 / 内容日历','发布记录','发布后核验'],
      gateName:'发布门禁',
      externalSideEffectPolicy:'真实发布属于外部副作用；高风险渠道必须人工批准'
    },
    channels:channels.map(x=>({
      id:x.id,connectionKey:x.connection_key,platformKey:x.platform_key,accountRef:x.account_ref,
      connectionRef:parseJson(x.connection_ref_json),regions:parseJson(x.regions_json),
      languages:parseJson(x.languages_json),riskLevel:x.risk_level,status:x.status,
      rightsBoundary:parseJson(x.rights_boundary_json),disclosurePolicy:parseJson(x.disclosure_policy_json)
    })),
    plans:plans.map(x=>({
      id:x.id,distributionPackageId:x.distribution_package_id,parentReleasePlanId:x.parent_release_plan_id||null,
      planKey:x.plan_key,versionNo:Number(x.version_no),title:x.title,releaseWindow:parseJson(x.release_window_json),
      calendar:parseJson(x.calendar_json),rights:parseJson(x.rights_json),disclosure:parseJson(x.disclosure_json),
      changeRef:parseJson(x.change_ref_json),status:x.status,isCurrent:Boolean(x.is_current),
      approval:parseJson(x.approval_json),frozenAt:x.frozen_at,
      items:items.filter(i=>i.release_plan_id===x.id).map(i=>({
        id:i.id,distributionVersionId:i.distribution_version_id,channelConnectionId:i.channel_connection_id,
        itemKey:i.item_key,platformKey:i.platform_key,region:i.region,language:i.language,
        scheduledPublishAt:i.scheduled_publish_at,status:i.status,riskLevel:i.risk_level,
        humanApproval:parseJson(i.human_approval_json)
      }))
    })),
    publications:publications.map(x=>({
      id:x.id,releasePlanItemId:x.release_plan_item_id,attemptNo:Number(x.attempt_no),status:x.status,
      externalId:x.external_id||null,publishedUrl:x.published_url||null,publishedAt:x.published_at,
      providerReceipt:parseJson(x.provider_receipt_json),error:parseJson(x.error_json)
    })),
    verifications:verifications.map(x=>({
      id:x.id,publicationRecordId:x.publication_record_id,status:x.status,
      checks:parseJson(x.checks_json),observed:parseJson(x.observed_json),verifiedAt:x.verified_at
    })),
    gateEvaluations:gates.map(x=>({
      id:x.id,releasePlanId:x.release_plan_id,gateKey:x.gate_key,status:x.status,
      reasonCodes:parseJson(x.reason_codes_json),evidenceSnapshot:parseJson(x.evidence_snapshot_json),asOf:x.as_of
    }))
  };
};
