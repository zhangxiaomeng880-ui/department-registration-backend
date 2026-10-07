import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5020';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body,token=platformToken)=>{
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
const suffix=randomUUID().slice(0,8);

const [[workspaceGate]]=await db.execute(
  `SELECT workspace_id FROM m30_retention_backup_gate_evaluations
    WHERE gate_key='G-M30-RETENTION-BACKUP' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`
);
assert.ok(workspaceGate,'M30.4 PASS workspace required');
const workspaceId=workspaceGate.workspace_id;

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_GLOBAL_SEARCH,'全局搜索');
assert.equal(modules.M30_AUDIT_EVIDENCE_VIEW,'审计 / 证据聚合');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-SEARCH-AUDIT').displayName,'全局搜索 / 审计证据门禁');

// Add two searchable workspace-scoped objects with the same probe.
r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-environments`,{
  environmentKey:`m305-search-${suffix}`,displayName:`M305 Search Beacon Environment ${suffix}`,
  environmentType:'TEST',releaseChannel:'search-validation',
  externalRef:{platform:'CI',ref:'m305-search'},healthStatus:'UNKNOWN',
  metadata:{searchFixture:true},evidence:{test:true,source:'M30.5'}
});
const env=expect(r,201);

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/platform-connections`,{
  connectionKey:`m305-search-${suffix}`,displayName:`M305 Search Beacon Connection ${suffix}`,
  connectionType:'TEST_CONNECTOR',adapterKey:'test-adapter',credentialRef:'ENV:M305_TEST_REF',
  endpointRef:{source:'CI'},capabilityScope:{SEARCH:true},healthStatus:'UNKNOWN',
  metadata:{searchFixture:true},evidence:{test:true,source:'M30.5'}
});
const conn=expect(r,201);

// Query validation.
r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=x`);
assert.equal(r.status,400,JSON.stringify(r.body));
assert.equal(r.body.error,'M30_SEARCH_QUERY_TOO_SHORT');

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('M305 Search Beacon')}&type=ENVIRONMENT&type=CONNECTION&limit=20`);
const search=expect(r,200);
assert.ok(search.total>=2,JSON.stringify(search));
assert.ok(search.results.some(x=>x.type==='ENVIRONMENT'&&x.id===env.id));
assert.ok(search.results.some(x=>x.type==='CONNECTION'&&x.id===conn.id));
assert.equal(search.byType.ENVIRONMENT>=1,true);
assert.equal(search.byType.CONNECTION>=1,true);

// Audit/Evidence aggregate must read multiple existing fact families rather than duplicate them.
r=await request('GET',`/api/runtime/workspaces/${workspaceId}/audit-evidence?limit=200`);
const audit=expect(r,200);
assert.ok(audit.total>=3,JSON.stringify(audit));
assert.ok(audit.sourceTypeCount>=3,JSON.stringify(audit.bySource));
assert.ok(audit.bySource.PLATFORM_HEALTH>=1);
assert.ok(
  audit.bySource.M30_BACKUP_GATE>=1 ||
  audit.bySource.M30_INCIDENT_GATE>=1 ||
  audit.bySource.M30_RELEASE_GATE>=1
);

// Workspace isolation: a scoped credential may search/audit only its own workspace.
r=await request('POST','/api/runtime/workspaces',{
  tenantId:(await db.execute('SELECT tenant_id FROM workspaces WHERE id=?',[workspaceId]))[0][0].tenant_id,
  workspaceKey:`m305-isolated-${suffix}`,name:'M30.5 Isolated Workspace'
});
const otherWorkspace=expect(r,201);
r=await request('POST','/api/runtime/identities',{
  identityKey:`m305-viewer-${suffix}`,displayName:'M30.5 Search Viewer'
});
const identity=expect(r,201);
r=await request('POST','/api/runtime/workspace-memberships',{
  workspaceId,identityId:identity.id,roleKey:'VIEWER'
});
expect(r,201);
r=await request('POST','/api/runtime/api-credentials',{
  identityId:identity.id,
  tenantId:(await db.execute('SELECT tenant_id FROM workspaces WHERE id=?',[workspaceId]))[0][0].tenant_id,
  workspaceId,name:'M30.5 scoped read',allowedPermissions:['workspace:read']
});
const credential=expect(r,201);
assert.ok(credential.token);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('M305 Search Beacon')}`,undefined,credential.token);
expect(r,200);
r=await request('GET',`/api/runtime/workspaces/${workspaceId}/audit-evidence?limit=20`,undefined,credential.token);
expect(r,200);
r=await request('GET',`/api/runtime/workspaces/${otherWorkspace.id}/global-search?q=M305`,undefined,credential.token);
assert.equal(r.status,403,JSON.stringify(r.body));
r=await request('GET',`/api/runtime/workspaces/${otherWorkspace.id}/audit-evidence`,undefined,credential.token);
assert.equal(r.status,403,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-gates/G-M30-SEARCH-AUDIT/evaluate`,{
  searchProbe:'M305 Search Beacon',asOf:'2026-10-07T09:00:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.upstreamRetentionBackupStatus,'PASS');
assert.ok(gate.evidenceSnapshot.searchResultCount>=2);
assert.ok(gate.evidenceSnapshot.searchResultTypes.includes('ENVIRONMENT'));
assert.ok(gate.evidenceSnapshot.searchResultTypes.includes('CONNECTION'));
assert.ok(gate.evidenceSnapshot.auditSourceTypeCount>=3);
assert.equal(gate.evidenceSnapshot.workspaceScoped,true);
assert.equal(gate.evidenceSnapshot.readOnlyAggregate,true);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/m30-search-audit?q=${encodeURIComponent('M305 Search Beacon')}&auditLimit=50`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.match(state.frontend.policy,/只读/);
assert.ok(state.search.total>=2);
assert.ok(state.audit.sourceTypeCount>=3);
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m30_search_audit_gate_evaluations
      WHERE workspace_id=? AND gate_key='G-M30-SEARCH-AUDIT' AND status='PASS') gate_pass,
    (SELECT COUNT(*) FROM platform_environments WHERE workspace_id=? AND id=?) env_count,
    (SELECT COUNT(*) FROM platform_connections WHERE workspace_id=? AND id=?) conn_count`,
  [workspaceId,workspaceId,env.id,workspaceId,conn.id]
);
assert.ok(Number(truth.gate_pass)>=1);
assert.equal(Number(truth.env_count),1);
assert.equal(Number(truth.conn_count),1);

await db.end();
console.log('M30_5_GLOBAL_SEARCH_AUDIT_EVIDENCE_PASS');
