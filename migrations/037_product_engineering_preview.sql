-- AI Native Runtime V2.7 M27.4 Engineering / Build / Integration / Preview
-- Migration: 037_product_engineering_preview.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS product_source_revisions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  revision_key VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  repository_full_name VARCHAR(320) NOT NULL,
  repository_url VARCHAR(1024) NULL,
  branch_name VARCHAR(255) NOT NULL,
  commit_sha CHAR(40) NOT NULL,
  pull_request_json JSON NOT NULL,
  source_verification_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_source_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_source_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m274_source_key (project_id,revision_key),
  INDEX idx_m274_source_commit (project_id,commit_sha,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_engineering_implementations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  technical_contract_version_id CHAR(36) NOT NULL,
  ai_contract_version_id CHAR(36) NULL,
  source_revision_id CHAR(36) NOT NULL,
  implementation_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
  technical_plan_json JSON NOT NULL,
  dependency_changes_json JSON NOT NULL,
  migration_versions_json JSON NOT NULL,
  known_issues_json JSON NOT NULL,
  rollback_notes_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_impl_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_impl_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m274_impl_technical FOREIGN KEY (technical_contract_version_id) REFERENCES product_technical_contract_versions(id),
  CONSTRAINT fk_m274_impl_ai FOREIGN KEY (ai_contract_version_id) REFERENCES product_ai_contract_versions(id),
  CONSTRAINT fk_m274_impl_source FOREIGN KEY (source_revision_id) REFERENCES product_source_revisions(id),
  CONSTRAINT fk_m274_impl_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m274_impl_key (project_id,implementation_key),
  INDEX idx_m274_impl_status (project_id,status,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_engineering_requirement_links (
  implementation_id CHAR(36) NOT NULL,
  requirement_version_id CHAR(36) NOT NULL,
  link_role VARCHAR(32) NOT NULL DEFAULT 'IMPLEMENTS',
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (implementation_id,requirement_version_id,link_role),
  CONSTRAINT fk_m274_impl_req_impl FOREIGN KEY (implementation_id) REFERENCES product_engineering_implementations(id),
  CONSTRAINT fk_m274_impl_req_version FOREIGN KEY (requirement_version_id) REFERENCES product_requirement_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_engineering_work_item_links (
  implementation_id CHAR(36) NOT NULL,
  work_item_id CHAR(36) NOT NULL,
  link_role VARCHAR(32) NOT NULL DEFAULT 'DELIVERS',
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (implementation_id,work_item_id,link_role),
  CONSTRAINT fk_m274_impl_work_impl FOREIGN KEY (implementation_id) REFERENCES product_engineering_implementations(id),
  CONSTRAINT fk_m274_impl_work_item FOREIGN KEY (work_item_id) REFERENCES project_work_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_engineering_checks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  implementation_id CHAR(36) NOT NULL,
  check_key VARCHAR(128) NOT NULL,
  check_type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  commit_sha CHAR(40) NOT NULL,
  run_ref_json JSON NOT NULL,
  result_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  executed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_check_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_check_impl FOREIGN KEY (implementation_id) REFERENCES product_engineering_implementations(id),
  UNIQUE KEY uq_m274_check_key (implementation_id,check_key),
  INDEX idx_m274_check_type_status (implementation_id,check_type,status,executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_build_records (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  implementation_id CHAR(36) NOT NULL,
  build_key VARCHAR(128) NOT NULL,
  build_id VARCHAR(255) NOT NULL,
  commit_sha CHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL,
  artifact_locator_json JSON NOT NULL,
  artifact_digest VARCHAR(191) NOT NULL,
  build_environment_json JSON NOT NULL,
  config_versions_json JSON NOT NULL,
  migration_versions_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  built_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_build_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_build_impl FOREIGN KEY (implementation_id) REFERENCES product_engineering_implementations(id),
  UNIQUE KEY uq_m274_build_key (implementation_id,build_key),
  UNIQUE KEY uq_m274_build_id (project_id,build_id),
  INDEX idx_m274_build_status (implementation_id,status,built_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_preview_deployments (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  implementation_id CHAR(36) NOT NULL,
  build_record_id CHAR(36) NOT NULL,
  preview_key VARCHAR(128) NOT NULL,
  environment_key VARCHAR(64) NOT NULL,
  deployment_id VARCHAR(255) NOT NULL,
  exact_commit_sha CHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL,
  preview_locator_json JSON NOT NULL,
  config_prompt_model_versions_json JSON NOT NULL,
  migration_versions_json JSON NOT NULL,
  health_json JSON NOT NULL,
  readiness_json JSON NOT NULL,
  smoke_result_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  verified_at TIMESTAMP(6) NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_preview_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_preview_impl FOREIGN KEY (implementation_id) REFERENCES product_engineering_implementations(id),
  CONSTRAINT fk_m274_preview_build FOREIGN KEY (build_record_id) REFERENCES product_build_records(id),
  CONSTRAINT fk_m274_preview_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m274_preview_key (project_id,preview_key),
  UNIQUE KEY uq_m274_preview_deployment (project_id,deployment_id),
  INDEX idx_m274_preview_status (project_id,status,verified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m274_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m274_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m274_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m274_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
