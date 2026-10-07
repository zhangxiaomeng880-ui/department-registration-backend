import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const parseJson=value=>{
  if(value==null)return null;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return null;}
};
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
};
const sha256=value=>createHash('sha256').update(
  typeof value==='string'?value:JSON.stringify(stable(value)),'utf8'
).digest('hex');

const snapshotDefinition=row=>({
  capabilityKey:row.capability_key,
  capabilityType:row.capability_type,
  displayName:row.display_name,
  version:row.version,
  status:row.status,
  routable:Boolean(row.routable),
  adapterKey:row.adapter_key||null,
  inputContract:parseJson(row.input_contract_json),
  outputContract:parseJson(row.output_contract_json),
  capabilities:parseJson(row.capabilities_json),
  policyTags:parseJson(row.policy_tags_json),
  metadata:parseJson(row.metadata_json)
});

const normalize=row=>row?({
  capabilityVersionId:row.capability_version_id,
  capabilityKey:row.capability_key,
  version:row.version,
  definitionSha256:row.definition_sha256,
  inputContract:parseJson(row.input_contract_json),
  outputContract:parseJson(row.output_contract_json),
  executionContract:parseJson(row.execution_contract_json),
  verificationContract:parseJson(row.verification_contract_json),
  gateContract:parseJson(row.gate_contract_json),
  policyTags:parseJson(row.policy_tags_json),
  metadata:parseJson(row.metadata_json),
  status:row.status,
  createdAt:row.created_at,
  frozenAt:row.frozen_at||null
}):null;

export const ensureCapabilityVersionSnapshot=async(capabilityKey,db=getRuntimePool())=>{
  const [caps]=await db.execute('SELECT * FROM capability_registry WHERE capability_key=?',[capabilityKey]);
  if(!caps.length){
    const error=new Error('Capability not found');
    error.code='CAPABILITY_NOT_FOUND';error.statusCode=404;throw error;
  }
  const cap=caps[0];
  const definition=snapshotDefinition(cap);
  const definitionSha256=sha256(definition);
  const [existing]=await db.execute(
    'SELECT * FROM capability_versions WHERE capability_key=? AND version=? LIMIT 1',
    [capabilityKey,cap.version]
  );
  if(existing.length){
    if(existing[0].definition_sha256!==definitionSha256){
      const error=new Error('Capability version is immutable; bump version before changing its executable definition');
      error.code='CAPABILITY_VERSION_IMMUTABLE_CONFLICT';error.statusCode=409;
      error.details={capabilityKey,version:cap.version,expectedDefinitionSha256:existing[0].definition_sha256,actualDefinitionSha256:definitionSha256};
      throw error;
    }
    return normalize(existing[0]);
  }

  const id=randomUUID();
  await db.execute(
    `INSERT INTO capability_versions (
      capability_version_id,capability_key,version,definition_sha256,
      input_contract_json,output_contract_json,execution_contract_json,
      verification_contract_json,gate_contract_json,policy_tags_json,metadata_json,status,frozen_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'CURRENT',CURRENT_TIMESTAMP(6))`,
    [
      id,capabilityKey,cap.version,definitionSha256,
      cap.input_contract_json,cap.output_contract_json,
      JSON.stringify({
        capabilityType:cap.capability_type,adapterKey:cap.adapter_key||null,
        routable:Boolean(cap.routable),capabilities:parseJson(cap.capabilities_json)
      }),
      JSON.stringify(parseJson(cap.metadata_json)?.verificationContract||null),
      JSON.stringify(parseJson(cap.metadata_json)?.gateContract||null),
      cap.policy_tags_json,cap.metadata_json
    ]
  );
  const [rows]=await db.execute('SELECT * FROM capability_versions WHERE capability_version_id=?',[id]);
  return normalize(rows[0]);
};

export const getCapabilityVersion=async capabilityVersionId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM capability_versions WHERE capability_version_id=?',[capabilityVersionId]
  );
  if(!rows.length){
    const error=new Error('Capability version not found');
    error.code='CAPABILITY_VERSION_NOT_FOUND';error.statusCode=404;throw error;
  }
  return normalize(rows[0]);
};

export const listCapabilityVersions=async({capabilityKey,status=null}={})=>{
  if(!capabilityKey){
    const error=new Error('capabilityKey is required');
    error.code='INVALID_CAPABILITY_VERSION_QUERY';error.statusCode=400;throw error;
  }
  const db=getRuntimePool();
  const params=[capabilityKey];
  let sql='SELECT * FROM capability_versions WHERE capability_key=?';
  if(status){sql+=' AND status=?';params.push(String(status).toUpperCase());}
  sql+=' ORDER BY created_at DESC,capability_version_id DESC';
  const [rows]=await db.execute(sql,params);
  return rows.map(normalize);
};
