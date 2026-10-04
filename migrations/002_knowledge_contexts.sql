-- AI Native 2.0 Knowledge Context Snapshot
-- Migration: 002_knowledge_contexts.sql
-- Purpose: persist only the knowledge actually retrieved for a Run.
-- The authoritative knowledge body remains in ChatGPT Library.

CREATE TABLE IF NOT EXISTS knowledge_contexts (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id CHAR(36) NULL,
  source_provider VARCHAR(64) NOT NULL,
  source_file_id VARCHAR(255) NOT NULL,
  source_library_file_id VARCHAR(255) NULL,
  source_version VARCHAR(128) NULL,
  source_path TEXT NULL,
  source_name VARCHAR(512) NULL,
  source_modified_at DATETIME(6) NULL,
  source_status VARCHAR(32) NULL,
  precedence_rank INT NULL,
  retrieval_query TEXT NULL,
  retrieval_mode VARCHAR(64) NULL,
  context_role VARCHAR(64) NOT NULL,
  content_json JSON NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  retrieved_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_knowledge_context_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_knowledge_context_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_knowledge_context_run (run_id, retrieved_at),
  INDEX idx_knowledge_context_task (task_id),
  INDEX idx_knowledge_context_source (source_provider, source_file_id, source_version),
  INDEX idx_knowledge_context_hash (content_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
