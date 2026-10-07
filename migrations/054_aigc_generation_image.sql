-- AI Native Runtime V2.8 M28.9 Generation / Candidate / Image-Keyframe Production
-- Migration: 054_aigc_generation_image.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_GENERATION_JOB','生成任务','AIGC_07_IMAGE',240,'正式 Generation Job：调用单、模型工具版本、Prompt/Reference/参数、输入指纹、成本、重试、Safety 与 Provenance'),
  ('AIGC_GENERATION_CANDIDATE','生成候选','AIGC_07_IMAGE',250,'每次 Generation Job 的候选输出、内容定位、输出指纹、质量评估与历史保留'),
  ('AIGC_CANDIDATE_SELECTION','候选选择与恢复','AIGC_07_IMAGE',260,'Selected/CURRENT、Rejected 与 Restore 事件；历史候选不可覆盖'),
  ('AIGC_IMAGE_KEYFRAME','图像 / 关键帧 / 分镜生产','AIGC_07_IMAGE',270,'镜头级关键帧正式生产、质量门禁与后续视频 Reference 准入')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-IMAGE','图像 / 关键帧门禁','ACTIVE'),
  ('GENERATION_STATUS','QUEUED','排队中','ACTIVE'),
  ('GENERATION_STATUS','RUNNING','生成中','ACTIVE'),
  ('GENERATION_STATUS','PASS','生成通过','ACTIVE'),
  ('GENERATION_STATUS','FAIL','生成失败','ACTIVE'),
  ('GENERATION_STATUS','BLOCKED','生成阻塞','ACTIVE'),
  ('CANDIDATE_STATUS','CANDIDATE','候选','ACTIVE'),
  ('CANDIDATE_STATUS','SELECTED','已选择','ACTIVE'),
  ('CANDIDATE_STATUS','REJECTED','已拒绝','ACTIVE'),
  ('CANDIDATE_STATUS','HISTORICAL','历史候选','ACTIVE'),
  ('SELECTION_EVENT','SELECT','选择为当前','ACTIVE'),
  ('SELECTION_EVENT','RESTORE','恢复为当前','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_generation_jobs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  parent_call_sheet_id CHAR(36) NOT NULL,
  job_key VARCHAR(180) NOT NULL,
  generation_kind VARCHAR(32) NOT NULL,
  provider VARCHAR(128) NOT NULL,
  model_tool VARCHAR(255) NOT NULL,
  model_tool_version VARCHAR(128) NOT NULL,
  tool_key VARCHAR(255) NULL,
  skill_key VARCHAR(320) NULL,
  mcp_key VARCHAR(320) NULL,
  prompt_text MEDIUMTEXT NOT NULL,
  negative_prompt_text MEDIUMTEXT NULL,
  prompt_version VARCHAR(128) NOT NULL,
  reference_bindings_json JSON NOT NULL,
  parameters_json JSON NOT NULL,
  input_fingerprint_sha256 CHAR(64) NOT NULL,
  requested_output_count INT NOT NULL,
  started_at TIMESTAMP(6) NULL,
  finished_at TIMESTAMP(6) NULL,
  latency_ms BIGINT NULL,
  usage_json JSON NOT NULL,
  cost_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  retry_json JSON NOT NULL,
  safety_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_job_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_job_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m289_job_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m289_job_callsheet FOREIGN KEY (parent_call_sheet_id) REFERENCES aigc_asset_call_sheets(id),
  CONSTRAINT fk_m289_job_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m289_job_key (project_id,job_key),
  INDEX idx_m289_job_shot (breakdown_plan_id,shot_id,generation_kind,status),
  INDEX idx_m289_job_status (project_id,status,created_at),
  INDEX idx_m289_job_input (project_id,input_fingerprint_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_generation_candidates (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  generation_job_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  candidate_key VARCHAR(200) NOT NULL,
  output_index INT NOT NULL,
  candidate_version_no INT NOT NULL DEFAULT 1,
  content_locator_json JSON NOT NULL,
  output_fingerprint_sha256 CHAR(64) NOT NULL,
  qa_json JSON NOT NULL,
  compare_group VARCHAR(128) NULL,
  selection_status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason TEXT NULL,
  human_comment TEXT NULL,
  safety_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_candidate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_candidate_job FOREIGN KEY (generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m289_candidate_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  UNIQUE KEY uq_m289_candidate_key (generation_job_id,candidate_key),
  UNIQUE KEY uq_m289_candidate_output (generation_job_id,output_index,candidate_version_no),
  INDEX idx_m289_candidate_current (shot_id,is_current,selection_status),
  INDEX idx_m289_candidate_job (generation_job_id,selection_status,output_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_candidate_selection_events (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  from_candidate_id CHAR(36) NULL,
  to_candidate_id CHAR(36) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  selected_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m289_selection_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m289_selection_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m289_selection_from FOREIGN KEY (from_candidate_id) REFERENCES aigc_generation_candidates(id),
  CONSTRAINT fk_m289_selection_to FOREIGN KEY (to_candidate_id) REFERENCES aigc_generation_candidates(id),
  CONSTRAINT fk_m289_selection_identity FOREIGN KEY (selected_by_identity_id) REFERENCES identities(id),
  INDEX idx_m289_selection_shot (shot_id,created_at),
  INDEX idx_m289_selection_to (to_candidate_id,created_at)
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
