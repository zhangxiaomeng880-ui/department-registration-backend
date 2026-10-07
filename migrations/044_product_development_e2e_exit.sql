-- AI Native Runtime V2.7 M27.11 Product Development E2E Exit
-- Migration: 044_product_development_e2e_exit.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_DEVELOPMENT_E2E_EXIT','产品研发终验','PD_FINAL',520,'真实产品研发项目 E2E Exit 与 Requirement→Code→Test→Release→Metric 双向追踪认证')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_development_e2e_certifications (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  certification_key VARCHAR(128) NOT NULL,
  project_identity_json JSON NOT NULL,
  source_repository_json JSON NOT NULL,
  build_evidence_json JSON NOT NULL,
  staging_deployment_json JSON NOT NULL,
  code_evidence_json JSON NOT NULL,
  test_evidence_json JSON NOT NULL,
  trace_anchors_json JSON NOT NULL,
  trace_snapshot_json JSON NOT NULL,
  gate_snapshot_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'FROZEN',
  certified_by_identity_id CHAR(36) NULL,
  certified_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2711_cert_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2711_cert_identity FOREIGN KEY (certified_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2711_cert_key (project_id,certification_key),
  INDEX idx_m2711_cert_status (project_id,status,certified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m2711_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2711_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2711_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2711_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
