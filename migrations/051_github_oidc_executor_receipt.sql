-- AI Native Runtime V2.8 M28.6 GitHub OIDC External Executor Receipt
-- Migration: 051_github_oidc_executor_receipt.sql
-- Secretless GitHub Actions -> Runtime bridge receipt transport.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Stable Runtime project representation for the novel bridge.
-- Content remains in ChatGPT Library; this row only anchors runs/evidence.
INSERT IGNORE INTO projects (
  id,tenant_id,workspace_id,project_key,name,project_type,status,current_workflow_version,current_knowledge_commit_sha
) VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  'novel-hello-that-summer',
  '你好，那年夏天',
  'AIGC_CONTENT',
  'ACTIVE',
  NULL,
  NULL
);

CREATE TABLE external_bridge_receipts (
  receipt_id VARCHAR(191) PRIMARY KEY,
  source_type VARCHAR(32) NOT NULL DEFAULT 'GITHUB_OIDC',
  repository VARCHAR(255) NOT NULL,
  git_ref VARCHAR(512) NOT NULL,
  workflow_ref VARCHAR(768) NOT NULL,
  github_run_id VARCHAR(64) NULL,
  github_run_attempt VARCHAR(32) NULL,
  github_actor VARCHAR(255) NULL,
  project_id CHAR(36) NOT NULL,
  trigger_key VARCHAR(320) NOT NULL,
  scheduled_fire_time DATETIME(6) NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
  attempt_count INT NOT NULL DEFAULT 1,
  trigger_fire_id CHAR(36) NULL,
  trigger_dispatch_id CHAR(36) NULL,
  capability_invocation_id CHAR(36) NULL,
  result_json JSON NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  oidc_claims_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m286_receipt_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m286_receipt_fire FOREIGN KEY (trigger_fire_id) REFERENCES trigger_fires(id),
  INDEX idx_m286_receipt_status (status,created_at),
  INDEX idx_m286_receipt_project (project_id,created_at),
  INDEX idx_m286_receipt_github_run (github_run_id,github_run_attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
