import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequirementStatement, validateAgentOutput, buildRequirementPrompt, requirementCompletionConstants } from '../src/requirement-completion-runtime.mjs';

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
