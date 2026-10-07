-- AI Native Runtime V2.8 M28.9.1 Generation Preflight + Keyframe Lock
-- Migration: 055_aigc_generation_lock_preflight.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO aigc_ui_labels(label_type,stable_key,display_name,status)
VALUES
  ('CANDIDATE_STATUS','LOCKED','已锁定','ACTIVE'),
  ('SELECTION_EVENT','LOCK','锁定','ACTIVE')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='ACTIVE';

ALTER TABLE aigc_generation_jobs
  ADD COLUMN preflight_json JSON NULL AFTER reference_bindings_json;

ALTER TABLE aigc_generation_candidates
  ADD COLUMN locked_at TIMESTAMP(6) NULL AFTER is_current;

CREATE INDEX idx_m2891_candidate_locked
  ON aigc_generation_candidates (shot_id,is_current,selection_status,locked_at);
