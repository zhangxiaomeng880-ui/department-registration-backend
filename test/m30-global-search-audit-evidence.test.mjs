import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5020';
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
const suffix=randomUUID().slice(0,8);

const [[gateWorkspace]]=await db.execute(
  `SELECT workspace_id FROM m30_retention_backup_gate_evaluations
    WHERE gate_key='G-M30-RETENTION-BACKUP' AND status='PASS'
    ORDER BY as_of DESC,created_at DESC LIMIT 1`
);
assert.ok(gateWorkspace,'M30.4 PASS workspace required');
const workspaceId=gateWorkspace.workspace_id;
const [[workspace]]=await db.execute('SELECT * FROM workspaces WHERE id=?',[workspaceId]);
assert.ok(workspace);

let r=await request('GET','/api/runtime/aigc-modules');
expect(r,200);
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.M30_GLOBAL_SEARCH,'全局搜索');
assert.equal(modules.M30_AUDIT_EVIDENCE,'审计 / 证据中心');

r=await request('GET','/api/runtime/aigc-ui-labels');
expect(r,200);
assert.equal(r.body.data.find(x=>x.stableKey==='G-M30-SEARCH-AUDIT').displayName,'全局搜索 / 审计证据门禁');

// Create searchable governance objects inside the same workspace.
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m305-search-${suffix}`,name:'全局搜索验证项目',
  projectType:'PRODUCT_DEVELOPMENT',status:'ACTIVE'
});
const project=expect(r,201);

r=await request('POST',`/api/runtime/projects/${project.id}/milestones`,{
  milestoneKey:'M305-MILESTONE',displayName:'搜索验收里程碑',sequenceNo:1,
  objective:'验证全局搜索与审计证据聚合',status:'PLANNED',
  evidence:{test:true,source:'M30.5'}
});
const milestone=expect(r,201);

r=await request('POST',`/api/runtime/projects/${project.id}/work-items`,{
  itemKey:'M305-WORK-1',itemType:'TASK',title:'完成全局搜索验收',
  milestoneId:milestone.id,priority:'HIGH',status:'PLANNED',
  acceptanceCriteria:{search:true,audit:true},evidence:{test:true,source:'M30.5'}
});
const workItem=expect(r,201);

// Create an isolated marker in another workspace to prove workspace scoping.
const [[otherWorkspace]]=await db.execute(
  'SELECT * FROM workspaces WHERE tenant_id=? AND id<>? ORDER BY created_at DESC LIMIT 1',
  [workspace.tenant_id,workspaceId]
);
assert.ok(otherWorkspace,'A second workspace from M30.1 isolation fixture is required');
r=await request('POST','/api/runtime/projects',{
  workspaceId:otherWorkspace.id,projectKey:`m305-isolated-${suffix}`,name:'隔离不可见项目',
  projectType:'PRODUCT_DEVELOPMENT',status:'ACTIVE'
});
expect(r,201);

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-search-audit/rebuild`,{});
const rebuilt=expect(r,200);
assert.ok(rebuilt.search.indexedCount>0);
assert.ok(rebuilt.audit.indexedCount>0);
for(const type of ['PROJECT','MILESTONE','WORK_ITEM','CAPABILITY','ENVIRONMENT','CONNECTION','INCIDENT','RELEASE_CANDIDATE','BACKUP']){
  assert.ok(rebuilt.search.coverage[type]>=1,`missing search type ${type}: ${JSON.stringify(rebuilt.search.coverage)}`);
}
for(const category of ['AUTHORIZATION','APPROVAL','GATE','HEALTH','INCIDENT','RELEASE','BACKUP']){
  assert.ok(rebuilt.audit.coverage[category]>=1,`missing audit category ${category}: ${JSON.stringify(rebuilt.audit.coverage)}`);
}

// Chinese search and type filtering.
r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('全局搜索验证')}`);
let search=expect(r,200);
assert.ok(search.results.some(x=>x.objectType==='PROJECT'&&x.objectId===project.id));

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('搜索验收')}&types=MILESTONE`);
search=expect(r,200);
assert.ok(search.results.some(x=>x.objectType==='MILESTONE'&&x.objectId===milestone.id));
assert.ok(search.results.every(x=>x.objectType==='MILESTONE'));

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('完成全局搜索验收')}&types=WORK_ITEM`);
search=expect(r,200);
assert.ok(search.results.some(x=>x.objectType==='WORK_ITEM'&&x.objectId===workItem.id));

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/global-search?q=${encodeURIComponent('隔离不可见')}`);
search=expect(r,200);
assert.equal(search.count,0,'cross-workspace project leaked into Global Search');

// Audit aggregate must expose original source references and SHA-256 fingerprints.
r=await request('GET',`/api/runtime/workspaces/${workspaceId}/audit-evidence?category=APPROVAL&limit=50`);
const approvals=expect(r,200);
assert.ok(approvals.count>=1);
assert.ok(approvals.items.some(x=>x.sourceType==='APPROVAL_REQUEST'));
assert.ok(approvals.items.every(x=>/^[0-9a-f]{64}$/.test(x.evidenceSha256)));
assert.ok(approvals.items.every(x=>x.evidence?.sourceRef?.type&&x.evidence?.sourceRef?.id));

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/audit-evidence?category=HEALTH&limit=100`);
const health=expect(r,200);
assert.ok(health.count>=1);
assert.ok(health.items.every(x=>x.category==='HEALTH'));

r=await request('POST',`/api/runtime/workspaces/${workspaceId}/m30-gates/G-M30-SEARCH-AUDIT/evaluate`,{
  asOf:'2026-10-07T08:50:00Z'
});
const gate=expect(r,200);
assert.equal(gate.status,'PASS',JSON.stringify(gate));
assert.equal(gate.evidenceSnapshot.upstreamRetentionBackupStatus,'PASS');
assert.deepEqual(gate.evidenceSnapshot.missingSearchTypes,[]);
assert.deepEqual(gate.evidenceSnapshot.missingAuditCategories,[]);
assert.equal(gate.evidenceSnapshot.badEvidenceHashCount,0);
assert.equal(gate.evidenceSnapshot.sourceOfTruthPolicy,'INDEX_REFERENCES_SOURCE_FACTS');
assert.equal(gate.evidenceSnapshot.workspaceScoped,true);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/m30-search-audit`);
const state=expect(r,200);
assert.equal(state.frontend.language,'zh-CN');
assert.equal(state.frontend.searchTitle,'全局搜索');
assert.equal(state.frontend.auditTitle,'审计 / 证据中心');
assert.match(state.frontend.policy,/Source-of-Truth/);
assert.equal(state.latestGate.status,'PASS');

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(DISTINCT object_type) FROM platform_search_documents WHERE workspace_id=?) search_types,
    (SELECT COUNT(DISTINCT category) FROM platform_audit_evidence_index WHERE workspace_id=?) audit_categories,
    (SELECT COUNT(*) FROM platform_audit_evidence_index WHERE workspace_id=? AND CHAR_LENGTH(evidence_sha256)<>64) bad_hash,
    (SELECT COUNT(*) FROM platform_search_documents WHERE workspace_id=? AND title='隔离不可见项目') leaked`,
  [workspaceId,workspaceId,workspaceId,workspaceId]
);
assert.ok(Number(truth.search_types)>=9);
assert.ok(Number(truth.audit_categories)>=7);
assert.equal(Number(truth.bad_hash),0);
assert.equal(Number(truth.leaked),0);

await db.end();
console.log('M30_5_GLOBAL_SEARCH_AUDIT_EVIDENCE_PASS');
