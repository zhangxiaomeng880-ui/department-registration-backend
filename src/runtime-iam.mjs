import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const IDENTITY_TYPES=new Set(['USER','SERVICE']);
const MEMBER_STATUS=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const safeEqual=(a,b)=>{
  const left=Buffer.from(String(a||''),'utf8'),right=Buffer.from(String(b||''),'utf8');
  return left.length>0&&left.length===right.length&&timingSafeEqual(left,right);
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('IAM metadata must not persist credentials or secrets','IAM_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const normalizeIdentity=row=>({
  id:row.id,identityKey:row.identity_key,identityType:row.identity_type,
  displayName:row.display_name,status:row.status,metadata:row.metadata_json,
  createdAt:row.created_at,updatedAt:row.updated_at,
});
const normalizeCredential=row=>({
  id:row.id,identityId:row.identity_id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  credentialPrefix:row.credential_prefix,status:row.status,expiresAt:row.expires_at,
  lastUsedAt:row.last_used_at,metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at,
});

export const createIdentity=async input=>{
  if(!input?.identityKey||!input?.displayName) throw errorOf('identityKey and displayName are required','INVALID_IDENTITY');
  rejectSecrets(input.metadata||null);
  const identityType=String(input.identityType||'SERVICE').toUpperCase();
  if(!IDENTITY_TYPES.has(identityType)) throw errorOf('identityType must be USER or SERVICE','INVALID_IDENTITY_TYPE');
  const db=getRuntimePool(),id=input.id||randomUUID();
  try{
    await db.execute(
      'INSERT INTO identities (id,identity_key,identity_type,display_name,status,metadata_json) VALUES (?,?,?,?,?,?)',
      [id,input.identityKey,identityType,input.displayName,input.status||'ACTIVE',asJson(input.metadata||null)]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('identityKey already exists','IDENTITY_KEY_EXISTS',409);
    throw error;
  }
  const [rows]=await db.execute('SELECT * FROM identities WHERE id=?',[id]);
  return normalizeIdentity(rows[0]);
};

const assertRoleScope=async(db,roleKey,expected)=>{
  const [rows]=await db.execute('SELECT role_key,scope_type,status FROM roles WHERE role_key=?',[roleKey]);
  if(!rows.length) throw errorOf('Role not found','ROLE_NOT_FOUND',404);
  if(rows[0].status!=='ACTIVE') throw errorOf('Role is not active','ROLE_NOT_ACTIVE',409);
  if(rows[0].scope_type!==expected) throw errorOf('Role scope does not match membership scope','ROLE_SCOPE_MISMATCH',409);
};

export const upsertTenantMembership=async input=>{
  if(!input?.tenantId||!input?.identityId||!input?.roleKey) throw errorOf('tenantId, identityId and roleKey are required','INVALID_TENANT_MEMBERSHIP');
  const status=String(input.status||'ACTIVE').toUpperCase();
  if(!MEMBER_STATUS.has(status)) throw errorOf('Invalid membership status','INVALID_MEMBERSHIP_STATUS');
  const db=getRuntimePool();
  await assertRoleScope(db,input.roleKey,'TENANT');
  const [scope]=await db.execute(
    'SELECT t.id AS tenant_id,i.id AS identity_id FROM tenants t CROSS JOIN identities i WHERE t.id=? AND i.id=?',
    [input.tenantId,input.identityId]
  );
  if(!scope.length) throw errorOf('Tenant or identity not found','MEMBERSHIP_SUBJECT_NOT_FOUND',404);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO tenant_memberships (id,tenant_id,identity_id,role_key,status)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_key=VALUES(role_key),status=VALUES(status)`,
    [id,input.tenantId,input.identityId,input.roleKey,status]
  );
  const [rows]=await db.execute(
    'SELECT * FROM tenant_memberships WHERE tenant_id=? AND identity_id=?',
    [input.tenantId,input.identityId]
  );
  return {id:rows[0].id,tenantId:rows[0].tenant_id,identityId:rows[0].identity_id,roleKey:rows[0].role_key,status:rows[0].status};
};

export const upsertWorkspaceMembership=async input=>{
  if(!input?.workspaceId||!input?.identityId||!input?.roleKey) throw errorOf('workspaceId, identityId and roleKey are required','INVALID_WORKSPACE_MEMBERSHIP');
  const status=String(input.status||'ACTIVE').toUpperCase();
  if(!MEMBER_STATUS.has(status)) throw errorOf('Invalid membership status','INVALID_MEMBERSHIP_STATUS');
  const db=getRuntimePool();
  await assertRoleScope(db,input.roleKey,'WORKSPACE');
  const [scope]=await db.execute(
    'SELECT w.id AS workspace_id,i.id AS identity_id FROM workspaces w CROSS JOIN identities i WHERE w.id=? AND i.id=?',
    [input.workspaceId,input.identityId]
  );
  if(!scope.length) throw errorOf('Workspace or identity not found','MEMBERSHIP_SUBJECT_NOT_FOUND',404);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO workspace_memberships (id,workspace_id,identity_id,role_key,status)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_key=VALUES(role_key),status=VALUES(status)`,
    [id,input.workspaceId,input.identityId,input.roleKey,status]
  );
  const [rows]=await db.execute(
    'SELECT * FROM workspace_memberships WHERE workspace_id=? AND identity_id=?',
    [input.workspaceId,input.identityId]
  );
  return {id:rows[0].id,workspaceId:rows[0].workspace_id,identityId:rows[0].identity_id,roleKey:rows[0].role_key,status:rows[0].status};
};

