import { randomUUID, createHash } from 'node:crypto';
import { invokeOpenAiResponses } from './openai-responses-provider.mjs';
import { getRuntimePool } from './runtime-db.mjs';
import { assertAccess, resolveProjectScope } from './runtime-rbac.mjs';

const LEVELS = ['PAGE', 'MODULE', 'METRIC', 'FUNCTION'];
const DIMENSIONS = [
  '目标与成功标准', '用户与角色', '场景与业务流程', '页面结构', '模块职责', '指标口径',
  '功能交互', '数据来源与更新机制', '异常类型与分析', '提醒机制', '权限与审计', '验收与非功能约束'
];
const CLASSES = ['AUTO_COMPLETE', 'DEFAULT_CANDIDATE', 'USER_DECISION_REQUIRED', 'BLOCKED', 'NOT_APPLICABLE'];
const fail = (code, statusCode = 400, details) => Object.assign(new Error(code), { code, statusCode, ...(details ? { details } : {}) });
const parseJson = value => {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cleanId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);

export const requirementCompletionSchema = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'assumptions', 'requirements', 'decisions', 'risks', 'completionScore'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    assumptions: {
      type: 'array', maxItems: 80, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'level', 'dimension', 'title', 'description', 'classification'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, level: { type: 'string', enum: LEVELS },
          dimension: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
          classification: { type: 'string', enum: ['AUTO_COMPLETE', 'DEFAULT_CANDIDATE'] }
        }
      }
    },
    requirements: {
      type: 'array', minItems: 4, maxItems: 160, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'level', 'page', 'module', 'metric', 'function', 'dimension', 'description', 'acceptanceCriteria', 'source'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, level: { type: 'string', enum: LEVELS },
          page: { type: ['string', 'null'] }, module: { type: ['string', 'null'] }, metric: { type: ['string', 'null'] },
          function: { type: ['string', 'null'] }, dimension: { type: 'string' }, description: { type: 'string' },
          acceptanceCriteria: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
          source: { type: 'string', enum: ['USER', 'PROJECT_CONTEXT', 'INFERRED'] }
        }
      }
    },
    decisions: {
      type: 'array', maxItems: 30, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'level', 'dimension', 'question', 'reason', 'options', 'required'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, level: { type: 'string', enum: LEVELS },
          dimension: { type: 'string' }, question: { type: 'string' }, reason: { type: 'string' }, required: { type: 'boolean' },
          options: { type: 'array', minItems: 2, maxItems: 6, items: {
            type: 'object', additionalProperties: false, required: ['id', 'label', 'description', 'recommended'],
            properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, label: { type: 'string' }, description: { type: 'string' }, recommended: { type: 'boolean' } }
          } }
        }
      }
    },
    risks: { type: 'array', maxItems: 30, items: { type: 'string' } },
    completionScore: { type: 'integer', minimum: 0, maximum: 100 }
  }
};

export const validateRequirementStatement = statement => {
  if (typeof statement !== 'string') throw fail('REQUIREMENT_STATEMENT_REQUIRED');
  const value = statement.trim();
  if (value.length < 4 || value.length > 4000) throw fail('REQUIREMENT_STATEMENT_LENGTH_INVALID');
  return value;
};

export const validateAgentOutput = output => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw fail('REQUIREMENT_AGENT_OUTPUT_INVALID', 502);
  if (!Array.isArray(output.requirements) || output.requirements.length < 4 || !Array.isArray(output.decisions) || !Array.isArray(output.assumptions)) throw fail('REQUIREMENT_AGENT_OUTPUT_INVALID', 502);
  const ids = new Set();
  for (const item of [...output.requirements, ...output.decisions, ...output.assumptions]) {
    if (!cleanId(item?.id) || ids.has(item.id) || !LEVELS.includes(item.level) || !DIMENSIONS.includes(item.dimension)) throw fail('REQUIREMENT_AGENT_OUTPUT_CONTRACT_VIOLATION', 502);
    ids.add(item.id);
  }
  for (const item of output.decisions) {
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.some(option => !cleanId(option?.id))) throw fail('REQUIREMENT_AGENT_DECISION_INVALID', 502);
  }
  output.decisions = output.decisions.map(item => ({ ...item, status: 'PENDING', answer: null }));
  return output;
};

