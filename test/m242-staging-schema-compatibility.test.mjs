import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  multipleStatements:true
});

await db.query('SET FOREIGN_KEY_CHECKS=0');
await db.query('DROP TABLE IF EXISTS eval_assertion_results');
await db.query('DROP TABLE IF EXISTS eval_case_results');
await db.query('DROP TABLE IF EXISTS eval_runs');
await db.query('SET FOREIGN_KEY_CHECKS=1');

await db.query(`
CREATE TABLE eval_runs (
  id CHAR(36) PRIMARY KEY,
  replay_manifest_id CHAR(36) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  baseline_runtime_sha CHAR(40) NULL,
  execution_mode VARCHAR(32) NOT NULL DEFAULT 'SYNTHETIC_REPLAY',
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  case_count INT UNSIGNED NOT NULL DEFAULT 0,
  passed_case_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_case_count INT UNSIGNED NOT NULL DEFAULT 0,
  assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  passed_assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_assertion_count INT UNSIGNED NOT NULL DEFAULT 0,
  result_sha256 CHAR(64) NULL,
  summary_json JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_eval_run_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  INDEX idx_m242_eval_run_manifest (replay_manifest_id,created_at),
  INDEX idx_m242_eval_run_candidate (candidate_runtime_sha,created_at),
  INDEX idx_m242_eval_run_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE eval_case_results (
  id CHAR(36) PRIMARY KEY,
  eval_run_id CHAR(36) NOT NULL,
  eval_case_id CHAR(36) NOT NULL,
  case_key VARCHAR(191) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  route_json JSON NOT NULL,
  observed_output_json JSON NULL,
  observed_evidence_json JSON NULL,
  observed_execution_json JSON NULL,
  assertion_summary_json JSON NOT NULL,
  result_sha256 CHAR(64) NOT NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_case_result_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  CONSTRAINT fk_m242_case_result_case FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id),
  UNIQUE KEY uq_m242_eval_run_case (eval_run_id,eval_case_id),
  INDEX idx_m242_case_result_status (eval_run_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE eval_assertion_results (
  id CHAR(36) PRIMARY KEY,
  eval_case_result_id CHAR(36) NOT NULL,
  assertion_group VARCHAR(64) NOT NULL,
  assertion_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  expected_json JSON NULL,
  actual_json JSON NULL,
  failure_code VARCHAR(128) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m242_assertion_case_result FOREIGN KEY (eval_case_result_id) REFERENCES eval_case_results(id),
  UNIQUE KEY uq_m242_assertion_key (eval_case_result_id,assertion_group,assertion_key),
  INDEX idx_m242_assertion_status (eval_case_result_id,status,assertion_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
`);

const migration=await fs.readFile(new URL('../migrations/019_eval_runner_runtime_replay_compatibility.sql',import.meta.url),'utf8');
await db.query(migration);

const [cols]=await db.execute(`
  SELECT table_name AS table_name,column_name AS column_name,is_nullable AS is_nullable
  FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND (
      (table_name='eval_runs' AND column_name='execution_project_id')
      OR (table_name='eval_case_results' AND column_name IN ('runtime_run_id','error_code','route_json'))
    )
  ORDER BY table_name,column_name
`);
const byKey=new Map(cols.map(x=>[`${x.table_name}.${x.column_name}`,x]));
assert.ok(byKey.has('eval_runs.execution_project_id'));
assert.ok(byKey.has('eval_case_results.runtime_run_id'));
assert.ok(byKey.has('eval_case_results.error_code'));
assert.equal(byKey.get('eval_case_results.route_json').is_nullable,'YES');

const [constraints]=await db.execute(`
  SELECT table_name AS table_name,constraint_name AS constraint_name
  FROM information_schema.table_constraints
  WHERE constraint_schema=DATABASE()
    AND constraint_name IN ('fk_m242_eval_run_project','fk_m242_case_result_runtime_run')
`);
const names=new Set(constraints.map(x=>x.constraint_name));
assert.ok(names.has('fk_m242_eval_run_project'));
assert.ok(names.has('fk_m242_case_result_runtime_run'));

const [indexes]=await db.execute(`
  SELECT DISTINCT index_name AS index_name
  FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='eval_runs'
    AND index_name='idx_m242_eval_run_project'
`);
assert.equal(indexes.length,1);

await db.end();
console.log('G24_2_STAGING_SCHEMA_COMPATIBILITY_PASS');
