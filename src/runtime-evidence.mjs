import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { routeRuntimeTask } from './runtime-router.mjs';
import { selectProviderModel } from './policy-router-v2.mjs';
import {
  resolvePricingVersion,
  calculateEstimatedCost,
  normalizePricingServiceTier,
} from './cost-ledger.mjs';

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
  const providerPolicy = await selectProviderModel({
    policyMode: input.policyMode,
    taskType: input.taskType,
    requiredStructuredOutput: input.requiredStructuredOutput,
    allowedProviderKeys: input.allowedProviderKeys,
    preferredProviderKey: input.preferredProviderKey,
    preferredModelKey: input.preferredModelKey,
    fallbackProviderKeys: input.fallbackProviderKeys,
    modelKey: input.modelKey,
  });
  const finalPolicyResult =
    decision.policyResult === 'ALLOW' && providerPolicy.allowed ? 'ALLOW' : 'BLOCK';
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
      policy_mode, selected_provider_key, selected_model_key, selected_adapter_key,
      provider_health_status, fallback_chain_json,
      input_summary, decision_json, duration_ms, error_category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      finalPolicyResult,
      providerPolicy.policyMode,
      providerPolicy.selectedProviderKey || null,
      providerPolicy.selectedModelKey || null,
      providerPolicy.selectedAdapterKey || null,
      providerPolicy.providerHealthStatus || null,
      asJson(providerPolicy.fallbackChain || []),
      input.query || null,
      asJson({
        ...decision,
        policyResult: finalPolicyResult,
        executionMode: input.executionMode || 'HYBRID_EXTERNAL_AGENT',
        providerPolicy,
      }),
      durationMs,
      input.errorCategory || null,
    ]
  );

  return {
    id,
    durationMs,
    correlationId,
    ...decision,
    policyResult: finalPolicyResult,
    policyMode: providerPolicy.policyMode,
    providerPolicyCode: providerPolicy.code,
    selectedProviderKey: providerPolicy.selectedProviderKey || null,
    selectedModelKey: providerPolicy.selectedModelKey || null,
    selectedAdapterKey: providerPolicy.selectedAdapterKey || null,
    providerHealthStatus: providerPolicy.providerHealthStatus || null,
    fallbackChain: providerPolicy.fallbackChain || [],
    providerPolicyReason: providerPolicy.reason,
    policyRouterVersion: providerPolicy.routerVersion,
  };
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
  const cachedInputTokens = Number(input.cachedInputTokens || 0);
  const cacheWriteTokens = Number(input.cacheWriteTokens || 0);
  const tokenOutput = Number(input.tokenOutput || 0);
  const durationMs = input.durationMs == null ? null : Number(input.durationMs);
  const serviceTier = normalizePricingServiceTier(input.serviceTier);
  const regionalUpliftBps = Number(input.regionalUpliftBps || 0);
  let correlationId = input.correlationId || null;
  const providerKey = input.providerKey || null;
  const errorCategory = input.errorCategory || null;
  let calculatedCost = {
    costStatus:'UNKNOWN',pricingVersionId:null,estimatedCost:null,currency:null,
    serviceTier,contextBand:null,regionalUpliftBps,formulaVersion:null,
  };

  try {
    await connection.beginTransaction();
    const [runRows] = await connection.execute(
      'SELECT project_id, tenant_id, workspace_id, correlation_id, run_type, trigger_source FROM runs WHERE id = ? FOR UPDATE',
      [input.runId]
    );
    if (!runRows.length) {
      const error = new Error('Run not found');
      error.code = 'RUN_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    correlationId = correlationId || runRows[0].correlation_id || null;

    const pricingVersion = await resolvePricingVersion(connection,{
      providerKey,modelKey:input.modelKey || null,serviceTier,at:new Date(),
    });
    calculatedCost = calculateEstimatedCost({
      tokenInput,cachedInputTokens,cacheWriteTokens,tokenOutput,
      serviceTier,regionalUpliftBps,pricingVersion,
    });

    await connection.execute(
      `INSERT INTO tool_executions (
        id, run_id, task_id, route_execution_id, correlation_id,
        tool_type, tool_key, provider_key, model_key, pricing_version_id, cost_status,
        status, input_json, output_json,
        token_input, token_output, cost_amount, cost_currency,
        duration_ms, error_code, error_category, error_message, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        id,input.runId,input.taskId || null,input.routeExecutionId || null,correlationId,
        input.toolType || 'CHATGPT_CONNECTOR',input.toolKey,providerKey,input.modelKey || null,
        calculatedCost.pricingVersionId,calculatedCost.costStatus,input.status,
        asJson(input.input || null),asJson(input.output || null),tokenInput,tokenOutput,
        calculatedCost.estimatedCost,calculatedCost.currency,durationMs,input.errorCode || null,
        errorCategory,input.errorMessage || null,
      ]
    );

    await connection.execute(
      `UPDATE tool_executions
       SET cached_input_tokens=?, cache_write_tokens=?, service_tier=?, context_band=?,
           regional_uplift_bps=?, cost_formula_version=?
       WHERE id=?`,
      [cachedInputTokens,cacheWriteTokens,calculatedCost.serviceTier,calculatedCost.contextBand,
       calculatedCost.regionalUpliftBps,calculatedCost.formulaVersion,id]
    );

    await connection.execute(
      `INSERT INTO usage_ledger (
        id, tenant_id, workspace_id, project_id, run_id, task_id, route_execution_id, tool_execution_id,
        correlation_id, provider_key, model_key, pricing_version_id, cost_status,
        estimated_cost, cost_currency, billing_class, status,
        token_input, token_output, duration_ms, error_category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usageId,runRows[0].tenant_id,runRows[0].workspace_id,runRows[0].project_id,input.runId,input.taskId || null,input.routeExecutionId || null,
        id,correlationId,providerKey,input.modelKey || null,calculatedCost.pricingVersionId,
        calculatedCost.costStatus,calculatedCost.estimatedCost,calculatedCost.currency,
        (runRows[0].run_type==='EVAL_REPLAY'||runRows[0].run_type==='SHADOW_REPLAY'||runRows[0].trigger_source==='EVAL_RUNNER'||runRows[0].trigger_source==='SHADOW_EVAL')
          ? 'INTERNAL_EVAL' : 'CUSTOMER',
        input.status,tokenInput,tokenOutput,durationMs,errorCategory,
      ]
    );

    await connection.execute(
      `UPDATE usage_ledger
       SET cached_input_tokens=?, cache_write_tokens=?, service_tier=?, context_band=?,
           regional_uplift_bps=?, cost_formula_version=?
       WHERE id=?`,
      [cachedInputTokens,cacheWriteTokens,calculatedCost.serviceTier,calculatedCost.contextBand,
       calculatedCost.regionalUpliftBps,calculatedCost.formulaVersion,usageId]
    );

    await connection.execute(
      `UPDATE runs
       SET token_input = token_input + ?,
           token_output = token_output + ?,
           cost_amount = cost_amount + ?
       WHERE id = ?`,
      [tokenInput,tokenOutput,calculatedCost.costStatus === 'CALCULATED' ? calculatedCost.estimatedCost : 0,input.runId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    id,usageLedgerId:usageId,correlationId,status:input.status,toolKey:input.toolKey,
    costStatus:calculatedCost.costStatus,pricingVersionId:calculatedCost.pricingVersionId,
    estimatedCost:calculatedCost.estimatedCost,costCurrency:calculatedCost.currency,
    serviceTier:calculatedCost.serviceTier,contextBand:calculatedCost.contextBand,
    regionalUpliftBps:calculatedCost.regionalUpliftBps,costFormulaVersion:calculatedCost.formulaVersion,
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