export const buildRequirementPrompt = ({ statement, applicationType, project, priorSessions }) => JSON.stringify({
  ownerAgent: 'PRODUCT_AGENT',
  executionMode: 'INTEGRATED',
  task: '由需求 Agent 在同一需求任务内分析并主动补齐一句话需求，形成可继续整理 PRD 的结构化结果。不要重复询问项目上下文中已有答案。',
  userStatement: statement,
  applicationType: applicationType || 'UNSPECIFIED',
  project,
  priorRequirementSessions: priorSessions,
  mandatoryLevels: LEVELS,
  completenessDimensions: DIMENSIONS,
  classificationRules: {
    AUTO_COMPLETE: '可由现有上下文直接确定，并说明依据',
    DEFAULT_CANDIDATE: '可给推荐默认值，但允许用户覆盖',
    USER_DECISION_REQUIRED: '会显著改变范围、成本、合规或验收，必须集中向用户决策',
    BLOCKED: '缺少外部授权或证据，明确阻塞',
    NOT_APPLICABLE: '说明为什么不适用'
  },
  domainChecklist: [
    '网站/APP/小程序分别说明接入方式、访问与异常与性能采集边界',
    '说明数据来源、上报与聚合更新机制、延迟和失败重试',
    '列出异常类型、访问来源、流量分布、提醒渠道、阈值、频控、升级与恢复通知',
    '前台与运营后台分别定义页面、模块、指标、搜索/下拉/筛选等功能点',
    '禁止默认加入工单分派等治理闭环；若用户未要求，只能列为可选决策'
  ]
});

const loadContext = async (db, projectId) => {
  const [projects] = await db.execute(
    'SELECT id,tenant_id,workspace_id,project_key,name,project_type,project_subtype_key,status,current_stage_key,current_workflow_version FROM projects WHERE id=? LIMIT 1',
    [projectId]
  );
  if (!projects.length) throw fail('PROJECT_NOT_FOUND', 404);
  const [previous] = await db.execute(
    'SELECT id,source_statement,status,result_json,decisions_json,created_at FROM requirement_completion_sessions WHERE project_id=? AND status<>? ORDER BY created_at DESC LIMIT 5',
    [projectId, 'FAILED']
  );
  return {
    project: projects[0],
    priorSessions: previous.map(row => ({ id: row.id, statement: row.source_statement, status: row.status, result: parseJson(row.result_json), decisions: parseJson(row.decisions_json), createdAt: row.created_at }))
  };
};

const writeAudit = (db, { projectId, actorKey, eventType, objectId, event }) => db.execute(
  'INSERT INTO audit_logs (project_id,event_type,actor_type,actor_key,object_type,object_id,event_json) VALUES (?,?,?,?,?,?,?)',
  [projectId, eventType, 'SCOPED', actorKey, 'REQUIREMENT_COMPLETION_SESSION', objectId, JSON.stringify(event)]
);

