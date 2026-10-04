-- AI Native Runtime V2.3 M23.2 Dunning / Collections
-- Migration: 014_collections.sql
-- Adds collection cases and immutable collection action history for overdue invoices.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS collection_cases (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL UNIQUE,
  tenant_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
  assigned_identity_id CHAR(36) NULL,
  opened_at TIMESTAMP(6) NOT NULL,
  last_contacted_at TIMESTAMP(6) NULL,
  next_action_at TIMESTAMP(6) NULL,
  promised_amount DECIMAL(30,10) NULL,
  promised_payment_at TIMESTAMP(6) NULL,
  resolved_at TIMESTAMP(6) NULL,
  resolution_code VARCHAR(64) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m232_case_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m232_case_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m232_case_assignee FOREIGN KEY (assigned_identity_id) REFERENCES identities(id),
  INDEX idx_m232_case_tenant_status (tenant_id,status,next_action_at),
  INDEX idx_m232_case_priority_status (priority,status,opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collection_actions (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  amount DECIMAL(30,10) NULL,
  promise_due_at TIMESTAMP(6) NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  metadata_json JSON NULL,
  occurred_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m232_action_case FOREIGN KEY (case_id) REFERENCES collection_cases(id),
  CONSTRAINT fk_m232_action_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_m232_action_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_m232_action_case_time (case_id,occurred_at),
  INDEX idx_m232_action_tenant_time (tenant_id,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
