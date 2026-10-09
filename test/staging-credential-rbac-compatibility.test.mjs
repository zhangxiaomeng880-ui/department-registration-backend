import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  multipleStatements:true
});

const migration=await fs.readFile(
  new URL('../migrations/20261009_staging_credential_rbac_compatibility.sql',import.meta.url),
  'utf8'
);
await db.query(migration);
await db.query(migration);

const [columns]=await db.execute(`
  SELECT column_name AS column_name,is_nullable AS is_nullable
  FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='api_credentials'
    AND column_name IN ('token_hash','name','allowed_permissions_json','revoked_at','secret_hash')
`);
const byName=new Map(columns.map(row=>[row.column_name,row]));
for(const required of ['token_hash','name','allowed_permissions_json','revoked_at']){
  assert.ok(byName.has(required),`missing api_credentials.${required}`);
}
if(byName.has('secret_hash')) assert.equal(byName.get('secret_hash').is_nullable,'YES');

const [roleCounts]=await db.execute(`
  SELECT
    (SELECT COUNT(*) FROM roles) AS source_count,
    (SELECT COUNT(*) FROM roles r JOIN rbac_roles rr ON rr.role_key=r.role_key) AS mirrored_count
`);
assert.equal(Number(roleCounts[0].mirrored_count),Number(roleCounts[0].source_count));

const [permissionCounts]=await db.execute(`
  SELECT
    (SELECT COUNT(*) FROM role_permissions) AS source_count,
    (SELECT COUNT(*) FROM role_permissions p
      JOIN rbac_role_permissions rp
        ON rp.role_key=p.role_key AND rp.permission_key=p.permission_key) AS mirrored_count
`);
assert.ok(Number(permissionCounts[0].source_count)>0);
assert.equal(Number(permissionCounts[0].mirrored_count),Number(permissionCounts[0].source_count));

await db.end();
console.log('STAGING_CREDENTIAL_RBAC_COMPATIBILITY_PASS');