export const executeRequirementCompletion = async ({ projectId, statement, applicationType = 'UNSPECIFIED', actorKey, db = getRuntimePool(), invoke = invokeOpenAiResponses }) => {
  const source = validateRequirementStatement(statement);
  if (!['WEBSITE', 'APP', 'MINI_PROGRAM', 'MULTI_CHANNEL', 'UNSPECIFIED'].includes(applicationType)) throw fail('APPLICATION_TYPE_INVALID');
  const id = randomUUID(), runId = randomUUID(), taskId = randomUUID(), stepId = randomUUID();
  const context = await loadContext(db, projectId);
  const contextFingerprint = hash(context);
  let provider;
  try {
    provider = await invoke({
      schema: requirementCompletionSchema,
      schemaName: 'requirement_completion_result',
      instructions: '你是 Product Agent（需求 Agent），当前执行内置需求分析与主动补齐步骤，不存在独立的需求补齐 Agent。输出必须完整覆盖四级拆解和十二维度；先主动补全，只把真正需要产品负责人决定的事项集中为 decisions。使用简体中文。',
      input: buildRequirementPrompt({ statement: source, applicationType, ...context }),
      metadata: { owner_agent: 'PRODUCT_AGENT', execution_mode: 'INTEGRATED', capability: 'CAP-REQ-COMPLETION-V1', project_id: projectId, run_id: runId }
    });
  } catch (error) {
    await db.execute(
      'INSERT INTO requirement_completion_sessions (id,project_id,workspace_id,actor_key,source_statement,application_type,status,context_fingerprint,run_id,task_id,step_id,error_code,result_json,decisions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, projectId, context.project.workspace_id, actorKey, source, applicationType, 'FAILED', contextFingerprint, runId, taskId, stepId, error.code || 'MODEL_PROVIDER_FAILED', null, JSON.stringify([])]
    );
    await writeAudit(db, { projectId, actorKey, eventType: 'REQUIREMENT_COMPLETION_FAILED', objectId: id, event: { runId, taskId, stepId, errorCode: error.code || 'MODEL_PROVIDER_FAILED' } });
    throw error;
  }
  const result = validateAgentOutput(provider.output);
  const decisions = result.decisions;
  const status = decisions.some(item => item.required) ? 'REVIEW_REQUIRED' : 'READY_FOR_PRD';
  const usage = provider.usage || {};
  await db.execute(
    'INSERT INTO requirement_completion_sessions (id,project_id,workspace_id,actor_key,source_statement,application_type,status,context_fingerprint,run_id,task_id,step_id,model_provider,model_key,provider_response_id,input_tokens,output_tokens,total_tokens,result_json,decisions_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, projectId, context.project.workspace_id, actorKey, source, applicationType, status, contextFingerprint, runId, taskId, stepId, provider.provider, provider.model, provider.providerResponseId, usage.input_tokens ?? null, usage.output_tokens ?? null, usage.total_tokens ?? null, JSON.stringify(result), JSON.stringify(decisions)]
  );
  await writeAudit(db, { projectId, actorKey, eventType: 'REQUIREMENT_COMPLETION_EXECUTED', objectId: id, event: { ownerAgent: 'PRODUCT_AGENT', executionMode: 'INTEGRATED', capabilityId: 'CAP-REQ-COMPLETION-V1', runId, taskId, stepId, status, contextFingerprint, model: provider.model, usage } });
  return { id, projectId, status, sourceStatement: source, applicationType, contextFingerprint, trace: { ownerAgent: 'PRODUCT_AGENT', executionMode: 'INTEGRATED', capabilityId: 'CAP-REQ-COMPLETION-V1', phase: 'PRODUCT', taskId, stepId, runId }, provider: { name: provider.provider, model: provider.model, responseId: provider.providerResponseId, usage, estimatedCost: null, costStatus: 'PRICING_RESOLUTION_PENDING' }, result, decisions };
};

const rowView = row => ({
  id: row.id, projectId: row.project_id, status: row.status, sourceStatement: row.source_statement,
  applicationType: row.application_type, contextFingerprint: row.context_fingerprint,
  trace: { ownerAgent: 'PRODUCT_AGENT', executionMode: 'INTEGRATED', capabilityId: 'CAP-REQ-COMPLETION-V1', phase: 'PRODUCT', runId: row.run_id, taskId: row.task_id, stepId: row.step_id },
  provider: { name: row.model_provider, model: row.model_key, responseId: row.provider_response_id, usage: { input_tokens: row.input_tokens, output_tokens: row.output_tokens, total_tokens: row.total_tokens } },
  result: parseJson(row.result_json), decisions: parseJson(row.decisions_json) || [], prdHandoff: parseJson(row.prd_handoff_json),
  errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at
});

export const getRequirementCompletion = async ({ projectId, sessionId, db = getRuntimePool() }) => {
  const [rows] = await db.execute('SELECT * FROM requirement_completion_sessions WHERE id=? AND project_id=? LIMIT 1', [sessionId, projectId]);
  if (!rows.length) throw fail('REQUIREMENT_COMPLETION_NOT_FOUND', 404);
  return rowView(rows[0]);
};

export const listRequirementCompletions = async ({ projectId, limit = 20, db = getRuntimePool() }) => {
  const size = Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 50) throw fail('INVALID_PAGE_LIMIT');
  const [rows] = await db.query('SELECT * FROM requirement_completion_sessions WHERE project_id=? ORDER BY created_at DESC LIMIT ?', [projectId, size]);
  return { projectId, items: rows.map(rowView) };
};

