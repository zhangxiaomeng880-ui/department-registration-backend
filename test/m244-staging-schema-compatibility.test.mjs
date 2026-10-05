import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  multipleStatements:true
});

const [legacyBefore]=await db.execute(`
  SELECT column_name AS column_name
  FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='eval_shadow_replays'
    AND column_name='source_input_sha256'
`);
if(!legacyBefore.length){
  await db.query(
    "ALTER TABLE eval_shadow_replays ADD COLUMN source_input_sha256 CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' AFTER source_snapshot_sha256"
  );
}

const migration=await fs.readFile(
  new URL('../migrations/022_shadow_eval_schema_compatibility.sql',import.meta.url),'utf8'
);
await db.query(migration);
await db.query(migration);

const [legacyAfter]=await db.execute(`
  SELECT column_name AS column_name
  FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='eval_shadow_replays'
    AND column_name='source_input_sha256'
`);
assert.equal(legacyAfter.length,0);

const [shadowCols]=await db.execute(`
  SELECT column_name AS column_name
  FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='eval_shadow_replays'
    AND column_name IN ('source_snapshot_sha256','safety_policy_version','safety_summary_json','shadow_sha256')
`);
assert.deepEqual(
  new Set(shadowCols.map(x=>x.column_name)),
  new Set(['source_snapshot_sha256','safety_policy_version','safety_summary_json','shadow_sha256'])
);

const [usageCols]=await db.execute(`
  SELECT column_name AS column_name
  FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='usage_ledger'
    AND column_name='billing_class'
`);
assert.equal(usageCols.length,1);

const [indexes]=await db.execute(`
  SELECT DISTINCT index_name AS index_name
  FROM information_schema.statistics
  WHERE table_schema=DATABASE()
    AND table_name='usage_ledger'
    AND index_name='idx_usage_billing_class_period'
`);
assert.equal(indexes.length,1);

const [internalScope]=await db.execute(`
  SELECT p.id,p.tenant_id,p.workspace_id,t.plan_key
  FROM projects p
  JOIN tenants t ON t.id=p.tenant_id
  WHERE p.id='00000000-0000-4000-8000-000000002403'
`);
assert.equal(internalScope.length,1);
assert.equal(internalScope[0].tenant_id,'00000000-0000-4000-8000-000000002401');
assert.equal(internalScope[0].workspace_id,'00000000-0000-4000-8000-000000002402');
assert.equal(internalScope[0].plan_key,'INTERNAL_EVAL');

await db.end();
console.log('G24_4_STAGING_SCHEMA_COMPATIBILITY_PASS');
