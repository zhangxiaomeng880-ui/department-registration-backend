-- AI Native Runtime V2.6 M26.1 Strategy / Project Governance Core
-- Migration: 030_strategy_project_governance.sql
-- Project Management facts remain separate from Runtime execution facts.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE projects
  ADD COLUMN project_subtype VARCHAR(64) NULL AFTER project_type,
  ADD COLUMN owner_identity_id CHAR(36) NULL AFTER project_subtype,
  ADD COLUMN project_manager_identity_id CHAR(36) NULL AFTER owner_identity_id,
  ADD COLUMN goal TEXT NULL AFTER project_manager_identity_id,
  ADD COLUMN success_criteria_json JSON NULL AFTER goal,
  ADD COLUMN scope_json JSON NULL AFTER success_criteria_json,
  ADD COLUMN out_of_scope_json JSON NULL AFTER scope_json,
  ADD COLUMN priority VARCHAR(32) NOT NULL DEFAULT 'MEDIUM' AFTER status,
  ADD COLUMN health VARCHAR(16) NOT NULL DEFAULT 'GREEN' AFTER priority,
  ADD COLUMN start_date DATE NULL AFTER health,
  ADD COLUMN target_date DATE NULL AFTER start_date,
  ADD COLUMN actual_end_date DATE NULL AFTER target_date,
  ADD COLUMN risk_level VARCHAR(32) NULL AFTER actual_end_date,
  ADD COLUMN budget_guardrail_amount DECIMAL(18,6) NULL AFTER risk_level,
  ADD COLUMN budget_guardrail_currency CHAR(3) NULL AFTER budget_guardrail_amount,
  ADD COLUMN release_distribution_status VARCHAR(64) NULL AFTER budget_guardrail_currency,
  ADD COLUMN tags_json JSON NULL AFTER release_distribution_status,
  ADD COLUMN archived_at TIMESTAMP(6) NULL AFTER tags_json,
  ADD CONSTRAINT fk_m261_project_owner
    FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  ADD CONSTRAINT fk_m261_project_manager
    FOREIGN KEY (project_manager_identity_id) REFERENCES identities(id),
  ADD INDEX idx_m261_project_governance (workspace_id,status,health,priority,target_date),
  ADD INDEX idx_m261_project_owner (owner_identity_id,status);

