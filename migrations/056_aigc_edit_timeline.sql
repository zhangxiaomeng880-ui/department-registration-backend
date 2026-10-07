-- AI Native Runtime V2.8 M28.11 Edit / Timeline / Composite / Post-production
-- Migration: 056_aigc_edit_timeline.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_module_registry(module_key,display_name,stage_key,sort_order,description)
VALUES
  ('AIGC_TIMELINE_VERSION','时间线与序列版本','AIGC_09_EDIT',320,'正式 Timeline / Sequence Version、Track、Clip、Timecode 与来源血缘'),
  ('AIGC_POST_PRODUCTION','合成与后期','AIGC_09_EDIT',330,'剪辑节奏、合成、调色、混音、字幕、图形、确定性文字与 VFX 修复'),
  ('AIGC_CREATIVE_REVIEW','创作审阅','AIGC_09_EDIT',340,'Reviewer / Approval Role、timecode/shot/asset 锚定评论、Resolve/Reopen 与变更决策'),
  ('AIGC_RENDER_EXPORT','渲染与导出记录','AIGC_09_EDIT',350,'每次 Preview/Edit Master Export 都形成不可覆盖的独立 Render/Export Record')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),stage_key=VALUES(stage_key),sort_order=VALUES(sort_order),
  status='ACTIVE',description=VALUES(description);

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('GATE','G-AIGC-EDIT','剪辑 / 时间线门禁','ACTIVE'),
  ('TIMELINE_STATUS','DRAFT','草稿','ACTIVE'),
  ('TIMELINE_STATUS','LOCKED','已锁定','ACTIVE'),
  ('TIMELINE_STATUS','HISTORICAL','历史版本','ACTIVE'),
  ('TRACK_TYPE','VIDEO','视频轨','ACTIVE'),
  ('TRACK_TYPE','DIALOGUE','对白轨','ACTIVE'),
  ('TRACK_TYPE','VOICE','声音轨','ACTIVE'),
  ('TRACK_TYPE','MUSIC','音乐轨','ACTIVE'),
  ('TRACK_TYPE','SFX','音效轨','ACTIVE'),
  ('TRACK_TYPE','AMBIENCE','环境声轨','ACTIVE'),
  ('TRACK_TYPE','CAPTION','字幕轨','ACTIVE'),
  ('TRACK_TYPE','GRAPHIC','图形轨','ACTIVE'),
  ('REVIEW_STATUS','OPEN','待处理','ACTIVE'),
  ('REVIEW_STATUS','RESOLVED','已解决','ACTIVE'),
  ('REVIEW_EVENT','COMMENT','评论','ACTIVE'),
  ('REVIEW_EVENT','RESOLVE','解决','ACTIVE'),
  ('REVIEW_EVENT','REOPEN','重新打开','ACTIVE'),
  ('EXPORT_TYPE','PREVIEW','预览导出','ACTIVE'),
  ('EXPORT_TYPE','EDIT_MASTER','剪辑母版导出','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

CREATE TABLE IF NOT EXISTS aigc_timeline_versions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  breakdown_plan_id CHAR(36) NOT NULL,
  timeline_key VARCHAR(180) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(512) NOT NULL,
  duration_ms BIGINT NOT NULL,
  post_production_plan_json JSON NOT NULL,
  parent_timeline_version_id CHAR(36) NULL,
  change_ref_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  locked_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2811_timeline_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_timeline_breakdown FOREIGN KEY (breakdown_plan_id) REFERENCES aigc_breakdown_plans(id),
  CONSTRAINT fk_m2811_timeline_parent FOREIGN KEY (parent_timeline_version_id) REFERENCES aigc_timeline_versions(id),
  CONSTRAINT fk_m2811_timeline_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2811_timeline_key (project_id,timeline_key),
  UNIQUE KEY uq_m2811_timeline_version (project_id,version_no),
  INDEX idx_m2811_timeline_current (project_id,is_current,status,version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_timeline_tracks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  timeline_version_id CHAR(36) NOT NULL,
  track_key VARCHAR(180) NOT NULL,
  track_type VARCHAR(24) NOT NULL,
  sequence_no INT NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  track_settings_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2811_track_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_track_timeline FOREIGN KEY (timeline_version_id) REFERENCES aigc_timeline_versions(id),
  UNIQUE KEY uq_m2811_track_key (timeline_version_id,track_key),
  UNIQUE KEY uq_m2811_track_seq (timeline_version_id,sequence_no),
  INDEX idx_m2811_track_type (timeline_version_id,track_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_timeline_clips (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  timeline_version_id CHAR(36) NOT NULL,
  track_id CHAR(36) NOT NULL,
  clip_key VARCHAR(200) NOT NULL,
  sequence_no INT NOT NULL,
  shot_id CHAR(36) NULL,
  source_type VARCHAR(32) NOT NULL,
  production_lock_id CHAR(36) NULL,
  asset_version_id CHAR(36) NULL,
  source_version_key VARCHAR(200) NOT NULL,
  source_in_ms BIGINT NOT NULL,
  source_out_ms BIGINT NOT NULL,
  timeline_start_ms BIGINT NOT NULL,
  timeline_end_ms BIGINT NOT NULL,
  speed DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  transition_json JSON NOT NULL,
  lineage_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2811_clip_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_clip_timeline FOREIGN KEY (timeline_version_id) REFERENCES aigc_timeline_versions(id),
  CONSTRAINT fk_m2811_clip_track FOREIGN KEY (track_id) REFERENCES aigc_timeline_tracks(id),
  CONSTRAINT fk_m2811_clip_shot FOREIGN KEY (shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m2811_clip_prod_lock FOREIGN KEY (production_lock_id) REFERENCES aigc_production_locks(id),
  CONSTRAINT fk_m2811_clip_asset_version FOREIGN KEY (asset_version_id) REFERENCES aigc_asset_versions(id),
  UNIQUE KEY uq_m2811_clip_key (timeline_version_id,clip_key),
  UNIQUE KEY uq_m2811_clip_seq (track_id,sequence_no),
  INDEX idx_m2811_clip_time (track_id,timeline_start_ms,timeline_end_ms),
  INDEX idx_m2811_clip_source_lock (production_lock_id),
  INDEX idx_m2811_clip_source_asset (asset_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_timeline_review_threads (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  timeline_version_id CHAR(36) NOT NULL,
  thread_key VARCHAR(180) NOT NULL,
  anchor_type VARCHAR(24) NOT NULL,
  anchor_shot_id CHAR(36) NULL,
  anchor_asset_version_id CHAR(36) NULL,
  timecode_ms BIGINT NULL,
  reviewer_json JSON NOT NULL,
  approval_role VARCHAR(128) NOT NULL,
  comment_text TEXT NOT NULL,
  requested_change_json JSON NULL,
  decision_ref_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at TIMESTAMP(6) NULL,
  CONSTRAINT fk_m2811_review_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_review_timeline FOREIGN KEY (timeline_version_id) REFERENCES aigc_timeline_versions(id),
  CONSTRAINT fk_m2811_review_shot FOREIGN KEY (anchor_shot_id) REFERENCES aigc_shots(id),
  CONSTRAINT fk_m2811_review_asset FOREIGN KEY (anchor_asset_version_id) REFERENCES aigc_asset_versions(id),
  CONSTRAINT fk_m2811_review_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2811_review_key (timeline_version_id,thread_key),
  INDEX idx_m2811_review_status (timeline_version_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_timeline_review_events (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  review_thread_id CHAR(36) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  event_payload_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  actor_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2811_review_event_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_review_event_thread FOREIGN KEY (review_thread_id) REFERENCES aigc_timeline_review_threads(id),
  CONSTRAINT fk_m2811_review_event_identity FOREIGN KEY (actor_identity_id) REFERENCES identities(id),
  INDEX idx_m2811_review_event_thread (review_thread_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_render_exports (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  timeline_version_id CHAR(36) NOT NULL,
  export_key VARCHAR(200) NOT NULL,
  export_version_no INT NOT NULL,
  export_type VARCHAR(24) NOT NULL,
  content_locator_json JSON NOT NULL,
  render_spec_json JSON NOT NULL,
  source_fingerprint_sha256 CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  evidence_json JSON NOT NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2811_export_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_export_timeline FOREIGN KEY (timeline_version_id) REFERENCES aigc_timeline_versions(id),
  CONSTRAINT fk_m2811_export_identity FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m2811_export_key (project_id,export_key),
  UNIQUE KEY uq_m2811_export_version (timeline_version_id,export_version_no),
  INDEX idx_m2811_export_status (project_id,timeline_version_id,export_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS aigc_m2811_gate_evaluations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  gate_key VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason_codes_json JSON NOT NULL,
  evidence_snapshot_json JSON NOT NULL,
  as_of TIMESTAMP(6) NOT NULL,
  evaluated_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m2811_gate_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m2811_gate_identity FOREIGN KEY (evaluated_by_identity_id) REFERENCES identities(id),
  INDEX idx_m2811_gate_project (project_id,gate_key,as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
