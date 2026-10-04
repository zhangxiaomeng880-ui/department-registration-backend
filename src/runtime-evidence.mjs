import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { routeRuntimeTask } from './runtime-router.mjs';

const asJson = value => value == null ? null : JSON.stringify(value);

const resolveCorrelationId = async (db, runId, explicitCorrelationId) => {
  if (explicitCorrelationId) return explicitCorrelationId;
  const [rows] = await db.execute('SELECT correlation_id FROM runs WHERE id = ?', [runId]);
  return rows[0]?.correlation_id || null;
};

export const routeAndRecord = async input => {
  if (!input?.runId || !input?.taskId) {
    const error = new Error('runId and taskId are required');
    error.code = 'INVALID_ROUTE_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const startedAt = performance.now();
  const decision = routeRuntimeTask(input);
  const durationMs = input.durationMs == null
    ? Math.max(0, Math.round(performance.now() - startedAt))
    : Number(input.durationMs);
  const db = getRuntimePool();
  const id = randomUUID();
  const correlationId = await resolveCorrelationId(db, input.runId, input.correlationId);

  await db.execute(
    `INSERT INTO route_executions (
      id, run_id, task_id, correlation_id, route_rule_key, route_priority, matched,
      agent_key, skill_key, tool_key, policy_result,
      input_summary, decision_json, duration_ms, error_category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId,
      correlationId,
      decision.routeRuleKey,
      decision.routePriority,
      decision.matched,
      decision.agentKey,
      decision.skillKey,
      decision.toolKey,
      decision.policyResult,
      input.query || null,
      asJson({ ...decision, executionMode: input.executionMode || 'HYBRID_EXTERNAL_AGENT' }),
      durationMs,
      input.errorCategory || null,
    ]
  );

  return { id, durationMs, correlationId, ...decision };
};

export const recordToolExecution = async input => {
  if (!input?.runId || !input?.toolKey || !input?.status) {
    const error = new Error('runId, toolKey and status are required');
    error.code = 'INVALID_TOOL_EXECUTION';
    error.statusCode = 400;
    throw error;
  }

  const db = getRuntimePool();
  const connection = await db.getConnection();
  const id = randomUUID();
  const usageId = randomUUID();
  const tokenInput = Number(input.tokenInput || 0);
  const tokenOutput = Number(input.tokenOutput || 0);
  const durationMs = input.durationMs == null ? null : Number(input.durationMs);
  const costAmount = Number(input.costAmount || 0);
  let correlationId = input.correlationId || null;
  const providerKey = input.providerKey || null;
  const errorCategory = input.errorCategory || null;

  try {
    await connection.beginTransaction();
    const [runRows] = await connection.execute(
      'SELECT project_id, correlation_id FROM runs WHERE id = ? FOR UPDATE',
      [input.runId]
    );
    if (!runRows.length) {
      const error = new Error('Run not found');
      error.code = 'RUN_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    correlationId = correlationId || runRows[0].correlation_id || null;

    await connection.execute(
      `INSERT INTO tool_executions (
        id, run_id, task_id, route_execution_id, correlation_id,
        tool_type, tool_key, provider_key, model_key, status, input_json, output_json,
        token_input, token_output, cost_amount, cost_currency,
        duration_ms, error_code, error_category, error_message, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        id,
        input.runId,
        input.taskId || null,
        input.routeExecutionId || null,
        correlationId,
        input.toolType || 'CHATGPT_CONNECTOR',
        input.toolKey,
        providerKey,
        input.modelKey || null,
        input.status,
        asJson(input.input || null),
        asJson(input.output || null),
        tokenInput,
        tokenOutput,
        costAmount,
        input.costCurrency || 'USD',
        durationMs,
        input.errorCode || null,
        errorCategory,
        input.errorMessage || null,
      ]
    );

    await connection.execute(
      `INSERT INTO usage_ledger (
        id, project_id, run_id, task_id, route_execution_id, tool_execution_id,
        correlation_id, provider_key, model_key, status,
        token_input, token_output, duration_ms, error_category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usageId,
        runRows[0].project_id,
        input.runId,
        input.taskId || null,
        input.routeExecutionId || null,
        id,
        correlationId,
        providerKey,
        input.modelKey || null,
        input.status,
        tokenInput,
        tokenOutput,
        durationMs,
        errorCategory,
      ]
    );

    await connection.execute(
      `UPDATE runs
       SET token_input = token_input + ?,
           token_output = token_output + ?,
           cost_amount = cost_amount + ?
       WHERE id = ?`,
      [tokenInput, tokenOutput, costAmount, input.runId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    id,
    usageLedgerId: usageId,
    correlationId,
    status: input.status,
    toolKey: input.toolKey
  };
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
  const correlationId = await resolveCorrelationId(db, input.runId, input.correlationId);
  await db.execute(
    `INSERT INTO gate_results (
      id, run_id, task_id, correlation_id, stage_key, gate_key, status,
      criteria_json, evidence_json, blocking_reason, decided_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId || null,
      correlationId,
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
  const correlationId = await resolveCorrelationId(db, input.runId, input.correlationId);
  await db.execute(
    `INSERT INTO qa_evidence (
      id, run_id, task_id, correlation_id, gate_result_id, qa_case_key, status,
      evidence_type, evidence_uri, evidence_json,
      issue_severity, issue_summary, verified_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runId,
      input.taskId || null,
      correlationId,
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
