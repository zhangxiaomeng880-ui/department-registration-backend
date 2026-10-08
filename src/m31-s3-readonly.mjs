// M31.5: small-object read-only S3 adapter, built-in SigV4; no client credentials.
// All object identities come from a DB-bound asset version and a fixed server config.
import { createHmac, createHash } from 'node:crypto';

const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const hex=buffer=>createHash('sha256').update(buffer).digest('hex');
const hmac=(key,value,encoding)=>createHmac('sha256',key).update(value).digest(encoding);
const permittedMimes=new Set([
 'image/png','image/jpeg','image/webp','application/pdf','text/plain',
 'application/json','audio/mpeg','audio/wav','video/mp4','application/octet-stream'
]);
const keySegment=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
const pathEncoded=key=>key.split('/').map(keySegment).join('/');

export const resolveS3Config=(env=process.env)=>{
 const required=['M31_S3_ENDPOINT','M31_S3_REGION','M31_S3_BUCKET','M31_S3_ACCESS_KEY_ID','M31_S3_SECRET_ACCESS_KEY'];
 if(required.some(k=>!env[k]))throw fail('FILE_PROVIDER_NOT_CONFIGURED',503);
 let endpoint;
 try{endpoint=new URL(env.M31_S3_ENDPOINT);}catch{throw fail('FILE_PROVIDER_INVALID_ENDPOINT',503);}
 if(endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||
    endpoint.pathname!=='/'||endpoint.search||endpoint.hash)
   throw fail('FILE_PROVIDER_INVALID_ENDPOINT',503);
 if(!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(env.M31_S3_BUCKET)||
    !/^[a-z0-9-]{2,24}$/.test(env.M31_S3_REGION))
   throw fail('FILE_PROVIDER_INVALID_CONFIG',503);
 return {
  endpoint,region:env.M31_S3_REGION,bucket:env.M31_S3_BUCKET,
  accessKey:env.M31_S3_ACCESS_KEY_ID,secretKey:env.M31_S3_SECRET_ACCESS_KEY
 };
};

export const signS3Request=({config,key,method='GET',now=new Date()})=>{
 if(!['HEAD','GET'].includes(method))throw fail('FILE_METHOD_NOT_ALLOWED',405);
 if(typeof key!=='string'||!key||key.startsWith('/')||key.includes('\\')||
   key.split('/').some(segment=>!segment||segment==='.'||segment==='..'||/[\x00-\x1f\x7f]/.test(segment)))
   throw fail('FILE_INVALID_OBJECT_KEY',409);
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
 const date=stamp.slice(0,8);
 const path='/'+keySegment(config.bucket)+'/'+pathEncoded(key);
 const host=config.endpoint.host;
 const bodyHash=hex('');
 const canonicalHeaders='host:'+host+'\n'+'x-amz-content-sha256:'+bodyHash+'\n'+'x-amz-date:'+stamp+'\n';
 const signedHeaders='host;x-amz-content-sha256;x-amz-date';
 const canonical=[method,path,'',canonicalHeaders,signedHeaders,bodyHash].join('\n');
 const scope=date+'/'+config.region+'/s3/aws4_request';
 const toSign=['AWS4-HMAC-SHA256',stamp,scope,hex(canonical)].join('\n');
 const signingKey=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,date),config.region),'s3'),'aws4_request');
 const signature=hmac(signingKey,toSign,'hex');
 return {
  url:config.endpoint.origin+path,
  headers:{
   'host':host,'x-amz-content-sha256':bodyHash,'x-amz-date':stamp,
   authorization:'AWS4-HMAC-SHA256 Credential='+config.accessKey+'/'+scope+
     ', SignedHeaders='+signedHeaders+', Signature='+signature
  }
 };
};

export const getS3Object=async({config,key,method='GET',fetchImpl=fetch,maxBytes=20*1024*1024})=>{
 const signed=signS3Request({config,key,method});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetchImpl(signed.url,{
   method,headers:signed.headers,signal:controller.signal,redirect:'error'
  });
  if(response.status===404)throw fail('FILE_OBJECT_NOT_FOUND',404);
  if(response.status===401||response.status===403)throw fail('FILE_PROVIDER_ACCESS_DENIED',503);
  if(!response.ok)throw fail('FILE_PROVIDER_UNAVAILABLE',503);
  const sizeHeader=response.headers.get('content-length');
  const size=sizeHeader==null?null:Number(sizeHeader);
  if(size!==null&&(!Number.isFinite(size)||size<0||size>maxBytes))throw fail('FILE_OBJECT_SIZE_UNSUPPORTED',413);
  const contentType=(response.headers.get('content-type')||'application/octet-stream').split(';')[0].trim().toLowerCase();
  if(!permittedMimes.has(contentType))throw fail('FILE_OBJECT_MIME_UNSUPPORTED',415);
  if(method==='HEAD')return {sizeBytes:size,contentType};
  // Bounded read. Response bodies larger than the head declaration are refused
  // after read; request cancellation and the 12s deadline limit resource use.
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>maxBytes)throw fail('FILE_OBJECT_SIZE_UNSUPPORTED',413);
  return {sizeBytes:bytes.length,contentType,bytes,sha256:hex(bytes)};
 }catch(e){
  if(e.name==='AbortError')throw fail('FILE_PROVIDER_TIMEOUT',503);
  if(e.code)throw e;
  throw fail('FILE_PROVIDER_UNAVAILABLE',503);
 }finally{clearTimeout(timer);}
};
