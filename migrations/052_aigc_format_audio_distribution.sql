-- AI Native Runtime V2.8 M28.7 Visual Format / Audio / Distribution Strategy
-- Migration: 052_aigc_format_audio_distribution.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_VISUAL_FORMAT_STRATEGY','视觉格式策略','AIGC_05_FORMAT',150,'母版画幅、分辨率、帧率、安全区、裁切重构、字幕与首尾帧规则'),
  ('AIGC_AUDIO_STRATEGY','音频策略','AIGC_05_FORMAT',160,'人声母版、对白、音乐、OST、SFX、环境声、分轨、响度、导出与权利'),
  ('AIGC_DISTRIBUTION_STRATEGY','分发策略','AIGC_05_FORMAT',170,'渠道、市场、语言、本地化、平台规格、AI 披露与权利边界'),
  ('AIGC_FORMAT_DELIVERY_MATRIX','格式交付矩阵','AIGC_05_FORMAT',180,'母版与各平台派生格式的明确映射，禁止以分发规格反向覆盖母版')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-FORMAT','格式 / 音频 / 分发门禁','ACTIVE'),
  ('FORMAT_KIND','MASTER','母版','ACTIVE'),
  ('FORMAT_KIND','DERIVATIVE','派生版本','ACTIVE'),
  ('LOCALIZATION_LEVEL','NONE','无需本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','SUBTITLE','字幕本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','VOICEOVER','配音本地化','ACTIVE'),
  ('LOCALIZATION_LEVEL','FULL','完整本地化','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_visual_format_strategies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  strategy_key VARCHAR(128) NOT NULL,
  master_format_json JSON NOT NULL,
  safe_zones_json JSON NOT NULL,
  crop_recompose_policy_json JSON NOT NULL,
  subtitle_safe_area_json JSON NOT NULL,
  first_last_frame_json JSON NOT NULL,
  distribution_profiles_json JSON NOT NULL,
  derivation_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_visual_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_visual_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m287_visual_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m287_visual_key (project_id,strategy_key),
  INDEX idx_m287_visual_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_audio_strategies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  strategy_key VARCHAR(128) NOT NULL,
  voice_master_json JSON NOT NULL,
  dialogue_json JSON NOT NULL,
  music_json JSON NOT NULL,
  ost_json JSON NOT NULL,
  sfx_json JSON NOT NULL,
  ambience_json JSON NOT NULL,
  track_separation_json JSON NOT NULL,
  loudness_export_json JSON NOT NULL,
  rights_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_audio_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_audio_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m287_audio_key (project_id,strategy_key),
  INDEX idx_m287_audio_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_distribution_strategies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  visual_format_strategy_id CHAR(36) NOT NULL,
  audio_strategy_id CHAR(36) NOT NULL,
  strategy_key VARCHAR(128) NOT NULL,
  targets_json JSON NOT NULL,
  localization_matrix_json JSON NOT NULL,
  release_packaging_json JSON NOT NULL,
  rights_boundary_json JSON NOT NULL,
  ai_disclosure_policy_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'FROZEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_distribution_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_distribution_visual FOREIGN KEY (visual_format_strategy_id) REFERENCES aigc_visual_format_strategies(id),
  CONSTRAINT fk_m287_distribution_audio FOREIGN KEY (audio_strategy_id) REFERENCES aigc_audio_strategies(id),
  CONSTRAINT fk_m287_distribution_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m287_distribution_key (project_id,strategy_key),
  INDEX idx_m287_distribution_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m287_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m287_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m287_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m287_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
