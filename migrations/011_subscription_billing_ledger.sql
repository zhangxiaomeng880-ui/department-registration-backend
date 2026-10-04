-- AI Native Runtime V2.2 M22.5 Subscription / Credit Balance / Billing Cycle + Invoice Ledger
-- Migration: 011_subscription_billing_ledger.sql
-- Provider cost remains cost evidence. Revenue is calculated from immutable billing-term snapshots.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS plan_billing_terms (
  id CHAR(36) PRIMARY KEY,
  plan_key VARCHAR(128) NOT NULL,
  term_version INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  billing_interval VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
  recurring_fee DECIMAL(20,10) NOT NULL DEFAULT 0,
  included_usage_credit DECIMAL(20,10) NOT NULL DEFAULT 0,
  overage_mode VARCHAR(16) NOT NULL DEFAULT 'PAYG',
  overage_markup_bps INT UNSIGNED NOT NULL DEFAULT 0,
  payment_due_days INT UNSIGNED NOT NULL DEFAULT 7,
  effective_from TIMESTAMP(6) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  source_label VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_billing_term_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  UNIQUE KEY uq_m225_plan_term_version (plan_key,term_version),
  UNIQUE KEY uq_m225_plan_term_effective (plan_key,effective_from),
  INDEX idx_m225_billing_term_lookup (plan_key,status,effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  billing_term_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMP(6) NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMP(6) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_subscription_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m225_subscription_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  CONSTRAINT fk_m225_subscription_term FOREIGN KEY (billing_term_id) REFERENCES plan_billing_terms(id),
  INDEX idx_m225_subscription_tenant_status (tenant_id,status),
  INDEX idx_m225_subscription_plan_status (plan_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS billing_cycles (
  id CHAR(36) PRIMARY KEY,
  subscription_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  plan_key VARCHAR(128) NOT NULL,
  billing_term_id CHAR(36) NOT NULL,
  cycle_no INT UNSIGNED NOT NULL,
  period_start TIMESTAMP(6) NOT NULL,
  period_end TIMESTAMP(6) NOT NULL,
  currency CHAR(3) NOT NULL,
  recurring_fee_snapshot DECIMAL(20,10) NOT NULL,
  included_usage_credit_snapshot DECIMAL(20,10) NOT NULL,
  overage_mode_snapshot VARCHAR(16) NOT NULL,
  overage_markup_bps_snapshot INT UNSIGNED NOT NULL,
  payment_due_days_snapshot INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  provider_cost_total DECIMAL(30,10) NULL,
  included_usage_consumed DECIMAL(30,10) NULL,
  overage_cost_basis DECIMAL(30,10) NULL,
  usage_revenue DECIMAL(30,10) NULL,
  invoice_subtotal DECIMAL(30,10) NULL,
  credit_applied DECIMAL(30,10) NULL,
  total_due DECIMAL(30,10) NULL,
  finalized_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_cycle_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT fk_m225_cycle_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m225_cycle_plan FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
  CONSTRAINT fk_m225_cycle_term FOREIGN KEY (billing_term_id) REFERENCES plan_billing_terms(id),
  UNIQUE KEY uq_m225_cycle_number (subscription_id,cycle_no),
  UNIQUE KEY uq_m225_cycle_period (subscription_id,period_start),
  INDEX idx_m225_cycle_tenant_status (tenant_id,status,period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) PRIMARY KEY,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  tenant_id CHAR(36) NOT NULL,
  subscription_id CHAR(36) NOT NULL,
  billing_cycle_id CHAR(36) NOT NULL UNIQUE,
  currency CHAR(3) NOT NULL,
  subtotal DECIMAL(30,10) NOT NULL,
  credit_applied DECIMAL(30,10) NOT NULL DEFAULT 0,
  total_due DECIMAL(30,10) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'FINALIZED',
  issued_at TIMESTAMP(6) NOT NULL,
  due_at TIMESTAMP(6) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_invoice_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m225_invoice_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT fk_m225_invoice_cycle FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id),
  INDEX idx_m225_invoice_tenant_issued (tenant_id,issued_at),
  INDEX idx_m225_invoice_status_due (status,due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  item_type VARCHAR(32) NOT NULL,
  description VARCHAR(512) NOT NULL,
  quantity DECIMAL(30,10) NOT NULL DEFAULT 1,
  unit_amount DECIMAL(30,10) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_invoice_item_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  INDEX idx_m225_invoice_item_invoice (invoice_id,item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS billing_usage_settlements (
  usage_ledger_id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  billing_cycle_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  provider_cost_amount DECIMAL(30,10) NOT NULL,
  included_credit_amount DECIMAL(30,10) NOT NULL DEFAULT 0,
  overage_cost_basis DECIMAL(30,10) NOT NULL DEFAULT 0,
  revenue_amount DECIMAL(30,10) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  calculation_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_settlement_usage FOREIGN KEY (usage_ledger_id) REFERENCES usage_ledger(id),
  CONSTRAINT fk_m225_settlement_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m225_settlement_cycle FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id),
  CONSTRAINT fk_m225_settlement_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  INDEX idx_m225_settlement_cycle (billing_cycle_id),
  INDEX idx_m225_settlement_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  subscription_id CHAR(36) NULL,
  billing_cycle_id CHAR(36) NULL,
  invoice_id CHAR(36) NULL,
  entry_type VARCHAR(32) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  currency CHAR(3) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  note VARCHAR(512) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m225_credit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_m225_credit_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT fk_m225_credit_cycle FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id),
  CONSTRAINT fk_m225_credit_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  INDEX idx_m225_credit_tenant_currency (tenant_id,currency,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO rbac_role_permissions (role_key,permission_key) VALUES
  ('TENANT_OWNER','billing:read'),
  ('TENANT_ADMIN','billing:read');
