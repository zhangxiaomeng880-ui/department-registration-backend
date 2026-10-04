import { getRuntimePool } from './runtime-db.mjs';

const n = value => value == null ? null : Number(value);
const bool = value => Boolean(Number(value));

const notFound = runId => {
  const error = new Error('Run not found');
  error.code = 'RUN_NOT_FOUND';
  error.statusCode = 404;
  error.details = { runId };
  return error;
};

const normalizeRun = row => ({
  id: row.id,
  projectId: row.project_id,
  correlationId: row.correlation_id || null,
  runType: row.run_type,
  status: row.status,
  triggerSource: row.trigger_source,
  workflowVersion: row.workflow_version,
  routerVersion: row.router_version,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  lastCheckpointAt: row.last_checkpoint_at,
  tokenInput: n(row.token_input) || 0,
  tokenOutput: n(row.token_output) || 0,
  costAmount: Number(row.cost_amount || 0),
  costCurrency: row.cost_currency,
  errorCode: row.error_code,
  errorCategory: row.error_category || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getRunObservability = async runId => {
  if (!runId) throw notFound(runId);

  const db = getRuntimePool();
  const [runRows] = await db.execute(
    `SELECT id, project_id, correlation_id, run_type, status, trigger_source,
            workflow_version, router_version, started_at, finished_at,
            last_checkpoint_at, token_input, token_output, cost_amount,
            cost_currency, error_code, error_category, created_at, updated_at
     FROM runs
     WHERE id = ?
     LIMIT 1`,
    [runId]
  );
  if (!runRows.length) throw notFound(runId);

  const [
    [taskRows],
    [routeRows],
    [toolRows],
    [usageRows],
    [gateRows],
    [qaRows],
    [checkpointRows],
  ] = await Promise.all([
    db.execute(
      `SELECT id, parent_task_id, correlation_id, stage_key, task_key, task_type,
              status, sequence_no, retry_count, max_retries, started_at, finished_at,
              error_code, error_category, created_at, updated_at
       FROM tasks WHERE run_id = ? ORDER BY sequence_no, created_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, correlation_id, route_rule_key, route_priority, matched,
              agent_key, skill_key, tool_key, policy_result, duration_ms,
              error_category, created_at
       FROM route_executions WHERE run_id = ? ORDER BY created_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, route_execution_id, correlation_id, tool_type, tool_key,
              provider_key, model_key, status, token_input, token_output,
              cost_amount, cost_currency, duration_ms, error_code, error_category,
              started_at, finished_at, created_at
       FROM tool_executions WHERE run_id = ? ORDER BY created_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, route_execution_id, tool_execution_id, correlation_id,
              provider_key, model_key, status, token_input, token_output,
              duration_ms, error_category, recorded_at
       FROM usage_ledger WHERE run_id = ? ORDER BY recorded_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, correlation_id, stage_key, gate_key, status,
              decided_by, decided_at, created_at
       FROM gate_results WHERE run_id = ? ORDER BY created_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, correlation_id, gate_result_id, qa_case_key, status,
              evidence_type, issue_severity, verified_by, verified_at, created_at
       FROM qa_evidence WHERE run_id = ? ORDER BY created_at, id`,
      [runId]
    ),
    db.execute(
      `SELECT id, task_id, correlation_id, sequence_no, checkpoint_type, status,
              stage_key, step_key, resume_from_task_key, created_by, created_at
       FROM checkpoints WHERE run_id = ? ORDER BY sequence_no, created_at, id`,
      [runId]
    ),
  ]);

  const run = normalizeRun(runRows[0]);
  const tasks = taskRows.map(row => ({
    id: row.id,
    parentTaskId: row.parent_task_id,
    correlationId: row.correlation_id || null,
    stageKey: row.stage_key,
    taskKey: row.task_key,
    taskType: row.task_type,
    status: row.status,
    sequenceNo: n(row.sequence_no),
    retryCount: n(row.retry_count) || 0,
    maxRetries: n(row.max_retries) || 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorCategory: row.error_category || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const routes = routeRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    correlationId: row.correlation_id || null,
    routeRuleKey: row.route_rule_key,
    routePriority: n(row.route_priority),
    matched: bool(row.matched),
    agentKey: row.agent_key,
    skillKey: row.skill_key,
    toolKey: row.tool_key,
    policyResult: row.policy_result,
    durationMs: n(row.duration_ms),
    errorCategory: row.error_category || null,
    createdAt: row.created_at,
  }));
  const tools = toolRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    routeExecutionId: row.route_execution_id,
    correlationId: row.correlation_id || null,
    toolType: row.tool_type,
    toolKey: row.tool_key,
    providerKey: row.provider_key || null,
    modelKey: row.model_key || null,
    status: row.status,
    tokenInput: n(row.token_input) || 0,
    tokenOutput: n(row.token_output) || 0,
    costAmount: Number(row.cost_amount || 0),
    costCurrency: row.cost_currency,
    durationMs: n(row.duration_ms),
    errorCode: row.error_code,
    errorCategory: row.error_category || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }));
  const usage = usageRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    routeExecutionId: row.route_execution_id,
    toolExecutionId: row.tool_execution_id,
    correlationId: row.correlation_id || null,
    providerKey: row.provider_key || null,
    modelKey: row.model_key || null,
    status: row.status,
    tokenInput: n(row.token_input) || 0,
    tokenOutput: n(row.token_output) || 0,
    durationMs: n(row.duration_ms),
    errorCategory: row.error_category || null,
    recordedAt: row.recorded_at,
  }));
  const gates = gateRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    correlationId: row.correlation_id || null,
    stageKey: row.stage_key,
    gateKey: row.gate_key,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  }));
  const qa = qaRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    correlationId: row.correlation_id || null,
    gateResultId: row.gate_result_id,
    qaCaseKey: row.qa_case_key,
    status: row.status,
    evidenceType: row.evidence_type,
    issueSeverity: row.issue_severity,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  }));
  const checkpoints = checkpointRows.map(row => ({
    id: row.id,
    taskId: row.task_id,
    correlationId: row.correlation_id || null,
    sequenceNo: n(row.sequence_no),
    checkpointType: row.checkpoint_type,
    status: row.status,
    stageKey: row.stage_key,
    stepKey: row.step_key,
    resumeFromTaskKey: row.resume_from_task_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));

  const allCorrelations = [
    ...tasks.map(x => x.correlationId),
    ...routes.map(x => x.correlationId),
    ...tools.map(x => x.correlationId),
    ...usage.map(x => x.correlationId),
    ...gates.map(x => x.correlationId),
    ...qa.map(x => x.correlationId),
    ...checkpoints.map(x => x.correlationId),
  ].filter(Boolean);

  const providers = [...new Map(
    tools
      .filter(x => x.providerKey || x.modelKey)
      .map(x => [`${x.providerKey || ''}:${x.modelKey || ''}`, {
        providerKey:x.providerKey,
        modelKey:x.modelKey,
      }])
  ).values()];

  const timeline = [
    ...tasks.map(x => ({type:'TASK', id:x.id, status:x.status, at:x.createdAt})),
    ...routes.map(x => ({type:'ROUTE', id:x.id, status:x.policyResult || (x.matched ? 'MATCHED' : 'NO_MATCH'), at:x.createdAt})),
    ...tools.map(x => ({type:'TOOL', id:x.id, status:x.status, at:x.createdAt})),
    ...gates.map(x => ({type:'GATE', id:x.id, status:x.status, at:x.createdAt})),
    ...qa.map(x => ({type:'QA', id:x.id, status:x.status, at:x.createdAt})),
    ...checkpoints.map(x => ({type:'CHECKPOINT', id:x.id, status:x.status, at:x.createdAt})),
  ].sort((a,b) => new Date(a.at) - new Date(b.at));

  return {
    run,
    summary:{
      taskCount:tasks.length,
      routeCount:routes.length,
      toolExecutionCount:tools.length,
      usageLedgerCount:usage.length,
      gateCount:gates.length,
      qaEvidenceCount:qa.length,
      checkpointCount:checkpoints.length,
      tokenInput:usage.reduce((sum,x) => sum + x.tokenInput,0),
      tokenOutput:usage.reduce((sum,x) => sum + x.tokenOutput,0),
      toolDurationMs:tools.reduce((sum,x) => sum + (x.durationMs || 0),0),
      correlationConsistent:Boolean(run.correlationId) &&
        allCorrelations.length > 0 &&
        allCorrelations.every(value => value === run.correlationId),
      sourceBodyExposed:false,
    },
    providers,
    tasks,
    routes,
    tools,
    usage,
    gates,
    qaEvidence:qa,
    checkpoints,
    timeline,
  };
};
