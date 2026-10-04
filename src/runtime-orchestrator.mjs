import {
  createRun,
  createTask,
  updateTask,
  saveCheckpoint,
} from './runtime-db.mjs';
import {
  routeAndRecord,
  recordGateResult,
  recordQaEvidence,
} from './runtime-evidence.mjs';
import { executeScriptContinuityAgent } from './autonomous-agent.mjs';
import { consumeEphemeralContextPacket } from './context-bridge.mjs';

const errorOf = (message, code, statusCode, details) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const validateEvidence = (output, packet) => {
  const sources = new Map(packet.items.map(item => [item.sourceFileId, item]));
  const problems = [];

  for (const finding of output?.findings || []) {
    for (const evidence of finding.evidence || []) {
      const source = sources.get(evidence.sourceFileId);
      if (!source) {
        problems.push({
          code:'UNKNOWN_EVIDENCE_SOURCE',
          findingCode:finding.code,
          sourceFileId:evidence.sourceFileId,
        });
        continue;
      }

      if (
        evidence.sourceVersion != null &&
        source.sourceVersion != null &&
        String(evidence.sourceVersion) !== String(source.sourceVersion)
      ) {
        problems.push({
          code:'EVIDENCE_VERSION_MISMATCH',
          findingCode:finding.code,
          sourceFileId:evidence.sourceFileId,
          expectedVersion:String(source.sourceVersion),
          actualVersion:String(evidence.sourceVersion),
        });
      }

      if (
        evidence.lineStart != null &&
        source.lineStart != null &&
        Number(evidence.lineStart) < Number(source.lineStart)
      ) {
        problems.push({
          code:'EVIDENCE_LINE_OUT_OF_RANGE',
          findingCode:finding.code,
          sourceFileId:evidence.sourceFileId,
          lineStart:Number(evidence.lineStart),
          allowedStart:Number(source.lineStart),
          allowedEnd:source.lineEnd == null ? null : Number(source.lineEnd),
        });
      }

      if (
        evidence.lineEnd != null &&
        source.lineEnd != null &&
        Number(evidence.lineEnd) > Number(source.lineEnd)
      ) {
        problems.push({
          code:'EVIDENCE_LINE_OUT_OF_RANGE',
          findingCode:finding.code,
          sourceFileId:evidence.sourceFileId,
          lineEnd:Number(evidence.lineEnd),
          allowedStart:source.lineStart == null ? null : Number(source.lineStart),
          allowedEnd:Number(source.lineEnd),
        });
      }
    }
  }

  return problems;
};

