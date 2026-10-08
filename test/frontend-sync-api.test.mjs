import test from 'node:test';
import assert from 'node:assert/strict';
import { listWorkbenchProjects,handleFrontendSyncRoute } from '../src/frontend-sync-api.mjs';

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
