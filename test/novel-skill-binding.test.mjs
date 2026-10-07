import assert from 'node:assert/strict';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m282-platform-token';

const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

let r=await request('GET','/api/runtime/novel-skill-binding');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.capability,JSON.stringify(r.body));
assert.equal(r.body.data.capability.capabilityKey,'SKILL:NOVEL_CONTINUOUS_UPDATE');
assert.equal(r.body.data.capability.capabilityType,'SKILL');
assert.equal(r.body.data.capability.version,'1.0');
assert.equal(r.body.data.capability.status,'ACTIVE');
assert.equal(r.body.data.capability.routable,false);
assert.equal(r.body.data.capability.adapterKey,'external-chatgpt-scheduler');
assert.equal(r.body.data.capability.metadata.sourceOfTruth,undefined);
assert.equal(r.body.data.capability.metadata.nativeRuntimeExecution,false);
assert.equal(r.body.data.capability.metadata.bindingStatus,'EXTERNAL_BOUND');
assert.equal(r.body.data.projectTypeBinding.projectTypeKey,'AIGC_CONTENT');
assert.equal(r.body.data.projectTypeBinding.bindingMode,'ALLOWED');
assert.equal(r.body.data.nativeRuntimeExecution,false);
assert.equal(r.body.data.nativeTriggerRegistry,false);

r=await request('POST','/api/runtime/novel-skill-binding/sync',{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.bindingStatus,'EXTERNAL_BOUND');
assert.ok(r.body.data.agentGrant,JSON.stringify(r.body));
assert.equal(r.body.data.agentGrant.agentCapabilityKey,'AGENT:STANDARD:AIGC_CONTENT:OPERATIONS_CONTENT');
assert.equal(r.body.data.agentGrant.childCapabilityKey,'SKILL:NOVEL_CONTINUOUS_UPDATE');
assert.equal(r.body.data.agentGrant.requirementMode,'ALLOWED');

r=await request('GET','/api/runtime/capabilities?capabilityType=SKILL&status=ACTIVE');
assert.equal(r.status,200,JSON.stringify(r.body));
const skill=r.body.data.find(x=>x.capabilityKey==='SKILL:NOVEL_CONTINUOUS_UPDATE');
assert.ok(skill,JSON.stringify(r.body.data));
assert.equal(skill.routable,false);
assert.equal(skill.adapterKey,'external-chatgpt-scheduler');

console.log('Runtime V2.8 M28.2 novel continuous-update Skill external binding validation passed');
