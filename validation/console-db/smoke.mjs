import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.RUNTIME_REQUIRE_AUTH='true';
process.env.RUNTIME_API_TOKEN=randomBytes(32).toString('hex');
const {server}=await import('../../src/server.mjs');
const {getRuntimePool}=await import('../../src/runtime-db.mjs');
const {createConsoleServer}=await import('./console/server.mjs');
const report=[];
async function request(base,path,status,options={}) {
 const r=await fetch(base+path,{...options,headers:{...options.headers,connection:'close'}});const body=await r.json();
 assert.equal(r.status,status,JSON.stringify({path,status:r.status,body}));
 report.push({path,status:r.status});return {r,body};
}
let bff;const dir=await mkdtemp(join(tmpdir(),'console-db-'));
try {
 await new Promise(r=>server.listen(43800,'127.0.0.1',r));
 const runtime='http://127.0.0.1:43800',origin='http://127.0.0.1:43801';
 await request(runtime,'/health',200);
 const ready=await request(runtime,'/ready',200);assert.equal(ready.body.components.database.ready,true);assert.equal(ready.body.status,'degraded');
 await request(runtime,'/api/runtime/projects',401);
 const token=process.env.RUNTIME_API_TOKEN;
 const auth={authorization:'Bearer '+token,'content-type':'application/json'};
 const created=await request(runtime,'/api/runtime/projects',201,{method:'POST',headers:auth,body:JSON.stringify({projectKey:'isolated-console-db',name:'隔离联调项目',projectType:'PRODUCT'})});
 const [rows]=await getRuntimePool().execute('SELECT id FROM projects WHERE project_key=?',['isolated-console-db']);assert.equal(rows.length,1);
 const env={...process.env,NODE_ENV:'test',RUNTIME_API_BASE_URL:'http://localhost:43800',CONSOLE_ALLOW_HTTP_LOCAL:'true',CONSOLE_ALLOW_SHARED_ADMIN_LOGIN:'true',CONSOLE_ADMIN_PASSWORD:randomBytes(24).toString('hex'),CONSOLE_SESSION_KEY:randomBytes(32).toString('hex'),CONSOLE_SESSION_DIR:dir};
 const start=async()=>{bff=createConsoleServer({env});await new Promise(r=>bff.listen(43801,'127.0.0.1',r));};
 await start();
 await request(origin,'/api/runtime/projects',401);
 const login=await request(origin,'/auth/login',200,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:env.CONSOLE_ADMIN_PASSWORD})});
 const cookie=login.r.headers.get('set-cookie').split(';')[0];
 await request(origin,'/api/runtime/workspaces',200,{headers:{cookie}});
 await request(origin,'/api/runtime/projects?workspaceId=00000000-0000-4000-8000-000000000102&offset=0&limit=100',200,{headers:{cookie}});
 const next=randomBytes(24).toString('hex');
 await request(origin,'/auth/change-password',200,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({currentPassword:env.CONSOLE_ADMIN_PASSWORD,newPassword:next})});
 await new Promise(r=>bff.close(r));await start();
 await request(origin,'/auth/session',200,{headers:{cookie}});
 await request(origin,'/auth/login',200,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:next})});
 console.log(JSON.stringify({result:'PASS',checks:report,databaseWriteRead:'PASS',bffRestartSession:'PASS',passwordAfterRestart:'PASS',model:'NOT_CONFIGURED',browserQA:'NOT_RUN'},null,2));
} finally {if(bff?.listening)await new Promise(r=>bff.close(r));await new Promise(r=>server.close(r));await getRuntimePool().end();await rm(dir,{recursive:true,force:true});}
