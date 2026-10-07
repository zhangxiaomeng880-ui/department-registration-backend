-- AI Native Runtime V2.8 M28.9 Image / Keyframe / Storyboard + Generation System
-- Migration: 054_aigc_image_generation.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_GENERATION_JOB','生成任务','AIGC_07_IMAGE',240,'正式生成执行对象：Provider/Model/Prompt/Reference/Parameter/Cost/Latency/Safety/Provenance'),
  ('AIGC_GENERATION_CANDIDATE','生成候选与历史','AIGC_07_IMAGE',250,'Candidate/Variant、QA、比较、选择/拒绝、Restore、Lock 与不可覆盖历史'),
  ('AIGC_IMAGE_PRODUCTION','图像 / 关键帧 / 分镜生产','AIGC_07_IMAGE',260,'Shot 级图像生产计划、关键帧覆盖与 Selected/CURRENT 视频参考资格'),
  ('AIGC_IMAGE_QA','图像质量验证','AIGC_07_IMAGE',270,'Identity/Look/Scene/Prop、Pose、Performance、Anatomy、Spatial、Camera、Lighting、Text/UI、Multi-format、Technical QA')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-IMAGE','图像生产门禁','ACTIVE'),
  ('GENERATION_STATUS','RUNNING','生成中','ACTIVE'),
  ('GENERATION_STATUS','SUCCEEDED','生成成功','ACTIVE'),
  ('GENERATION_STATUS','FAILED','生成失败','ACTIVE'),
  ('CANDIDATE_STATE','CANDIDATE','候选','ACTIVE'),
  ('CANDIDATE_STATE','SELECTED','已选择','ACTIVE'),
  ('CANDIDATE_STATE','REJECTED','已拒绝','ACTIVE'),
  ('CANDIDATE_STATE','LOCKED','已锁定','ACTIVE'),
  ('SELECTION_EVENT','SELECT','选择','ACTIVE'),
  ('SELECTION_EVENT','REJECT','拒绝','ACTIVE'),
  ('SELECTION_EVENT','RESTORE','恢复为当前','ACTIVE'),
  ('SELECTION_EVENT','LOCK','锁定','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_image_production_plans (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  target_shot_ids_json JSON NOT NULL,
  required_output_type VARCHAR(24) NOT NULL,
  coverage_policy_json JSON NOT NULL,
  qa_policy_json JSON NOT NULL,
  selection_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_image_plan_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_image_plan_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m289_image_plan_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m289_image_plan_key (project_id,plan_key),
  INDEX idx_m289_image_plan_current (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_generation_jobs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  image_production_plan_id CHAR(36) NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  unit_id CHAR(36) NULL,
  scene_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  asset_id CHAR(36) NULL,
  parent_call_sheet_id CHAR(36) NOT NULL,
  generation_key VARCHAR(180) NOT NULL,
  generation_type VARCHAR(32) NOT NULL,
  provider VARCHAR(128) NOT NULL,
  model_name VARCHAR(255) NOT NULL,
  model_version VARCHAR(128) NOT NULL,
  execution_stack_json JSON NOT NULL,
  prompt_text MEDIUMTEXT NOT NULL,
  negative_prompt_text MEDIUMTEXT NULL,
  prompt_version VARCHAR(128) NOT NULL,
  parameters_json JSON NOT NULL,
  input_fingerprint_sha256 CHAR(64) NOT NULL,
  requested_output_count INT NOT NULL,
  reference_snapshot_json JSON NOT NULL,
  preflight_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ended_at TIMESTAMP(6) NULL,
  latency_ms BIGINT NULL,
  token_usage_json JSON NULL,
  credit_usage_json JSON NULL,
  cost_json JSON NULL,
  error_json JSON NULL,
  retry_json JSON NOT NULL,
  safety_json JSON NULL,
  provenance_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_job_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_job_image_plan FOREIGN KEY (image_production_plan_id) REFERENCES aigc_image_production_plans(id),
  CONSTRAINT fk_m289_job_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m289_job_unit FOREIGN KEY (unit_id) REFERENCES aigc_units(id),
  CONSTRAINT fk_m289_job_scene FOREIGN KEY (scene_id) REFERENCES aigc_scenes(id),
  CONSTRAINT fk_m289_job_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m289_job_asset FOREIGN KEY (asset_id) REFERENCES aigc_assets(id),
  CONSTRAINT fk_m289_job_callsheet FOREIGN KEY (parent_call_sheet_id) REFERENCES aigc_asset_call_sheets(id),
  CONSTRAINT fk_m289_job_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m289_generation_key (project_id,generation_key),
  INDEX idx_m289_job_shot (shot_id,status,created_at),
  INDEX idx_m289_job_plan (image_production_plan_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_generation_job_references (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  generation_job_id CHAR(36) NOT NULL,
  asset_version_id CHAR(36) NOT NULL,
  reference_role VARCHAR(32) NOT NULL,
  inherited_from VARCHAR(32) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  compatibility_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_job_ref_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_job_ref_job FOREIGN KEY (generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m289_job_ref_asset_version FOREIGN KEY (asset_version_id) REFERENCES aigc_asset_versions(id),
  UNIQUE KEY uq_m289_job_ref (generation_job_id,asset_version_id,reference_role),
  INDEX idx_m289_job_ref_role (generation_job_id,reference_role,required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_generation_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  generation_job_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  candidate_key VARCHAR(200) NOT NULL,
  candidate_type VARCHAR(32) NOT NULL,
  ordinal_no INT NOT NULL,
  content_locator_json JSON NOT NULL,
  output_fingerprint_sha256 CHAR(64) NOT NULL,
  qa_result_json JSON NOT NULL,
  qa_status VARCHAR(16) NOT NULL,
  compare_group VARCHAR(128) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  selected_reason TEXT NULL,
  rejected_reason TEXT NULL,
  human_comment TEXT NULL,
  parent_candidate_id CHAR(36) NULL,
  version_no INT NOT NULL DEFAULT 1,
  provenance_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_candidate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_candidate_job FOREIGN KEY (generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m289_candidate_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m289_candidate_parent FOREIGN KEY (parent_candidate_id) REFERENCES aigc_generation_candidates(id),
  UNIQUE KEY uq_m289_candidate_key (project_id,candidate_key),
  UNIQUE KEY uq_m289_candidate_ordinal (generation_job_id,ordinal_no),
  INDEX idx_m289_candidate_shot (shot_id,is_current,state,qa_status),
  INDEX idx_m289_candidate_compare (project_id,compare_group,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_candidate_selection_events (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  previous_current_candidate_id CHAR(36) NULL,
  reason TEXT NOT NULL,
  human_comment TEXT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_select_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_select_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m289_select_candidate FOREIGN KEY (candidate_id) REFERENCES aigc_generation_candidates(id),
  CONSTRAINT fk_m289_select_previous FOREIGN KEY (previous_current_candidate_id) REFERENCES aigc_generation_candidates(id),
  CONSTRAINT fk_m289_select_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  INDEX idx_m289_select_history (shot_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m289_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m289_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
