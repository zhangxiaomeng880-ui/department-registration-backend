#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

export MYSQL_PWD="$DB_PASSWORD"
MYSQL=(mysql --protocol=tcp -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" --batch --skip-column-names)

echo "[1/7] Applying runtime persistence migration"
"${MYSQL[@]}" < migrations/001_runtime_persistence.sql

echo "[2/7] Verifying required tables"
required_tables=(
  projects
  runs
  tasks
  checkpoints
  stage_snapshots
  route_executions
  tool_executions
  gate_results
  qa_evidence
  audit_logs
)
for table in "${required_tables[@]}"; do
  count="$("${MYSQL[@]}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$table';")"
  if [[ "$count" != "1" ]]; then
    echo "Missing table: $table" >&2
    exit 1
  fi
done

PROJECT_ID="11111111-1111-4111-8111-111111111111"
RUN_ID="22222222-2222-4222-8222-222222222222"
TASK_ID="33333333-3333-4333-8333-333333333333"
CHECKPOINT_ID="44444444-4444-4444-8444-444444444444"
SNAPSHOT_ID="55555555-5555-4555-8555-555555555555"
ROUTE_ID="66666666-6666-4666-8666-666666666666"
TOOL_ID="77777777-7777-4777-8777-777777777777"
GATE_ID="88888888-8888-4888-8888-888888888888"
QA_ID="99999999-9999-4999-8999-999999999999"

echo "[3/7] Writing Project -> Run -> Task -> Checkpoint"
"${MYSQL[@]}" <<SQL
INSERT INTO projects (
  id, project_key, name, project_type, status,
  current_workflow_version, current_knowledge_commit_sha
) VALUES (
  '$PROJECT_ID', 'runtime-persistence-ci', 'AI Native Runtime Persistence CI',
  'AIGC_CONTENT', 'ACTIVE', 'workflow-ci-v1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

INSERT INTO runs (
  id, project_id, run_type, status, trigger_source,
  input_json, runtime_commit_sha, knowledge_commit_sha,
  workflow_version, router_version, started_at
) VALUES (
  '$RUN_ID', '$PROJECT_ID', 'WORKFLOW', 'RUNNING', 'CI',
  JSON_OBJECT('task', 'runtime persistence validation'),
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'workflow-ci-v1', 'router-ci-v1', CURRENT_TIMESTAMP(6)
);

INSERT INTO tasks (
  id, run_id, stage_key, task_key, task_type, status, sequence_no,
  input_json, output_json, dependency_json, started_at, finished_at
) VALUES (
  '$TASK_ID', '$RUN_ID', 'SCRIPT', 'sc042-sc050-continuity-read',
  'ANALYSIS', 'PASS', 1,
  JSON_OBJECT('scope', 'SC042-SC050'),
  JSON_OBJECT('result', 'validated'),
  JSON_OBJECT('knowledge_commit', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
);

INSERT INTO checkpoints (
  id, run_id, task_id, sequence_no, checkpoint_type, status,
  stage_key, step_key, state_json,
  completed_task_keys_json, pending_task_keys_json, blocked_task_keys_json,
  dependency_fingerprint, runtime_commit_sha, knowledge_commit_sha,
  workflow_version, router_version, resume_from_task_key
) VALUES (
  '$CHECKPOINT_ID', '$RUN_ID', '$TASK_ID', 1, 'AUTO', 'VALID',
  'SCRIPT', 'continuity-read',
  JSON_OBJECT('last_completed_task', 'sc042-sc050-continuity-read', 'status', 'PASS'),
  JSON_ARRAY('sc042-sc050-continuity-read'),
  JSON_ARRAY('next-runtime-task'),
  JSON_ARRAY(),
  'fp-ci-001',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'workflow-ci-v1', 'router-ci-v1', 'next-runtime-task'
);

UPDATE runs
SET last_checkpoint_at = CURRENT_TIMESTAMP(6)
WHERE id = '$RUN_ID';
SQL

echo "[4/7] Writing Router / Tool / Gate / QA / Audit evidence"
"${MYSQL[@]}" <<SQL
INSERT INTO route_executions (
  id, run_id, task_id, route_rule_key, route_priority, matched,
  agent_key, skill_key, tool_key, policy_result, input_summary,
  decision_json, duration_ms
) VALUES (
  '$ROUTE_ID', '$RUN_ID', '$TASK_ID', 'P86', 86, TRUE,
  'Script Agent', 'script-storyboard', 'Knowledge Store',
  'ALLOW', 'SC042-SC050 continuity read',
  JSON_OBJECT('reason', 'script narrative continuity task'), 12
);

INSERT INTO tool_executions (
  id, run_id, task_id, route_execution_id, tool_type, tool_key,
  status, input_json, output_json, token_input, token_output,
  cost_amount, duration_ms, started_at, finished_at
) VALUES (
  '$TOOL_ID', '$RUN_ID', '$TASK_ID', '$ROUTE_ID', 'MCP',
  'Knowledge Store', 'PASS',
  JSON_OBJECT('query', 'current facts'),
  JSON_OBJECT('source', 'git knowledge current'),
  100, 50, 0.001000, 25,
  CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
);

INSERT INTO gate_results (
  id, run_id, task_id, stage_key, gate_key, status,
  criteria_json, evidence_json, decided_by
) VALUES (
  '$GATE_ID', '$RUN_ID', '$TASK_ID', 'SCRIPT', 'G-RUNTIME-CI',
  'PASS',
  JSON_OBJECT('checkpoint_written', TRUE, 'route_recorded', TRUE),
  JSON_OBJECT('checkpoint_id', '$CHECKPOINT_ID', 'route_execution_id', '$ROUTE_ID'),
  'CI'
);

INSERT INTO qa_evidence (
  id, run_id, task_id, gate_result_id, qa_case_key, status,
  evidence_type, evidence_json, verified_by
) VALUES (
  '$QA_ID', '$RUN_ID', '$TASK_ID', '$GATE_ID', 'QA-RUNTIME-PERSISTENCE-001',
  'PASS', 'DB_ASSERTION',
  JSON_OBJECT('assertion', 'runtime evidence queryable by run_id'),
  'CI'
);

INSERT INTO audit_logs (
  project_id, run_id, task_id, event_type, actor_type,
  actor_key, object_type, object_id, event_json
) VALUES (
  '$PROJECT_ID', '$RUN_ID', '$TASK_ID', 'CHECKPOINT_CREATED',
  'SYSTEM', 'github-actions', 'CHECKPOINT', '$CHECKPOINT_ID',
  JSON_OBJECT('sequence_no', 1, 'status', 'VALID')
);
SQL

echo "[5/7] Creating immutable Current Stage Snapshot"
"${MYSQL[@]}" <<SQL
INSERT INTO stage_snapshots (
  id, project_id, run_id, stage_key, snapshot_version,
  gate_status, is_current, state_json, evidence_json,
  runtime_commit_sha, knowledge_commit_sha, workflow_version
) VALUES (
  '$SNAPSHOT_ID', '$PROJECT_ID', '$RUN_ID', 'SCRIPT', 1,
  'PASS', TRUE,
  JSON_OBJECT('task_status', 'PASS'),
  JSON_OBJECT('gate_result_id', '$GATE_ID'),
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'workflow-ci-v1'
);
SQL

echo "[6/7] Verifying Current uniqueness"
set +e
"${MYSQL[@]}" -e "
  INSERT INTO stage_snapshots (
    id, project_id, run_id, stage_key, snapshot_version,
    gate_status, is_current, state_json
  ) VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '$PROJECT_ID', '$RUN_ID', 'SCRIPT', 2,
    'PASS', TRUE, JSON_OBJECT('duplicate_current', TRUE)
  );
" >/tmp/duplicate-current.out 2>/tmp/duplicate-current.err
duplicate_exit=$?
set -e
if [[ "$duplicate_exit" -eq 0 ]]; then
  echo "Expected duplicate Current Stage Snapshot to be rejected, but insert succeeded" >&2
  exit 1
fi

echo "[7/7] Simulating process restart with a fresh DB connection"
resume_task="$("${MYSQL[@]}" -e "
  SELECT resume_from_task_key
  FROM checkpoints
  WHERE run_id = '$RUN_ID' AND status = 'VALID'
  ORDER BY sequence_no DESC
  LIMIT 1;
")"
if [[ "$resume_task" != "next-runtime-task" ]]; then
  echo "Resume checkpoint mismatch: $resume_task" >&2
  exit 1
fi

evidence_count="$("${MYSQL[@]}" -e "
  SELECT
    (SELECT COUNT(*) FROM route_executions WHERE run_id = '$RUN_ID') +
    (SELECT COUNT(*) FROM tool_executions WHERE run_id = '$RUN_ID') +
    (SELECT COUNT(*) FROM gate_results WHERE run_id = '$RUN_ID') +
    (SELECT COUNT(*) FROM qa_evidence WHERE run_id = '$RUN_ID') +
    (SELECT COUNT(*) FROM audit_logs WHERE run_id = '$RUN_ID');
")"
if [[ "$evidence_count" -lt 5 ]]; then
  echo "Runtime evidence is incomplete: $evidence_count" >&2
  exit 1
fi

echo "PASS: MySQL runtime persistence migration, checkpoint reload, Current uniqueness, and run evidence are verified."
