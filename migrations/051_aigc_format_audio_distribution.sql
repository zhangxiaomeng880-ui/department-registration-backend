-- AI Native Runtime V2.8 M28.6 Visual Format / Audio / Distribution Strategy
-- Migration: 051_aigc_format_audio_distribution.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_VISUAL_FORMAT','视觉格式策略','AIGC_05_FORMAT',150,'母版画幅、分辨率、帧率、安全区、裁切/重构、字幕安全区与首尾帧要求'),
  ('AIGC_AUDIO_STRATEGY','音频策略','AIGC_05_FORMAT',160,'Voice、对白、音乐、OST、SFX、环境声、分轨、响度、导出与权利'),
  ('AIGC_DISTRIBUTION_STRATEGY','分发策略','AIGC_05_FORMAT',170,'Channel、Market、Language、Localization、Platform Spec、AI Disclosure 与 Rights Boundary'),
  ('AIGC_SHOT_FORMAT_POLICY','镜头多画幅策略','AIGC_05_FORMAT',180,'镜头级可裁切、需重构、仅母版与安全区策略')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-FORMAT','格式 / 音频 / 分发策略门禁','ACTIVE'),
  ('FORMAT_POLICY','SAFE_CROP','可安全裁切','ACTIVE'),
  ('FORMAT_POLICY','RECOMPOSE_REQUIRED','需要重新构图','ACTIVE'),
  ('FORMAT_POLICY','MASTER_ONLY','仅保留母版','ACTIVE'),
  ('LOCALIZATION_LEVEL','NONE','不本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','SUBTITLE','字幕本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','DUB','配音本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','REEDIT','重剪本地化','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_format_strategies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  strategy_key VARCHAR(128) NOT NULL,
  version_no INT NOT NULL,
  master_aspect_ratio VARCHAR(32) NOT NULL,
  master_resolution_json JSON NOT NULL,
  frame_rate_json JSON NOT NULL,
  safe_zones_json JSON NOT NULL,
  crop_recompose_policy_json JSON NOT NULL,
  subtitle_safe_area_json JSON NOT NULL,
  first_last_frame_json JSON NOT NULL,
  audio_strategy_json JSON NOT NULL,
  master_locked BOOLEAN NOT NULL DEFAULT FALSE,
  story_fact_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m286_format_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m286_format_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m286_format_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m286_format_key (project_id,strategy_key),
  UNIQUE KEY uq_m286_format_version (project_id,version_no),
  INDEX idx_m286_format_current (project_id,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_shot_format_policies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  format_strategy_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NOT NULL,
  policy_key VARCHAR(180) NOT NULL,
  format_policy VARCHAR(32) NOT NULL,
  protected_window_json JSON NOT NULL,
  crop_safe_area_json JSON NOT NULL,
  subtitle_safe_area_json JSON NOT NULL,
  first_last_frame_json JSON NOT NULL,
  rationale TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m286_shot_policy_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m286_shot_policy_strategy FOREIGN KEY (format_strategy_id) REFERENCES aigc_format_strategies(id),
  CONSTRAINT fk_m286_shot_policy_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  UNIQUE KEY uq_m286_shot_policy (format_strategy_id,shot_id),
  UNIQUE KEY uq_m286_shot_policy_key (format_strategy_id,policy_key),
  INDEX idx_m286_shot_policy_type (format_strategy_id,format_policy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_distribution_profiles (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  format_strategy_id CHAR(36) NOT NULL,
  profile_key VARCHAR(160) NOT NULL,
  channel VARCHAR(128) NOT NULL,
  channel_type VARCHAR(48) NOT NULL,
  market VARCHAR(128) NOT NULL,
  language VARCHAR(64) NOT NULL,
  localization_level VARCHAR(24) NOT NULL,
  distribution_aspect_ratio VARCHAR(32) NOT NULL,
  platform_spec_json JSON NOT NULL,
  adaptation_json JSON NOT NULL,
  ai_disclosure_json JSON NOT NULL,
  rights_boundary_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE',
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m286_distribution_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m286_distribution_strategy FOREIGN KEY (format_strategy_id) REFERENCES aigc_format_strategies(id),
  UNIQUE KEY uq_m286_distribution_key (format_strategy_id,profile_key),
  INDEX idx_m286_distribution_scope (format_strategy_id,channel_type,market,language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m286_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m286_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m286_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m286_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
