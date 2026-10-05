-- AI Native Runtime V2.4 M24.4 Production-safe Replay / Shadow Eval
-- Migration: 021_eval_shadow_replay.sql
-- Isolates Shadow Eval from customer billing/quota scopes and stores immutable source-run fingerprints.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT IGNORE INTO plans (plan_key,name,status,metadata_json)
VALUES (
  'INTERNAL_EVAL',
  'Internal Evaluation Plan',
  'ACTIVE',
  JSON_OBJECT('system',TRUE,'billable',FALSE,'migration','021_eval_shadow_replay')
);

INSERT IGNORE INTO plan_entitlements (id,plan_key,entitlement_key,enabled,config_json)
VALUES (
  '00000000-0000-4000-8000-000000002404',
  'INTERNAL_EVAL',
  'MODEL_EXECUTION',
  TRUE,
  JSON_OBJECT('system',TRUE,'shadowEval',TRUE)
);

INSERT IGNORE INTO tenants (id,tenant_key,name,plan_key,status,metadata_json)
VALUES (
  '00000000-0000-4000-8000-000000002401',
  'internal-eval',
  'Internal Evaluation Tenant',
  'INTERNAL_EVAL',
  'ACTIVE',
  JSON_OBJECT('system',TRUE,'billable',FALSE,'shadowEval',TRUE)
);

INSERT IGNORE INTO workspaces (id,tenant_id,workspace_key,name,status,metadata_json)
VALUES (
  '00000000-0000-4000-8000-000000002402',
  '00000000-0000-4000-8000-000000002401',
  'shadow-eval',
  'Shadow Evaluation Workspace',
  'ACTIVE',
  JSON_OBJECT('system',TRUE,'shadowEval',TRUE)
);

INSERT IGNORE INTO projects (
  id,tenant_id,workspace_id,project_key,name,project_type,status,current_workflow_version,current_knowledge_commit_sha
) VALUES (
  '00000000-0000-4000-8000-000000002403',
  '00000000-0000-4000-8000-000000002401',
  '00000000-0000-4000-8000-000000002402',
  'shadow-eval-runtime',
  'Shadow Eval Runtime',
  'AIGC_CONTENT',
  'ACTIVE',
  'eval-shadow-v1',
  NULL
);

ALTER TABLE usage_ledger
  ADD COLUMN billing_class VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER' AFTER cost_currency,
  ADD INDEX idx_usage_billing_class_period (billing_class,recorded_at);

UPDATE usage_ledger u
JOIN runs r ON r.id=u.run_id
SET u.billing_class='INTERNAL_EVAL'
WHERE r.run_type IN ('EVAL_REPLAY','SHADOW_REPLAY')
   OR r.trigger_source IN ('EVAL_RUNNER','SHADOW_EVAL');

CREATE TABLE IF NOT EXISTS eval_shadow_projects (
  project_id CHAR(36) PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  safety_policy_version VARCHAR(64) NOT NULL DEFAULT 'shadow-safe-v1',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m244_shadow_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m244_shadow_project_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO eval_shadow_projects (project_id,status,safety_policy_version)
VALUES ('00000000-0000-4000-8000-000000002403','ACTIVE','shadow-safe-v1');

CREATE TABLE IF NOT EXISTS eval_shadow_replays (
  id CHAR(36) PRIMARY KEY,
  source_run_id CHAR(36) NOT NULL,
  source_project_id CHAR(36) NOT NULL,
  replay_manifest_id CHAR(36) NOT NULL,
  execution_project_id CHAR(36) NOT NULL,
  baseline_runtime_sha CHAR(40) NOT NULL,
  candidate_runtime_sha CHAR(40) NOT NULL,
  source_snapshot_sha256 CHAR(64) NOT NULL,
  source_input_sha256 CHAR(64) NOT NULL,
  safety_policy_version VARCHAR(64) NOT NULL DEFAULT 'shadow-safe-v1',
  eval_run_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PREPARED',
  safety_summary_json JSON NULL,
  shadow_sha256 CHAR(64) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  prepared_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m244_shadow_source_run FOREIGN KEY (source_run_id) REFERENCES runs(id),
  CONSTRAINT fk_m244_shadow_source_project FOREIGN KEY (source_project_id) REFERENCES projects(id),
  CONSTRAINT fk_m244_shadow_manifest FOREIGN KEY (replay_manifest_id) REFERENCES eval_replay_manifests(id),
  CONSTRAINT fk_m244_shadow_execution_project FOREIGN KEY (execution_project_id) REFERENCES eval_shadow_projects(project_id),
  CONSTRAINT fk_m244_shadow_eval_run FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  INDEX idx_m244_shadow_source_run (source_run_id,created_at),
  INDEX idx_m244_shadow_candidate (candidate_runtime_sha,created_at),
  INDEX idx_m244_shadow_status (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