export const answerRequirementDecisions = async ({ projectId, sessionId, answers, actorKey, db = getRuntimePool() }) => {
  if (!Array.isArray(answers) || !answers.length || answers.length > 30) throw fail('DECISION_ANSWERS_REQUIRED');
  const current = await getRequirementCompletion({ projectId, sessionId, db });
  if (!['REVIEW_REQUIRED', 'READY_FOR_PRD'].includes(current.status)) throw fail('REQUIREMENT_SESSION_NOT_DECIDABLE', 409);
  const byId = new Map(current.decisions.map(item => [item.id, item]));
  for (const answer of answers) {
    const decision = byId.get(answer?.decisionId);
    if (!decision) throw fail('DECISION_NOT_FOUND', 404);
    const option = decision.options.find(item => item.id === answer.optionId);
    if (!option) throw fail('DECISION_OPTION_INVALID');
    decision.status = 'RESOLVED';
    decision.answer = { optionId: option.id, label: option.label, answeredBy: actorKey, answeredAt: new Date().toISOString() };
  }
  const pendingRequired = current.decisions.some(item => item.required && item.status !== 'RESOLVED');
  const status = pendingRequired ? 'REVIEW_REQUIRED' : 'READY_FOR_PRD';
  if (current.result) current.result.decisions = current.decisions;
  await db.execute('UPDATE requirement_completion_sessions SET status=?,result_json=?,decisions_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND project_id=?', [status, JSON.stringify(current.result), JSON.stringify(current.decisions), sessionId, projectId]);
  await writeAudit(db, { projectId, actorKey, eventType: 'REQUIREMENT_DECISION_RECORDED', objectId: sessionId, event: { answerCount: answers.length, status } });
  return { ...current, status, decisions: current.decisions, result: current.result };
};

export const createPrdHandoff = async ({ projectId, sessionId, actorKey, db = getRuntimePool() }) => {
  const current = await getRequirementCompletion({ projectId, sessionId, db });
  if (current.status !== 'READY_FOR_PRD') throw fail('REQUIREMENT_DECISIONS_PENDING', 409);
  const handoff = { handoffId: randomUUID(), ownerAgent: 'PRODUCT_AGENT', executionMode: 'INTEGRATED', continuationStep: 'PRD_PREPARATION', targetAgent: 'PRODUCT_AGENT', targetPhase: 'PRODUCT', sourceSessionId: sessionId, contextFingerprint: current.contextFingerprint, createdBy: actorKey, createdAt: new Date().toISOString(), status: 'READY' };
  await db.execute('UPDATE requirement_completion_sessions SET status=?,prd_handoff_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND project_id=?', ['HANDOFF_READY', JSON.stringify(handoff), sessionId, projectId]);
  await writeAudit(db, { projectId, actorKey, eventType: 'REQUIREMENT_PRD_HANDOFF_READY', objectId: sessionId, event: handoff });
  return { ...current, status: 'HANDOFF_READY', prdHandoff: handoff };
};

export const handleRequirementCompletionRoute = async (req, res, url, { json, readBody, principal, db = getRuntimePool() } = {}) => {
  const match = url.pathname.match(/^\/api\/runtime\/projects\/([A-Za-z0-9-]{1,64})\/requirement-completions(?:\/([A-Za-z0-9-]{1,80}))?(?:\/(decisions|handoff))?$/);
  if (!match) return false;
  const [, projectId, sessionId, action] = match;
  const scope = await resolveProjectScope(projectId);
  const write = req.method !== 'GET';
  if (!principal?.platformAdmin) await assertAccess({ principal, permission: write ? 'project:write' : 'project:read', ...scope, method: req.method, path: url.pathname });
  const actorKey = principal?.identityId || principal?.credentialId || 'PLATFORM_ADMIN';
  if (req.method === 'POST' && !sessionId) {
    const body = await readBody(req);
    json(res, 201, { data: await executeRequirementCompletion({ projectId, statement: body.statement, applicationType: body.applicationType, actorKey, db }) }); return true;
  }
  if (req.method === 'GET' && !sessionId) { json(res, 200, { data: await listRequirementCompletions({ projectId, limit: url.searchParams.get('limit') || 20, db }) }); return true; }
  if (req.method === 'GET' && sessionId && !action) { json(res, 200, { data: await getRequirementCompletion({ projectId, sessionId, db }) }); return true; }
  if (req.method === 'POST' && sessionId && action === 'decisions') {
    const body = await readBody(req); json(res, 200, { data: await answerRequirementDecisions({ projectId, sessionId, answers: body.answers, actorKey, db }) }); return true;
  }
  if (req.method === 'POST' && sessionId && action === 'handoff') { json(res, 200, { data: await createPrdHandoff({ projectId, sessionId, actorKey, db }) }); return true; }
  throw fail('REQUIREMENT_COMPLETION_METHOD_NOT_ALLOWED', 405);
};

export const requirementCompletionConstants = { LEVELS, DIMENSIONS, CLASSES };
