// Manual, staging-only acceptance fixture. Never invoked by normal migrations.
import {createHash,createHmac} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {getRuntimePool} from '../src/runtime-db.mjs';
import {resolveS3Config,getS3Object} from '../src/m31-s3-readonly.mjs';

const envId='fc068d5a-6664-42df-8bae-c84cbc569601';
if(process.argv[2]!=='--staging-rc1'||process.env.RAILWAY_ENVIRONMENT_ID!==envId)
  throw new Error('STAGING_FIXTURE_SCOPE_REQUIRED');
const projectId='31a642c1-e0ee-4e36-a799-44ac50a825b1';
const workspaceId='00000000-0000-4000-8000-000000000102';
const tenantId='00000000-0000-4000-8000-000000000101';
const libraryId='a3110000-0000-4000-8000-000000000001';
const assetId='a3110000-0000-4000-8000-000000000002';
const versionId='a3110000-0000-4000-8000-000000000003';
const bytes=Buffer.from('AI Native staging download acceptance fixture. Test data only.\n');
const hex=x=>createHash('sha256').update(x).digest('hex');
const hmac=(k,v,e)=>createHmac('sha256',k).update(v).digest(e);
const fingerprint=hex(bytes);
const key=[tenantId,workspaceId,projectId,assetId,versionId,'staging-download-test.txt'].join('/');
const db=getRuntimePool();
let connection;
try {
  const [projects]=await db.query('SELECT project_key,workspace_id FROM projects WHERE id=?',[projectId]);
  if(projects.length!==1||projects[0].workspace_id!==workspaceId||!projects[0].project_key.startsWith('rc1-staging-smoke-'))
    throw new Error('STAGING_FIXTURE_PROJECT_MISMATCH');
  const [workspaces]=await db.query('SELECT tenant_id FROM workspaces WHERE id=?',[workspaceId]);
  if(workspaces[0]?.tenant_id!==tenantId)throw new Error('STAGING_FIXTURE_TENANT_MISMATCH');
  const config=resolveS3Config();
  let object;
  try {object=await getS3Object({config,key,maxBytes:1024});}
  catch(error){if(error.code!=='FILE_OBJECT_NOT_FOUND')throw error;}
  if(object&&object.sha256!==fingerprint)throw new Error('STAGING_FIXTURE_OBJECT_COLLISION');
  if(!object){
    const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,'');
    const date=stamp.slice(0,8),virtual=config.urlStyle==='virtual-host';
    const host=virtual?config.bucket+'.'+config.endpoint.host:config.endpoint.host;
    const path=(virtual?'':'/'+config.bucket)+'/'+key;
    const canonicalHeaders='host:'+host+'\nx-amz-content-sha256:'+fingerprint+'\nx-amz-date:'+stamp+'\n';
    const signedHeaders='host;x-amz-content-sha256;x-amz-date';
    const canonical=['PUT',path,'',canonicalHeaders,signedHeaders,fingerprint].join('\n');
    const scope=date+'/'+config.region+'/s3/aws4_request';
    const signingKey=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,date),config.region),'s3'),'aws4_request');
    const signature=hmac(signingKey,['AWS4-HMAC-SHA256',stamp,scope,hex(canonical)].join('\n'),'hex');
    const response=await fetch(config.endpoint.protocol+'//'+host+path,{
      method:'PUT',redirect:'error',signal:AbortSignal.timeout(12000),body:bytes,
      headers:{'content-type':'text/plain','if-none-match':'*','x-amz-content-sha256':fingerprint,'x-amz-date':stamp,
        authorization:'AWS4-HMAC-SHA256 Credential='+config.accessKey+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature}
    });
    if(!response.ok)throw new Error('STAGING_FIXTURE_UPLOAD_FAILED_'+response.status);
  }
  object=await getS3Object({config,key,maxBytes:1024});
  if(object.sha256!==fingerprint)throw new Error('STAGING_FIXTURE_HASH_MISMATCH');
  await getS3Object({config,key,method:'HEAD',maxBytes:1024});
  const usage={allowedProjectIds:[projectId]},rights={fileReadAllowed:true,releaseApproved:true};
  const evidence={testOnly:true,purpose:'staging-download-acceptance',sha256:fingerprint};
  const tables=[
    ['aigc_asset_libraries',libraryId,{workspace_id:workspaceId,owner_project_id:projectId,library_key:'rc1-download-acceptance',display_name:'预发下载验收测试库',library_scope:'PROJECT',permission_policy_json:rights,rights_policy_json:rights,usage_scope_json:usage,version_policy_json:{},status:'ACTIVE',evidence_json:evidence}],
    ['aigc_assets',assetId,{workspace_id:workspaceId,owner_project_id:projectId,library_id:libraryId,asset_key:'rc1-download-acceptance-test',asset_type:'DOCUMENT',display_name:'预发下载验收测试文件（非正式资产）',purpose_json:{testOnly:true},source_of_truth_json:{fixture:true},upstream_source_json:{},only_variable_json:{},rights_json:rights,usage_scope_json:usage,status:'CURRENT',evidence_json:evidence}],
    ['aigc_asset_versions',versionId,{workspace_id:workspaceId,owner_project_id:projectId,asset_id:assetId,version_key:'rc1-download-test-v1',version_no:1,content_locator_json:{provider:'S3_COMPATIBLE',objectKey:key,filename:'staging-download-test.txt',mimeType:'text/plain'},output_spec_json:{sizeBytes:bytes.length},required_views_json:[],fingerprint_sha256:fingerprint,state:'CURRENT',qa_result_json:{status:'PASS',testOnly:true,verification:'S3 GET SHA256 and HEAD'},evidence_json:evidence}]
  ];
  connection=await db.getConnection();await connection.beginTransaction();
  for(const [table,id,data] of tables){
    const [existing]=await connection.query('SELECT * FROM '+table+' WHERE id=? FOR UPDATE',[id]);
    if(existing.length){
      for(const [column,value] of Object.entries(data)){
        let actual=existing[0][column];
        if(column.endsWith('_json')){if(typeof actual==='string')actual=JSON.parse(actual);
          if(!isDeepStrictEqual(actual,value))throw new Error('STAGING_FIXTURE_ROW_COLLISION');
        }else if(actual!==value)throw new Error('STAGING_FIXTURE_ROW_COLLISION');
      }
      continue;
    }
    const columns=['id',...Object.keys(data)],values=[id,...Object.values(data).map(v=>typeof v==='object'?JSON.stringify(v):v)];
    await connection.query('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',values);
  }
  await connection.commit();
  console.log(JSON.stringify({status:'PASS',testOnly:true,projectId,assetId,versionId,sha256:fingerprint,sizeBytes:bytes.length}));
}catch(error){if(connection)await connection.rollback();console.error(error.code||error.message);process.exitCode=1;}
finally{if(connection)connection.release();await db.end();}
