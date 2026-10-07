-- AI Native Runtime V2.7 M27.10 Decision / Review / Knowledge / Backlog
-- Migration: 043_product_review_knowledge_backlog.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_REVIEW','产品复盘','PD_17_REVIEW',490,'汇总计划、执行、质量、发布、事故、结果、成本与改进事实'),
  ('PRODUCT_REVIEW_OUTPUT','复盘输出','PD_18_KNOWLEDGE',500,'Backlog、Bug、Tech Debt、Process、AI 能力改进、可复用模式、废弃知识与下一版本提案'),
  ('PRODUCT_REVIEW_DECISION','复盘决策','PD_17_REVIEW',510,'复盘结论与继续、迭代、冻结、回滚等正式决策')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_delivery_reviews (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_rollout_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  outcome_review_id CHAR(36) NOT NULL,
  review_key VARCHAR(128) NOT NULL,
  planned_actual_json JSON NOT NULL,
  scope_change_json JSON NOT NULL,
  schedule_wait_block_json JSON NOT NULL,
  first_pass_rework_json JSON NOT NULL,
  defect_escape_json JSON NOT NULL,
  release_incident_json JSON NOT NULL,
  ai_human_json JSON NOT NULL,
  cost_json JSON NOT NULL,
  outcome_json JSON NOT NULL,
  reuse_json JSON NOT NULL,
  failure_mode_json JSON NOT NULL,
  improvement_json JSON NOT NULL,
  decision_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'FROZEN',
  reviewed_by_identity_id CHAR(36) NULL,
  reviewed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2710_review_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2710_review_rollout FOREIGN KEY (release_rollout_id) REFERENCES product_release_rollouts(id),
  CONSTRAINT fk_m2710_review_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m2710_review_outcome FOREIGN KEY (outcome_review_id) REFERENCES product_outcome_reviews(id),
  CONSTRAINT fk_m2710_review_identity FOREIGN KEY (reviewed_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2710_review_key (project_id,review_key),
  INDEX idx_m2710_review_release (release_rollout_id,status,reviewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_review_outputs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_id CHAR(36) NOT NULL,
  output_key VARCHAR(128) NOT NULL,
  output_type VARCHAR(48) NOT NULL,
  disposition VARCHAR(16) NOT NULL,
  title VARCHAR(512) NOT NULL,
  rationale TEXT NULL,
  work_item_id CHAR(36) NULL,
  decision_id CHAR(36) NULL,
  project_version_id CHAR(36) NULL,
  knowledge_ref_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2710_output_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2710_output_review FOREIGN KEY (review_id) REFERENCES product_delivery_reviews(id),
  CONSTRAINT fk_m2710_output_work_item FOREIGN KEY (work_item_id) REFERENCES project_work_items(id),
  CONSTRAINT fk_m2710_output_decision FOREIGN KEY (decision_id) REFERENCES project_decisions(id),
  CONSTRAINT fk_m2710_output_version FOREIGN KEY (project_version_id) REFERENCES project_versions(id),
  UNIQUE KEY uq_m2710_output_key (review_id,output_key),
  INDEX idx_m2710_output_type (review_id,output_type,disposition)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m2710_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2710_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2710_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2710_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