CREATE TABLE IF NOT EXISTS strategic_items (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NULL,
  item_key VARCHAR(128) NOT NULL,
  item_type VARCHAR(16) NOT NULL,
  title VARCHAR(255) NOT NULL,
  goal TEXT NOT NULL,
  theme VARCHAR(255) NULL,
  scope_json JSON NULL,
  owner_identity_id CHAR(36) NULL,
  target_start DATE NULL,
  target_end DATE NULL,
  success_metric_json JSON NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
  health VARCHAR(16) NOT NULL DEFAULT 'GREEN',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_strategy_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m261_strategy_parent FOREIGN KEY (parent_id) REFERENCES strategic_items(id),
  CONSTRAINT fk_m261_strategy_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_strategy_key (workspace_id,item_key),
  INDEX idx_m261_strategy_type_status (workspace_id,item_type,status,priority),
  INDEX idx_m261_strategy_health (workspace_id,health,target_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS portfolios (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  portfolio_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  strategic_theme VARCHAR(255) NULL,
  owner_identity_id CHAR(36) NULL,
  target_start DATE NULL,
  target_end DATE NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
  health VARCHAR(16) NOT NULL DEFAULT 'GREEN',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  capacity_signal_json JSON NULL,
  budget_signal_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_portfolio_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_m261_portfolio_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_portfolio_key (workspace_id,portfolio_key),
  INDEX idx_m261_portfolio_health (workspace_id,status,health,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS strategic_item_project_links (
  strategic_item_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  link_role VARCHAR(32) NOT NULL DEFAULT 'CONTRIBUTES_TO',
  weight_bps INT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (strategic_item_id,project_id),
  CONSTRAINT fk_m261_strategy_project_strategy FOREIGN KEY (strategic_item_id) REFERENCES strategic_items(id),
  CONSTRAINT fk_m261_strategy_project_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS portfolio_project_links (
  portfolio_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  roadmap_order INT NULL,
  target_window VARCHAR(64) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (portfolio_id,project_id),
  CONSTRAINT fk_m261_portfolio_project_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_m261_portfolio_project_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_m261_portfolio_roadmap (portfolio_id,roadmap_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_baselines (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  baseline_no INT NOT NULL,
  version_label VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CURRENT',
  goal TEXT NULL,
  scope_json JSON NULL,
  out_of_scope_json JSON NULL,
  architecture_json JSON NULL,
  workflow_json JSON NULL,
  management_state_json JSON NULL,
  environment_json JSON NULL,
  knowledge_pointers_json JSON NULL,
  asset_pointers_json JSON NULL,
  data_pointers_json JSON NULL,
  release_distribution_json JSON NULL,
  decisions_json JSON NULL,
  risks_blockers_json JSON NULL,
  snapshot_json JSON NULL,
  evidence_json JSON NULL,
  effective_from TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  replaced_by_id CHAR(36) NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_baseline_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_baseline_replaced_by FOREIGN KEY (replaced_by_id) REFERENCES project_baselines(id),
  CONSTRAINT fk_m261_baseline_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_baseline_no (project_id,baseline_no),
  UNIQUE KEY uq_m261_baseline_label (project_id,version_label),
  INDEX idx_m261_baseline_status (project_id,status,effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_structure_nodes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NULL,
  node_key VARCHAR(128) NOT NULL,
  node_type VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner_identity_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_structure_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_structure_parent FOREIGN KEY (parent_id) REFERENCES project_structure_nodes(id),
  CONSTRAINT fk_m261_structure_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_structure_key (project_id,node_key),
  INDEX idx_m261_structure_parent (project_id,parent_id,node_type,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_iterations (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  iteration_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  sequence_no INT NOT NULL,
  goal TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  outcome_json JSON NULL,
  retrospective_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_iteration_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m261_iteration_key (project_id,iteration_key),
  UNIQUE KEY uq_m261_iteration_seq (project_id,sequence_no),
  INDEX idx_m261_iteration_status (project_id,status,start_date,end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE project_milestones
  ADD COLUMN management_status VARCHAR(32) NOT NULL DEFAULT 'PLANNED' AFTER status,
  ADD COLUMN objective TEXT NULL AFTER display_name,
  ADD COLUMN owner_identity_id CHAR(36) NULL AFTER objective,
  ADD COLUMN planned_start DATE NULL AFTER owner_identity_id,
  ADD COLUMN planned_end DATE NULL AFTER planned_start,
  ADD COLUMN actual_start DATETIME(6) NULL AFTER planned_end,
  ADD COLUMN actual_end DATETIME(6) NULL AFTER actual_start,
  ADD COLUMN progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER actual_end,
  ADD COLUMN exit_criteria_json JSON NULL AFTER progress_percent,
  ADD COLUMN required_deliverables_json JSON NULL AFTER exit_criteria_json,
  ADD COLUMN required_gates_json JSON NULL AFTER required_deliverables_json,
  ADD COLUMN evidence_json JSON NULL AFTER required_gates_json,
  ADD COLUMN milestone_version VARCHAR(64) NULL AFTER evidence_json,
  ADD CONSTRAINT fk_m261_milestone_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  ADD INDEX idx_m261_milestone_management (project_id,management_status,planned_end,sequence_no);

CREATE TABLE IF NOT EXISTS project_work_items (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  structure_node_id CHAR(36) NULL,
  milestone_id CHAR(36) NULL,
  iteration_id CHAR(36) NULL,
  item_key VARCHAR(128) NOT NULL,
  item_type VARCHAR(32) NOT NULL,
  title VARCHAR(512) NOT NULL,
  stage_key VARCHAR(128) NULL,
  owner_identity_id CHAR(36) NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  estimate_hours DECIMAL(12,2) NULL,
  actual_work_minutes BIGINT NOT NULL DEFAULT 0,
  waiting_minutes BIGINT NOT NULL DEFAULT 0,
  blocked_minutes BIGINT NOT NULL DEFAULT 0,
  acceptance_criteria_json JSON NULL,
  evidence_json JSON NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_work_item_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_work_item_structure FOREIGN KEY (structure_node_id) REFERENCES project_structure_nodes(id),
  CONSTRAINT fk_m261_work_item_milestone FOREIGN KEY (milestone_id) REFERENCES project_milestones(id),
  CONSTRAINT fk_m261_work_item_iteration FOREIGN KEY (iteration_id) REFERENCES project_iterations(id),
  CONSTRAINT fk_m261_work_item_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_work_item_key (project_id,item_key),
  INDEX idx_m261_work_item_plan (project_id,milestone_id,iteration_id,status,priority),
  INDEX idx_m261_work_item_stage (project_id,stage_key,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_dependencies (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  dependency_type VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  critical_path BOOLEAN NOT NULL DEFAULT FALSE,
  external_reference_json JSON NULL,
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_dependency_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m261_dependency_edge (project_id,source_type,source_id,target_type,target_id,dependency_type),
  INDEX idx_m261_dependency_target (project_id,target_type,target_id,status,critical_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_risks (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  risk_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  probability VARCHAR(16) NOT NULL,
  impact VARCHAR(16) NOT NULL,
  trigger_text TEXT NULL,
  owner_identity_id CHAR(36) NULL,
  mitigation TEXT NULL,
  contingency TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_risk_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_risk_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_risk_key (project_id,risk_key),
  INDEX idx_m261_risk_status (project_id,status,impact,probability)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_issues (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  issue_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  source VARCHAR(255) NULL,
  affected_scope_json JSON NULL,
  root_cause TEXT NULL,
  fix_summary TEXT NULL,
  retest_json JSON NULL,
  resolution_evidence_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_issue_project FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE KEY uq_m261_issue_key (project_id,issue_key),
  INDEX idx_m261_issue_status (project_id,status,severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_blockers (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  blocker_key VARCHAR(128) NOT NULL,
  blocking_object_type VARCHAR(32) NOT NULL,
  blocking_object_id VARCHAR(191) NOT NULL,
  reason TEXT NOT NULL,
  waiting_on VARCHAR(512) NULL,
  resume_condition TEXT NULL,
  resume_point_json JSON NULL,
  owner_identity_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMP(6) NULL,
  evidence_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_blocker_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_blocker_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_blocker_key (project_id,blocker_key),
  INDEX idx_m261_blocker_status (project_id,status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_decisions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  decision_key VARCHAR(128) NOT NULL,
  title VARCHAR(512) NOT NULL,
  context_json JSON NOT NULL,
  options_json JSON NULL,
  decision_json JSON NOT NULL,
  owner_identity_id CHAR(36) NULL,
  approver_identity_id CHAR(36) NULL,
  impact_json JSON NULL,
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  effective_version VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'EFFECTIVE',
  evidence_json JSON NULL,
  decided_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_decision_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_decision_owner FOREIGN KEY (owner_identity_id) REFERENCES identities(id),
  CONSTRAINT fk_m261_decision_approver FOREIGN KEY (approver_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_decision_key (project_id,decision_key),
  INDEX idx_m261_decision_status (project_id,status,decided_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_changes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  change_key VARCHAR(128) NOT NULL,
  before_json JSON NULL,
  change_reason TEXT NOT NULL,
  change_scope_json JSON NOT NULL,
  impacted_objects_json JSON NOT NULL,
  revalidation_scope_json JSON NULL,
  after_json JSON NOT NULL,
  evidence_json JSON NULL,
  created_by_identity_id CHAR(36) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_m261_change_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_m261_change_creator FOREIGN KEY (created_by_identity_id) REFERENCES identities(id),
  UNIQUE KEY uq_m261_change_key (project_id,change_key),
  INDEX idx_m261_change_created (project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE projects
  ADD COLUMN current_baseline_id CHAR(36) NULL AFTER current_knowledge_commit_sha,
  ADD COLUMN current_iteration_id CHAR(36) NULL AFTER current_baseline_id,
  ADD COLUMN current_milestone_id CHAR(36) NULL AFTER current_iteration_id,
  ADD CONSTRAINT fk_m261_project_current_baseline FOREIGN KEY (current_baseline_id) REFERENCES project_baselines(id),
  ADD CONSTRAINT fk_m261_project_current_iteration FOREIGN KEY (current_iteration_id) REFERENCES project_iterations(id),
  ADD CONSTRAINT fk_m261_project_current_milestone FOREIGN KEY (current_milestone_id) REFERENCES project_milestones(id),
  ADD INDEX idx_m261_project_current_management (current_milestone_id,current_iteration_id,current_baseline_id);
