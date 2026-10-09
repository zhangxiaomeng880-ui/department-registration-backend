import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequirementStatement, validateAgentOutput, buildRequirementPrompt, requirementCompletionConstants, executeRequirementCompletion, createPrdHandoff } from '../src/requirement-completion-runtime.mjs';

test('one-line requirement validation is bounded and normalized', () => {
  assert.equal(validateRequirementStatement('  建立网站异常监控工作台  '), '建立网站异常监控工作台');
  assert.throws(() => validateRequirementStatement('短'), /REQUIREMENT_STATEMENT_LENGTH_INVALID/);
});

test('prompt includes four levels, twelve dimensions and monitoring specifics', () => {
  const payload = JSON.parse(buildRequirementPrompt({ statement: '建立网站异常监控工作台', applicationType: 'WEBSITE', project: { id: 'p1' }, priorSessions: [] }));
  assert.deepEqual(payload.mandatoryLevels, ['PAGE', 'MODULE', 'METRIC', 'FUNCTION']);
  assert.equal(payload.completenessDimensions.length, 12);
  assert.match(JSON.stringify(payload), /上报与聚合更新机制/);
  assert.match(JSON.stringify(payload), /禁止默认加入工单分派/);
});

test('agent result contract rejects duplicate ids and decorates pending decisions', () => {
  const dimensions = requirementCompletionConstants.DIMENSIONS;
  const base = {
    summary: '已补全', completionScore: 80, risks: [], assumptions: [],
    requirements: ['PAGE', 'MODULE', 'METRIC', 'FUNCTION'].map((level, index) => ({ id: 'r' + index, level, dimension: dimensions[index], page: null, module: null, metric: null, function: null, description: '说明', acceptanceCriteria: ['可验收'], source: 'INFERRED' })),
    decisions: [{ id: 'd1', level: 'FUNCTION', dimension: dimensions[9], question: '选择提醒渠道', reason: '影响触达', required: true, options: [{ id: 'o1', label: '站内', description: '站内提醒', recommended: true }, { id: 'o2', label: '邮件', description: '邮件提醒', recommended: false }] }]
  };
  const checked = validateAgentOutput(structuredClone(base));
  assert.equal(checked.decisions[0].status, 'PENDING');
  const invalid = structuredClone(base); invalid.decisions[0].id = 'r0';
  assert.throws(() => validateAgentOutput(invalid), /REQUIREMENT_AGENT_OUTPUT_CONTRACT_VIOLATION/);
});


test('completion model run and PRD continuation retain one Product Agent owner', async () => {
  const writes = [];
  const db = { execute: async (sql, values) => {
    if (sql.startsWith('SELECT id,tenant_id')) return [[{ id: 'p1', workspace_id: 'w1' }]];
    if (sql.startsWith('SELECT id,source_statement')) return [[]];
    writes.push({ sql, values }); return [{}];
  } };
  let request;
  const completed = await executeRequirementCompletion({ projectId: 'p1', statement: '建立网站异常监控工作台', actorKey: 'u1', db, invoke: async args => {
    request = args;
    return { provider: 'openai', model: 'test', output: { summary: '需求', assumptions: [], decisions: [], risks: [], completionScore: 100,
      requirements: ['PAGE','MODULE','METRIC','FUNCTION'].map((level, i) => ({ id: 'r'+i, level, dimension: requirementCompletionConstants.DIMENSIONS[i] })) } };
  } });
  assert.equal(request.metadata.owner_agent, 'PRODUCT_AGENT');
  assert.equal(request.metadata.execution_mode, 'INTEGRATED');
  assert.equal(completed.trace.ownerAgent, 'PRODUCT_AGENT');
  assert.equal(completed.status, 'READY_FOR_PRD');
  const persisted = writes.find(item => item.sql.startsWith('INSERT INTO requirement_completion_sessions')).values;
  const continuationDb = { execute: async sql => sql.startsWith('SELECT *') ? [[{
    id: completed.id, project_id: 'p1', status: 'READY_FOR_PRD', context_fingerprint: completed.contextFingerprint,
    result_json: persisted[17], decisions_json: persisted[18]
  }]] : [{}] };
  const prepared = await createPrdHandoff({ projectId: 'p1', sessionId: completed.id, actorKey: 'u1', db: continuationDb });
  assert.equal(prepared.prdHandoff.ownerAgent, completed.trace.ownerAgent);
  assert.equal(prepared.prdHandoff.executionMode, 'INTEGRATED');
  assert.equal(prepared.prdHandoff.continuationStep, 'PRD_PREPARATION');
});
