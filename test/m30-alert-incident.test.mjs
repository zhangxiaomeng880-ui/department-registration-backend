import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5018';
const token=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body.data;};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[workspaceGate]]=await db.execute(
  `SELECT workspace_id FROM m30_release_rollback_gate_evaluations
    WHERE gate_key='G-M30-RELEASE-ROLLBACK' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`
);
assert.ok(workspaceGate,'M30.2 PASS workspace required');
const workspaceId=workspaceGate.workspace_id;
const [[environment]]=await db.execute(
  `SELECT * FROM platform_environments
    WHERE workspace_id=? AND environment_type='PREVIEW' AND status='ACTIVE'
    ORDER BY updated_at DESC LIMIT 1`,[workspaceId]
);
assert.ok(environment,'M30.2 PREVIEW environment required');

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_ALERT_RULE,'告警规则');
assert.equal(modules.M30_ALERT_EVENT,'告警事件');
assert.equal(modules.M30_INCIDENT,'事故管理');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-ALERT-INCIDENT').displayName,'告警 / 事故管理门禁');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-alert-rules`,{
  ruleKey:'M303-ENV-DOWN',displayName:'环境不可用告警',sourceType:'PLATFORM_HEALTH',
  severity:'CRITICAL',
  condition:{healthStatuses:['DOWN'],subjectTypes:['ENVIRONMENT'],lookbackSeconds:3600},
  dedupeWindowSeconds:3600,evidence:{test:true,source:'M30.3'}
});
const rule=expect(r,201);
assert.equal(rule.status,'ACTIVE');

// Generate a governed DOWN fact through the M30.1 health API.
r=await request('POST',`/api/runtime/platform-environments/${environment.id}/health`,{
  healthStatus:'DOWN',reasonCode:'M303_SYNTHETIC_OUTAGE',latencyMs:9999,
  observedAt:'2026-10-07T08:30:00Z',source:'M30_CI',evidence:{test:true,outage:true}
});
expect(r,200);

r=await request('POST',`/api/runtime/platform-alert-rules/${rule.id}/evaluate`,{
  asOf:'2026-10-07T08:30:30Z'
});
const evaluation=expect(r,200);
assert.ok(evaluation.matchedFactCount>=1);
const alert=evaluation.alerts.find(x=>x.subjectId===environment.id&&!x.idempotent)||evaluation.alerts[0];
assert.ok(alert?.id);

// Re-evaluation dedupes the exact same health fact.
r=await request('POST',`/api/runtime/platform-alert-rules/${rule.id}/evaluate`,{
  asOf:'2026-10-07T08:30:40Z'
});
const replay=expect(r,200);
assert.ok(replay.alerts.some(x=>x.id===alert.id&&x.idempotent===true));

r=await request('POST',`/api/runtime/platform-alerts/${alert.id}/incidents`,{
  incidentKey:'M303-INCIDENT-ENV-DOWN',title:'Preview 环境不可用',
  severity:'CRITICAL',evidence:{test:true,createdFromAlert:true},
  openedAt:'2026-10-07T08:31:00Z'
});
const incident=expect(r,201);
assert.equal(incident.status,'OPEN');

// Resolution must fail closed until a later HEALTHY recovery fact exists.
r=await request('POST',`/api/runtime/platform-incidents/${incident.id}/transition`,{
  action:'RESOLVE',rootCause:{category:'SYNTHETIC_TEST'},resolution:{action:'RESTORE'},
  evidence:{test:true},occurredAt:'2026-10-07T08:31:30Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_INCIDENT_RECOVERY_EVIDENCE_REQUIRED');

r=await request('POST',`/api/runtime/platform-incidents/${incident.id}/transition`,{
  action:'ACKNOWLEDGE',evidence:{test:true},occurredAt:'2026-10-07T08:31:40Z'
});
const acknowledged=expect(r,200);
assert.equal(acknowledged.status,'ACKNOWLEDGED');

// Record recovery through the same governed health source.
r=await request('POST',`/api/runtime/platform-environments/${environment.id}/health`,{
  healthStatus:'HEALTHY',reasonCode:'M303_RECOVERED',latencyMs:15,
  observedAt:'2026-10-07T08:32:00Z',source:'M30_CI',evidence:{test:true,recovered:true}
});
expect(r,200);

r=await request('POST',`/api/runtime/platform-incidents/${incident.id}/transition`,{
  action:'RESOLVE',
  rootCause:{category:'SYNTHETIC_OUTAGE',summary:'Controlled M30.3 incident fixture'},
  resolution:{action:'HEALTH_RECOVERED',verification:'PLATFORM_HEALTH_EVENT'},
  evidence:{test:true,recoveryVerified:true},occurredAt:'2026-10-07T08:32:30Z'
});
const resolved=expect(r,200);
assert.equal(resolved.status,'RESOLVED');

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-gates/G-M30-ALERT-INCIDENT/evaluate`,{
  asOf:'2026-10-07T08:33:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.upstreamReleaseRollbackStatus,'PASS');
assert.ok(gate.evidenceSnapshot.activeRuleCount>=1);
assert.ok(gate.evidenceSnapshot.alertEventCount>=1);
assert.ok(gate.evidenceSnapshot.resolvedIncidentCount>=1);
assert.ok(gate.evidenceSnapshot.recoveryEvidenceCount>=1);
assert.equal(gate.evidenceSnapshot.incidentResolutionRequiresRecovery,true);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/m30-alert-incident`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.match(state.frontend.policy,/HEALTHY/);
assert.ok(state.alerts.some(x=>x.id===alert.id&&x.status==='RESOLVED'));
assert.ok(state.incidents.some(x=>x.id===incident.id&&x.status==='RESOLVED'));
assert.ok(state.incidentEvents.some(x=>x.incidentId===incident.id&&x.eventType==='ACKNOWLEDGED'));
assert.ok(state.incidentEvents.some(x=>x.incidentId===incident.id&&x.eventType==='RESOLVED'));
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM platform_alert_events WHERE workspace_id=? AND status='RESOLVED') resolved_alerts,
    (SELECT COUNT(*) FROM platform_incidents WHERE workspace_id=? AND status='RESOLVED') resolved_incidents,
    (SELECT COUNT(*) FROM platform_incident_events e JOIN platform_incidents i ON i.id=e.incident_id
      WHERE i.workspace_id=? AND e.event_type='RESOLVED') resolved_events`,
  [workspaceId,workspaceId,workspaceId]
);
assert.ok(Number(truth.resolved_alerts)>=1);
assert.ok(Number(truth.resolved_incidents)>=1);
assert.ok(Number(truth.resolved_events)>=1);

await db.end();
console.log('M30_3_ALERT_INCIDENT_RECOVERY_LOOP_PASS');
