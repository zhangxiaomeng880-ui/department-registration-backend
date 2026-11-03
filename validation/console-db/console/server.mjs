import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {createSessionStore} from './session-store.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const MIME={'/theme.css':'text/css; charset=utf-8','/frontend-panels.mjs':'text/javascript; charset=utf-8','/':'text/html; charset=utf-8','/index.html':'text/html; charset=utf-8','/requirements.html':'text/html; charset=utf-8','/credential-admin.html':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/requirements.js':'text/javascript; charset=utf-8','/credential-admin.js':'text/javascript; charset=utf-8','/read-guards.mjs':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8','/requirements.css':'text/css; charset=utf-8','/credential-admin.css':'text/css; charset=utf-8','/workspace-v2.mjs':'text/javascript; charset=utf-8'};
const ASSETS={'/theme.css':'theme.css','/frontend-panels.mjs':'frontend-panels.mjs','/':'index.html','/index.html':'index.html','/requirements.html':'requirements.html','/credential-admin.html':'credential-admin.html','/app.js':'app.js','/requirements.js':'requirements.js','/credential-admin.js':'credential-admin.js','/read-guards.mjs':'read-guards.mjs','/style.css':'style.css','/requirements.css':'requirements.css','/credential-admin.css':'credential-admin.css','/workspace-v2.mjs':'workspace-v2.mjs'};

