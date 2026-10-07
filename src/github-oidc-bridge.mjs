import { createHash,createPublicKey,verify as verifySignature } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { fireTrigger,completeTriggerDispatch,getTriggerFire } from './trigger-runtime.mjs';

const DEFAULT_ISSUER='https://token.actions.githubusercontent.com';
const DEFAULT_CONFIG_URL=DEFAULT_ISSUER+'/.well-known/openid-configuration';
const DEFAULT_AUDIENCE='ai-native-runtime-staging-bridge';
const DEFAULT_REPOSITORY='zhangxiaomeng880-ui/department-registration-backend';
const DEFAULT_REF='refs/heads/runtime-bridge-receipts';
const DEFAULT_WORKFLOW_REF=
  DEFAULT_REPOSITORY+'/.github/workflows/runtime-bridge-receipt-staging.yml@'+DEFAULT_REF;
const ALLOWED_TRIGGER='TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN';
const ALLOWED_PROJECT_KEY='novel-hello-that-summer';

const errorOf=(message,code,statusCode=400,details)=>{
  const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e;
};
const b64url=value=>Buffer.from(String(value).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value).length/4)*4,'='),'base64');
const parseJson=value=>{
  if(value==null)return null;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return null;}
};
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  }
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stable(value)),'utf8'
).digest('hex');

let oidcCache={expiresAt:0,jwksUri:null,keys:null};
const getOidcKeys=async()=>{
  const now=Date.now();
  if(oidcCache.keys&&oidcCache.expiresAt>now)return oidcCache;
  const configUrl=process.env.GITHUB_OIDC_CONFIG_URL||DEFAULT_CONFIG_URL;
  const configResponse=await fetch(configUrl,{signal:AbortSignal.timeout(5000)});
  if(!configResponse.ok)throw errorOf('GitHub OIDC discovery failed','GITHUB_OIDC_DISCOVERY_FAILED',503);
  const config=await configResponse.json();
  if(!config?.jwks_uri)throw errorOf('GitHub OIDC discovery is missing jwks_uri','GITHUB_OIDC_DISCOVERY_INVALID',503);
  const jwksResponse=await fetch(config.jwks_uri,{signal:AbortSignal.timeout(5000)});
  if(!jwksResponse.ok)throw errorOf('GitHub OIDC JWKS fetch failed','GITHUB_OIDC_JWKS_FAILED',503);
  const jwks=await jwksResponse.json();
  if(!Array.isArray(jwks?.keys))throw errorOf('GitHub OIDC JWKS is invalid','GITHUB_OIDC_JWKS_INVALID',503);
  oidcCache={expiresAt:now+10*60*1000,jwksUri:config.jwks_uri,keys:jwks.keys};
  return oidcCache;
};

const audienceMatches=(aud,expected)=>
  Array.isArray(aud)?aud.includes(expected):aud===expected;

