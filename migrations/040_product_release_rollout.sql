-- AI Native Runtime V2.7 M27.7 Release / Rollout
-- Migration: 040_product_release_rollout.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_RELEASE_ROLLOUT','发布执行','PD_14_RELEASE',360,'锁定发布候选版本后的部署、验证、发布与全量灰度状态机'),
  ('PRODUCT_RELEASE_WAVE','灰度批次','PD_14_RELEASE',370,'分阶段、金丝雀、比例、内测、租户或区域灰度批次'),
  ('PRODUCT_RELEASE_VERIFICATION','发布验证证据','PD_14_RELEASE',380,'部署后健康、就绪、关键流程与发布范围验证'),
  ('PRODUCT_RELEASE_STATE_EVENT','发布状态记录','PD_14_RELEASE',390,'DEPLOYED、VERIFIED、RELEASED、FULLY_ROLLED_OUT 不可变状态历史')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_release_rollouts (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_candidate_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  rollout_key VARCHAR(128) NOT NULL,
  strategy VARCHAR(32) NOT NULL,
  release_state VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  target_environment VARCHAR(128) NOT NULL,
  deployment_id VARCHAR(255) NOT NULL,
  exact_commit_sha CHAR(40) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  target_scope_json JSON NOT NULL,
  deployment_evidence_json JSON NOT NULL,
  verification_json JSON NULL,
  release_evidence_json JSON NULL,
  full_rollout_evidence_json JSON NULL,
  started_by_identity_id CHAR(36) NULL,
  released_by_identity_id CHAR(36) NULL,
  deployed_at TIMESTAMP(6) NOT NULL,
  verified_at TIMESTAMP(6) NULL,
  released_at TIMESTAMP(6) NULL,
  fully_rolled_out_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m277_rollout_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m277_rollout_candidate FOREIGN KEY (release_candidate_id) REFERENCES product_release_candidates(id),
  CONSTRAINT fk_m277_rollout_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m277_rollout_started_by FOREIGN KEY (started_by_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m277_rollout_released_by FOREIGN KEY (released_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m277_rollout_key (project_id,rollout_key),
  UNIQUE KEY uq_m277_rollout_candidate (release_candidate_id),
  UNIQUE KEY uq_m277_rollout_deployment (project_id,target_environment,deployment_id),
  INDEX idx_m277_rollout_state (project_id,release_state,lifecycle_status,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_release_waves (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  rollout_id CHAR(36) NOT NULL,
  wave_key VARCHAR(128) NOT NULL,
  sequence_no INT NOT NULL,
  scope_json JSON NOT NULL,
  target_percentage DECIMAL(5,2) NULL,
  is_final_wave BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
  verification_json JSON NULL,
  released_at TIMESTAMP(6) NULL,
  verified_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m277_wave_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m277_wave_rollout FOREIGN KEY (rollout_id) REFERENCES product_release_rollouts(id),
  UNIQUE KEY uq_m277_wave_key (rollout_id,wave_key),
  UNIQUE KEY uq_m277_wave_sequence (rollout_id,sequence_no),
  INDEX idx_m277_wave_status (rollout_id,status,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_release_state_events (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  rollout_id CHAR(36) NOT NULL,
  event_key VARCHAR(128) NOT NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NOT NULL,
  wave_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  actor_identity_id CHAR(36) NULL,
  occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m277_event_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m277_event_rollout FOREIGN KEY (rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m277_event_wave FOREIGN KEY (wave_id) REFERENCES product_release_waves(id),
  CONSTRAINT fk_m277_event_actor FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m277_event_key (rollout_id,event_key),
  INDEX idx_m277_event_state (rollout_id,to_state,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m277_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m277_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m277_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m277_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
