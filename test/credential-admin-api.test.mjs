import test from 'node:test';
import assert from 'node:assert/strict';
import {listIdentities,listWorkspaceMemberships,listApiCredentials} from '../src/runtime-rbac.mjs';

const db={
  query:async(sql,args)=>{
    if(sql.includes('FROM identities'))return [[{id:'i1',identity_key:'xiaomeng',display_name:'张晓梦',status:'ACTIVE',created_at:'2026-10-09'}]];
    if(sql.includes('FROM workspace_memberships'))return [[{id:'m1',workspace_id:args[0],identity_id:'i1',identity_key:'xiaomeng',display_name:'张晓梦',role_key:'OPERATOR',role_name:'Operator',status:'ACTIVE',created_at:'2026-10-09'}]];
    if(sql.includes('FROM api_credentials'))return [[{id:'c1',credential_prefix:'abcdef123456',identity_id:'i1',identity_key:'xiaomeng',display_name:'张晓梦',tenant_id:'t1',workspace_id:args[0],name:'个人工作台',status:'ACTIVE',allowed_permissions_json:['project:read'],expires_at:null,last_used_at:null,revoked_at:null,created_at:'2026-10-09'}]];
    throw Error('unexpected query '+sql);
  }
};

test('identity list returns safe member fields only',async()=>{
  const result=await listIdentities({status:'ACTIVE'},db);
  assert.deepEqual(result[0],{id:'i1',identityKey:'xiaomeng',displayName:'张晓梦',status:'ACTIVE',createdAt:'2026-10-09'});
});

test('workspace membership list carries role and display name',async()=>{
  const result=await listWorkspaceMemberships({workspaceId:'w1'},db);
  assert.equal(result[0].roleKey,'OPERATOR');
  assert.equal(result[0].displayName,'张晓梦');
});

test('credential list never exposes token hash or full token',async()=>{
  const result=await listApiCredentials({workspaceId:'w1'},db);
  assert.equal(result[0].credentialPrefix,'rtk_abcdef123456_…');
  assert.ok(!JSON.stringify(result).includes('token_hash'));
  assert.ok(!JSON.stringify(result).includes('tokenHash'));
  assert.equal(result[0].allowedPermissions[0],'project:read');
});

test('admin lists reject unsafe filters',async()=>{
  await assert.rejects(()=>listIdentities({status:'DROP TABLE'},db),error=>error.code==='INVALID_IDENTITY_STATUS');
  await assert.rejects(()=>listWorkspaceMemberships({},db),error=>error.code==='WORKSPACE_ID_REQUIRED');
});
