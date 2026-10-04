import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const PRICE_STATUS = new Set(['ACTIVE','HISTORICAL','REVOKED']);
const BUDGET_ACTION = new Set(['HOLD','BLOCK']);
const asJson = value => value == null ? null : JSON.stringify(value);

const errorOf = (message, code, statusCode = 400, details) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const money = value => value == null ? null : Number(value);

const normalizePrice = row => ({
  id: row.id,
  providerKey: row.provider_key,
  modelKey: row.model_key,
  currency: row.currency,
  inputRatePerMillion: money(row.input_rate_per_million),
  outputRatePerMillion: money(row.output_rate_per_million),
  effectiveFrom: row.effective_from,
  sourceLabel: row.source_label,
  sourceUri: row.source_uri,
  status: row.status,
  metadata: row.metadata_json,
  createdAt: row.created_at,
});

export const createPricingVersion = async input => {
  if (
    !input?.providerKey ||
    !input?.modelKey ||
    input?.inputRatePerMillion == null ||
    input?.outputRatePerMillion == null ||
    !input?.effectiveFrom ||
    !input?.sourceLabel
  ) {
    throw errorOf(
      'providerKey, modelKey, inputRatePerMillion, outputRatePerMillion, effectiveFrom and sourceLabel are required',
      'INVALID_PRICING_VERSION'
    );
  }

  const inputRate = Number(input.inputRatePerMillion);
  const outputRate = Number(input.outputRatePerMillion);
  if (!Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) {
    throw errorOf('Pricing rates must be non-negative finite numbers', 'INVALID_PRICING_RATE');
  }

  const status = String(input.status || 'ACTIVE').toUpperCase();
  if (!PRICE_STATUS.has(status)) {
    throw errorOf('Unsupported pricing status', 'INVALID_PRICING_STATUS');
  }

  const currency = String(input.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw errorOf('currency must be a 3-letter code', 'INVALID_PRICING_CURRENCY');
  }

  const db = getRuntimePool();
  const [models] = await db.execute(
    'SELECT provider_key FROM model_registry WHERE provider_key = ? AND model_key = ?',
    [input.providerKey, input.modelKey]
  );
  if (!models.length) {
    throw errorOf('Provider/model must exist before pricing is published', 'PRICING_MODEL_NOT_FOUND', 404);
  }

  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO pricing_versions (
        id, provider_key, model_key, currency,
        input_rate_per_million, output_rate_per_million,
        effective_from, source_label, source_uri, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.providerKey,
        input.modelKey,
        currency,
        inputRate,
        outputRate,
        new Date(input.effectiveFrom),
        input.sourceLabel,
        input.sourceUri || null,
        status,
        asJson(input.metadata || null),
      ]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw errorOf(
        'A pricing version already exists for this provider/model/effectiveFrom',
        'PRICING_VERSION_IMMUTABLE',
        409
      );
    }
    throw error;
  }

  const [rows] = await db.execute('SELECT * FROM pricing_versions WHERE id = ?', [id]);
  return normalizePrice(rows[0]);
};

export const listPricingVersions = async input => {
  const db = getRuntimePool();
  const clauses = [];
  const values = [];
  if (input?.providerKey) { clauses.push('provider_key = ?'); values.push(input.providerKey); }
  if (input?.modelKey) { clauses.push('model_key = ?'); values.push(input.modelKey); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `SELECT * FROM pricing_versions ${where}
     ORDER BY provider_key, model_key, effective_from, id`,
    values
  );
  return rows.map(normalizePrice);
};

