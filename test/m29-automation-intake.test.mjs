import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5013';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>{
  assert.equal(r.status,status,JSON.stringify(r.body));
  return r.body.data;
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[project]]=await db.execute(
  `SELECT p.*
     FROM projects p
    WHERE p.project_type='AIGC_CONTENT'
      AND p.name='你好，那年夏天'
      AND p.status='ACTIVE'
    ORDER BY p.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.3 active novel bridge validation project is required');
const projectId=project.id;

const [[capabilityVersion]]=await db.execute(
  `SELECT capability_version_id
     FROM capability_versions
    WHERE capability_key='SKILL:NOVEL_CONTINUOUS_UPDATE' AND status='CURRENT'
    ORDER BY frozen_at DESC,created_at DESC LIMIT 1`
);
assert.ok(capabilityVersion,'Novel continuous update capability version is required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M29_AUTOMATION_INTAKE,'自动化入口');
assert.equal(modules.M29_SCHEDULER_TICK,'调度扫描');
assert.equal(modules.M29_WEBHOOK_INTAKE,'Webhook 入口');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(
  r.body.data.find(x=>x.stableKey==='G-M29-AUTOMATION').displayName,
  '自动化入口 / 调度 / Webhook 门禁'
);

const suffix=projectId.slice(0,8);
const triggerSpecs=[
  {
    triggerKey:`M293-SCHEDULE-${suffix}`,triggerType:'SCHEDULE',
    displayName:'M29.3 定时调度验证',scopeType:'PROJECT',scopeId:projectId,
    timezone:'Asia/Shanghai',scheduleExpr:'30 10 * * *',enabled:true,
    evidence:{test:true,externalSideEffect:false}
  },
  {
    triggerKey:`M293-EVENT-${suffix}`,triggerType:'EVENT',
    displayName:'M29.3 事件入口验证',scopeType:'PROJECT',scopeId:projectId,
    eventType:'M293_INTERNAL_EVENT',enabled:true,
    evidence:{test:true,externalSideEffect:false}
  },
  {
    triggerKey:`M293-WEBHOOK-${suffix}`,triggerType:'WEBHOOK',
    displayName:'M29.3 Webhook 入口验证',scopeType:'PROJECT',scopeId:projectId,
    eventType:'M293_WEBHOOK_EVENT',enabled:true,
    evidence:{test:true,externalSideEffect:false}
  }
];

for(const spec of triggerSpecs){
  r=await request('POST','/api/runtime/m29-automation-triggers',spec);
  const trigger=expect(r,201);
  assert.equal(trigger.triggerType,spec.triggerType);
  assert.equal(trigger.enabled,true);

  r=await request('POST','/api/runtime/trigger-bindings',{
    triggerKey:spec.triggerKey,
    capabilityKey:'SKILL:NOVEL_CONTINUOUS_UPDATE',
    capabilityVersionId:capabilityVersion.capability_version_id,
    priority:10,
    stageKey:'AIGC_11_DERIVATION',
    policy:{
      executionMode:'BRIDGE',m29Automation:true,
      checkpointPath:'/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md'
    },
    enabled:true
  });
  expect(r,201);
}

// Gate must HOLD until each configured intake type has actually reached Trigger Runtime.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-AUTOMATION/evaluate`,{
  asOf:'2026-10-07T02:29:00Z'
});
let gate=expect(r,200);
assert.equal(gate.status,'HOLD');
assert.ok(gate.reasonCodes.includes('M29_AUTOMATION_INTAKE_COVERAGE_INCOMPLETE'));
assert.deepEqual(
  [...gate.evidenceSnapshot.configuredTriggerTypes].sort(),
  ['EVENT','SCHEDULE','WEBHOOK']
);

// Scheduler evaluates the configured timezone/Cron contract and dispatches only the due slot.
r=await request('POST','/api/runtime/m29-scheduler/tick',{
  asOf:'2026-10-07T02:30:00Z',
  evidence:{test:true,externalSideEffect:false}
});
const tick=expect(r,200);
assert.equal(tick.failedCount,0,JSON.stringify(r.body));
assert.ok(tick.fired.some(x=>x.triggerKey===triggerSpecs[0].triggerKey&&x.projectId===projectId));
const scheduleFire=tick.fired.find(x=>x.triggerKey===triggerSpecs[0].triggerKey&&x.projectId===projectId);
assert.ok(scheduleFire.triggerFireId);

// A structured Event goes through the same Trigger Runtime.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,{
  triggerKey:triggerSpecs[1].triggerKey,
  intakeType:'EVENT',
  intakeKey:'M293-EVENT-INTAKE-001',
  eventId:'M293-EVENT-001',
  eventType:'M293_INTERNAL_EVENT',
  occurredAt:'2026-10-07T02:31:00Z',
  sourceRef:{source:'CI_INTERNAL_EVENT',eventRef:'evt-001'},
  payload:{kind:'NEXT_ROUND_SIGNAL',value:'READY'},
  evidence:{test:true,externalSideEffect:false}
});
const eventIntake=expect(r,201);
assert.equal(eventIntake.status,'FIRED');
assert.ok(eventIntake.triggerFireId);

