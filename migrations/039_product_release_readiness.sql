-- AI Native Runtime V2.7 M27.6 Release Readiness / Version Freeze
-- Migration: 039_product_release_readiness.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO product_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('PRODUCT_RELEASE_CANDIDATE','发布候选版本','PD_13_RELEASE_READY',310,'冻结待发布版本的精确代码、构建、预览、验收与质量事实'),
  ('PRODUCT_RELEASE_EVIDENCE_MANIFEST','发布证据清单','PD_13_RELEASE_READY',320,'不可变发布证据清单与完整性哈希'),
  ('PRODUCT_RELEASE_OBSERVABILITY','发布监控与告警','PD_13_RELEASE_READY',330,'监控、告警、仪表盘与数据埋点就绪状态'),
  ('PRODUCT_RELEASE_OPERATIONS','发布运行手册与支持','PD_13_RELEASE_READY',340,'Runbook、支持责任人与事故归属'),
  ('PRODUCT_RELEASE_COMMUNICATION','发布说明与启用','PD_13_RELEASE_READY',350,'Release Notes、Changelog、文档、沟通与启用计划')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  stage_key=VALUES(stage_key),
  sort_order=VALUES(sort_order),
  status='ACTIVE',
  description=VALUES(description);

CREATE TABLE IF NOT EXISTS product_release_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  product_baseline_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  build_record_id CHAR(36) NOT NULL,
  preview_deployment_id CHAR(36) NOT NULL,
  acceptance_run_id CHAR(36) NOT NULL,
  qa_plan_id CHAR(36) NOT NULL,
  qa_execution_id CHAR(36) NOT NULL,
  regression_run_id CHAR(36) NOT NULL,
  rc_key VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  exact_commit_sha CHAR(40) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  included_requirements_json JSON NOT NULL,
  included_work_items_json JSON NOT NULL,
  environment_json JSON NOT NULL,
  config_prompt_model_feature_json JSON NOT NULL,
  migration_json JSON NOT NULL,
  audit_compliance_json JSON NOT NULL,
  known_issues_json JSON NOT NULL,
  risks_json JSON NOT NULL,
  release_notes_json JSON NOT NULL,
  rollout_plan_json JSON NOT NULL,
  rollback_plan_json JSON NOT NULL,
  observability_json JSON NOT NULL,
  operations_json JSON NOT NULL,
  documentation_json JSON NOT NULL,
  launch_enablement_json JSON NOT NULL,
  instrumentation_json JSON NOT NULL,
  owner_identity_id CHAR(36) NULL,
  approver_identity_id CHAR(36) NULL,
  evidence_json JSON NOT NULL,
  manifest_sha256 CHAR(64) NULL,
  frozen_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m276_rc_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m276_rc_baseline FOREIGN KEY (product_baseline_id) REFERENCES product_requirement_baselines(id),
  CONSTRAINT fk_m276_rc_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m276_rc_plan FOREIGN KEY (delivery_plan_id) REFERENCES product_delivery_plans(id),
  CONSTRAINT fk_m276_rc_build FOREIGN KEY (build_record_id) REFERENCES product_build_records(id),
  CONSTRAINT fk_m276_rc_preview FOREIGN KEY (preview_deployment_id) REFERENCES product_preview_deployments(id),
  CONSTRAINT fk_m276_rc_accept FOREIGN KEY (acceptance_run_id) REFERENCES product_acceptance_runs(id),
  CONSTRAINT fk_m276_rc_qa_plan FOREIGN KEY (qa_plan_id) REFERENCES product_qa_plans(id),
  CONSTRAINT fk_m276_rc_qa_exec FOREIGN KEY (qa_execution_id) REFERENCES product_qa_executions(id),
  CONSTRAINT fk_m276_rc_regression FOREIGN KEY (regression_run_id) REFERENCES product_qa_regression_runs(id),
  CONSTRAINT fk_m276_rc_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m276_rc_approver FOREIGN KEY (approver_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m276_rc_key (project_id,rc_key),
  UNIQUE KEY uq_m276_rc_version (release_version_id),
  INDEX idx_m276_rc_status (project_id,status,frozen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_release_evidence_manifests (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  release_candidate_id CHAR(36) NOT NULL,
  release_version_id CHAR(36) NOT NULL,
  manifest_json JSON NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m276_manifest_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m276_manifest_rc FOREIGN KEY (release_candidate_id) REFERENCES product_release_candidates(id),
  CONSTRAINT fk_m276_manifest_version FOREIGN KEY (release_version_id) REFERENCES project_versions(id),
  CONSTRAINT fk_m276_manifest_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m276_manifest_rc (release_candidate_id),
  UNIQUE KEY uq_m276_manifest_sha (project_id,manifest_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_m276_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m276_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m276_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m276_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