export const verifyGithubOidcToken=async token=>{
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw errorOf('GitHub OIDC token is malformed','GITHUB_OIDC_INVALID',401);
  let header,claims;
  try{
    header=JSON.parse(b64url(parts[0]).toString('utf8'));
    claims=JSON.parse(b64url(parts[1]).toString('utf8'));
  }catch{
    throw errorOf('GitHub OIDC token is malformed','GITHUB_OIDC_INVALID',401);
  }
  if(header.alg!=='RS256'||!header.kid)throw errorOf('GitHub OIDC algorithm is not allowed','GITHUB_OIDC_ALG_DENIED',401);
  const keys=await getOidcKeys();
  const jwk=keys.keys.find(key=>key.kid===header.kid&&key.kty==='RSA');
  if(!jwk)throw errorOf('GitHub OIDC signing key is unknown','GITHUB_OIDC_KID_UNKNOWN',401);
  const key=createPublicKey({key:jwk,format:'jwk'});
  const verified=verifySignature(
    'RSA-SHA256',
    Buffer.from(parts[0]+'.'+parts[1],'utf8'),
    key,
    b64url(parts[2])
  );
  if(!verified)throw errorOf('GitHub OIDC signature is invalid','GITHUB_OIDC_SIGNATURE_INVALID',401);

  const now=Math.floor(Date.now()/1000),skew=60;
  const expectedIssuer=process.env.GITHUB_OIDC_EXPECTED_ISSUER||DEFAULT_ISSUER;
  const expectedAudience=process.env.GITHUB_OIDC_AUDIENCE||DEFAULT_AUDIENCE;
  const expectedRepository=process.env.GITHUB_OIDC_EXPECTED_REPOSITORY||DEFAULT_REPOSITORY;
  const expectedRef=process.env.GITHUB_OIDC_EXPECTED_REF||DEFAULT_REF;
  const expectedWorkflowRef=process.env.GITHUB_OIDC_EXPECTED_WORKFLOW_REF||DEFAULT_WORKFLOW_REF;

  if(claims.iss!==expectedIssuer)throw errorOf('GitHub OIDC issuer mismatch','GITHUB_OIDC_ISSUER_MISMATCH',401);
  if(!audienceMatches(claims.aud,expectedAudience))throw errorOf('GitHub OIDC audience mismatch','GITHUB_OIDC_AUDIENCE_MISMATCH',401);
  if(!claims.exp||Number(claims.exp)<now-skew)throw errorOf('GitHub OIDC token expired','GITHUB_OIDC_EXPIRED',401);
  if(claims.nbf&&Number(claims.nbf)>now+skew)throw errorOf('GitHub OIDC token is not active','GITHUB_OIDC_NOT_ACTIVE',401);
  if(claims.iat&&Number(claims.iat)>now+skew)throw errorOf('GitHub OIDC issued-at is invalid','GITHUB_OIDC_IAT_INVALID',401);
  if(claims.repository!==expectedRepository)throw errorOf('GitHub OIDC repository mismatch','GITHUB_OIDC_REPOSITORY_MISMATCH',403);
  if(claims.ref!==expectedRef)throw errorOf('GitHub OIDC ref mismatch','GITHUB_OIDC_REF_MISMATCH',403);
  if(claims.workflow_ref!==expectedWorkflowRef)throw errorOf('GitHub OIDC workflow mismatch','GITHUB_OIDC_WORKFLOW_MISMATCH',403);
  if(claims.event_name!=='push')throw errorOf('GitHub OIDC event is not allowed','GITHUB_OIDC_EVENT_DENIED',403);
  return claims;
};