// Raw credentials/secrets are never accepted at the normalized intake boundary.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,{
  triggerKey:triggerSpecs[2].triggerKey,
  intakeType:'WEBHOOK',
  intakeKey:'M293-WEBHOOK-SECRET',
  eventId:'M293-WEBHOOK-SECRET',
  eventType:'M293_WEBHOOK_EVENT',
  sourceRef:{source:'CI_WEBHOOK'},
  payload:{token:'forbidden'},
  verification:{status:'VERIFIED',provider:'CI_EDGE',verificationRef:'sha256:secret-test'},
  evidence:{test:true}
});
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_AUTOMATION_SECRET_NOT_ALLOWED');

// Webhook must arrive with upstream verification evidence.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,{
  triggerKey:triggerSpecs[2].triggerKey,
  intakeType:'WEBHOOK',
  intakeKey:'M293-WEBHOOK-UNVERIFIED',
  eventId:'M293-WEBHOOK-UNVERIFIED',
  eventType:'M293_WEBHOOK_EVENT',
  sourceRef:{source:'CI_WEBHOOK'},
  payload:{kind:'PROVIDER_EVENT'},
  verification:{status:'PENDING',provider:'CI_EDGE',verificationRef:'sha256:pending'},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_WEBHOOK_VERIFICATION_REQUIRED');

const webhookBody={
  triggerKey:triggerSpecs[2].triggerKey,
  intakeType:'WEBHOOK',
  intakeKey:'M293-WEBHOOK-INTAKE-001',
  eventId:'M293-WEBHOOK-001',
  eventType:'M293_WEBHOOK_EVENT',
  occurredAt:'2026-10-07T02:32:00Z',
  sourceRef:{source:'CI_WEBHOOK_EDGE',providerEventRef:'provider-event-001'},
  payload:{kind:'PROVIDER_EVENT',objectType:'CONTENT',state:'UPDATED'},
  verification:{status:'VERIFIED',provider:'CI_EDGE_VERIFIER',verificationRef:'sha256:verified-001'},
  evidence:{test:true,rawWebhookBodyPersisted:false}
};
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,webhookBody);
const webhookIntake=expect(r,201);
assert.equal(webhookIntake.status,'FIRED');
assert.ok(webhookIntake.triggerFireId);

// Same normalized receipt is idempotent.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,webhookBody);
const duplicate=expect(r,200);
assert.equal(duplicate.idempotent,true);
assert.equal(duplicate.id,webhookIntake.id);
assert.equal(duplicate.triggerFireId,webhookIntake.triggerFireId);

// Same intake key with different payload fails closed.
r=await request('POST',`/api/runtime/projects/${projectId}/m29-automation-intakes`,{
  ...webhookBody,
  payload:{kind:'PROVIDER_EVENT',objectType:'CONTENT',state:'CONFLICT'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M29_AUTOMATION_INTAKE_CONFLICT');

r=await request('POST',`/api/runtime/projects/${projectId}/m29-gates/G-M29-AUTOMATION/evaluate`,{
  asOf:'2026-10-07T02:33:00Z'
});
gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(r.body));
assert.equal(gate.evidenceSnapshot.scheduleIntakeCount,1);
assert.equal(gate.evidenceSnapshot.eventIntakeCount,1);
assert.equal(gate.evidenceSnapshot.webhookIntakeCount,1);
assert.deepEqual(gate.evidenceSnapshot.missingConfiguredIntakeTypes,[]);
assert.deepEqual(gate.evidenceSnapshot.failedIntakeIds,[]);
assert.deepEqual(gate.evidenceSnapshot.invalidLineageIntakeIds,[]);
assert.equal(gate.evidenceSnapshot.reusesTriggerRuntime,true);
assert.equal(gate.evidenceSnapshot.reusesBridgeRetryDeadLetter,true);
assert.equal(gate.evidenceSnapshot.reusesWorkflowRetryRollback,true);
assert.equal(gate.evidenceSnapshot.readyForAutomationRuntime,true);

r=await request('GET',`/api/runtime/projects/${projectId}/m29-automation`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.gateName,'自动化入口 / 调度 / Webhook 门禁');
assert.deepEqual(state.frontend.moduleNames,['自动化入口','调度扫描','Webhook 入口']);
assert.match(state.frontend.reliabilityPolicy,/Dead-letter/);
assert.equal(state.triggers.length,3);
assert.equal(state.intakes.filter(x=>x.status==='FIRED').length,3);

// M29.3 only normalizes and dispatches; Novel bridge remains pending and no real library work is executed.
const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_automation_intakes
      WHERE project_id=? AND status='FIRED') fired_intakes,
    (SELECT COUNT(DISTINCT intake_type) FROM m29_automation_intakes
      WHERE project_id=? AND status='FIRED') intake_types,
    (SELECT COUNT(*) FROM m29_automation_intakes
      WHERE project_id=? AND status='FAILED') failed_intakes,
    (SELECT COUNT(*) FROM m29_automation_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-AUTOMATION' AND status='PASS') gate_pass,
    (SELECT COUNT(*) FROM trigger_dispatches d
      JOIN trigger_fires f ON f.id=d.trigger_fire_id
      WHERE f.project_id=? AND d.status='PENDING') pending_bridge_dispatches`,
  [projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.fired_intakes),3);
assert.equal(Number(truth.intake_types),3);
assert.equal(Number(truth.failed_intakes),0);
assert.equal(Number(truth.gate_pass),1);
assert.ok(Number(truth.pending_bridge_dispatches)>=3);

await db.end();
console.log('M29_3_AUTOMATION_INTAKE_PASS');