const headers={
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'x-frame-options':'DENY','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};
// The static main Console shell contains no user data. Sensitive JSON and files keep no-store.
const shellHeaders={...headers,'cache-control':'private, no-cache'};
const error=(code,status=400)=>Object.assign(new Error(code),{status,code});
const json=(res,status,data,extra={})=>{res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));};
const equals=(a,b)=>{const x=createHash('sha256').update(a).digest(),y=createHash('sha256').update(b).digest();return timingSafeEqual(x,y);};
const readJson=async req=>{
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>16384)throw error('REQUEST_TOO_LARGE',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw error('INVALID_JSON');}
};
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(x=>x.length===2));
const sameOrigin=req=>{
  const origin=req.headers.origin;const host=req.headers.host;
  if(!origin||!host)return false;
  try{return new URL(origin).host===String(host).split(',')[0].trim()&&['https:','http:'].includes(new URL(origin).protocol);}catch{return false;}
};
const allowed=(method,path)=>{
  if(method==='GET'){
    if(/^\/api\/runtime\/runs\/[A-Za-z0-9-]{1,80}\/observability$/.test(path))return true;
    if(/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/(cost-summary|product-release-readiness|product-release-rollout)$/.test(path))return true;
    if(['/api/runtime/workspaces','/api/runtime/project-types','/api/runtime/project-subtypes','/api/runtime/domain-presets','/api/runtime/aigc-modules','/api/runtime/aigc-ui-labels','/api/runtime/capabilities','/api/runtime/projects'].includes(path))return true;
    if(/^\/api\/runtime\/projects\/[a-zA-Z0-9-]{1,64}\/(knowledge-bindings|audit-events|lifecycle|governance|stage-transitions|aigc-foundation|aigc-script-domain|aigc-breakdown|aigc-format-strategy|aigc-asset-system|aigc-generation-image|aigc-video-audio-production|aigc-edit-timeline|aigc-mastering|aigc-distribution-package|aigc-release-publishing|aigc-performance|aigc-review|product-domain|product-delivery-domain|product-engineering-domain|product-quality-domain|product-outcome|product-review)$/.test(path))return true;
    if(/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/assets\/[A-Za-z0-9-]{1,64}\/versions\/[A-Za-z0-9-]{1,64}\/(access|content)$/.test(path))return true;
    if(/^\/api\/runtime\/workspaces\/[a-zA-Z0-9-]{1,64}\/(audit-evidence|global-search)$/.test(path))return true;
    if(/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/requirement-completions(?:\/[A-Za-z0-9-]{1,80})?$/.test(path))return true;
  }
  if(method==='POST'&&path==='/api/runtime/projects')return true;
  if(method==='POST'&&/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/requirement-completions(?:\/[A-Za-z0-9-]{1,80}\/(decisions|handoff))?$/.test(path))return true;
  return false;
};
const credentialAdminAllowed=(method,path)=>{
  if(method==='GET'&&['/api/runtime/workspaces','/api/runtime/identities','/api/runtime/rbac-roles','/api/runtime/workspace-memberships','/api/runtime/api-credentials'].includes(path))return true;
  if(method==='POST'&&['/api/runtime/identities','/api/runtime/workspace-memberships','/api/runtime/api-credentials'].includes(path))return true;
  return method==='POST'&&/^\/api\/runtime\/api-credentials\/[A-Za-z0-9-]{1,80}\/revoke$/.test(path);
};
export const createConsoleServer=({env=process.env,fetchImpl=fetch}={})=>{
  const sessions=createSessionStore(env),failed=new Map();
  if(!env.RUNTIME_API_BASE_URL||((env.CONSOLE_ALLOW_SHARED_ADMIN_LOGIN==='true'||env.CONSOLE_ALLOW_CREDENTIAL_ADMIN_LOGIN==='true')&&(!env.CONSOLE_ADMIN_PASSWORD||!env.RUNTIME_API_TOKEN)))throw error('CONSOLE_CONFIGURATION_REQUIRED',503);
  if(!/^https:\/\//.test(env.RUNTIME_API_BASE_URL)&&!(env.CONSOLE_ALLOW_HTTP_LOCAL==='true'&&/^http:\/\/localhost(:\d+)?$/.test(env.RUNTIME_API_BASE_URL)))throw error('INVALID_RUNTIME_BASE_URL',503);
  const base=env.RUNTIME_API_BASE_URL.replace(/\/$/,'');
  const secure=env.NODE_ENV==='production' ? '; Secure' : '';
  const accountFile=join(env.CONSOLE_SESSION_DIR||'/tmp','owner-password.json');
  const ownerPassword=async value=>{
    try{
      const saved=JSON.parse(await readFile(accountFile,'utf8'));
      const savedMatch=equals(saved.hash,createHash('sha256').update(saved.salt+value).digest('hex'));
      const recoveryMatch=!!env.CONSOLE_ADMIN_PASSWORD&&equals(value,env.CONSOLE_ADMIN_PASSWORD);
      return savedMatch||recoveryMatch;
    }
    catch(e){if(e.code!=='ENOENT')throw e;return !!env.CONSOLE_ADMIN_PASSWORD&&equals(value,env.CONSOLE_ADMIN_PASSWORD);}
  };
  const saveOwnerPassword=async value=>{
    if(typeof value!=='string'||value.length<12||value.length>128)throw error('PASSWORD_POLICY_REQUIRED',400);
    const salt=randomBytes(24).toString('hex'),hash=createHash('sha256').update(salt+value).digest('hex');
    await mkdir(dirname(accountFile),{recursive:true,mode:0o700});
    const temporary=accountFile+'.'+randomBytes(8).toString('hex')+'.tmp';
    await writeFile(temporary,JSON.stringify({salt,hash}),{mode:0o600,flag:'wx'});await rename(temporary,accountFile);
  };
  let probeCache=null;
  const runtimeProbe=async()=>{
    if(probeCache && Date.now()<probeCache.expires)return probeCache;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
    const checks={authorizedWorkspaces:'BLOCKED',projectList:'BLOCKED',lifecycle:'NOT_APPLICABLE',primaryAudit:'NOT_APPLICABLE'};
    try{
      const query=async path=>{
        const res=await fetchImpl(base+path,{
          method:'GET',redirect:'error',signal:controller.signal,
          headers:{'authorization':'Bearer '+env.RUNTIME_API_TOKEN,'accept':'application/json'}
        });
        if(!res.ok)throw error('UPSTREAM_HTTP_'+res.status,503);
        const body=await res.json();
        if(!body||!Object.hasOwn(body,'data'))throw error('UPSTREAM_CONTRACT_INVALID',503);
        return body.data;
      };
      const workspaces=await query('/api/runtime/workspaces');
      if(!Array.isArray(workspaces))throw error('WORKSPACE_CONTRACT_INVALID',503);
      checks.authorizedWorkspaces='PASS';
      if(!workspaces.length)throw error('WORKSPACE_EMPTY',503);
      const workspaceId=workspaces[0].id;
      if(typeof workspaceId!=='string')throw error('WORKSPACE_ID_INVALID',503);
      const listing=await query('/api/runtime/projects?workspaceId='+encodeURIComponent(workspaceId)+'&limit=10');
      if(!Array.isArray(listing?.items)||!Number.isSafeInteger(listing.total))throw error('PROJECT_LIST_CONTRACT_INVALID',503);
      checks.projectList='PASS';
      if(listing.items.length){
        const id=listing.items[0].id;
        if(typeof id!=='string')throw error('PROJECT_ID_INVALID',503);
        const lifecycle=await query('/api/runtime/projects/'+encodeURIComponent(id)+'/lifecycle');
        if(!Array.isArray(lifecycle?.stages))throw error('LIFECYCLE_CONTRACT_INVALID',503);
        checks.lifecycle='PASS';
        const audit=await query('/api/runtime/projects/'+encodeURIComponent(id)+'/audit-events?limit=3');
        if(audit?.source!=='AUDIT_LOGS_PRIMARY'||!Array.isArray(audit.items))throw error('AUDIT_CONTRACT_INVALID',503);
        checks.primaryAudit='PASS';
      }
      probeCache={expires:Date.now()+30000,status:200,result:{status:'ready',checks}};
    }catch(e){
      probeCache={expires:Date.now()+10000,status:503,result:{status:'blocked',checks,error:e.code||'UPSTREAM_UNAVAILABLE'}};
    }finally{clearTimeout(timer);}
    return probeCache;
  };
  const sess=req=>sessions.get(cookies(req).ain_session);
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://internal.local'),path=url.pathname;
      if(req.method==='GET'&&path==='/healthz')return json(res,200,{status:'ok',mode:'STAGING_CONSOLE',runtimeConfigured:true});
      // Read-only staging diagnostics: no project names, IDs, counts or secrets in response.
      if(req.method==='GET'&&path==='/healthz/runtime'){
        if(env.CONSOLE_RUNTIME_PROBE_ENABLED!=='true')throw error('NOT_FOUND',404);
        const probe=await runtimeProbe();return json(res,probe.status,probe.result);
      }
      if(req.method==='GET'&&path==='/auth/session'){
        const s=await sess(req);
        return json(res,200,{authenticated:!!s,mode:s?.mode||null,owner:!!s&&s.mode==='owner',writesEnabled:!!s&&s.mode==='scoped'&&s.permissions.includes('project:write')&&env.CONSOLE_ALLOW_WRITES==='true',credentialAdmin:!!s&&s.mode==='staging-credential-admin',sharedLoginEnabled:env.CONSOLE_ALLOW_SHARED_ADMIN_LOGIN==='true',credentialAdminLoginEnabled:env.CONSOLE_ALLOW_CREDENTIAL_ADMIN_LOGIN==='true',environment:'PRODUCTION'});
      }
      if(req.method==='POST'){
        if(!sameOrigin(req))throw error('ORIGIN_MISMATCH',403);
        if(req.headers['content-type']?.split(';')[0]!=='application/json')throw error('JSON_CONTENT_TYPE_REQUIRED',415);
      }
      if(req.method==='POST'&&path==='/auth/login'){
        // The app never stores a Runtime credential in browser storage or
        // returns it to a client. All subsequent calls use an HttpOnly session.
        const ip=String(req.socket.remoteAddress||'unknown');
        const previous=failed.get(ip)||{count:0,until:0};
        const strikes=Date.now()>=previous.until?{count:0,until:0}:previous;
        if(strikes.count>=5)throw error('LOGIN_RATE_LIMITED',429);
        const body=await readJson(req);
        let credential=null,mode=null,identityId=null,permissions=[];
        if(typeof body.credential==='string'&&body.credential){
          if(!/^rtk_[a-f0-9]{12}_[A-Za-z0-9_-]{30,80}$/.test(body.credential)){
            throw error('INVALID_CREDENTIALS',401);
          }
          credential=body.credential;
          const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
          try{
            const authenticatedGet=async path=>{
              const reply=await fetchImpl(base+path,{
                method:'GET',redirect:'error',signal:controller.signal,
                headers:{'authorization':'Bearer '+credential,'accept':'application/json'}
              });
              if(reply.status!==200)throw error('INVALID_CREDENTIALS',401);
              const response=await reply.json();
              return response?.data;
            };
            const self=await authenticatedGet('/api/runtime/me');
            if(self?.principalType!=='SCOPED'||self.platformAdmin!==false||!self.identityId||
               !Array.isArray(self.permissions)||!['workspace:read','project:read'].every(x=>self.permissions.includes(x))){
              throw error('SCOPED_READER_PERMISSIONS_REQUIRED',403);
            }
            const workspaces=await authenticatedGet('/api/runtime/workspaces');
            if(!Array.isArray(workspaces)||!workspaces.length)throw error('SCOPED_WORKSPACE_REQUIRED',403);
            identityId=self.identityId;
            permissions=self.permissions;
            mode='scoped';
          }finally{clearTimeout(timeout);}
        }else if(typeof body.adminPassword==='string'&&env.CONSOLE_ALLOW_CREDENTIAL_ADMIN_LOGIN==='true'&&
          env.CONSOLE_ADMIN_PASSWORD&&equals(body.adminPassword,env.CONSOLE_ADMIN_PASSWORD)){
          credential=env.RUNTIME_API_TOKEN;
          mode='staging-credential-admin';
        }else if(typeof body.password==='string'&&env.CONSOLE_ALLOW_SHARED_ADMIN_LOGIN==='true'&&await ownerPassword(body.password)){
          credential=env.RUNTIME_API_TOKEN;
          mode='owner';
        }else{
          failed.set(ip,{count:strikes.count+1,until:Date.now()+900000});
          throw error('INVALID_CREDENTIALS',401);
        }
        failed.delete(ip);
        const sid=randomBytes(32).toString('hex');
        const ttl=mode==='staging-credential-admin'?1800:mode==='owner'?2592000:28800;
        await sessions.set(sid,{exp:Date.now()+ttl*1000,mode,credential,identityId,permissions});
        return json(res,200,{authenticated:true,mode},{'set-cookie':`ain_session=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure}`});
      }
      if(req.method==='POST'&&path==='/auth/logout'){
        const sid=cookies(req).ain_session;if(sid)await sessions.delete(sid);
        return json(res,200,{authenticated:false},{'set-cookie':`ain_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`});
      }
      if(req.method==='POST'&&path==='/auth/change-password'){
        const session=await sess(req);if(!session||session.mode!=='owner')throw error('OWNER_SESSION_REQUIRED',403);
        const body=await readJson(req);if(!await ownerPassword(body.currentPassword||''))throw error('CURRENT_PASSWORD_INVALID',401);
        await saveOwnerPassword(body.newPassword);return json(res,200,{changed:true});
      }
      if(path.startsWith('/api/')){
        const session=await sess(req);
        if(!session)throw error('CONSOLE_UNAUTHORIZED',401);
        if(session.mode==='owner'){
          if(!allowed(req.method,path)&&!credentialAdminAllowed(req.method,path))throw error('OWNER_ROUTE_NOT_ALLOWED',403);
        }else if(session.mode==='staging-credential-admin'){
          if(!credentialAdminAllowed(req.method,path))throw error('CREDENTIAL_ADMIN_ROUTE_NOT_ALLOWED',403);
        }else if(!allowed(req.method,path))throw error('API_ROUTE_NOT_ALLOWED',403);
        if(/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/assets\/[A-Za-z0-9-]{1,64}\/versions\/[A-Za-z0-9-]{1,64}\/(access|content)$/.test(path)&&!['scoped','owner'].includes(session.mode))
          throw error('PERSONAL_SCOPED_FILE_ACCESS_REQUIRED',403);
        if(req.method!=='GET'){
          const scopedWrite=env.CONSOLE_ALLOW_WRITES==='true'&&session.mode==='scoped'&&session.permissions.includes('project:write');
          const credentialAdminWrite=['staging-credential-admin','owner'].includes(session.mode)&&credentialAdminAllowed(req.method,path);
          if(!scopedWrite&&!credentialAdminWrite)throw error('SCOPED_STAGING_WRITE_REQUIRED',403);
        }
        const body=req.method==='POST'?await readJson(req):null;
        if(req.method==='POST'&&path==='/api/runtime/projects'&&(!body.workspaceId||!body.projectKey||!body.name||!['AIGC_CONTENT','PRODUCT_DEVELOPMENT'].includes(body.projectType)))throw error('INVALID_PROJECT_INPUT');
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),path.includes('/requirement-completions')?120000:15000);
        try{
          const result=await fetchImpl(base+path+url.search,{
            method:req.method,headers:{
              'authorization':'Bearer '+session.credential,
              'accept':'application/json',...(body?{'content-type':'application/json'}:{})
            },...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal
          });
          // Stream only the one allowlisted, authenticated attachment route.
          // Never allow an arbitrary URL or forward the S3 signing credentials.
          const isFile=/^\/api\/runtime\/projects\/[A-Za-z0-9-]{1,64}\/assets\/[A-Za-z0-9-]{1,64}\/versions\/[A-Za-z0-9-]{1,64}\/content$/.test(path);
          if(isFile&&result.ok){
            const size=Number(result.headers.get('content-length'));
            const mime=(result.headers.get('content-type')||'application/octet-stream').split(';')[0].toLowerCase();
            const allowedMime=['application/pdf','image/png','image/jpeg','image/webp','text/plain','application/json','audio/mpeg','audio/wav','video/mp4','application/octet-stream'];
            if(!allowedMime.includes(mime)||!Number.isSafeInteger(size)||size<0||size>20*1024*1024)
              throw error('FILE_PROXY_CONTRACT_INVALID',502);
            let bytes=0;const chunks=[];
            for await(const chunk of result.body){
              bytes+=chunk.byteLength;
              if(bytes>20*1024*1024)throw error('FILE_PROXY_TOO_LARGE',413);
              chunks.push(Buffer.from(chunk));
            }
            if(bytes!==size)throw error('FILE_PROXY_LENGTH_MISMATCH',502);
            const payload=Buffer.concat(chunks,bytes);
            res.writeHead(200,{...headers,'content-type':mime,'content-length':bytes,
              'content-disposition':'attachment; filename="authorized-asset"',
              'content-security-policy':"sandbox; default-src 'none'"});
            return res.end(payload);
          }
          const raw=(await result.text()).slice(0,1048576);
          let payload;try{payload=JSON.parse(raw);}catch{payload={error:'RUNTIME_NON_JSON_RESPONSE'};}
          if(result.status===401){
            if(session.mode==='scoped'){
              const sid=cookies(req).ain_session;
              if(sid)await sessions.delete(sid);
            }
          }
          return json(res,result.status,payload);
        }finally{clearTimeout(timeout);}
      }
      if(req.method==='GET'&&path==='/credential-admin'){
        const bytes=await readFile(join(root,'public','credential-admin.html'));
        res.writeHead(200,{...headers,'content-type':MIME['/credential-admin.html']});return res.end(bytes);
      }
      if(req.method==='GET'&&path==='/requirements'){
        const bytes=await readFile(join(root,'public','requirements.html'));
        res.writeHead(200,{...headers,'content-type':MIME['/requirements.html']});return res.end(bytes);
      }
      // Addressable project pages: deep links and browser back/forward always
      // load the same authenticated shell, never a fabricated project snapshot.
      if(req.method==='GET'&&(['/dashboard','/projects','/ai-runtime','/assets','/capabilities','/knowledge','/analytics','/management'].includes(path)||/^\/projects\/[A-Za-z0-9-]{1,64}\/runs\/[A-Za-z0-9-]{1,80}$/.test(path)||new RegExp('^/projects/[A-Za-z0-9-]{1,64}(/(overview|definition|tasks|assets|data|stages|audit|quality|release|knowledge|analytics|settings|runs)(/[A-Za-z0-9-]{1,64})?)?'+String.fromCharCode(36)).test(path))){
        const bytes=await readFile(join(root,'public','index.html'));
        res.writeHead(200,{...shellHeaders,'content-type':MIME['/']});return res.end(bytes);
      }
      if(req.method==='GET'&&ASSETS[path]){
        const bytes=await readFile(join(root,'public',ASSETS[path]));
        res.writeHead(200,{...(path==='/'||path==='/index.html'?shellHeaders:headers),'content-type':MIME[path]});return res.end(bytes);
      }
      throw error('NOT_FOUND',404);
    }catch(e){return json(res,e.status||502,{error:e.code||'UPSTREAM_UNAVAILABLE'});}
  });
};
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    createConsoleServer().listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AI Native Console listening'));
  }catch(e){console.error(e.code||'STARTUP_FAILED');process.exitCode=1;}
}
