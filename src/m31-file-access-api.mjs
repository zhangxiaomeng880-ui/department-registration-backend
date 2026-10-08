// M31.5: project-scoped, auditable, fail-closed file access.
import {getRuntimePool} from './runtime-db.mjs';
import {assertAccess,resolveProjectScope} from './runtime-rbac.mjs';
import {resolveS3Config,getS3Object} from './m31-s3-readonly.mjs';

const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const SHA=/^[a-f0-9]{64}$/i;
const parse=v=>{if(v==null)return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return null;}};
const finalStates=new Set(['PASS','CURRENT','LOCKED','FROZEN']);

export const evaluateM31FilePolicy=({row,projectId,tenantId,workspaceId,config})=>{
 if(!row)throw fail('FILE_VERSION_NOT_FOUND',404);
 if(row.owner_project_id!==projectId||row.asset_owner_project_id!==projectId||
    row.library_owner_project_id!==projectId||row.library_scope!=='PROJECT')
  throw fail('FILE_PROJECT_OWNERSHIP_DENIED',403);
 if(row.workspace_id!==workspaceId)throw fail('FILE_WORKSPACE_OWNERSHIP_DENIED',403);
 if(row.library_status!=='ACTIVE'||!finalStates.has(row.asset_status)||!finalStates.has(row.state))
  throw fail('FILE_VERSION_NOT_CURRENT',409);
 const permission=parse(row.permission_policy_json)||{};
 const libraryRights=parse(row.rights_policy_json)||{};
 const assetRights=parse(row.asset_rights_json)||{};
 const qa=parse(row.qa_result_json)||{};
 if(permission.fileReadAllowed!==true||libraryRights.fileReadAllowed!==true||
    assetRights.fileReadAllowed!==true||qa.status!=='PASS'||
    libraryRights.releaseApproved===false||assetRights.releaseApproved===false)
  throw fail('FILE_RIGHTS_NOT_APPROVED',403);
 for(const usage of [parse(row.library_usage_scope_json)||{},parse(row.asset_usage_scope_json)||{}]){
  if(Array.isArray(usage.allowedProjectIds)&&!usage.allowedProjectIds.includes(projectId))
   throw fail('FILE_USAGE_SCOPE_DENIED',403);
 }
 const locator=parse(row.content_locator_json);
 if(locator?.provider!=='S3_COMPATIBLE'||typeof locator.objectKey!=='string')
  throw fail('FILE_SOURCE_NOT_MIGRATED',409);
 if(locator.bucket&&locator.bucket!==config.bucket)throw fail('FILE_BUCKET_MISMATCH',403);
 const prefix=[tenantId,workspaceId,projectId,row.asset_id,row.version_id].join('/')+'/';
 if(!locator.objectKey.startsWith(prefix)||locator.objectKey.length>700||
   !/^[a-zA-Z0-9_./-]+$/.test(locator.objectKey)||
   locator.objectKey.split('/').some(segment=>!segment||segment==='.'||segment==='..'))
  throw fail('FILE_OBJECT_KEY_OUT_OF_SCOPE',403);
 if(typeof row.fingerprint_sha256!=='string'||!SHA.test(row.fingerprint_sha256))
  throw fail('FILE_FINGERPRINT_REQUIRED',409);
 const name=String(locator.filename||row.asset_key||'asset.bin').replace(/[\r\n"\\\/]/g,'_').slice(0,110);
 return {key:locator.objectKey,fingerprint:row.fingerprint_sha256.toLowerCase(),
  mimeType:locator.mimeType||null,name};
};

const loadVersion=async(db,assetId,versionId)=>{
 const sql='SELECT v.id AS version_id,v.asset_id,v.workspace_id,v.owner_project_id,v.state,'+
 'v.qa_result_json,v.content_locator_json,v.fingerprint_sha256,'+
 'a.asset_key,a.owner_project_id AS asset_owner_project_id,a.status AS asset_status,'+
 'a.rights_json AS asset_rights_json,a.usage_scope_json AS asset_usage_scope_json,'+
 'l.owner_project_id AS library_owner_project_id,l.library_scope,'+
 'l.status AS library_status,l.permission_policy_json,l.rights_policy_json,'+
 'l.usage_scope_json AS library_usage_scope_json '+
 'FROM aigc_asset_versions v JOIN aigc_assets a ON a.id=v.asset_id '+
 'JOIN aigc_asset_libraries l ON l.id=a.library_id '+
 'WHERE v.id=? AND v.asset_id=? LIMIT 1';
 return (await db.execute(sql,[versionId,assetId]))[0][0]||null;
};

const audit=async(db,{principal,projectId,assetId,versionId,result,reason})=>{
 const sql='INSERT INTO audit_logs '+
 '(project_id,event_type,actor_type,actor_key,object_type,object_id,event_json) '+
 'VALUES (?,?,?,?,?,?,?)';
 await db.execute(sql,[projectId,result==='ALLOW'?'FILE_ACCESS_GRANTED':'FILE_ACCESS_DENIED',
  principal?.platformAdmin?'PLATFORM':'SCOPED',
  principal?.identityId||principal?.credentialId||'PLATFORM_ADMIN',
  'ASSET_VERSION',versionId,
  JSON.stringify({source:'M31_FILE_GATE',assetId,result,reason:reason||null})]);
};

export const handleM31FileAccessRoute=async(req,res,url,{
 principal,json,db=getRuntimePool(),env=process.env,fetchImpl=fetch,
 assertAccessImpl=assertAccess,resolveProjectScopeImpl=resolveProjectScope
}={})=>{
 const match=url.pathname.match(new RegExp('^/api/runtime/projects/([A-Za-z0-9-]{1,64})/assets/([A-Za-z0-9-]{1,64})/versions/([A-Za-z0-9-]{1,64})/(access|content)$'));
 if(req.method!=='GET'||!match)return false;
 const [,projectId,assetId,versionId,action]=match;
 const scope=await resolveProjectScopeImpl(projectId);
 if(!principal?.platformAdmin)await assertAccessImpl({
  principal,permission:'project:read',...scope,method:req.method,path:url.pathname
 });
 let auditing=false;
 try{
  const config=resolveS3Config(env);
  const row=await loadVersion(db,assetId,versionId);
  const policy=evaluateM31FilePolicy({
   row,projectId,tenantId:scope.tenantId,workspaceId:scope.workspaceId,config
  });
  const found=await getS3Object({config,key:policy.key,
   method:action==='access'?'HEAD':'GET',fetchImpl});
  if(policy.mimeType&&found.contentType!==policy.mimeType)throw fail('FILE_MIME_MISMATCH',409);
  if(action==='content'&&found.sha256!==policy.fingerprint)throw fail('FILE_FINGERPRINT_MISMATCH',409);
  auditing=true;
  await audit(db,{principal,projectId,assetId,versionId,result:'ALLOW'});
  if(action==='access'){
   json(res,200,{data:{access:'READY',projectId,assetId,versionId,
    mimeType:found.contentType,sizeBytes:found.sizeBytes,
    contentPath:url.pathname.replace(/\/access$/,'/content'),
    fingerprintVerifiedOnDownload:true}});
  }else{
   res.writeHead(200,{
    'content-type':found.contentType,'content-length':found.sizeBytes,
    'content-disposition':'attachment; filename="'+policy.name+'"',
    'cache-control':'private, no-store','x-content-type-options':'nosniff',
    'content-security-policy':"sandbox; default-src 'none'",'x-frame-options':'DENY'
   });
   res.end(found.bytes);
  }
  return true;
 }catch(e){
  if(!auditing){
   try{await audit(db,{principal,projectId,assetId,versionId,result:'DENY',reason:e.code||'UNKNOWN'});}
   catch{throw fail('FILE_AUDIT_UNAVAILABLE',503);}
  }
  throw e;
 }
};
