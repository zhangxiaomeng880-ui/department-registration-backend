-- AI Native Runtime V2.8 M28.10 Video / Motion / Dialogue / Music / SFX Production
-- Migration: 055_aigc_video_audio_production.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_VIDEO_MOTION_PRODUCTION','视频与动作生产','AIGC_08_VIDEO_AUDIO',280,'关键帧驱动的视频生成、动作轨迹、镜头运动、时长与时间连续性'),
  ('AIGC_DIALOGUE_VOICE_PRODUCTION','对白与声音生产','AIGC_08_VIDEO_AUDIO',290,'对白、声音身份、发音、表演参考、同步与锁定'),
  ('AIGC_MUSIC_SFX_PRODUCTION','音乐与音效生产','AIGC_08_VIDEO_AUDIO',300,'音乐 / OST / SFX 的来源、权利、版本、Cue、Timing 与 Mix Intent'),
  ('AIGC_PRODUCTION_FAILURE_RERUN','生产失败与局部重跑','AIGC_08_VIDEO_AUDIO',310,'失败原因分类、受影响范围、局部重跑、替代任务与恢复证据')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-PRODUCTION','视频 / 音频生产门禁','ACTIVE'),
  ('PRODUCTION_TYPE','VIDEO','视频','ACTIVE'),
  ('PRODUCTION_TYPE','DIALOGUE','对白','ACTIVE'),
  ('PRODUCTION_TYPE','VOICE','声音','ACTIVE'),
  ('PRODUCTION_TYPE','MUSIC','音乐 / OST','ACTIVE'),
  ('PRODUCTION_TYPE','SFX','音效','ACTIVE'),
  ('PRODUCTION_APPLICABILITY','REQUIRED','必需','ACTIVE'),
  ('PRODUCTION_APPLICABILITY','N_A','不适用','ACTIVE'),
  ('PRODUCTION_STATUS','OPEN','待生产','ACTIVE'),
  ('PRODUCTION_STATUS','LOCKED','已锁定','ACTIVE'),
  ('PRODUCTION_STATUS','N_A','不适用','ACTIVE'),
  ('FAILURE_CATEGORY','TOOL_CAPABILITY','工具能力','ACTIVE'),
  ('FAILURE_CATEGORY','PROMPT','提示词','ACTIVE'),
  ('FAILURE_CATEGORY','REFERENCE','参考输入','ACTIVE'),
  ('FAILURE_CATEGORY','MOTION','动作 / 运动','ACTIVE'),
  ('FAILURE_CATEGORY','ASSET_UPSTREAM','上游资产','ACTIVE'),
  ('FAILURE_STATUS','OPEN','待处理','ACTIVE'),
  ('FAILURE_STATUS','RESOLVED','已解决','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_shot_production_requirements (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  requirement_key VARCHAR(200) NOT NULL,
  production_type VARCHAR(24) NOT NULL,
  applicability VARCHAR(16) NOT NULL,
  source_spec_json JSON NOT NULL,
  qa_policy_json JSON NOT NULL,
  rationale TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2810_req_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2810_req_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m2810_req_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m2810_req_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2810_req_key (project_id,requirement_key),
  UNIQUE KEY uq_m2810_req_type (breakdown_plan_id,shot_id,production_type),
  INDEX idx_m2810_req_status (project_id,production_type,applicability,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_production_locks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  production_requirement_id CHAR(36) NOT NULL,
  generation_job_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  lock_key VARCHAR(200) NOT NULL,
  lock_fingerprint_sha256 CHAR(64) NOT NULL,
  qa_snapshot_json JSON NOT NULL,
  rights_json JSON NOT NULL,
  timing_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'LOCKED',
  evidence_json JSON NOT NULL,
  locked_by_identity_id CHAR(36) NULL,
  locked_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2810_lock_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2810_lock_requirement FOREIGN KEY (production_requirement_id) REFERENCES aigc_shot_production_requirements(id),
  CONSTRAINT fk_m2810_lock_job FOREIGN KEY (generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m2810_lock_candidate FOREIGN KEY (candidate_id) REFERENCES aigc_generation_candidates(id),
  CONSTRAINT fk_m2810_lock_identity FOREIGN KEY (locked_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2810_lock_requirement (production_requirement_id),
  UNIQUE KEY uq_m2810_lock_key (project_id,lock_key),
  INDEX idx_m2810_lock_type (project_id,status,locked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_production_failure_analyses (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  generation_job_id CHAR(36) NOT NULL,
  failure_category VARCHAR(32) NOT NULL,
  affected_scope_json JSON NOT NULL,
  rerun_scope_json JSON NOT NULL,
  root_evidence_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  replacement_generation_job_id CHAR(36) NULL,
  resolution_json JSON NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2810_fail_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2810_fail_job FOREIGN KEY (generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m2810_fail_replacement FOREIGN KEY (replacement_generation_job_id) REFERENCES aigc_generation_jobs(id),
  CONSTRAINT fk_m2810_fail_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2810_fail_job (generation_job_id),
  INDEX idx_m2810_fail_status (project_id,status,failure_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2810_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2810_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2810_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2810_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
