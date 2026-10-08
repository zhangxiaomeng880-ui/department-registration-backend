import test from 'node:test';
import assert from 'node:assert/strict';
import { listWorkbenchProjects,handleFrontendSyncRoute,scopedPrincipalView } from '../src/frontend-sync-api.mjs';

test('project listing rejects missing or malicious workspace, non-paginated requests and invalid filters before DB use',async()=>{
  await assert.rejects(listWorkbenchProjects({}),{code:'WORKSPACE_ID_REQUIRED'});
  await assert.rejects(listWorkbenchProjects({workspaceId:'x;DROP TABLE projects'}),{code:'WORKSPACE_ID_REQUIRED'});
  await assert.rejects(listWorkbenchProjects({workspaceId:'workspace1',limit:101}),{code:'INVALID_PROJECT_PAGE'});
  await assert.rejects(listWorkbenchProjects({workspaceId:'workspace1',offset:-1}),{code:'INVALID_PROJECT_PAGE'});
  await assert.rejects(listWorkbenchProjects({workspaceId:'workspace1',projectType:'UNKNOWN'}),{code:'INVALID_PROJECT_TYPE'});
});
test('route never claims unrelated methods or paths',async()=>{
  const res={};
  assert.equal(await handleFrontendSyncRoute({method:'POST'},res,new URL('https://test.invalid/api/runtime/projects'),{}),false);
  assert.equal(await handleFrontendSyncRoute({method:'GET'},res,new URL('https://test.invalid/api/runtime/workspaces'),{}),false);
});

test('GET self permissions derives strictly from authenticated Runtime principal, never accepts client-provided identity',async()=>{
 const principal={type:'SCOPED',platformAdmin:false,
  identityId:'id-001',tenantId:'tenant-001',workspaceId:'workspace-001',
  permissions:new Set(['project:read','workspace:read'])
 };
 const me=scopedPrincipalView(principal);
 assert.deepEqual(me,{principalType:'SCOPED',platformAdmin:false,
  identityId:'id-001',tenantId:'tenant-001',workspaceId:'workspace-001',
  permissions:['project:read','workspace:read']});
 assert.deepEqual(scopedPrincipalView({platformAdmin:true}),{
  principalType:'PLATFORM',platformAdmin:true,identityId:null,tenantId:null,
  workspaceId:null,permissions:[]
 });
 assert.throws(()=>scopedPrincipalView(null),{code:'RUNTIME_UNAUTHORIZED'});
 const captured=[];
 const handled=await handleFrontendSyncRoute(
  {method:'GET'}, {},new URL('https://test.invalid/api/runtime/me?identityId=attacker'),
  {principal,json:(_res,status,data)=>captured.push({status,data})}
 );
 assert.equal(handled,true);
 assert.equal(captured[0].status,200);
 assert.equal(captured[0].data.data.identityId,'id-001');
 assert.ok(!JSON.stringify(captured).includes('attacker'));
});
