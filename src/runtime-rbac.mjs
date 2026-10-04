import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Identity metadata must not persist secrets','IDENTITY_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const hashToken=token=>createHash('sha256').update(String(token)).digest('hex');
const safeEqualHex=(left,right)=>{
  const a=Buffer.from(String(left||''),'hex'),b=Buffer.from(String(right||''),'hex');
  return a.length>0&&a.length===b.length&&timingSafeEqual(a,b);
};
const normalizePermissions=value=>{
  if(value==null) return null;
  if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!x.trim())) throw errorOf('allowedPermissions must be an array of permission keys','INVALID_CREDENTIAL_PERMISSIONS');
  return [...new Set(value.map(x=>x.trim()))].sort();
};

export const createIdentity=async input=>{
  if(!input?.identityKey||!input?.displayName) throw errorOf('identityKey and displayName are required','INVALID_IDENTITY');
  rejectSecrets(input.metadata||null);
  const db=getRuntimePool(),id=input.id||randomUUID();
  try{
    await db.execute(
      'INSERT INTO identities (id,identity_key,display_name,status,metadata_json) VALUES (?,?,?,?,?)',
      [id,input.identityKey,input.displayName,input.status||'ACTIVE',asJson(input.metadata||null)]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('identityKey already exists','IDENTITY_KEY_EXISTS',409);
    throw error;
  }
  return {id,identityKey:input.identityKey,displayName:input.displayName,status:input.status||'ACTIVE'};
};

const roleScope=async(db,roleKey)=>{
  const [rows]=await db.execute('SELECT role_key,scope_type FROM rbac_roles WHERE role_key=?',[roleKey]);
  if(!rows.length) throw errorOf('Role not found','ROLE_NOT_FOUND',404);
  return rows[0];
};

export const upsertTenantMembership=async input=>{
  if(!input?.tenantId||!input?.identityId||!input?.roleKey) throw errorOf('tenantId, identityId and roleKey are required','INVALID_TENANT_MEMBERSHIP');
  const db=getRuntimePool(),role=await roleScope(db,input.roleKey);
  if(role.scope_type!=='TENANT') throw errorOf('Role is not tenant-scoped','ROLE_SCOPE_MISMATCH',409);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO tenant_memberships (id,tenant_id,identity_id,role_key,status)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_key=VALUES(role_key),status=VALUES(status)`,
    [id,input.tenantId,input.identityId,input.roleKey,input.status||'ACTIVE']
  );
  const [rows]=await db.execute('SELECT * FROM tenant_memberships WHERE tenant_id=? AND identity_id=?',[input.tenantId,input.identityId]);
  return {id:rows[0].id,tenantId:rows[0].tenant_id,identityId:rows[0].identity_id,roleKey:rows[0].role_key,status:rows[0].status};
};

export const upsertWorkspaceMembership=async input=>{
  if(!input?.workspaceId||!input?.identityId||!input?.roleKey) throw errorOf('workspaceId, identityId and roleKey are required','INVALID_WORKSPACE_MEMBERSHIP');
  const db=getRuntimePool(),role=await roleScope(db,input.roleKey);
  if(role.scope_type!=='WORKSPACE') throw errorOf('Role is not workspace-scoped','ROLE_SCOPE_MISMATCH',409);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO workspace_memberships (id,workspace_id,identity_id,role_key,status)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_key=VALUES(role_key),status=VALUES(status)`,
    [id,input.workspaceId,input.identityId,input.roleKey,input.status||'ACTIVE']
  );
  const [rows]=await db.execute('SELECT * FROM workspace_memberships WHERE workspace_id=? AND identity_id=?',[input.workspaceId,input.identityId]);
  return {id:rows[0].id,workspaceId:rows[0].workspace_id,identityId:rows[0].identity_id,roleKey:rows[0].role_key,status:rows[0].status};
};

const membershipPermissions=async(db,{identityId,tenantId,workspaceId})=>{
  const [tenantRows]=await db.execute(
    `SELECT rp.permission_key
     FROM tenant_memberships tm
     JOIN rbac_role_permissions rp ON rp.role_key=tm.role_key
     WHERE tm.identity_id=? AND tm.tenant_id=? AND tm.status='ACTIVE'`,
    [identityId,tenantId]
  );
  let workspaceRows=[];
  if(workspaceId){
    [workspaceRows]=await db.execute(
      `SELECT rp.permission_key
       FROM workspace_memberships wm
       JOIN workspaces w ON w.id=wm.workspace_id
       JOIN rbac_role_permissions rp ON rp.role_key=wm.role_key
       WHERE wm.identity_id=? AND wm.workspace_id=? AND w.tenant_id=? AND wm.status='ACTIVE'`,
      [identityId,workspaceId,tenantId]
    );
  }
  return new Set([...tenantRows,...workspaceRows].map(x=>x.permission_key));
};

