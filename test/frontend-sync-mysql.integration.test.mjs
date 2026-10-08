import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimePool, createProject } from '../src/runtime-db.mjs';
import { listWorkbenchProjects, listWorkbenchProjectAudit } from '../src/frontend-sync-api.mjs';

const W1='00000000-0000-4000-8000-000000000901';
const W2='00000000-0000-4000-8000-000000000902';
const T1='00000000-0000-4000-8000-000000000911';
const T2='00000000-0000-4000-8000-000000000912';

test('real MySQL: creating a project produces an atomic audit event and survives a fresh query',async()=>{
  const db=getRuntimePool();
  try{
    await db.query('CREATE TABLE tenants (id CHAR(36) PRIMARY KEY,status VARCHAR(32) NOT NULL)');
    await db.query('CREATE TABLE workspaces (id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,status VARCHAR(32) NOT NULL)');
    await db.query(`CREATE TABLE projects (
       id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,workspace_id CHAR(36) NOT NULL,
       project_key VARCHAR(128) UNIQUE NOT NULL,name VARCHAR(255) NOT NULL,project_type VARCHAR(64) NOT NULL,
       project_subtype_key VARCHAR(128) NULL,status VARCHAR(32) NOT NULL,
       current_workflow_version VARCHAR(64) NULL,current_knowledge_commit_sha CHAR(40) NULL,
       current_stage_key VARCHAR(128) NULL,workflow_template_id CHAR(36) NULL,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE audit_logs (
       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,project_id CHAR(36) NULL,
       event_type VARCHAR(128) NOT NULL,actor_type VARCHAR(32) NOT NULL,
       actor_key VARCHAR(128) NOT NULL,object_type VARCHAR(64) NULL,
       object_id VARCHAR(128) NULL,event_json JSON NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.execute('INSERT INTO tenants (id,status) VALUES (?,?), (?,?)',[T1,'ACTIVE',T2,'ACTIVE']);
    await db.execute('INSERT INTO workspaces (id,tenant_id,status) VALUES (?,?,?), (?,?,?)',[W1,T1,'ACTIVE',W2,T2,'ACTIVE']);
    const saved=await createProject({
      workspaceId:W1,projectKey:'M31_MYSQL_REAL',name:'前端实际落库验收样例',
      projectType:'AIGC_CONTENT',auditActor:{type:'SCOPED',actorKey:'test-user-m31'}
    });
    assert.ok(saved.id&&saved.workspaceId===W1);
    const page1=await listWorkbenchProjects({workspaceId:W1,limit:10,offset:0});
    assert.equal(page1.total,1);
    assert.equal(page1.items[0].id,saved.id);
    const page2=await listWorkbenchProjects({workspaceId:W2,limit:10,offset:0});
    assert.equal(page2.total,0,'No cross-workspace projects');
    const [audit]=await db.execute(
      'SELECT event_type,actor_type,actor_key,project_id,event_json FROM audit_logs WHERE project_id=?',[saved.id]
    );
    assert.equal(audit.length,1);
    assert.equal(audit[0].event_type,'PROJECT_CREATED');
    assert.equal(audit[0].actor_key,'test-user-m31');
    assert.equal(audit[0].event_json.source,'RUNTIME_PROJECTS_API');
    const liveAudit=await listWorkbenchProjectAudit({projectId:saved.id,limit:10});
    assert.equal(liveAudit.source,'AUDIT_LOGS_PRIMARY');
    assert.equal(liveAudit.items.length,1);
    assert.equal(liveAudit.items[0].eventType,'PROJECT_CREATED');
    assert.equal(liveAudit.items[0].projectId,saved.id);
  }finally{await db.end();}
});
