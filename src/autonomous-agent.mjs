import { createHash } from 'node:crypto';
import { invokeOpenAiResponses } from './openai-responses-provider.mjs';
import { recordToolExecution } from './runtime-evidence.mjs';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

export const CONTINUITY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string' },
    findingCount: { type: 'integer', minimum: 0 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          severity: { type: 'string' },
          scene: { type: 'string' },
          summary: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceFileId: { type: 'string' },
                sourceVersion: { type: ['string','null'] },
                lineStart: { type: ['integer','null'] },
                lineEnd: { type: ['integer','null'] },
              },
              required: ['sourceFileId','sourceVersion','lineStart','lineEnd'],
              additionalProperties: false,
            },
          },
        },
        required: ['code','severity','scene','summary','evidence'],
        additionalProperties: false,
      },
    },
    noOtherHardConflicts: { type: 'boolean' },
  },
  required: ['scope','findingCount','findings','noOtherHardConflicts'],
  additionalProperties: false,
};

const assertContextPacket = packet => {
  if (!Array.isArray(packet?.items) || !packet.items.length) {
    const error = new Error('contextPacket.items[] is required');
    error.code = 'CONTEXT_PACKET_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  for (const item of packet.items) {
    if (!item.sourceFileId || !item.sourceText) {
      const error = new Error('Each context item requires sourceFileId and transient sourceText');
      error.code = 'INVALID_CONTEXT_PACKET';
      error.statusCode = 400;
      throw error;
    }
  }
};

export const executeScriptContinuityAgent = async input => {
  if (!input?.runId || !input?.taskId || !input?.routeExecutionId || !input?.query) {
    const error = new Error('runId, taskId, routeExecutionId and query are required');
    error.code = 'INVALID_AGENT_EXECUTION';
    error.statusCode = 400;
    throw error;
  }
  assertContextPacket(input.contextPacket);

  const contextMaterial = input.contextPacket.items.map((item, index) => ({
    rank: index + 1,
    sourceFileId: item.sourceFileId,
    sourceLibraryFileId: item.sourceLibraryFileId || null,
    sourceVersion: item.sourceVersion || null,
    sourcePath: item.sourcePath || null,
    lineStart: item.lineStart ?? null,
    lineEnd: item.lineEnd ?? null,
    sourceText: item.sourceText,
  }));
  const contextHash = sha256(JSON.stringify(contextMaterial));

  const instructions = [
    'You are the AI Native Script Agent.',
    'Perform continuity analysis only from the supplied CURRENT context.',
    'Do not invent missing facts.',
    'Do not rewrite or modify already-PASS screenplay content.',
    'Return only real continuity issues supported by supplied evidence.',
    'If there are no additional hard conflicts, say so through noOtherHardConflicts.',
  ].join('\n');

  const providerResult = await invokeOpenAiResponses({
    instructions,
    input: JSON.stringify({
      task: input.query,
      scope: input.scope || null,
      precedence: input.contextPacket.precedence || [],
      context: contextMaterial,
    }),
    schema: CONTINUITY_ANALYSIS_SCHEMA,
    schemaName: 'script_continuity_analysis',
    metadata: {
      run_id: input.runId,
      task_id: input.taskId,
      route_rule: input.routeRuleKey || 'P86',
    },
  });

  const toolEvidence = await recordToolExecution({
    runId: input.runId,
    taskId: input.taskId,
    routeExecutionId: input.routeExecutionId,
    toolType: 'MODEL_PROVIDER',
    toolKey: 'openai.responses',
    modelKey: providerResult.model,
    status: providerResult.status === 'completed' ? 'PASS' : 'HOLD',
    input: {
      queryHash: sha256(input.query),
      contextHash,
      contextItemCount: contextMaterial.length,
      sourceBodyPersisted: false,
    },
    output: {
      providerResponseId: providerResult.providerResponseId,
      findingCount: providerResult.output.findingCount,
      output: providerResult.output,
    },
    tokenInput: providerResult.usage?.input_tokens || 0,
    tokenOutput: providerResult.usage?.output_tokens || 0,
  });

  return {
    executionMode: 'AUTONOMOUS_MODEL_PROVIDER',
    provider: providerResult.provider,
    providerResponseId: providerResult.providerResponseId,
    model: providerResult.model,
    contextHash,
    sourceBodyPersisted: false,
    toolExecutionId: toolEvidence.id,
    output: providerResult.output,
    usage: providerResult.usage,
  };
};