export const createApiCredential=async input=>{
  if(!input?.identityId||!input?.tenantId||!input?.name) throw errorOf('identityId, tenantId and name are required','INVALID_API_CREDENTIAL');
  const allowed=normalizePermissions(input.allowedPermissions);
  const db=getRuntimePool();
  const [identities]=await db.execute('SELECT id,status FROM identities WHERE id=?',[input.identityId]);
  if(!identities.length) throw errorOf('Identity not found','IDENTITY_NOT_FOUND',404);
  if(identities[0].status!=='ACTIVE') throw errorOf('Identity is not active','IDENTITY_NOT_ACTIVE',409);
  const [tenants]=await db.execute('SELECT id,status FROM tenants WHERE id=?',[input.tenantId]);
  if(!tenants.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
  if(tenants[0].status!=='ACTIVE') throw errorOf('Tenant is not active','TENANT_NOT_ACTIVE',409);
  if(input.workspaceId){
    const [workspaces]=await db.execute('SELECT id,tenant_id,status FROM workspaces WHERE id=?',[input.workspaceId]);
    if(!workspaces.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
    if(workspaces[0].tenant_id!==input.tenantId) throw errorOf('Workspace does not belong to tenant','WORKSPACE_TENANT_MISMATCH',409);
    if(workspaces[0].status!=='ACTIVE') throw errorOf('Workspace is not active','WORKSPACE_NOT_ACTIVE',409);
  }
  const permissions=await membershipPermissions(db,{identityId:input.identityId,tenantId:input.tenantId,workspaceId:input.workspaceId||null});
  if(!permissions.size) throw errorOf('Identity has no active membership in credential scope','CREDENTIAL_MEMBERSHIP_REQUIRED',403);
  if(allowed&&allowed.some(p=>!permissions.has(p))) throw errorOf('Credential permissions exceed membership permissions','CREDENTIAL_PERMISSION_ESCALATION',403);
  const id=randomUUID(),prefix=randomBytes(6).toString('hex'),secret=randomBytes(32).toString('base64url');
  const token=`rtk_${prefix}_${secret}`;
  const expiresAt=input.expiresAt?new Date(input.expiresAt):null;
  if(expiresAt&&Number.isNaN(expiresAt.getTime())) throw errorOf('expiresAt is invalid','INVALID_CREDENTIAL_EXPIRY');
  await db.execute(
    `INSERT INTO api_credentials (
      id,credential_prefix,token_hash,identity_id,tenant_id,workspace_id,name,status,
      allowed_permissions_json,expires_at
    ) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`,
    [id,prefix,hashToken(token),input.identityId,input.tenantId,input.workspaceId||null,input.name,asJson(allowed),expiresAt]
  );
  return {
    id,name:input.name,credentialPrefix:prefix,identityId:input.identityId,tenantId:input.tenantId,
    workspaceId:input.workspaceId||null,allowedPermissions:allowed,expiresAt,token
  };
};

export const revokeApiCredential=async id=>{
  const db=getRuntimePool();
  const [result]=await db.execute(
    "UPDATE api_credentials SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP(6) WHERE id=? AND status<>'REVOKED'",
    [id]
  );
  if(!result.affectedRows){
    const [rows]=await db.execute('SELECT id,status FROM api_credentials WHERE id=?',[id]);
    if(!rows.length) throw errorOf('Credential not found','CREDENTIAL_NOT_FOUND',404);
  }
  return {id,status:'REVOKED'};
};

export const listRbacRoles=async()=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT r.role_key,r.scope_type,r.name,GROUP_CONCAT(rp.permission_key ORDER BY rp.permission_key) AS permissions
     FROM rbac_roles r LEFT JOIN rbac_role_permissions rp ON rp.role_key=r.role_key
     GROUP BY r.role_key,r.scope_type,r.name ORDER BY r.scope_type,r.role_key`
  );
  return rows.map(r=>({roleKey:r.role_key,scopeType:r.scope_type,name:r.name,permissions:r.permissions?String(r.permissions).split(','):[]}));
};

export const authenticateScopedCredential=async token=>{
  const match=String(token||'').match(/^rtk_([a-f0-9]{12})_[A-Za-z0-9_-]+$/);
  if(!match) return null;
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.*,i.status AS identity_status,t.status AS tenant_status,w.status AS workspace_status
     FROM api_credentials c
     JOIN identities i ON i.id=c.identity_id
     JOIN tenants t ON t.id=c.tenant_id
     LEFT JOIN workspaces w ON w.id=c.workspace_id
     WHERE c.credential_prefix=? LIMIT 1`,
    [match[1]]
  );
  if(!rows.length) return null;
  const row=rows[0];
  if(!safeEqualHex(hashToken(token),row.token_hash)) return null;
  if(row.status!=='ACTIVE'||row.identity_status!=='ACTIVE'||row.tenant_status!=='ACTIVE') throw errorOf('Scoped credential is inactive','RUNTIME_CREDENTIAL_INACTIVE',401);
  if(row.workspace_id&&row.workspace_status!=='ACTIVE') throw errorOf('Scoped credential workspace is inactive','RUNTIME_CREDENTIAL_INACTIVE',401);
  if(row.expires_at&&new Date(row.expires_at).getTime()<=Date.now()) throw errorOf('Scoped credential expired','RUNTIME_CREDENTIAL_EXPIRED',401);
  const permissions=await membershipPermissions(db,{
    identityId:row.identity_id,tenantId:row.tenant_id,workspaceId:row.workspace_id
  });
  const allowed=Array.isArray(row.allowed_permissions_json)?new Set(row.allowed_permissions_json):null;
  const effective=[...permissions].filter(p=>!allowed||allowed.has(p));
  await db.execute('UPDATE api_credentials SET last_used_at=CURRENT_TIMESTAMP(6) WHERE id=?',[row.id]);
  return {
    type:'SCOPED',platformAdmin:false,credentialId:row.id,identityId:row.identity_id,
    tenantId:row.tenant_id,workspaceId:row.workspace_id,permissions:new Set(effective)
  };
};