export const resolvePricingVersion = async (connection, {
  providerKey,
  modelKey,
  at = new Date(),
}) => {
  if (!providerKey || !modelKey) return null;
  const [rows] = await connection.execute(
    `SELECT *
     FROM pricing_versions
     WHERE provider_key = ?
       AND model_key = ?
       AND effective_from <= ?
       AND status <> 'REVOKED'
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [providerKey, modelKey, at]
  );
  return rows[0] ? normalizePrice(rows[0]) : null;
};

export const calculateEstimatedCost = ({
  tokenInput = 0,
  tokenOutput = 0,
  pricingVersion,
}) => {
  if (!pricingVersion) {
    return {
      costStatus:'UNKNOWN',
      pricingVersionId:null,
      estimatedCost:null,
      currency:null,
      reason:'PRICE_METADATA_NOT_FOUND',
    };
  }

  const inputCost = Number(tokenInput || 0) * pricingVersion.inputRatePerMillion / 1_000_000;
  const outputCost = Number(tokenOutput || 0) * pricingVersion.outputRatePerMillion / 1_000_000;
  const estimatedCost = Number((inputCost + outputCost).toFixed(10));

  return {
    costStatus:'CALCULATED',
    pricingVersionId:pricingVersion.id,
    estimatedCost,
    currency:pricingVersion.currency,
    reason:null,
  };
};

export const upsertProjectBudgetPolicy = async input => {
  if (!input?.projectId || !input?.policyKey) {
    throw errorOf('projectId and policyKey are required', 'INVALID_BUDGET_POLICY');
  }
  const action = String(input.actionOnExceed || 'HOLD').toUpperCase();
  if (!BUDGET_ACTION.has(action)) {
    throw errorOf('actionOnExceed must be HOLD or BLOCK', 'INVALID_BUDGET_ACTION');
  }
  const currency = String(input.currency || 'USD').toUpperCase();
  const runLimit = input.runLimitAmount == null ? null : Number(input.runLimitAmount);
  const projectLimit = input.projectLimitAmount == null ? null : Number(input.projectLimitAmount);
  if ((runLimit != null && (!Number.isFinite(runLimit) || runLimit < 0)) ||
      (projectLimit != null && (!Number.isFinite(projectLimit) || projectLimit < 0))) {
    throw errorOf('Budget limits must be non-negative numbers', 'INVALID_BUDGET_LIMIT');
  }

  const db = getRuntimePool();
  const id = input.id || randomUUID();
  await db.execute(
    `INSERT INTO project_budget_policies (
      id, project_id, policy_key, enabled, currency,
      run_limit_amount, project_limit_amount, action_on_exceed, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      currency = VALUES(currency),
      run_limit_amount = VALUES(run_limit_amount),
      project_limit_amount = VALUES(project_limit_amount),
      action_on_exceed = VALUES(action_on_exceed),
      metadata_json = VALUES(metadata_json)`,
    [
      id,
      input.projectId,
      input.policyKey,
      input.enabled === false ? 0 : 1,
      currency,
      runLimit,
      projectLimit,
      action,
      asJson(input.metadata || null),
    ]
  );
  const [rows] = await db.execute(
    'SELECT * FROM project_budget_policies WHERE project_id = ? AND policy_key = ?',
    [input.projectId, input.policyKey]
  );
  const row = rows[0];
  return {
    id:row.id,
    projectId:row.project_id,
    policyKey:row.policy_key,
    enabled:Boolean(row.enabled),
    currency:row.currency,
    runLimitAmount:money(row.run_limit_amount),
    projectLimitAmount:money(row.project_limit_amount),
    actionOnExceed:row.action_on_exceed,
    metadata:row.metadata_json,
  };
};

const costSummaryQuery = async (db, whereSql, values) => {
  const [[totals]] = await db.execute(
    `SELECT
       COUNT(*) AS usage_count,
       SUM(CASE WHEN cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
       COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) AS estimated_cost
     FROM usage_ledger
     ${whereSql}`,
    values
  );
  return {
    usageCount:Number(totals.usage_count || 0),
    unknownCount:Number(totals.unknown_count || 0),
    estimatedCost:Number(totals.estimated_cost || 0),
  };
};

export const getRunCostSummary = async runId => {
  const db = getRuntimePool();
  const [[run]] = await db.execute('SELECT id, project_id FROM runs WHERE id = ?', [runId]);
  if (!run) throw errorOf('Run not found', 'RUN_NOT_FOUND', 404);

  const totals = await costSummaryQuery(db, 'WHERE run_id = ?', [runId]);
  const [byTaskRows] = await db.execute(
    `SELECT u.task_id, t.stage_key,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN u.cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
            COALESCE(SUM(CASE WHEN u.cost_status='CALCULATED' THEN u.estimated_cost ELSE 0 END),0) AS estimated_cost
     FROM usage_ledger u
     LEFT JOIN tasks t ON t.id = u.task_id
     WHERE u.run_id = ?
     GROUP BY u.task_id, t.stage_key
     ORDER BY t.stage_key, u.task_id`,
    [runId]
  );
  const [byProviderRows] = await db.execute(
    `SELECT provider_key, model_key, cost_currency,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
            COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) AS estimated_cost
     FROM usage_ledger
     WHERE run_id = ?
     GROUP BY provider_key, model_key, cost_currency
     ORDER BY provider_key, model_key`,
    [runId]
  );

  return {
    runId,
    projectId:run.project_id,
    costStatus:totals.unknownCount > 0 ? 'UNKNOWN' : 'CALCULATED',
    ...totals,
    byTask:byTaskRows.map(row => ({
      taskId:row.task_id,
      stageKey:row.stage_key,
      usageCount:Number(row.usage_count || 0),
      unknownCount:Number(row.unknown_count || 0),
      estimatedCost:Number(row.estimated_cost || 0),
    })),
    byProviderModel:byProviderRows.map(row => ({
      providerKey:row.provider_key,
      modelKey:row.model_key,
      currency:row.cost_currency,
      usageCount:Number(row.usage_count || 0),
      unknownCount:Number(row.unknown_count || 0),
      estimatedCost:Number(row.estimated_cost || 0),
    })),
  };
};

export const getProjectCostSummary = async projectId => {
  const db = getRuntimePool();
  const [[project]] = await db.execute('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) throw errorOf('Project not found', 'PROJECT_NOT_FOUND', 404);

  const totals = await costSummaryQuery(db, 'WHERE project_id = ?', [projectId]);
  const [byRunRows] = await db.execute(
    `SELECT run_id,
            COUNT(*) AS usage_count,
            SUM(CASE WHEN cost_status='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
            COALESCE(SUM(CASE WHEN cost_status='CALCULATED' THEN estimated_cost ELSE 0 END),0) AS estimated_cost
     FROM usage_ledger
     WHERE project_id = ?
     GROUP BY run_id
     ORDER BY run_id`,
    [projectId]
  );
  return {
    projectId,
    costStatus:totals.unknownCount > 0 ? 'UNKNOWN' : 'CALCULATED',
    ...totals,
    byRun:byRunRows.map(row => ({
      runId:row.run_id,
      usageCount:Number(row.usage_count || 0),
      unknownCount:Number(row.unknown_count || 0),
      estimatedCost:Number(row.estimated_cost || 0),
    })),
  };
};

export const evaluateBudgetPolicy = async ({ projectId, runId }) => {
  const db = getRuntimePool();
  const [policies] = await db.execute(
    `SELECT * FROM project_budget_policies
     WHERE project_id = ? AND enabled = TRUE
     ORDER BY created_at, id`,
    [projectId]
  );
  if (!policies.length) {
    return { decision:'ALLOW', reason:'NO_BUDGET_POLICY', policies:[] };
  }

  const projectSummary = await getProjectCostSummary(projectId);
  const runSummary = runId ? await getRunCostSummary(runId) : null;
  if (projectSummary.unknownCount > 0 || (runSummary && runSummary.unknownCount > 0)) {
    return {
      decision:'HOLD',
      reason:'COST_UNKNOWN_MISSING_PRICING',
      projectSummary,
      runSummary,
      policies:policies.map(row => row.policy_key),
    };
  }

  for (const policy of policies) {
    const runLimit = money(policy.run_limit_amount);
    const projectLimit = money(policy.project_limit_amount);
    const runExceeded = runSummary && runLimit != null && runSummary.estimatedCost > runLimit;
    const projectExceeded = projectLimit != null && projectSummary.estimatedCost > projectLimit;
    if (runExceeded || projectExceeded) {
      return {
        decision:policy.action_on_exceed,
        reason:runExceeded ? 'RUN_BUDGET_EXCEEDED' : 'PROJECT_BUDGET_EXCEEDED',
        policyKey:policy.policy_key,
        projectSummary,
        runSummary,
      };
    }
  }

  return {
    decision:'ALLOW',
    reason:'WITHIN_BUDGET',
    projectSummary,
    runSummary,
    policies:policies.map(row => row.policy_key),
  };
};
