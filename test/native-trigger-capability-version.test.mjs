import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m283-platform-token';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const suffix=randomUUID().slice(0,8);

// Novel Skill must now have an exact immutable version snapshot and a shadow native trigger binding.
let r=await request('GET','/api/runtime/capability-versions?capabilityKey=SKILL%3ANOVEL_CONTINUOUS_UPDATE');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1,JSON.stringify(r.body));
const version=r.body.data[0];
assert.equal(version.version,'1.0');
assert.match(version.definitionSha256,/^[a-f0-9]{64}$/);

r=await request('GET','/api/runtime/triggers/TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.triggerType,'SCHEDULE');
assert.equal(r.body.data.scheduleExpr,'0 9 * * *');
assert.equal(r.body.data.timezone,'Asia/Shanghai');
assert.equal(r.body.data.enabled,false);
assert.equal(r.body.data.bindings.length,1);
assert.equal(r.body.data.bindings[0].capabilityKey,'SKILL:NOVEL_CONTINUOUS_UPDATE');
assert.equal(r.body.data.bindings[0].capabilityVersionId,version.capabilityVersionId);

// Build a minimal active AIGC project for direct trigger/bridge validation.
const planKey=`M283_PLAN_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey,name:'M28.3 Trigger Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/tenants',{
  tenantKey:`m283-${suffix}`,name:'M28.3 Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'Main'});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

// Minimal workflow keeps project creation contract valid without mutating frozen standard AIGC workflow.
r=await request('POST','/api/runtime/workflow-templates',{
  projectTypeKey:'AIGC_CONTENT',templateKey:`m283-trigger-${suffix}`,version:'1.0.0',displayName:'M28.3 Trigger Validation'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const templateId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/milestones`,{
  milestoneKey:'AG-M7',displayName:'内容派生',sequenceNo:1,acceptance:{gate:'G-AIGC-DISTRIBUTION-PACKAGE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const milestoneId=r.body.data.id;
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/stages`,{
  milestoneTemplateId:milestoneId,stageKey:'AIGC_11_DERIVATION',displayName:'内容派生 / 本地化 / 平台适配',sequenceNo:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST',`/api/runtime/workflow-templates/${templateId}/freeze`,{});
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m283-novel-${suffix}`,name:'你好，那年夏天',
  projectType:'AIGC_CONTENT',workflowTemplateId:templateId
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

// Shadow fire is explicit; native trigger remains disabled so it cannot double-run the external ChatGPT schedule.
r=await request('POST','/api/runtime/triggers/TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN/fire',{
  projectId,allowDisabledShadow:true,
  scheduledFireTime:'2026-10-07T09:00:00.000000',
  triggerReason:'M28.3_SHADOW_VALIDATION'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'DISPATCH_PENDING',JSON.stringify(r.body));
const fire=r.body.data;
assert.ok(fire.capabilityInvocationId);

r=await request('GET','/api/runtime/trigger-dispatches?status=PENDING');
assert.equal(r.status,200,JSON.stringify(r.body));
const dispatch=r.body.data.find(x=>x.triggerFireId===fire.id);
assert.ok(dispatch,JSON.stringify(r.body));
assert.equal(dispatch.transportMode,'CHATGPT_LIBRARY_BRIDGE');
assert.equal(dispatch.request.capabilityKey,'SKILL:NOVEL_CONTINUOUS_UPDATE');

// Same fire key is idempotent.
r=await request('POST','/api/runtime/triggers/TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN/fire',{
  projectId,allowDisabledShadow:true,
  scheduledFireTime:'2026-10-07T09:00:00.000000',
  triggerReason:'M28.3_SHADOW_VALIDATION'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.id,fire.id);

// External Library executor can complete the same exact-version invocation.
r=await request('POST',`/api/runtime/trigger-dispatches/${dispatch.id}/complete`,{
  status:'PASS',
  output:{
    status:'PASS',updatedChapters:['NOVEL_001'],reusedPassChapters:[],
    gateStatus:'PASS',
    checkpointPath:'/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md',
    resumePoint:'NOVEL_002',blockingReason:null
  },
  evidence:{executor:'CHATGPT_LIBRARY_BRIDGE',sample:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');

r=await request('GET',`/api/runtime/trigger-fires/${fire.id}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');

r=await request('GET',`/api/runtime/capability-invocations/${fire.capabilityInvocationId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.selectedCapabilityKey,'SKILL:NOVEL_CONTINUOUS_UPDATE');
assert.equal(r.body.data.capabilityVersionId,version.capabilityVersionId);
assert.equal(r.body.data.triggerFireId,fire.id);

// Re-sync is idempotent and must preserve the frozen executable definition.
r=await request('POST','/api/runtime/novel-skill-binding/sync',{});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.capability.adapterKey,'novel-continuous-update-bridge');
assert.equal(r.body.data.capability.routable,true);
r=await request('GET','/api/runtime/capability-versions?capabilityKey=SKILL%3ANOVEL_CONTINUOUS_UPDATE');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].capabilityVersionId,version.capabilityVersionId);

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[counts]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM capability_versions WHERE capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE' AND version='1.0') version_count,
    (SELECT COUNT(*) FROM trigger_registry WHERE trigger_key='TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN') trigger_count,
    (SELECT COUNT(*) FROM trigger_capability_bindings b JOIN trigger_registry t ON t.trigger_id=b.trigger_id
      WHERE t.trigger_key='TRIGGER_NOVEL_CONTINUOUS_UPDATE_0900_CN') binding_count,
    (SELECT COUNT(*) FROM trigger_dispatches WHERE trigger_fire_id=?) dispatch_count`,
  [fire.id]
);
assert.equal(Number(counts.version_count),1);
assert.equal(Number(counts.trigger_count),1);
assert.equal(Number(counts.binding_count),1);
assert.equal(Number(counts.dispatch_count),1);
await db.end();

console.log('Runtime V2.8 M28.3 native trigger + immutable capability version + novel bridge validation passed');