const persistDecision=async({principal,method,path,permission,decision,reasonCode,tenantId=null,workspaceId=null})=>{
  if(!principal||principal.platformAdmin) return;
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO authorization_decisions (
      id,credential_id,identity_id,tenant_id,workspace_id,method,path,permission_key,decision,reason_code
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(),principal.credentialId||null,principal.identityId||null,tenantId||principal.tenantId||null,
     workspaceId||principal.workspaceId||null,method,path,permission||null,decision,reasonCode||null]
  );
};

export const assertAccess=async({principal,permission,tenantId=null,workspaceId=null,method='UNKNOWN',path=''})=>{
  if(principal?.platformAdmin) return;
  if(!principal||principal.type!=='SCOPED') throw errorOf('Runtime authentication required','RUNTIME_UNAUTHORIZED',401);
  let reason=null;
  if(tenantId&&tenantId!==principal.tenantId) reason='CROSS_TENANT_DENIED';
  else if(principal.workspaceId&&workspaceId&&workspaceId!==principal.workspaceId) reason='CROSS_WORKSPACE_DENIED';
  else if(!principal.permissions.has(permission)) reason='PERMISSION_DENIED';
  if(reason){
    await persistDecision({principal,method,path,permission,decision:'DENY',reasonCode:reason,tenantId,workspaceId});
    throw errorOf('Runtime authorization denied','RUNTIME_FORBIDDEN',403,{permission,reasonCode:reason});
  }
  await persistDecision({principal,method,path,permission,decision:'ALLOW',reasonCode:null,tenantId,workspaceId});
};

export const resolveWorkspaceScope=async workspaceId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,tenant_id FROM workspaces WHERE id=?',[workspaceId]);
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].id};
};
export const resolveProjectScope=async projectId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,tenant_id,workspace_id FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};
export const resolveRunScope=async runId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT id,tenant_id,workspace_id FROM runs WHERE id=?',[runId]);
  if(!rows.length) throw errorOf('Run not found','RUN_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:rows[0].workspace_id};
};

export const requirePlatformAdmin=principal=>{
  if(!principal?.platformAdmin) throw errorOf('Platform administrator credential required','PLATFORM_ADMIN_REQUIRED',403);
};
