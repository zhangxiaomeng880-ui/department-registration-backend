import assert from 'node:assert/strict';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const token = process.env.RUNTIME_API_TOKEN || 'ci-runtime-token';

const request = async (method, path, body, authToken) => {
  const headers = { 'content-type':'application/json' };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status:response.status, body:await response.json() };
};

let r = await request('GET','/health');
assert.equal(r.status,200);
assert.equal(r.body.status,'ok');

r = await request('GET','/ready');
assert.equal(r.status,200);
assert.ok(['ready','degraded'].includes(r.body.status));
assert.equal(r.body.components.database.ready,true);
assert.equal(r.body.components.runtimeAuth.required,true);
assert.equal(r.body.components.runtimeAuth.ready,true);
assert.equal(r.body.components.contextBridge.persisted,false);

r = await request('POST','/api/runtime/projects',{
  projectKey:'unauthorized-project',
  name:'Unauthorized Project',
  projectType:'AIGC_CONTENT'
});
assert.equal(r.status,401);
assert.equal(r.body.error,'RUNTIME_UNAUTHORIZED');

r = await request('POST','/api/runtime/projects',{
  projectKey:'wrong-token-project',
  name:'Wrong Token Project',
  projectType:'AIGC_CONTENT'
},'wrong-token');
assert.equal(r.status,401);
assert.equal(r.body.error,'RUNTIME_UNAUTHORIZED');

const projectKey = `deployment-ci-${Date.now().toString(36)}`;
r = await request('POST','/api/runtime/projects',{
  projectKey,
  name:'Deployment CI Project',
  projectType:'AIGC_CONTENT',
  currentWorkflowVersion:'deployment-v1'
},token);
assert.equal(r.status,201);
assert.equal(r.body.data.projectKey,projectKey);

r = await request('POST','/api/runtime/context-packets',{
  query:'deployment context bridge smoke test',
  scope:'SMOKE',
  items:[{
    sourceFileId:'deployment-ci-source',
    sourceVersion:'1',
    sourceStatus:'CURRENT',
    sourceText:'Transient deployment validation context.'
  }]
},token);
assert.equal(r.status,201);
assert.equal(r.body.data.persisted === undefined || r.body.data.persisted === false,true);
assert.equal(Object.hasOwn(r.body.data,'items'),false);

console.log('RUNTIME_DEPLOYMENT_INGRESS_PASS');
