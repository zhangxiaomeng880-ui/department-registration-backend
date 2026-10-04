import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const REPLAY_CONTRACT_VERSION='eval-replay-v1';
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const sha40=/^[a-f0-9]{40}$/i;
const sha64=/^[a-f0-9]{64}$/i;
const allowedAssertionKeys=new Set(['structuredOutput','evidence','router','execution']);
const allowedSourceRefKeys=new Set([
  'sourceFileId','sourceVersion','lineStart','lineEnd','contentSha256','contextRole','sourceProvider'
]);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const stableValue=value=>{
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
};
const stableJson=value=>JSON.stringify(stableValue(value));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:stableJson(value),'utf8').digest('hex');
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf(
        'Eval fixtures must not persist credentials or secrets','EVAL_SECRET_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(value);
};
const validateReplayInput=input=>{
  if(!input||typeof input!=='object'||Array.isArray(input)) throw errorOf('replayInput must be an object','INVALID_EVAL_REPLAY_INPUT');
  if(!input.projectType||!input.taskType||typeof input.query!=='string'||!input.query.trim()){
    throw errorOf('replayInput requires projectType, taskType and a non-empty synthetic query','INVALID_EVAL_REPLAY_INPUT');
  }
  const forbidden=['sourceBody','sourceText','source_text','retrievedText','retrieved_text','documentBody','document_body','rawSource','raw_source','snippet'];
  const visit=(node,path='replayInput')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=`${path}.${key}`;
      if(forbidden.includes(key)) throw errorOf(
        'Private source bodies are not allowed in eval replay fixtures','EVAL_SOURCE_BODY_NOT_ALLOWED',400,{field:next}
      );
      visit(child,next);
    }
  };
  visit(input);
  rejectSecrets(input);
};
const validateSourceRefs=sourceRefs=>{
  if(sourceRefs==null) return [];
  if(!Array.isArray(sourceRefs)) throw errorOf('sourceRefs must be an array','INVALID_EVAL_SOURCE_REFS');
  return sourceRefs.map((ref,index)=>{
    if(!ref||typeof ref!=='object'||Array.isArray(ref)) throw errorOf('Each sourceRef must be an object','INVALID_EVAL_SOURCE_REF',400,{index});
    for(const key of Object.keys(ref)){
      if(!allowedSourceRefKeys.has(key)) throw errorOf(
        'sourceRefs may contain references and hashes only','EVAL_SOURCE_BODY_NOT_ALLOWED',400,{index,field:key}
      );
    }
    if(!ref.sourceFileId||!sha64.test(ref.contentSha256||'')) throw errorOf(
      'sourceRef requires sourceFileId and a SHA-256 contentSha256','INVALID_EVAL_SOURCE_REF',400,{index}
    );
    if(ref.lineStart!=null&&(!Number.isInteger(Number(ref.lineStart))||Number(ref.lineStart)<1)) throw errorOf('lineStart must be a positive integer','INVALID_EVAL_SOURCE_REF',400,{index});
    if(ref.lineEnd!=null&&(!Number.isInteger(Number(ref.lineEnd))||Number(ref.lineEnd)<1)) throw errorOf('lineEnd must be a positive integer','INVALID_EVAL_SOURCE_REF',400,{index});
    if(ref.lineStart!=null&&ref.lineEnd!=null&&Number(ref.lineEnd)<Number(ref.lineStart)) throw errorOf('lineEnd cannot be before lineStart','INVALID_EVAL_SOURCE_REF',400,{index});
    return {
      sourceFileId:String(ref.sourceFileId),
      sourceVersion:ref.sourceVersion==null?null:String(ref.sourceVersion),
      lineStart:ref.lineStart==null?null:Number(ref.lineStart),
      lineEnd:ref.lineEnd==null?null:Number(ref.lineEnd),
      contentSha256:String(ref.contentSha256).toLowerCase(),
      contextRole:ref.contextRole==null?null:String(ref.contextRole),
      sourceProvider:ref.sourceProvider==null?null:String(ref.sourceProvider)
    };
  });
};
const validateAssertions=assertions=>{
  if(!assertions||typeof assertions!=='object'||Array.isArray(assertions)) throw errorOf('assertions must be an object','INVALID_EVAL_ASSERTIONS');
  const keys=Object.keys(assertions);
  if(!keys.length) throw errorOf('At least one assertion group is required','INVALID_EVAL_ASSERTIONS');
  for(const key of keys){
    if(!allowedAssertionKeys.has(key)) throw errorOf('Unsupported assertion group','INVALID_EVAL_ASSERTIONS',400,{group:key});
  }
  if(assertions.structuredOutput){
    const s=assertions.structuredOutput;
    if(typeof s!=='object'||Array.isArray(s)) throw errorOf('structuredOutput assertion must be an object','INVALID_EVAL_ASSERTIONS');
    if(s.requiredKeys&&!Array.isArray(s.requiredKeys)) throw errorOf('structuredOutput.requiredKeys must be an array','INVALID_EVAL_ASSERTIONS');
    if(s.jsonSchemaSha256&&!sha64.test(s.jsonSchemaSha256)) throw errorOf('structuredOutput.jsonSchemaSha256 must be SHA-256','INVALID_EVAL_ASSERTIONS');
  }
  if(assertions.evidence){
    const e=assertions.evidence;
    if(typeof e!=='object'||Array.isArray(e)) throw errorOf('evidence assertion must be an object','INVALID_EVAL_ASSERTIONS');
    if(e.minCount!=null&&(!Number.isInteger(Number(e.minCount))||Number(e.minCount)<0)) throw errorOf('evidence.minCount must be a non-negative integer','INVALID_EVAL_ASSERTIONS');
    if(e.allowedSourceFileIds&&!Array.isArray(e.allowedSourceFileIds)) throw errorOf('evidence.allowedSourceFileIds must be an array','INVALID_EVAL_ASSERTIONS');
  }
  if(assertions.router){
    const r=assertions.router;
    if(typeof r!=='object'||Array.isArray(r)) throw errorOf('router assertion must be an object','INVALID_EVAL_ASSERTIONS');
    if(r.policyResult&&!['ALLOW','BLOCK'].includes(String(r.policyResult).toUpperCase())) throw errorOf('router.policyResult must be ALLOW or BLOCK','INVALID_EVAL_ASSERTIONS');
  }
  if(assertions.execution){
    const x=assertions.execution;
    if(typeof x!=='object'||Array.isArray(x)) throw errorOf('execution assertion must be an object','INVALID_EVAL_ASSERTIONS');
    if(x.maxDurationMs!=null&&!(Number(x.maxDurationMs)>=0)) throw errorOf('execution.maxDurationMs must be non-negative','INVALID_EVAL_ASSERTIONS');
    if(x.maxEstimatedCost!=null&&!(Number(x.maxEstimatedCost)>=0)) throw errorOf('execution.maxEstimatedCost must be non-negative','INVALID_EVAL_ASSERTIONS');
  }
  rejectSecrets(assertions);
};
const normalizeSuite=row=>({
  id:row.id,suiteKey:row.suite_key,name:row.name,description:row.description||null,status:row.status,
  createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeVersion=row=>({
  id:row.id,suiteId:row.suite_id,versionNo:Number(row.version_no),status:row.status,
  replayContractVersion:row.replay_contract_version,fixtureSha256:row.fixture_sha256||null,
  caseCount:Number(row.case_count),frozenAt:row.frozen_at||null,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeCase=row=>({
  id:row.id,suiteVersionId:row.suite_version_id,caseKey:row.case_key,sequenceNo:Number(row.sequence_no),
  fixtureKind:row.fixture_kind,replayInput:row.replay_input_json,sourceRefs:row.source_refs_json||[],
  assertions:row.assertions_json,caseSha256:row.case_sha256,createdAt:row.created_at
});
const normalizeManifest=row=>({
  id:row.id,suiteVersionId:row.suite_version_id,candidateRuntimeSha:row.candidate_runtime_sha,
  baselineRuntimeSha:row.baseline_runtime_sha||null,workflowVersion:row.workflow_version||null,
  routerVersion:row.router_version||null,ragIndexVersion:row.rag_index_version||null,
  replayContractVersion:row.replay_contract_version,fixtureSha256:row.fixture_sha256,
  manifestSha256:row.manifest_sha256,status:row.status,idempotencyKey:row.idempotency_key,
  metadata:row.metadata_json,generatedAt:row.generated_at
});
const computeStoredCaseHash=row=>sha256({
  contractVersion:REPLAY_CONTRACT_VERSION,
  caseKey:row.case_key,
  sequenceNo:Number(row.sequence_no),
  fixtureKind:row.fixture_kind,
  replayInput:row.replay_input_json,
  sourceRefs:row.source_refs_json||[],
  assertions:row.assertions_json
});
const assertStoredCaseIntegrity=row=>{
  const actual=computeStoredCaseHash(row);
  if(actual!==row.case_sha256) throw errorOf(
    'Eval case content no longer matches its stored SHA-256','EVAL_CASE_INTEGRITY_MISMATCH',500,{caseKey:row.case_key}
  );
  return actual;
};

export const createEvalSuite=async({suiteKey,name,description=null}={})=>{
  if(!suiteKey||!name) throw errorOf('suiteKey and name are required','INVALID_EVAL_SUITE');
  const db=getRuntimePool(),id=randomUUID();
  await db.execute(
    'INSERT INTO eval_suites (id,suite_key,name,description,status) VALUES (?,?,?,?,\'ACTIVE\')',
    [id,String(suiteKey),String(name),description==null?null:String(description)]
  );
  const [rows]=await db.execute('SELECT * FROM eval_suites WHERE id=?',[id]);
  return normalizeSuite(rows[0]);
};

export const listEvalSuites=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute("SELECT * FROM eval_suites WHERE status='ACTIVE' ORDER BY suite_key,id");
  return rows.map(normalizeSuite);
};

export const createEvalSuiteVersion=async({suiteId,versionNo}={})=>{
  const parsed=Number(versionNo);
  if(!suiteId||!Number.isInteger(parsed)||parsed<1) throw errorOf('suiteId and positive integer versionNo are required','INVALID_EVAL_SUITE_VERSION');
  const db=getRuntimePool();
  const [suites]=await db.execute("SELECT id,status FROM eval_suites WHERE id=?",[suiteId]);
  if(!suites.length) throw errorOf('Eval suite not found','EVAL_SUITE_NOT_FOUND',404);
  if(suites[0].status!=='ACTIVE') throw errorOf('Eval suite is not active','EVAL_SUITE_NOT_ACTIVE',409);
  const id=randomUUID();
  await db.execute(
    `INSERT INTO eval_suite_versions
     (id,suite_id,version_no,status,replay_contract_version)
     VALUES (?,? ,?,'DRAFT',?)`,
    [id,suiteId,parsed,REPLAY_CONTRACT_VERSION]
  );
  const [rows]=await db.execute('SELECT * FROM eval_suite_versions WHERE id=?',[id]);
  return normalizeVersion(rows[0]);
};

export const addEvalCase=async({
  suiteVersionId,caseKey,sequenceNo,replayInput,sourceRefs=[],assertions
}={})=>{
  const seq=Number(sequenceNo);
  if(!suiteVersionId||!caseKey||!Number.isInteger(seq)||seq<1) throw errorOf(
    'suiteVersionId, caseKey and positive integer sequenceNo are required','INVALID_EVAL_CASE'
  );
  validateReplayInput(replayInput);
  const normalizedRefs=validateSourceRefs(sourceRefs);
  validateAssertions(assertions);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [versions]=await connection.execute('SELECT * FROM eval_suite_versions WHERE id=? FOR UPDATE',[suiteVersionId]);
    if(!versions.length) throw errorOf('Eval suite version not found','EVAL_SUITE_VERSION_NOT_FOUND',404);
    if(versions[0].status!=='DRAFT') throw errorOf('Frozen eval suite versions are immutable','EVAL_SUITE_VERSION_FROZEN',409);
    const material={
      contractVersion:REPLAY_CONTRACT_VERSION,caseKey:String(caseKey),sequenceNo:seq,fixtureKind:'SYNTHETIC',
      replayInput,sourceRefs:normalizedRefs,assertions
    };
    const caseHash=sha256(material),id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_cases
       (id,suite_version_id,case_key,sequence_no,fixture_kind,replay_input_json,source_refs_json,assertions_json,case_sha256)
       VALUES (?,?,?,?, 'SYNTHETIC',?,?,?,?)`,
      [id,suiteVersionId,String(caseKey),seq,JSON.stringify(replayInput),JSON.stringify(normalizedRefs),JSON.stringify(assertions),caseHash]
    );
    await connection.commit();
    const [rows]=await db.execute('SELECT * FROM eval_cases WHERE id=?',[id]);
    return normalizeCase(rows[0]);
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const getEvalSuiteVersion=async suiteVersionId=>{
  const db=getRuntimePool();
  const [versions]=await db.execute('SELECT * FROM eval_suite_versions WHERE id=?',[suiteVersionId]);
  if(!versions.length) throw errorOf('Eval suite version not found','EVAL_SUITE_VERSION_NOT_FOUND',404);
  const [cases]=await db.execute(
    'SELECT * FROM eval_cases WHERE suite_version_id=? ORDER BY sequence_no,case_key,id',[suiteVersionId]
  );
  for(const row of cases) assertStoredCaseIntegrity(row);
  return {...normalizeVersion(versions[0]),cases:cases.map(normalizeCase)};
};

export const freezeEvalSuiteVersion=async suiteVersionId=>{
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [versions]=await connection.execute('SELECT * FROM eval_suite_versions WHERE id=? FOR UPDATE',[suiteVersionId]);
    if(!versions.length) throw errorOf('Eval suite version not found','EVAL_SUITE_VERSION_NOT_FOUND',404);
    const version=versions[0];
    const [cases]=await connection.execute(
      'SELECT * FROM eval_cases WHERE suite_version_id=? ORDER BY sequence_no,case_key,id',[suiteVersionId]
    );
    if(!cases.length) throw errorOf('Cannot freeze an empty eval suite version','EVAL_SUITE_VERSION_EMPTY',409);
    for(const row of cases) assertStoredCaseIntegrity(row);
    const fixtureHash=sha256({
      replayContractVersion:version.replay_contract_version,
      cases:cases.map(row=>({caseKey:row.case_key,sequenceNo:Number(row.sequence_no),caseSha256:row.case_sha256}))
    });
    if(version.status==='FROZEN'){
      if(version.fixture_sha256!==fixtureHash||Number(version.case_count)!==cases.length){
        throw errorOf('Frozen eval fixture hash no longer matches stored cases','EVAL_FIXTURE_INTEGRITY_MISMATCH',500);
      }
      await connection.commit();
      return {...normalizeVersion(version),idempotent:true};
    }
    if(version.status!=='DRAFT') throw errorOf('Eval suite version cannot be frozen from current state','INVALID_EVAL_VERSION_STATE',409);
    await connection.execute(
      `UPDATE eval_suite_versions
       SET status='FROZEN',fixture_sha256=?,case_count=?,frozen_at=CURRENT_TIMESTAMP(6)
       WHERE id=?`,
      [fixtureHash,cases.length,suiteVersionId]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_suite_versions WHERE id=?',[suiteVersionId]);
    await connection.commit();
    return {...normalizeVersion(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const createEvalReplayManifest=async({
  suiteVersionId,candidateRuntimeSha,baselineRuntimeSha=null,workflowVersion=null,
  routerVersion=null,ragIndexVersion=null,idempotencyKey,metadata=null
}={})=>{
  if(!suiteVersionId||!sha40.test(candidateRuntimeSha||'')||!idempotencyKey) throw errorOf(
    'suiteVersionId, 40-char candidateRuntimeSha and idempotencyKey are required','INVALID_EVAL_REPLAY_MANIFEST'
  );
  if(baselineRuntimeSha&&!sha40.test(baselineRuntimeSha)) throw errorOf('baselineRuntimeSha must be a 40-char git SHA','INVALID_EVAL_REPLAY_MANIFEST');
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute(
      'SELECT * FROM eval_replay_manifests WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      const same=
        row.suite_version_id===suiteVersionId &&
        row.candidate_runtime_sha.toLowerCase()===candidateRuntimeSha.toLowerCase() &&
        (row.baseline_runtime_sha||null)===(baselineRuntimeSha?baselineRuntimeSha.toLowerCase():null) &&
        (row.workflow_version||null)===(workflowVersion||null) &&
        (row.router_version||null)===(routerVersion||null) &&
        (row.rag_index_version||null)===(ragIndexVersion||null);
      if(!same) throw errorOf(
        'Idempotency key was already used for a different replay manifest','EVAL_REPLAY_IDEMPOTENCY_CONFLICT',409
      );
      await connection.commit();
      return {...normalizeManifest(row),idempotent:true};
    }
    const [versions]=await connection.execute('SELECT * FROM eval_suite_versions WHERE id=? FOR UPDATE',[suiteVersionId]);
    if(!versions.length) throw errorOf('Eval suite version not found','EVAL_SUITE_VERSION_NOT_FOUND',404);
    const version=versions[0];
    if(version.status!=='FROZEN'||!sha64.test(version.fixture_sha256||'')) throw errorOf('Replay manifests require a frozen eval suite version','EVAL_SUITE_VERSION_NOT_FROZEN',409);
    const material={
      replayContractVersion:version.replay_contract_version,
      suiteVersionId,
      fixtureSha256:version.fixture_sha256,
      candidateRuntimeSha:candidateRuntimeSha.toLowerCase(),
      baselineRuntimeSha:baselineRuntimeSha?baselineRuntimeSha.toLowerCase():null,
      workflowVersion:workflowVersion||null,routerVersion:routerVersion||null,ragIndexVersion:ragIndexVersion||null
    };
    const manifestHash=sha256(material),id=randomUUID();
    await connection.execute(
      `INSERT INTO eval_replay_manifests
       (id,suite_version_id,candidate_runtime_sha,baseline_runtime_sha,workflow_version,router_version,
        rag_index_version,replay_contract_version,fixture_sha256,manifest_sha256,status,idempotency_key,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,'READY',?,?)`,
      [id,suiteVersionId,candidateRuntimeSha.toLowerCase(),baselineRuntimeSha?baselineRuntimeSha.toLowerCase():null,
       workflowVersion||null,routerVersion||null,ragIndexVersion||null,version.replay_contract_version,
       version.fixture_sha256,manifestHash,idempotencyKey,metadata==null?null:JSON.stringify(metadata)]
    );
    const [rows]=await connection.execute('SELECT * FROM eval_replay_manifests WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeManifest(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const getEvalReplayManifest=async manifestId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM eval_replay_manifests WHERE id=?',[manifestId]);
  if(!rows.length) throw errorOf('Eval replay manifest not found','EVAL_REPLAY_MANIFEST_NOT_FOUND',404);
  const row=rows[0];
  const expected=sha256({
    replayContractVersion:row.replay_contract_version,
    suiteVersionId:row.suite_version_id,
    fixtureSha256:row.fixture_sha256,
    candidateRuntimeSha:row.candidate_runtime_sha,
    baselineRuntimeSha:row.baseline_runtime_sha||null,
    workflowVersion:row.workflow_version||null,routerVersion:row.router_version||null,ragIndexVersion:row.rag_index_version||null
  });
  if(expected!==row.manifest_sha256) throw errorOf('Eval replay manifest integrity check failed','EVAL_REPLAY_MANIFEST_INTEGRITY_MISMATCH',500);
  return normalizeManifest(row);
};

export const REPLAY_CONTRACT=REPLAY_CONTRACT_VERSION;
