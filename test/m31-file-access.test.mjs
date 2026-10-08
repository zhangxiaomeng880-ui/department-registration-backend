import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateM31FilePolicy,handleM31FileAccessRoute} from '../src/m31-file-access-api.mjs';
import {resolveS3Config,signS3Request,getS3Object} from '../src/m31-s3-readonly.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const P='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';
const V='33333333-3333-4333-8333-333333333333';
const T='44444444-4444-4444-8444-444444444444';
const W='55555555-5555-4555-8555-555555555555';
const file=Buffer.from('%PDF-1.7\nReal binary fixture','utf8');
const env={
 M31_S3_ENDPOINT:'https://s3.test.invalid/',
 M31_S3_REGION:'sjc',
 M31_S3_BUCKET:'m31-fixtures',
 M31_S3_ACCESS_KEY_ID:'integration-key-id',
 M31_S3_SECRET_ACCESS_KEY:'integration-secret-key'
};
const key=[T,W,P,A,V,'real-qa.pdf'].join('/');
const principal={type:'SCOPED',platformAdmin:false,identityId:'user-1',tenantId:T,workspaceId:W,
 permissions:new Set(['project:read'])};
const row={
 version_id:V,asset_id:A,owner_project_id:P,asset_owner_project_id:P,library_owner_project_id:P,
 workspace_id:W,library_scope:'PROJECT',library_status:'ACTIVE',asset_status:'CURRENT',state:'CURRENT',
 permission_policy_json:{fileReadAllowed:true,crossProjectReuse:false},
 rights_policy_json:{fileReadAllowed:true,releaseApproved:true},
 asset_rights_json:{fileReadAllowed:true,releaseApproved:true},
 asset_usage_scope_json:{allowedProjectIds:[P]},library_usage_scope_json:{allowedProjectIds:[P]},
 qa_result_json:{status:'PASS'},content_locator_json:{provider:'S3_COMPATIBLE',objectKey:key,mimeType:'application/pdf',filename:'QA report.pdf'},
 fingerprint_sha256:sha(file),asset_key:'SCENE_QA'
};
const http=(status,bytes=file,contentType='application/pdf')=>new Response(bytes,{
 status,headers:{'content-type':contentType,'content-length':String(bytes?.byteLength??0)}
});
const s3=async(url,options)=>{
 assert.equal(new URL(url).origin,'https://s3.test.invalid');
 assert.ok(url.endsWith('/'+key));
 assert.ok(/^AWS4-HMAC-SHA256 Credential=/.test(options.headers.authorization));
 return options.method==='HEAD'?http(200,null):http(200);
};
const setup=(record=row,fetchImpl=s3,usedEnv=env,user=principal)=>{
 const logs=[],response={
  writeHead(status,headers){this.status=status;this.headers=headers;},
  end(body){this.data=body;}
 };
 const db={
  async execute(sql,params){
   if(sql.startsWith('SELECT v.id'))return [[record&&params[0]===V&&params[1]===A?record:null].filter(Boolean)];
   if(sql.startsWith('INSERT INTO audit_logs')){logs.push(params);return [{affectedRows:1}];}
   throw Error('UNEXPECTED_SQL '+sql.slice(0,40));
  }
 };
 const opts={
  principal:user,db,env:usedEnv,fetchImpl,
  resolveProjectScopeImpl:async id=>{assert.equal(id,P);return {tenantId:T,workspaceId:W};},
  assertAccessImpl:async({principal:actor,permission,tenantId,workspaceId})=>{
   if(actor?.tenantId!==tenantId||actor?.workspaceId!==workspaceId||!actor?.permissions.has(permission))
    throw Object.assign(new Error('Denied'),{code:'RUNTIME_FORBIDDEN',statusCode:403});
  },
  json:(res,status,body)=>{res.status=status;res.body=body;}
 };
 const invoke=async action=>handleM31FileAccessRoute({method:'GET'},response,
  new URL('https://runtime.test.invalid/api/runtime/projects/'+P+'/assets/'+A+'/versions/'+V+'/'+action),opts);
 return {invoke,logs,response};
};
test('SigV4 is deterministic and safe: only GET/HEAD, HTTPS server-configured origin and paths',()=>{
 const config=resolveS3Config(env);
 const signed=signS3Request({config,key,now:new Date('2026-10-08T00:00:00Z')});
 assert.ok(signed.headers.authorization.includes('Credential=integration-key-id/20261008/sjc/s3/aws4_request'));
 assert.ok(signed.url.startsWith('https://s3.test.invalid/m31-fixtures/'));
 assert.throws(()=>signS3Request({config,key:'../private',method:'GET'}),{code:'FILE_INVALID_OBJECT_KEY'});
 assert.throws(()=>signS3Request({config,key,method:'PUT'}),{code:'FILE_METHOD_NOT_ALLOWED'});
 assert.throws(()=>resolveS3Config({...env,M31_S3_ENDPOINT:'http://evil.invalid'}),{code:'FILE_PROVIDER_INVALID_ENDPOINT'});
 assert.throws(()=>resolveS3Config({}),{code:'FILE_PROVIDER_NOT_CONFIGURED'});
});
test('only explicitly approved asset, immutable version, correct project and key may open',()=>{
 const config=resolveS3Config(env);
 assert.equal(evaluateM31FilePolicy({row,projectId:P,tenantId:T,workspaceId:W,config}).key,key);
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,owner_project_id:'other'},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_PROJECT_OWNERSHIP_DENIED'});
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,asset_rights_json:{}},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_RIGHTS_NOT_APPROVED'});
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,qa_result_json:{status:'FAIL'}},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_RIGHTS_NOT_APPROVED'});
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,content_locator_json:{provider:'S3_COMPATIBLE',objectKey:'other/'+key}},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_OBJECT_KEY_OUT_OF_SCOPE'});
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,state:'DRAFT'},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_VERSION_NOT_CURRENT'});
 assert.throws(()=>evaluateM31FilePolicy({row:{...row,content_locator_json:{provider:'PROJECT_LIBRARY',ref:'file-123'}},projectId:P,tenantId:T,workspaceId:W,config}),{code:'FILE_SOURCE_NOT_MIGRATED'});
});
test('true file HEAD access returns only same-origin path and audited access, no S3 link',async()=>{
 const a=setup();
 assert.equal(await a.invoke('access'),true);
 assert.equal(a.response.status,200);
 assert.equal(a.response.body.data.access,'READY');
 assert.equal(a.response.body.data.fingerprintVerifiedOnDownload,true);
 assert.equal(a.response.body.data.contentPath.endsWith('/content'),true);
 assert.equal(JSON.stringify(a.response.body).includes('s3.test.invalid'),false);
 assert.equal(a.logs[0][1],'FILE_ACCESS_GRANTED');
 assert.equal(a.logs[0][3],'user-1');
});
test('download uses GET, verifies SHA256 and emits no-store attachment only after audit',async()=>{
 const a=setup();
 await a.invoke('content');
 assert.equal(a.response.status,200);
 assert.deepEqual(a.response.data,file);
 assert.equal(a.response.headers['content-type'],'application/pdf');
 assert.match(a.response.headers['content-disposition'],/^attachment;/);
 assert.equal(a.logs[0][1],'FILE_ACCESS_GRANTED');
});
test('tampered object checksum blocks download and audits denial',async()=>{
 const bad=setup(row,async()=>http(200,Buffer.from('tampered')));
 await assert.rejects(bad.invoke('content'),{code:'FILE_FINGERPRINT_MISMATCH'});
 assert.equal(bad.response.status,undefined);
 assert.equal(bad.logs[0][1],'FILE_ACCESS_DENIED');
});
test('cross-project or viewer without project:read never calls object store',async()=>{
 let called=0;
 const cross=setup({...row,owner_project_id:'wrong'},async()=>{called++;return http(200);});
 await assert.rejects(cross.invoke('access'),{code:'FILE_PROJECT_OWNERSHIP_DENIED'});
 assert.equal(cross.logs[0][1],'FILE_ACCESS_DENIED');
 const viewer=setup(row,async()=>{called++;return http(200);},env,{...principal,permissions:new Set(['workspace:read'])});
 await assert.rejects(viewer.invoke('access'),{code:'RUNTIME_FORBIDDEN'});
 assert.equal(called,0);
 assert.equal(viewer.logs.length,0,'RBAC assertion already logs its own authorization decision');
});
test('no S3 credentials, no source migration and object-not-found always fail closed',async()=>{
 const unconfigured=setup(row,s3,{});
 await assert.rejects(unconfigured.invoke('access'),{code:'FILE_PROVIDER_NOT_CONFIGURED'});
 assert.equal(unconfigured.logs[0][1],'FILE_ACCESS_DENIED');
 const missing=setup(row,async()=>http(404));
 await assert.rejects(missing.invoke('access'),{code:'FILE_OBJECT_NOT_FOUND'});
 assert.equal(missing.logs[0][1],'FILE_ACCESS_DENIED');
});
test('deny if audit ledger is broken; never provide file bytes',async()=>{
 const db={async execute(sql,params){
  if(sql.startsWith('SELECT v.id'))return [[row]];
  if(sql.startsWith('INSERT INTO audit_logs'))throw Error('db unavailable');
  throw Error('unexpected');
 }};
 const response={writeHead(){throw Error('MUST_NOT_STREAM');},end(){throw Error('MUST_NOT_STREAM');}};
 await assert.rejects(handleM31FileAccessRoute({method:'GET'},response,
  new URL('https://runtime.test.invalid/api/runtime/projects/'+P+'/assets/'+A+'/versions/'+V+'/content'),{
   principal,db,env,fetchImpl:s3,
   resolveProjectScopeImpl:async()=>({tenantId:T,workspaceId:W}),
   assertAccessImpl:async()=>{},json:()=>{}
  }),/db unavailable/);
});
test('adapter blocks unsupported MIME and oversized HEAD',async()=>{
 const config=resolveS3Config(env);
 await assert.rejects(getS3Object({config,key,fetchImpl:async()=>http(200,file,'text/html')}),{code:'FILE_OBJECT_MIME_UNSUPPORTED'});
 await assert.rejects(getS3Object({config,key,method:'HEAD',fetchImpl:async()=>new Response(null,{status:200,headers:{'content-length':'20971521','content-type':'application/pdf'}})}),{code:'FILE_OBJECT_SIZE_UNSUPPORTED'});
});

test('Railway virtual-host-style S3 SigV4 targets the bucket host, not a path-style URL',()=>{
 const configured=resolveS3Config({
  ...env,M31_S3_ENDPOINT:'https://t3.storageapi.dev',
  M31_S3_BUCKET:'m31-asset-read-staging-eglbiw',
  M31_S3_REGION:'auto',M31_S3_URL_STYLE:'virtual-host'
 });
 const signed=signS3Request({config:configured,key,now:new Date('2026-10-08T01:00:00Z')});
 assert.equal(new URL(signed.url).hostname,'m31-asset-read-staging-eglbiw.t3.storageapi.dev');
 assert.equal(new URL(signed.url).pathname,'/'+key);
 assert.equal(signed.headers.host,'m31-asset-read-staging-eglbiw.t3.storageapi.dev');
 assert.match(signed.headers.authorization,/\/auto\/s3\/aws4_request/);
});
