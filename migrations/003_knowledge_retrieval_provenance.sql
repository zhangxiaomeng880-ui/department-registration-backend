-- AI Native 2.0 Retrieval provenance
-- Migration: 003_knowledge_retrieval_provenance.sql
-- Stores retrieval provenance only. Retrieved source text remains transient.

CREATE TABLE IF NOT EXISTS knowledge_retrievals (
  id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NULL,
  task_id CHAR(36) NULL,
  source_id CHAR(36) NOT NULL,
  query_text TEXT NOT NULL,
  query_hash VARCHAR(128) NOT NULL,
  retrieval_mode VARCHAR(64) NOT NULL DEFAULT 'LIBRARY_SEARCH_READ',
  status VARCHAR(32) NOT NULL DEFAULT 'PASS',
  candidate_count INT NOT NULL DEFAULT 0,
  selected_count INT NOT NULL DEFAULT 0,
  context_hash VARCHAR(128) NULL,
  policy_json JSON NULL,
  started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_knowledge_retrieval_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  CONSTRAINT fk_knowledge_retrieval_run FOREIGN KEY (run_id) REFERENCES runs(id),
  CONSTRAINT fk_knowledge_retrieval_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_retrieval_run_created (run_id, created_at),
  INDEX idx_retrieval_source_created (source_id, created_at),
  INDEX idx_retrieval_query_hash (query_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_retrieval_items (
  id CHAR(36) PRIMARY KEY,
  retrieval_id CHAR(36) NOT NULL,
  document_id CHAR(36) NULL,
  external_file_id VARCHAR(255) NOT NULL,
  library_file_id VARCHAR(255) NULL,
  version_id VARCHAR(255) NULL,
  source_path VARCHAR(1024) NULL,
  rank_no INT NOT NULL,
  relevance_score DECIMAL(12,8) NULL,
  selected BOOLEAN NOT NULL DEFAULT TRUE,
  line_start INT NULL,
  line_end INT NULL,
  content_hash VARCHAR(128) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_retrieval_items_retrieval FOREIGN KEY (retrieval_id) REFERENCES knowledge_retrievals(id),
  CONSTRAINT fk_retrieval_items_document FOREIGN KEY (document_id) REFERENCES knowledge_documents(id),
  UNIQUE KEY uq_retrieval_rank (retrieval_id, rank_no),
  INDEX idx_retrieval_item_file_version (external_file_id, version_id),
  INDEX idx_retrieval_item_selected (retrieval_id, selected)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
