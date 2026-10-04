-- AI Native 2.0 Knowledge Source Adapter metadata
-- Migration: 002_knowledge_source_adapter.sql
-- Source content remains external. This schema stores only source identity/version/sync metadata.

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id CHAR(36) PRIMARY KEY,
  source_key VARCHAR(128) NOT NULL UNIQUE,
  provider VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL DEFAULT 'LIBRARY',
  transport_mode VARCHAR(64) NOT NULL DEFAULT 'CONNECTOR',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  root_scope VARCHAR(512) NULL,
  config_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_knowledge_sources_provider_status (provider, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  external_file_id VARCHAR(255) NOT NULL,
  library_file_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(255) NULL,
  file_provider VARCHAR(64) NULL,
  source_status VARCHAR(32) NULL,
  default_retrieval BOOLEAN NOT NULL DEFAULT TRUE,
  current_version_id VARCHAR(255) NULL,
  current_version_number BIGINT NULL,
  source_modified_at TIMESTAMP(6) NULL,
  content_fingerprint VARCHAR(128) NULL,
  last_indexed_version_id VARCHAR(255) NULL,
  last_indexed_at TIMESTAMP(6) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_knowledge_documents_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  UNIQUE KEY uq_knowledge_document_external (source_id, external_file_id),
  INDEX idx_knowledge_documents_current (source_id, source_status, default_retrieval),
  INDEX idx_knowledge_documents_version (source_id, current_version_id),
  INDEX idx_knowledge_documents_path (source_id, source_path(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_sync_runs (
  id CHAR(36) PRIMARY KEY,
  source_id CHAR(36) NOT NULL,
  run_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  discovered_count INT NOT NULL DEFAULT 0,
  changed_count INT NOT NULL DEFAULT 0,
  unchanged_count INT NOT NULL DEFAULT 0,
  removed_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  source_cursor VARCHAR(1024) NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  summary_json JSON NULL,
  CONSTRAINT fk_knowledge_sync_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  CONSTRAINT fk_knowledge_sync_run FOREIGN KEY (run_id) REFERENCES runs(id),
  INDEX idx_knowledge_sync_source_started (source_id, started_at),
  INDEX idx_knowledge_sync_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