const membershipPermissions=async(db,{identityId,tenantId,workspaceId=null})=>{
  const roleKeys=[];
  const [tenantRows]=await db.execute(
    `SELECT role_key FROM tenant_memberships
     WHERE tenant_id=? AND identity_id=? AND status='ACTIVE'`,
    [tenantId,identityId]
  );
  roleKeys.push(...tenantRows.map(x=>x.role_key));
  if(workspaceId){
    const [workspaceRows]=await db.execute(
      `SELECT wm.role_key
       FROM workspace_memberships wm
       JOIN workspaces w ON w.id=wm.workspace_id
       WHERE wm.workspace_id=? AND w.tenant_id=? AND wm.identity_id=? AND wm.status='ACTIVE'`,
      [workspaceId,tenantId,identityId]
    );
    roleKeys.push(...workspaceRows.map(x=>x.role_key));
  }
  if(!roleKeys.length) return [];
  const placeholders=roleKeys.map(()=>'?').join(',');
  const [permissions]=await db.execute(
    `SELECT DISTINCT permission_key FROM role_permissions WHERE role_key IN (${placeholders})`,
    roleKeys
  );
  return permissions.map(x=>x.permission_key);
};

export const createApiCredential=async input=>{
  if(!input?.identityId||!input?.tenantId) throw errorOf('identityId and tenantId are required','INVALID_API_CREDENTIAL');
  rejectSecrets(input.metadata||null);
  const db=getRuntimePool();
  const [subjects]=await db.execute(
    `SELECT i.id AS identity_id,i.status AS identity_status,t.id AS tenant_id,t.status AS tenant_status
     FROM identities i JOIN tenants t ON t.id=? WHERE i.id=?`,
    [input.tenantId,input.identityId]
  );
  if(!subjects.length) throw errorOf('Identity or tenant not found','CREDENTIAL_SUBJECT_NOT_FOUND',404);
  if(subjects[0].identity_status!=='ACTIVE'||subjects[0].tenant_status!=='ACTIVE') throw errorOf('Credential subject is not active','CREDENTIAL_SUBJECT_NOT_ACTIVE',409);
  if(input.workspaceId){
    const [workspaces]=await db.execute('SELECT id FROM workspaces WHERE id=? AND tenant_id=? AND status=\'ACTIVE\'',[input.workspaceId,input.tenantId]);
    if(!workspaces.length) throw errorOf('Workspace does not belong to active tenant','CREDENTIAL_WORKSPACE_MISMATCH',409);
  }

  const available=await membershipPermissions(db,{
    identityId:input.identityId,tenantId:input.tenantId,workspaceId:input.workspaceId||null
  });
  if(!available.length) throw errorOf('Identity has no active membership in credential scope','CREDENTIAL_MEMBERSHIP_REQUIRED',403);

  const requested=Array.isArray(input.permissions)&&input.permissions.length
    ? [...new Set(input.permissions.map(String))]
    : available;
  const forbidden=requested.filter(x=>!available.includes(x));
  if(forbidden.length) throw errorOf('Credential permissions exceed membership permissions','CREDENTIAL_SCOPE_EXCEEDS_ROLE',403,{forbidden});

  const prefix=randomBytes(6).toString('hex');
  const secret=randomBytes(24).toString('base64url');
  const token=`rtv2_${prefix}_${secret}`;
  const id=input.id||randomUUID();
  const expiresAt=input.expiresAt?new Date(input.expiresAt):null;
  if(expiresAt&&Number.isNaN(expiresAt.getTime())) throw errorOf('Invalid expiresAt','INVALID_CREDENTIAL_EXPIRY');

  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO api_credentials (
        id,identity_id,tenant_id,workspace_id,credential_prefix,secret_hash,status,expires_at,metadata_json
      ) VALUES (?,?,?,?,?,?,'ACTIVE',?,?)`,
      [id,input.identityId,input.tenantId,input.workspaceId||null,prefix,sha256(token),expiresAt,asJson(input.metadata||null)]
    );
    for(const permission of requested){
      await connection.execute(
        'INSERT INTO api_credential_scopes (credential_id,permission_key) VALUES (?,?)',
        [id,permission]
      );
    }
    await connection.commit();
  }catch(error){
    await connection.rollback();throw error;
  }finally{connection.release();}

  return {
    credential:{id,identityId:input.identityId,tenantId:input.tenantId,workspaceId:input.workspaceId||null,credentialPrefix:prefix,status:'ACTIVE',expiresAt,permissions:requested},
    token
  };
};

export const revokeApiCredential=async credentialId=>{
  const db=getRuntimePool();
  const [result]=await db.execute("UPDATE api_credentials SET status='REVOKED' WHERE id=?",[credentialId]);
  if(!result.affectedRows) throw errorOf('Credential not found','CREDENTIAL_NOT_FOUND',404);
  return {id:credentialId,status:'REVOKED'};
};

export const listApiCredentials=async({identityId=null,tenantId=null}={})=>{
  const db=getRuntimePool(),clauses=[],values=[];
  if(identityId){clauses.push('identity_id=?');values.push(identityId);}
  if(tenantId){clauses.push('tenant_id=?');values.push(tenantId);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const [rows]=await db.execute(
    `SELECT id,identity_id,tenant_id,workspace_id,credential_prefix,status,expires_at,last_used_at,metadata_json,created_at,updated_at
     FROM api_credentials ${where} ORDER BY created_at,id`,
    values
  );
  return rows.map(normalizeCredential);
};

export const authenticateScopedToken=async token=>{
  const match=String(token||'').match(/^rtv2_([a-f0-9]{12})_([A-Za-z0-9_-]+)$/);
  if(!match) return null;
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT c.*,i.identity_key,i.identity_type,i.status AS identity_status,
            t.status AS tenant_status,w.status AS workspace_status
     FROM api_credentials c
     JOIN identities i ON i.id=c.identity_id
     JOIN tenants t ON t.id=c.tenant_id
     LEFT JOIN workspaces w ON w.id=c.workspace_id
     WHERE c.credential_prefix=? LIMIT 1`,
    [match[1]]
  );
  if(!rows.length) return null;
  const row=rows[0];
  if(!safeEqual(sha256(token),row.secret_hash)) return null;
  if(row.status!=='ACTIVE'||row.identity_status!=='ACTIVE'||row.tenant_status!=='ACTIVE') return null;
  if(row.workspace_id&&row.workspace_status!=='ACTIVE') return null;
  if(row.expires_at&&new Date(row.expires_at).getTime()<=Date.now()) return null;

  const rolePermissions=await membershipPermissions(db,{
    identityId:row.identity_id,tenantId:row.tenant_id,workspaceId:row.workspace_id||null
  });
  if(!rolePermissions.length) return null;
  const [scopes]=await db.execute(
    'SELECT permission_key FROM api_credential_scopes WHERE credential_id=?',
    [row.id]
  );
  const requested=scopes.map(x=>x.permission_key);
  const permissions=requested.filter(x=>rolePermissions.includes(x));
  if(!permissions.length) return null;
  await db.execute('UPDATE api_credentials SET last_used_at=CURRENT_TIMESTAMP(6) WHERE id=?',[row.id]);
  return {
    authType:'SCOPED_CREDENTIAL',platformAdmin:false,credentialId:row.id,
    identityId:row.identity_id,identityKey:row.identity_key,identityType:row.identity_type,
    tenantId:row.tenant_id,workspaceId:row.workspace_id||null,permissions
  };
};

export const getAuthSelf=auth=>({
  authType:auth.authType,platformAdmin:Boolean(auth.platformAdmin),
  credentialId:auth.credentialId||null,identityId:auth.identityId||null,identityKey:auth.identityKey||null,
  identityType:auth.identityType||null,tenantId:auth.tenantId||null,workspaceId:auth.workspaceId||null,
  permissions:Array.isArray(auth.permissions)?auth.permissions:[],
});
