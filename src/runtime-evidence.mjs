import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { routeRuntimeTask } from './runtime-router.mjs';

const asJson = value => value == null ? null : JSON.stringify(value);

export const routeAndRecord = async input => {
  if (!input?.runId || !input?.taskId) {
    const error = new Error('runId and taskId are required');
    error.code = 'INVALID_ROUTE_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const decision = routeRuntimeTask(input);
  const db = getRuntimePool();
  const id = randomUUID();

  await db.execute(
    `INSERT INTO route_executions (
      id, run_id, task_id, route_rule_key, route_priority, matched,
      agent_key, skill_key, tool_key, policy_result,
      input_summary, decision_json, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId,
      decision.routeRuleKey,
      decision.routePriority,
      decision.matched,
      decision.agentKey,
      decision.skillKey,
      decision.toolKey,
      decision.policyResult,
      input.query || null,
      asJson({ ...decision, executionMode: input.executionMode || 'HYBRID_EXTERNAL_AGENT' }),
      Number(input.durationMs || 0),
    ]
  );

  return { id, ...decision };
};

export const recordToolExecution = async input => {
  if (!input?.runId || !input?.toolKey || !input?.status) {
    const error = new Error('runId, toolKey and status are required');
    error.code = 'INVALID_TOOL_EXECUTION';
    error.statusCode = 400;
    throw error;
  }
  const db = getRuntimePool();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO tool_executions (
      id, run_id, task_id, route_execution_id, tool_type, tool_key,
      model_key, status, input_json, output_json,
      token_input, token_output, cost_amount, cost_currency,
      duration_ms, error_code, error_message, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
    [
      id,
      input.runId,
      input.taskId || null,
      input.routeExecutionId || null,
      input.toolType || 'CHATGPT_CONNECTOR',
      input.toolKey,
      input.modelKey || null,
      input.status,
      asJson(input.input || null),
      asJson(input.output || null),
      Number(input.tokenInput || 0),
      Number(input.tokenOutput || 0),
      Number(input.costAmount || 0),
      input.costCurrency || 'USD',
      input.durationMs == null ? null : Number(input.durationMs),
      input.errorCode || null,
      input.errorMessage || null,
    ]
  );
  return { id, status: input.status, toolKey: input.toolKey };
};

export const recordGateResult = async input => {
  if (!input?.runId || !input?.stageKey || !input?.gateKey || !input?.status) {
    const error = new Error('runId, stageKey, gateKey and status are required');
    error.code = 'INVALID_GATE_RESULT';
    error.statusCode = 400;
    throw error;
  }
  const db = getRuntimePool();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO gate_results (
      id, run_id, task_id, stage_key, gate_key, status,
      criteria_json, evidence_json, blocking_reason, decided_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId || null,
      input.stageKey,
      input.gateKey,
      input.status,
      asJson(input.criteria || {}),
      asJson(input.evidence || null),
      input.blockingReason || null,
      input.decidedBy || 'RUNTIME',
    ]
  );
  return { id, status: input.status, gateKey: input.gateKey };
};

export const recordQaEvidence = async input => {
  if (!input?.runId || !input?.qaCaseKey || !input?.status || !input?.evidenceType) {
    const error = new Error('runId, qaCaseKey, status and evidenceType are required');
    error.code = 'INVALID_QA_EVIDENCE';
    error.statusCode = 400;
    throw error;
  }
  const db = getRuntimePool();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO qa_evidence (
      id, run_id, task_id, gate_result_id, qa_case_key, status,
      evidence_type, evidence_uri, evidence_json,
      issue_severity, issue_summary, verified_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId || null,
      input.gateResultId || null,
      input.qaCaseKey,
      input.status,
      input.evidenceType,
      input.evidenceUri || null,
      asJson(input.evidence || null),
      input.issueSeverity || null,
      input.issueSummary || null,
      input.verifiedBy || 'RUNTIME',
    ]
  );
  return { id, status: input.status, qaCaseKey: input.qaCaseKey };
};