const outputKeys=new Set([
  'status','updatedChapters','reusedPassChapters','gateStatus',
  'checkpointPath','resumePoint','blockingReason'
]);
const validateMetadataOnly=value=>{
  if(value==null)return null;
  const encoded=JSON.stringify(value);
  if(encoded.length>16384)throw errorOf('Bridge evidence is too large','BRIDGE_EVIDENCE_TOO_LARGE',400);
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      if(/(?:^|_)(?:content|body|text|raw|source_body|chapter_text)(?:$|_)/i.test(key)){
        throw errorOf(
          'Bridge payload must not contain source bodies or generated prose',
          'BRIDGE_SOURCE_BODY_NOT_ALLOWED',400,{field:key}
        );
      }
      visit(child);
    }
  };
  visit(value);
  return value;
};
const validateReceipt=receipt=>{
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw errorOf('Receipt must be an object','INVALID_EXTERNAL_BRIDGE_RECEIPT');
  const required=['schemaVersion','receiptId','projectKey','triggerKey','output'];
  const missing=required.filter(key=>receipt[key]==null||receipt[key]==='');
  if(missing.length)throw errorOf('Receipt is missing required fields','INVALID_EXTERNAL_BRIDGE_RECEIPT',400,{missing});
  if(receipt.schemaVersion!=='1.0')throw errorOf('Receipt schemaVersion is unsupported','EXTERNAL_BRIDGE_SCHEMA_UNSUPPORTED',409);
  if(receipt.projectKey!==ALLOWED_PROJECT_KEY)throw errorOf('Receipt project is not allowed','EXTERNAL_BRIDGE_PROJECT_DENIED',403);
  if(receipt.triggerKey!==ALLOWED_TRIGGER)throw errorOf('Receipt trigger is not allowed','EXTERNAL_BRIDGE_TRIGGER_DENIED',403);
  if(typeof receipt.receiptId!=='string'||receipt.receiptId.length>191)throw errorOf('receiptId is invalid','INVALID_EXTERNAL_BRIDGE_RECEIPT');
  if(receipt.scheduledFireTime&&Number.isNaN(new Date(receipt.scheduledFireTime).getTime()))throw errorOf('scheduledFireTime is invalid','INVALID_EXTERNAL_BRIDGE_RECEIPT');
  if(!receipt.output||typeof receipt.output!=='object'||Array.isArray(receipt.output))throw errorOf('Receipt output is invalid','INVALID_EXTERNAL_BRIDGE_RECEIPT');
  const unknown=Object.keys(receipt.output).filter(key=>!outputKeys.has(key));
  if(unknown.length)throw errorOf('Receipt output contains disallowed fields','BRIDGE_SOURCE_BODY_NOT_ALLOWED',400,{fields:unknown});
  for(const key of ['status','gateStatus','checkpointPath']){
    if(typeof receipt.output[key]!=='string'||!receipt.output[key].trim())throw errorOf('Receipt output is missing status metadata','INVALID_EXTERNAL_BRIDGE_RECEIPT',400,{field:key});
  }
  for(const key of ['updatedChapters','reusedPassChapters']){
    if(receipt.output[key]!=null&&(!Array.isArray(receipt.output[key])||receipt.output[key].some(x=>typeof x!=='string'))){
      throw errorOf('Receipt chapter lists must contain strings','INVALID_EXTERNAL_BRIDGE_RECEIPT',400,{field:key});
    }
  }
  validateMetadataOnly(receipt.output);
  validateMetadataOnly(receipt.evidence||null);
  if(receipt.errorMessage!=null&&String(receipt.errorMessage).length>1000)throw errorOf('Receipt errorMessage is too large','INVALID_EXTERNAL_BRIDGE_RECEIPT');
  return {
    schemaVersion:'1.0',
    receiptId:receipt.receiptId,
    projectKey:receipt.projectKey,
    triggerKey:receipt.triggerKey,
    scheduledFireTime:receipt.scheduledFireTime||null,
    outcome:receipt.outcome==='FAIL'?'FAIL':'PASS',
    output:{
      status:receipt.output.status,
      updatedChapters:receipt.output.updatedChapters||[],
      reusedPassChapters:receipt.output.reusedPassChapters||[],
      gateStatus:receipt.output.gateStatus,
      checkpointPath:receipt.output.checkpointPath,
      resumePoint:receipt.output.resumePoint??null,
      blockingReason:receipt.output.blockingReason??null
    },
    evidence:receipt.evidence||null,
    errorCode:receipt.errorCode||null,
    errorMessage:receipt.errorMessage||null
  };
};

const publicClaims=claims=>({
  repository:claims.repository,
  ref:claims.ref,
  workflowRef:claims.workflow_ref,
  runId:String(claims.run_id||''),
  runAttempt:String(claims.run_attempt||''),
  actor:claims.actor||null,
  eventName:claims.event_name,
  sha:claims.sha||null
});