export const orchestrateContextPacket = async input => {
  if (!input?.projectId || !input?.contextPacketId) {
    throw errorOf(
      'projectId and contextPacketId are required',
      'INVALID_ORCHESTRATION_REQUEST',
      400
    );
  }

  const packet = consumeEphemeralContextPacket(input.contextPacketId);
  const query = input.query || packet.query;
  const scope = input.scope || packet.scope || null;
  const workflowVersion = input.workflowVersion || 'context-orchestrator-v1';
  const routerVersion = input.routerVersion || 'router-p86-v1';
  const taskKey = input.taskKey || 'script-continuity-analysis';
  let runId = null;
  let taskId = null;
  let routeExecutionId = null;
  let correlationId = input.correlationId || null;

  try {
    const run = await createRun({
      projectId:input.projectId,
      correlationId,
      runType:'WORKFLOW',
      triggerSource:'CONTEXT_BRIDGE',
      input:{
        query,
        scope,
        contextPacketId:packet.id,
        contextHash:packet.contextHash,
        sourceBodyPersisted:false,
      },
      workflowVersion,
      routerVersion,
      status:'RUNNING',
    });
    runId = run.id;
    correlationId = run.correlationId;

    const task = await createTask({
      runId,
      correlationId,
      stageKey:input.stageKey || 'SCRIPT',
      taskKey,
      taskType:input.taskType || 'SCRIPT_CONTINUITY',
      sequenceNo:1,
      input:{query,scope,contextHash:packet.contextHash},
      dependencies:{contextHash:packet.contextHash},
    });
    taskId = task.id;

    const route = await routeAndRecord({
      runId,
      taskId,
      correlationId,
      projectType:input.projectType || 'AIGC_CONTENT',
      taskType:input.taskType || 'SCRIPT_CONTINUITY',
      query,
      executionMode:'AUTONOMOUS_CONTEXT_ORCHESTRATOR',
      policyMode:input.policyMode,
      requiredStructuredOutput:true,
      allowedProviderKeys:input.allowedProviderKeys,
      preferredProviderKey:input.preferredProviderKey,
      preferredModelKey:input.preferredModelKey,
      fallbackProviderKeys:input.fallbackProviderKeys,
    });
    routeExecutionId = route.id;

    if (!route.matched || route.policyResult !== 'ALLOW') {
      throw errorOf(
        'Runtime Router did not allow this task',
        'ROUTE_NOT_ALLOWED',
        409,
        { route }
      );
    }

    const agent = await executeScriptContinuityAgent({
      runId,
      taskId,
      routeExecutionId,
      correlationId,
      routeRuleKey:route.routeRuleKey,
      selectedProviderKey:route.selectedProviderKey,
      selectedModelKey:route.selectedModelKey,
      selectedAdapterKey:route.selectedAdapterKey,
      query,
      scope,
      contextPacket:{
        precedence:packet.precedence,
        items:packet.items,
      },
    });

    const evidenceProblems = validateEvidence(agent.output, packet);
    if (evidenceProblems.length) {
      await updateTask(taskId,{
        status:'FAIL',
        output:{
          executionMode:agent.executionMode,
          providerResponseId:agent.providerResponseId,
          evidenceProblems,
        },
        errorCode:'AGENT_EVIDENCE_INVALID',
        errorMessage:'Agent output referenced evidence outside the supplied Context Packet',
        finished:true,
      });

      const gate = await recordGateResult({
        runId,
        taskId,
        correlationId,
        stageKey:input.stageKey || 'SCRIPT',
        gateKey:'G-RUNTIME-AUTONOMOUS-EVIDENCE',
        status:'FAIL',
        criteria:{
          routerMatched:true,
          modelExecuted:true,
          evidenceMustResolveToContextPacket:true,
          sourceBodyPersisted:false,
        },
        evidence:{
          contextHash:packet.contextHash,
          providerResponseId:agent.providerResponseId,
          evidenceProblems,
        },
        blockingReason:'AGENT_EVIDENCE_INVALID',
        decidedBy:'RUNTIME_ORCHESTRATOR',
      });

      const qa = await recordQaEvidence({
        runId,
        taskId,
        correlationId,
        gateResultId:gate.id,
        qaCaseKey:'QA-AUTONOMOUS-EVIDENCE-PROVENANCE',
        status:'FAIL',
        evidenceType:'CONTEXT_PACKET_PROVENANCE',
        evidence:{ contextHash:packet.contextHash, evidenceProblems },
        issueSeverity:'BLOCKER',
        issueSummary:'Agent evidence did not resolve to the supplied transient context.',
        verifiedBy:'RUNTIME_ORCHESTRATOR',
      });

      const checkpoint = await saveCheckpoint(runId,{
        taskId,
        correlationId,
        stageKey:input.stageKey || 'SCRIPT',
        stepKey:'agent-evidence-validation-failed',
        state:{
          status:'FAIL',
          errorCode:'AGENT_EVIDENCE_INVALID',
          gateResultId:gate.id,
          qaEvidenceId:qa.id,
        },
        completedTaskKeys:[],
        pendingTaskKeys:[],
        blockedTaskKeys:[taskKey],
        dependencyFingerprint:packet.contextHash,
        workflowVersion,
        routerVersion,
        resumeFromTaskKey:taskKey,
        createdBy:'RUNTIME_ORCHESTRATOR',
      });

      throw errorOf(
        'Agent evidence validation failed',
        'AGENT_EVIDENCE_INVALID',
        422,
        { runId, taskId, checkpointId:checkpoint.id, evidenceProblems }
      );
    }

    await updateTask(taskId,{
      status:'PASS',
      output:{
        executionMode:agent.executionMode,
        provider:agent.provider,
        providerResponseId:agent.providerResponseId,
        model:agent.model,
        contextHash:packet.contextHash,
        sourceBodyPersisted:false,
        result:agent.output,
      },
      finished:true,
    });

    const gate = await recordGateResult({
      runId,
      taskId,
      correlationId,
      stageKey:input.stageKey || 'SCRIPT',
      gateKey:'G-RUNTIME-AUTONOMOUS-CONTEXT',
      status:'PASS',
      criteria:{
        routerMatched:true,
        contextConsumedOnce:true,
        modelExecuted:true,
        evidenceResolvedToContextPacket:true,
        sourceBodyPersisted:false,
        checkpointRequired:true,
      },
      evidence:{
        contextPacketId:packet.id,
        contextHash:packet.contextHash,
        routeExecutionId,
        toolExecutionId:agent.toolExecutionId,
        providerResponseId:agent.providerResponseId,
        findingCount:agent.output.findingCount,
      },
      decidedBy:'RUNTIME_ORCHESTRATOR',
    });

    const qa = await recordQaEvidence({
      runId,
      taskId,
      correlationId,
      gateResultId:gate.id,
      qaCaseKey:'QA-AUTONOMOUS-CONTEXT-PROVENANCE',
      status:'PASS',
      evidenceType:'CONTEXT_PACKET_PROVENANCE',
      evidence:{
        contextHash:packet.contextHash,
        contextPacketConsumed:true,
        evidenceProblems:[],
        findingCount:agent.output.findingCount,
      },
      issueSeverity:agent.output.findingCount > 0 ? 'P1_CONTINUITY' : null,
      issueSummary:agent.output.findingCount > 0
        ? `${agent.output.findingCount} evidence-supported continuity issue(s) reported`
        : null,
      verifiedBy:'RUNTIME_ORCHESTRATOR',
    });

    const checkpoint = await saveCheckpoint(runId,{
      taskId,
      correlationId,
      stageKey:input.stageKey || 'SCRIPT',
      stepKey:'autonomous-context-analysis-complete',
      state:{
        status:'PASS',
        routeRuleKey:route.routeRuleKey,
        gateResultId:gate.id,
        qaEvidenceId:qa.id,
        findingCount:agent.output.findingCount,
        contextHash:packet.contextHash,
      },
      completedTaskKeys:[taskKey],
      pendingTaskKeys:input.nextTaskKey ? [input.nextTaskKey] : [],
      blockedTaskKeys:[],
      dependencyFingerprint:packet.contextHash,
      workflowVersion,
      routerVersion,
      resumeFromTaskKey:input.nextTaskKey || null,
      createdBy:'RUNTIME_ORCHESTRATOR',
    });

    return {
      executionMode:'AUTONOMOUS_CONTEXT_ORCHESTRATOR',
      runId,
      taskId,
      correlationId,
      routeExecutionId,
      routeRuleKey:route.routeRuleKey,
      policyMode:route.policyMode,
      selectedProviderKey:route.selectedProviderKey,
      selectedModelKey:route.selectedModelKey,
      fallbackChain:route.fallbackChain,
      contextPacketId:packet.id,
      contextHash:packet.contextHash,
      contextPacketConsumed:true,
      sourceBodyPersisted:false,
      provider:agent.provider,
      providerResponseId:agent.providerResponseId,
      model:agent.model,
      findingCount:agent.output.findingCount,
      findings:agent.output.findings,
      noOtherHardConflicts:agent.output.noOtherHardConflicts,
      gateResultId:gate.id,
      qaEvidenceId:qa.id,
      checkpointId:checkpoint.id,
      resumeFromTaskKey:checkpoint.resumeFromTaskKey,
    };
  } catch (error) {
    if (taskId && error.code !== 'AGENT_EVIDENCE_INVALID') {
      try {
        await updateTask(taskId,{
          status:'FAIL',
          errorCode:error.code || 'ORCHESTRATION_ERROR',
          errorCategory:error.errorCategory || 'ORCHESTRATION',
          errorMessage:error.message,
          finished:true,
        });
      } catch {}
    }
    throw error;
  }
};
