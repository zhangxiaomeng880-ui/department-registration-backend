import { createHash } from 'node:crypto';
import { invokeOpenAiResponses, classifyProviderError } from './openai-responses-provider.mjs';
import { recordToolExecution } from './runtime-evidence.mjs';
import { authorizeCommercialExecution, commitUsageReservation, releaseUsageReservation } from './commercial-control.mjs';

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

  const evidenceInput = {
    queryHash: sha256(input.query),
    contextHash,
    contextItemCount: contextMaterial.length,
    sourceBodyPersisted: false,
  };

  const selectedProviderKey = input.selectedProviderKey || 'openai-responses';
  const selectedAdapterKey = input.selectedAdapterKey || 'openai-responses';
  const selectedModelKey = input.selectedModelKey || null;

  if (selectedAdapterKey !== 'openai-responses') {
    const error = new Error(`Provider adapter is not implemented: ${selectedAdapterKey}`);
    error.code = 'PROVIDER_ADAPTER_NOT_IMPLEMENTED';
    error.statusCode = 503;
    error.errorCategory = 'CONFIGURATION';
    await recordToolExecution({
      runId: input.runId,
      taskId: input.taskId,
      routeExecutionId: input.routeExecutionId,
      correlationId: input.correlationId || null,
      toolType: 'MODEL_PROVIDER',
      toolKey: selectedAdapterKey,
      providerKey: selectedProviderKey,
      modelKey: selectedModelKey,
      status: 'FAIL',
      input: evidenceInput,
      output: null,
      tokenInput: 0,
      tokenOutput: 0,
      errorCode: error.code,
      errorCategory: error.errorCategory,
      errorMessage: error.message,
    });
    throw error;
  }

  const shadowMode=input.executionMode==='SHADOW_EVAL';
  const commercialAuthorization=shadowMode
    ? {reservationId:null,planKey:null,decision:'ALLOW',shadowBypass:true}
    : await authorizeCommercialExecution({
        runId:input.runId,
        entitlementKey:'MODEL_EXECUTION',
        operationKey:'MODEL_EXECUTION',
        reservationMetric:'TOOL_EXECUTION_COUNT',
        reservationAmount:1,
        reservationTtlSeconds:300,
        source:'AUTONOMOUS_AGENT',
      });

  let providerResult;
  try {
    providerResult = await invokeOpenAiResponses({
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
        correlation_id: input.correlationId || '',
      },
      modelKey: selectedModelKey || undefined,
    });
  } catch (error) {
    let failureEvidence=null;
    try{
      failureEvidence=await recordToolExecution({
        runId: input.runId,
        taskId: input.taskId,
        routeExecutionId: input.routeExecutionId,
        correlationId: input.correlationId || null,
        toolType: 'MODEL_PROVIDER',
        toolKey: 'openai.responses',
        providerKey: selectedProviderKey,
        modelKey: selectedModelKey || process.env.OPENAI_MODEL || null,
        status: 'FAIL',
        input: evidenceInput,
        output: null,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: error.durationMs ?? null,
        errorCode: error.code || 'MODEL_PROVIDER_ERROR',
        errorCategory: error.errorCategory || classifyProviderError(error),
        errorMessage: error.message,
      });
    } finally {
      if(!shadowMode){
        if(failureEvidence?.id){
          await commitUsageReservation(commercialAuthorization.reservationId,{
            actualAmount:1,toolExecutionId:failureEvidence.id
          });
        }else{
          await releaseUsageReservation(commercialAuthorization.reservationId,{reasonCode:'PROVIDER_FAILURE_UNRECORDED'});
        }
      }
    }
    throw error;
  }

  const toolEvidence = await recordToolExecution({
    runId: input.runId,
    taskId: input.taskId,
    routeExecutionId: input.routeExecutionId,
    correlationId: input.correlationId || null,
    toolType: 'MODEL_PROVIDER',
    toolKey: 'openai.responses',
    providerKey: selectedProviderKey,
    modelKey: providerResult.model,
    status: providerResult.status === 'completed' ? 'PASS' : 'HOLD',
    input: evidenceInput,
    output: {
      providerResponseId: providerResult.providerResponseId,
      findingCount: providerResult.output.findingCount,
      output: providerResult.output,
    },
    tokenInput: providerResult.usage?.input_tokens || 0,
    cachedInputTokens: providerResult.usage?.input_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: providerResult.usage?.input_tokens_details?.cache_write_tokens || 0,
    tokenOutput: providerResult.usage?.output_tokens || 0,
    serviceTier: providerResult.serviceTier || 'STANDARD',
    regionalUpliftBps: Number(process.env.OPENAI_REGIONAL_UPLIFT_BPS || 0),
    durationMs: providerResult.durationMs,
  });

  if(!shadowMode){
    await commitUsageReservation(commercialAuthorization.reservationId,{
      actualAmount:1,
      toolExecutionId:toolEvidence.id,
    });
  }

  return {
    executionMode: 'AUTONOMOUS_MODEL_PROVIDER',
    provider: selectedProviderKey,
    providerAdapter: providerResult.provider,
    providerResponseId: providerResult.providerResponseId,
    model: providerResult.model,
    contextHash,
    correlationId: input.correlationId || null,
    sourceBodyPersisted: false,
    commercialAuthorization:shadowMode?'SHADOW_BYPASS':'ALLOW',
    planKey:commercialAuthorization.planKey,
    usageReservationId:commercialAuthorization.reservationId,
    toolExecutionId: toolEvidence.id,
    usageLedgerId: toolEvidence.usageLedgerId,
    output: providerResult.output,
    usage: providerResult.usage,
    durationMs: providerResult.durationMs,
  };
};
