-- AI Native Runtime V2.7 M27.8 Post-release Verification / Incident Operations
-- Migration: 041_product_post_release_incident.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_POST_RELEASE_VERIFICATION','上线后验证','PD_15_POST_RELEASE',400,'对已发布版本执行健康、就绪、关键流程、性能、埋点、核心指标与反馈验证'),
  ('PRODUCT_INCIDENT','线上事故','PD_15_POST_RELEASE',410,'线上异常的检测、分级、处置、验证与关闭'),
  ('PRODUCT_INCIDENT_ACTION','事故处置动作','PD_15_POST_RELEASE',420,'Mitigate、Rollback、Fix 等事故处置动作与证据'),
  ('PRODUCT_INCIDENT_REVIEW','事故复盘','PD_15_POST_RELEASE',430,'根因、时间线、预防措施、Backlog 与 Knowledge 回写')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_post_release_verifications (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  verification_key VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  exact_commit_sha CHAR(40) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  deployment_id VARCHAR(255) NOT NULL,
  health_json JSON NOT NULL,
  readiness_json JSON NOT NULL,
  smoke_critical_flow_json JSON NOT NULL,
  error_incident_json JSON NOT NULL,
  performance_json JSON NOT NULL,
  instrumentation_json JSON NOT NULL,
  primary_metric_json JSON NOT NULL,
  user_feedback_json JSON NOT NULL,
  operations_feedback_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  verified_by_identity_id CHAR(36) NULL,
  verified_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m278_verify_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m278_verify_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m278_verify_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m278_verify_identity FOREIGN KEY (verified_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m278_verify_key (project_id,verification_key),
  INDEX idx_m278_verify_rollout (release_rollout_id,status,verified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_incidents (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  detected_verification_id CHAR(36) NULL,
  incident_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  severity VARCHAR(8) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DETECTED',
  signal_json JSON NOT NULL,
  affected_scope_json JSON NOT NULL,
  triage_json JSON NULL,
  mitigation_summary_json JSON NULL,
  owner_identity_id CHAR(36) NULL,
  detected_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  triaged_at TIMESTAMP(6) NULL,
  mitigated_at TIMESTAMP(6) NULL,
  resolved_at TIMESTAMP(6) NULL,
  closed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m278_incident_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m278_incident_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m278_incident_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m278_incident_verification FOREIGN KEY (detected_verification_id) REFERENCES product_post_release_verifications(id),
  CONSTRAINT fk_m278_incident_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m278_incident_key (project_id,incident_key),
  INDEX idx_m278_incident_status (project_id,status,severity,detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_incident_actions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  incident_id CHAR(36) NOT NULL,
  action_key VARCHAR(128) NOT NULL,
  action_type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
  action_ref_json JSON NOT NULL,
  result_json JSON NULL,
  evidence_json JSON NOT NULL,
  actor_identity_id CHAR(36) NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at TIMESTAMP(6) NULL,
  verified_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m278_action_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m278_action_incident FOREIGN KEY (incident_id) REFERENCES product_incidents(id),
  CONSTRAINT fk_m278_action_actor FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m278_action_key (incident_id,action_key),
  INDEX idx_m278_action_status (incident_id,action_type,status,started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_incident_reviews (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  incident_id CHAR(36) NOT NULL,
  verification_id CHAR(36) NOT NULL,
  review_key VARCHAR(128) NOT NULL,
  root_cause_json JSON NOT NULL,
  timeline_json JSON NOT NULL,
  customer_impact_json JSON NOT NULL,
  prevention_json JSON NOT NULL,
  backlog_work_item_ids_json JSON NOT NULL,
  knowledge_refs_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  reviewed_by_identity_id CHAR(36) NULL,
  reviewed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m278_review_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m278_review_incident FOREIGN KEY (incident_id) REFERENCES product_incidents(id),
  CONSTRAINT fk_m278_review_verification FOREIGN KEY (verification_id) REFERENCES product_post_release_verifications(id),
  CONSTRAINT fk_m278_review_identity FOREIGN KEY (reviewed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m278_review_incident (incident_id),
  UNIQUE KEY uq_m278_review_key (project_id,review_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