export const ingestGithubBridgeReceipt=async(receiptInput,claims)=>{
  const receipt=validateReceipt(receiptInput);
  const db=getRuntimePool();
  const payloadSha256=sha256(receipt);
  const [projects]=await db.execute(
    "SELECT id FROM projects WHERE project_key=? AND project_type='AIGC_CONTENT' AND status='ACTIVE' LIMIT 1",
    [receipt.projectKey]
  );
  if(!projects.length)throw errorOf('Runtime project for external receipt was not found','EXTERNAL_BRIDGE_PROJECT_NOT_FOUND',404);
  const projectId=projects[0].id;

  const [existing]=await db.execute('SELECT * FROM external_bridge_receipts WHERE receipt_id=?',[receipt.receiptId]);
  if(existing.length){
    const row=existing[0];
    if(row.payload_sha256!==payloadSha256)throw errorOf(
      'Receipt id was reused with a different payload',
      'EXTERNAL_BRIDGE_RECEIPT_CONFLICT',409,{receiptId:receipt.receiptId}
    );
    if(row.status==='PASS'||row.status==='FAIL'){
      return {
        receiptId:row.receipt_id,status:row.status,idempotent:true,
        triggerFireId:row.trigger_fire_id||null,
        triggerDispatchId:row.trigger_dispatch_id||null,
        capabilityInvocationId:row.capability_invocation_id||null,
        result:parseJson(row.result_json)
      };
    }
    await db.execute(
      'UPDATE external_bridge_receipts SET attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP(6) WHERE receipt_id=?',
      [receipt.receiptId]
    );
  }else{
    const pc=publicClaims(claims);
    await db.execute(
      `INSERT INTO external_bridge_receipts (
        receipt_id,source_type,repository,git_ref,workflow_ref,github_run_id,github_run_attempt,
        github_actor,project_id,trigger_key,scheduled_fire_time,payload_sha256,status,oidc_claims_json
      ) VALUES (?,'GITHUB_OIDC',?,?,?,?,?,?,?,?,?,?,'PROCESSING',?)`,
      [
        receipt.receiptId,pc.repository,pc.ref,pc.workflowRef,pc.runId||null,pc.runAttempt||null,
        pc.actor,projectId,receipt.triggerKey,
        receipt.scheduledFireTime?new Date(receipt.scheduledFireTime):null,
        payloadSha256,JSON.stringify(pc)
      ]
    );
  }

  let fire;
  try{
    fire=await fireTrigger({
      triggerKey:receipt.triggerKey,
      projectId,
      allowDisabledShadow:true,
      scheduledFireTime:receipt.scheduledFireTime,
      dedupeKey:'github-receipt:'+receipt.receiptId,
      triggerReason:'GITHUB_OIDC_EXTERNAL_EXECUTOR_RECEIPT'
    });
    const fireState=await getTriggerFire(fire.id);
    const dispatchId=fireState.result?.dispatchId||fire.result?.dispatchId||null;
    if(!dispatchId)throw errorOf('Bridge dispatch was not created','EXTERNAL_BRIDGE_DISPATCH_MISSING',409);

    const completion=await completeTriggerDispatch(dispatchId,{
      status:receipt.outcome,
      output:receipt.output,
      evidence:{
        ...(receipt.evidence||{}),
        externalExecutor:{
          type:'GITHUB_OIDC_RECEIPT',
          ...publicClaims(claims),
          receiptId:receipt.receiptId
        }
      },
      errorCode:receipt.errorCode,
      errorMessage:receipt.errorMessage
    });
    const finalFire=await getTriggerFire(fire.id);
    const status=receipt.outcome==='FAIL'?'FAIL':'PASS';
    await db.execute(
      `UPDATE external_bridge_receipts
          SET status=?,trigger_fire_id=?,trigger_dispatch_id=?,capability_invocation_id=?,
              result_json=?,error_code=?,error_message=?,completed_at=CURRENT_TIMESTAMP(6),
              updated_at=CURRENT_TIMESTAMP(6)
        WHERE receipt_id=?`,
      [
        status,fire.id,dispatchId,fire.capabilityInvocationId||fireState.capabilityInvocationId||null,
        JSON.stringify({fire:finalFire,completion}),receipt.errorCode,receipt.errorMessage,receipt.receiptId
      ]
    );
    return {
      receiptId:receipt.receiptId,status,idempotent:false,
      triggerFireId:fire.id,triggerDispatchId:dispatchId,
      capabilityInvocationId:fire.capabilityInvocationId||fireState.capabilityInvocationId||null,
      fire:finalFire
    };
  }catch(error){
    await db.execute(
      `UPDATE external_bridge_receipts
          SET status='ERROR',error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP(6)
        WHERE receipt_id=?`,
      [error.code||'EXTERNAL_BRIDGE_RECEIPT_ERROR',String(error.message||'').slice(0,4000),receipt.receiptId]
    ).catch(()=>{});
    throw error;
  }
};

export const handleGithubOidcBridgeRoute=async(req,res,url,{json,readBody})=>{
  if(req.method!=='POST'||url.pathname!=='/api/external/bridge/github-receipts')return false;
  const header=String(req.headers.authorization||'');
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  if(!token)throw errorOf('GitHub OIDC bearer token is required','GITHUB_OIDC_REQUIRED',401);
  const claims=await verifyGithubOidcToken(token);
  const result=await ingestGithubBridgeReceipt(await readBody(req),claims);
  json(res,result.idempotent?200:201,{data:result});
  return true;
};
