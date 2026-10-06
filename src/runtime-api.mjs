import {
  runtimeDbConfigured,
  createProject,
  createRun,
  createTask,
  updateTask,
  saveCheckpoint,
  getLatestCheckpoint,
  resumeRun,
  addKnowledgeContexts,
  listKnowledgeContexts,
  getKnowledgeContextFingerprint,
} from './runtime-db.mjs';
import {
  routeAndRecord,
  recordToolExecution,
  recordGateResult,
  recordQaEvidence,
} from './runtime-evidence.mjs';
import { executeScriptContinuityAgent } from './autonomous-agent.mjs';
import { orchestrateContextPacket } from './runtime-orchestrator.mjs';
import { getRunObservability } from './runtime-observability.mjs';
import {
  upsertProvider,
  upsertModel,
  setProviderHealth,
  listProviderRegistry,
} from './provider-registry.mjs';
import {
  createPricingVersion,
  listPricingVersions,
  upsertProjectBudgetPolicy,
  getRunCostSummary,
  getProjectCostSummary,
  evaluateBudgetPolicy,
} from './cost-ledger.mjs';
import { createTenant, listTenants, createWorkspace, listWorkspaces } from './tenant-workspace.mjs';
import {
  createIdentity,upsertTenantMembership,upsertWorkspaceMembership,createApiCredential,
  revokeApiCredential,listRbacRoles,assertAccess,resolveWorkspaceScope,resolveProjectScope,
  resolveRunScope,resolveTaskScope,resolveReservationScope,resolveCredentialScope,requirePlatformAdmin
} from './runtime-rbac.mjs';
import { upsertQuotaPolicy, listQuotaPolicies, getUsageMeter, evaluateRunQuota } from './quota-meter.mjs';
import {
  createPlan,listPlans,upsertPlanEntitlement,listPlanEntitlements,assignTenantPlan,
  evaluateEntitlement,upsertRateLimitPolicy,listRateLimitPolicies,
  authorizeCommercialExecution,commitUsageReservation,releaseUsageReservation,listUsageReservations
} from './commercial-control.mjs';
import {
  createPlanBillingTerm,listPlanBillingTerms,createSubscription,getTenantSubscription,
  issueCredit,getCreditBalance,finalizeBillingCycle,listTenantInvoices,getInvoice,
  resolveInvoiceScope,resolveBillingCycleScope,reconcileBillingCycle,
  recordInvoicePayment,listInvoicePayments,getBillingOperationsSummary,listReceivables
} from './billing-ledger.mjs';
import {
  openCollectionCase,getInvoiceCollectionCase,getCollectionCase,listCollectionCases,
  recordCollectionAction,resolveCollectionCaseScope
} from './collections.mjs';
import { getRevenueAnalytics, getRevenuePerformance } from './revenue-analytics.mjs';
import { closeFinancePeriod,getFinanceClose,listFinanceCloses,getFinanceCloseExport } from './finance-close.mjs';
import {
  createEvalSuite,listEvalSuites,createEvalSuiteVersion,addEvalCase,getEvalSuiteVersion,
  freezeEvalSuiteVersion,createEvalReplayManifest,getEvalReplayManifest
} from './eval-replay.mjs';
import { runEvalReplayManifest,getEvalRun,resolveEvalRuntimeSha } from './eval-runner.mjs';
import { compareEvalRuns,getEvalRegressionComparison } from './eval-regression.mjs';
import {
  registerShadowEvalProject,listShadowEvalProjects,prepareShadowReplay,executeShadowReplay,
  getShadowReplay,verifyShadowSourceSnapshot
} from './eval-shadow.mjs';
import { createEvalReliabilitySnapshot,getEvalReliabilitySnapshot } from './eval-reliability.mjs';
import {
  upsertProjectType,listProjectTypes,upsertCapability,listCapabilities,upsertAgentProfile,
  grantAgentCapability,bindProjectTypeCapability,createWorkflowTemplate,addWorkflowMilestone,
  addWorkflowStage,addStageCapabilityRequirement,addStageKnowledgePolicy,freezeWorkflowTemplate,getWorkflowTemplate,
  bindProjectWorkflow,getProjectLifecycle
} from './core-meta-registry.mjs';
import { invokeStageCapability,getCapabilityInvocation } from './capability-runtime.mjs';
import { transitionProjectStage,getStageTransitionEvent,listStageTransitionEvents } from './stage-runtime.mjs';
import {
  orchestrateProjectWorkflow,getWorkflowOrchestrationSession,listWorkflowOrchestrationSessions
} from './workflow-orchestrator.mjs';
import {
  decideKnowledgeWriteback,getKnowledgeWriteback,listKnowledgeWritebacks
} from './knowledge-context-runtime.mjs';
import {
  syncStandardDomainPresets,listProjectSubtypes,listDomainWorkflowPresets,getDomainWorkflowPreset,
  getDomainPresetReadiness,compileDomainWorkflowPreset,resolveDomainPresetWorkflow,
  bindProjectKnowledgeSource,listProjectKnowledgeBindings
} from './domain-workflow-presets.mjs';
import {
  createInvoiceAdjustment,recordPaymentRefund,listInvoiceAdjustments,listInvoiceRefunds,
  getInvoiceFinancialSummary,openBillingDispute,recordBillingDisputeAction,
  getBillingDispute,listBillingDisputes,resolveBillingDisputeScope
} from './financial-adjustments.mjs';
import {
  createEphemeralContextPacket,
  getEphemeralContextPacketMetadata,
  consumeEphemeralContextPacket,
} from './context-bridge.mjs';
import {
  updateProjectGovernance,createStrategicItem,listStrategicItems,createPortfolio,listPortfolios,
  getPortfolioRoadmap,linkStrategicItemProject,linkPortfolioProject,createProjectBaseline,
  createProjectStructureNode,createProjectIteration,createProjectMilestone,createProjectWorkItem,
  createProjectDependency,createProjectRisk,createProjectIssue,createProjectBlocker,
  createProjectDecision,createProjectChange,getProjectGovernance,
  updateProjectWorkItem,updateProjectDependency,updateProjectRisk,resolveProjectBlocker,
  updateProjectMilestonePlan,resolveProjectGovernanceObjectScope
} from './project-governance.mjs';
import {
  createGovernanceUpdate,listGovernanceUpdates,resolveGovernanceTargetScope,
  createCapacitySnapshot,getMilestoneIntelligence,refreshMilestoneIntelligence,
  overrideMilestoneProgress,completeMilestone,createProjectVersion,listProjectVersions,
  updateProjectVersion,resolveProjectVersionScope,linkMilestoneVersion,
  getProjectIntelligence,refreshProjectIntelligence
} from './milestone-intelligence.mjs';
import {
  createBenchmarkDimension,createBenchmarkSubject,createBenchmarkSnapshot,addBenchmarkObservation,
  createCapabilityBenchmarkRun,createMarketSignal,createCompetitorChangeEvent,linkBenchmarkDecision,
  getBenchmarkSubjectIntelligence,getProjectCompetitiveIntelligence,
  createApprovalRequest,decideApproval,refreshApprovalDeadlines,listApprovalInbox,
  listNotifications,updateNotification,listActivityEvents,
  resolveBenchmarkSubjectScope,resolveBenchmarkSnapshotScope,resolveApprovalScope,resolveNotificationScope
} from './competitive-collaboration.mjs';
import {
  getProjectHealth,refreshProjectHealth,getPortfolioIntelligence,refreshPortfolioIntelligence,
  getProjectClosureReadiness,completeProject,archiveProject,resolvePortfolioScope
} from './portfolio-closure-governance.mjs';
import {
  createProductEvidence,createProductInsight,createProductOpportunity,createSolutionCandidate,
  createProductHypothesis,createProductPrioritization,createProductGoal,createProductBet,
  createProductRequirement,reviseProductRequirement,createProductTraceLink,
  evaluateProductGate,createProductRequirementBaseline,getProductDiscoveryState,
  getProductRequirement,resolveProductProjectScope,resolveProductRequirementScope
} from './product-development-domain.mjs';

const match = (pathname, expression) => pathname.match(expression);

export const handleRuntimeRoute = async (req, res, url, helpers) => {
  const { json, readBody, principal } = helpers;
  if (!url.pathname.startsWith('/api/runtime/')) return false;

  if (!runtimeDbConfigured()) {
    json(res, 503, { error: 'RUNTIME_DB_NOT_CONFIGURED' });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-suites') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createEvalSuite(await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/eval-suites') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listEvalSuites()});
    return true;
  }

  const evalSuiteVersionsMatch=match(url.pathname,/^\/api\/runtime\/eval-suites\/([^/]+)\/versions$/);
  if (req.method === 'POST' && evalSuiteVersionsMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await createEvalSuiteVersion({
      suiteId:evalSuiteVersionsMatch[1],versionNo:body.versionNo
    })});
    return true;
  }

  const evalVersionCasesMatch=match(url.pathname,/^\/api\/runtime\/eval-suite-versions\/([^/]+)\/cases$/);
  if (req.method === 'POST' && evalVersionCasesMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await addEvalCase({
      suiteVersionId:evalVersionCasesMatch[1],caseKey:body.caseKey,sequenceNo:body.sequenceNo,
      replayInput:body.replayInput,sourceRefs:body.sourceRefs||[],assertions:body.assertions
    })});
    return true;
  }

  const evalVersionFreezeMatch=match(url.pathname,/^\/api\/runtime\/eval-suite-versions\/([^/]+)\/freeze$/);
  if (req.method === 'POST' && evalVersionFreezeMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await freezeEvalSuiteVersion(evalVersionFreezeMatch[1])});
    return true;
  }

  const evalVersionMatch=match(url.pathname,/^\/api\/runtime\/eval-suite-versions\/([^/]+)$/);
  if (req.method === 'GET' && evalVersionMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalSuiteVersion(evalVersionMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-replay-manifests') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createEvalReplayManifest(await readBody(req))});
    return true;
  }

  const evalReplayManifestMatch=match(url.pathname,/^\/api\/runtime\/eval-replay-manifests\/([^/]+)$/);
  if (req.method === 'GET' && evalReplayManifestMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalReplayManifest(evalReplayManifestMatch[1])});
    return true;
  }

  const evalReplayRunMatch=match(url.pathname,/^\/api\/runtime\/eval-replay-manifests\/([^/]+)\/run$/);
  if (req.method === 'POST' && evalReplayRunMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await runEvalReplayManifest(evalReplayRunMatch[1],{
      idempotencyKey:body.idempotencyKey,
      executionProjectId:body.executionProjectId,
      runtimeCommitSha:body.runtimeCommitSha||resolveEvalRuntimeSha(),
      contextsByCaseKey:body.contextsByCaseKey||{}
    })});
    return true;
  }

  const evalRunMatch=match(url.pathname,/^\/api\/runtime\/eval-runs\/([^/]+)$/);
  if (req.method === 'GET' && evalRunMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalRun(evalRunMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-regression-comparisons') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await compareEvalRuns(await readBody(req))});
    return true;
  }

  const evalComparisonMatch=match(url.pathname,/^\/api\/runtime\/eval-regression-comparisons\/([^/]+)$/);
  if (req.method === 'GET' && evalComparisonMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalRegressionComparison(evalComparisonMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-shadow-projects') {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await registerShadowEvalProject(body.projectId)});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/eval-shadow-projects') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listShadowEvalProjects()});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-shadow-replays') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await prepareShadowReplay(await readBody(req))});
    return true;
  }

  const shadowReplayRunMatch=match(url.pathname,/^\/api\/runtime\/eval-shadow-replays\/([^/]+)\/run$/);
  if (req.method === 'POST' && shadowReplayRunMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    if(body.runtimeCommitSha!=null){
      throw Object.assign(new Error('Shadow eval Runtime SHA is server-controlled and cannot be overridden by the caller'),{
        code:'SHADOW_RUNTIME_SHA_OVERRIDE_NOT_ALLOWED',statusCode:400
      });
    }
    json(res,201,{data:await executeShadowReplay(shadowReplayRunMatch[1],{
      contextsByCaseKey:body.contextsByCaseKey||{}
    })});
    return true;
  }

  const shadowReplayIntegrityMatch=match(url.pathname,/^\/api\/runtime\/eval-shadow-replays\/([^/]+)\/source-integrity$/);
  if (req.method === 'GET' && shadowReplayIntegrityMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await verifyShadowSourceSnapshot(shadowReplayIntegrityMatch[1])});
    return true;
  }

  const shadowReplayMatch=match(url.pathname,/^\/api\/runtime\/eval-shadow-replays\/([^/]+)$/);
  if (req.method === 'GET' && shadowReplayMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getShadowReplay(shadowReplayMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/eval-reliability-snapshots') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createEvalReliabilitySnapshot(await readBody(req))});
    return true;
  }

  const evalReliabilityMatch=match(url.pathname,/^\/api\/runtime\/eval-reliability-snapshots\/([^/]+)$/);
  if (req.method === 'GET' && evalReliabilityMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalReliabilitySnapshot(evalReliabilityMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/finance-closes') {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await closeFinancePeriod({
      periodStart:body.periodStart,periodEnd:body.periodEnd,idempotencyKey:body.idempotencyKey,
      sourceLabel:body.sourceLabel||null,metadata:body.metadata||null
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/finance-closes') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listFinanceCloses({limit:url.searchParams.get('limit')||100})});
    return true;
  }

  const financeCloseExportMatch=match(url.pathname,/^\/api\/runtime\/finance-closes\/([^/]+)\/export$/);
  if (req.method === 'GET' && financeCloseExportMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getFinanceCloseExport(financeCloseExportMatch[1],{
      format:url.searchParams.get('format')||'JSON'
    })});
    return true;
  }

  const financeCloseMatch=match(url.pathname,/^\/api\/runtime\/finance-closes\/([^/]+)$/);
  if (req.method === 'GET' && financeCloseMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getFinanceClose(financeCloseMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/plan-billing-terms') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createPlanBillingTerm(await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/plan-billing-terms') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listPlanBillingTerms({planKey:url.searchParams.get('planKey')||null})});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/subscriptions') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createSubscription(await readBody(req))});
    return true;
  }

  const tenantSubscriptionMatch=match(url.pathname,/^\/api\/runtime\/tenants\/([^/]+)\/subscription$/);
  if (req.method === 'GET' && tenantSubscriptionMatch) {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'billing:read',tenantId:tenantSubscriptionMatch[1],method:req.method,path:url.pathname});
    json(res,200,{data:await getTenantSubscription(tenantSubscriptionMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/credits') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await issueCredit(await readBody(req))});
    return true;
  }

  const tenantCreditMatch=match(url.pathname,/^\/api\/runtime\/tenants\/([^/]+)\/credit-balance$/);
  if (req.method === 'GET' && tenantCreditMatch) {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'billing:read',tenantId:tenantCreditMatch[1],method:req.method,path:url.pathname});
    json(res,200,{data:await getCreditBalance({tenantId:tenantCreditMatch[1],currency:url.searchParams.get('currency')||'USD'})});
    return true;
  }

  const billingFinalizeMatch=match(url.pathname,/^\/api\/runtime\/billing-cycles\/([^/]+)\/finalize$/);
  if (req.method === 'POST' && billingFinalizeMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,200,{data:await finalizeBillingCycle({cycleId:billingFinalizeMatch[1],finalizedAt:body.finalizedAt||new Date()})});
    return true;
  }

  const billingReconcileMatch=match(url.pathname,/^\/api\/runtime\/billing-cycles\/([^/]+)\/reconcile$/);
  if (req.method === 'GET' && billingReconcileMatch) {
    if(!principal?.platformAdmin){const scope=await resolveBillingCycleScope(billingReconcileMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await reconcileBillingCycle(billingReconcileMatch[1])});
    return true;
  }

  const tenantInvoicesMatch=match(url.pathname,/^\/api\/runtime\/tenants\/([^/]+)\/invoices$/);
  if (req.method === 'GET' && tenantInvoicesMatch) {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'billing:read',tenantId:tenantInvoicesMatch[1],method:req.method,path:url.pathname});
    json(res,200,{data:await listTenantInvoices(tenantInvoicesMatch[1])});
    return true;
  }

  const invoiceAdjustmentsMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/adjustments$/);
  if (req.method === 'POST' && invoiceAdjustmentsMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await createInvoiceAdjustment({
      invoiceId:invoiceAdjustmentsMatch[1],adjustmentType:body.adjustmentType,amount:body.amount,
      currency:body.currency||null,reasonCode:body.reasonCode,idempotencyKey:body.idempotencyKey,
      effectiveAt:body.effectiveAt||new Date(),metadata:body.metadata||null
    })});
    return true;
  }
  if (req.method === 'GET' && invoiceAdjustmentsMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoiceAdjustmentsMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await listInvoiceAdjustments(invoiceAdjustmentsMatch[1])});
    return true;
  }

  const invoiceFinancialMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/financial-position$/);
  if (req.method === 'GET' && invoiceFinancialMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoiceFinancialMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await getInvoiceFinancialSummary(invoiceFinancialMatch[1],{asOf:url.searchParams.get('asOf')||new Date()})});
    return true;
  }

  const paymentRefundMatch=match(url.pathname,/^\/api\/runtime\/payments\/([^/]+)\/refunds$/);
  if (req.method === 'POST' && paymentRefundMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await recordPaymentRefund({
      paymentId:paymentRefundMatch[1],amount:body.amount,idempotencyKey:body.idempotencyKey,
      refundReference:body.refundReference||null,refundedAt:body.refundedAt||new Date(),metadata:body.metadata||null
    })});
    return true;
  }

  const invoiceRefundsMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/refunds$/);
  if (req.method === 'GET' && invoiceRefundsMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoiceRefundsMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await listInvoiceRefunds(invoiceRefundsMatch[1])});
    return true;
  }

  const invoiceDisputesMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/disputes$/);
  if (req.method === 'POST' && invoiceDisputesMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await openBillingDispute({
      invoiceId:invoiceDisputesMatch[1],disputedAmount:body.disputedAmount,currency:body.currency||null,
      reasonCode:body.reasonCode,idempotencyKey:body.idempotencyKey,openedAt:body.openedAt||new Date(),
      metadata:body.metadata||null
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/billing-disputes') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listBillingDisputes({
      tenantId:requestedTenant,status:url.searchParams.get('status')||'ACTIVE',limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const disputeActionMatch=match(url.pathname,/^\/api\/runtime\/billing-disputes\/([^/]+)\/actions$/);
  if (req.method === 'POST' && disputeActionMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await recordBillingDisputeAction({
      disputeId:disputeActionMatch[1],actionType:body.actionType,idempotencyKey:body.idempotencyKey,
      acceptedAmount:body.acceptedAmount??null,resolutionNote:body.resolutionNote||null,
      occurredAt:body.occurredAt||new Date(),metadata:body.metadata||null
    })});
    return true;
  }

  const disputeMatch=match(url.pathname,/^\/api\/runtime\/billing-disputes\/([^/]+)$/);
  if (req.method === 'GET' && disputeMatch) {
    if(!principal?.platformAdmin){const scope=await resolveBillingDisputeScope(disputeMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await getBillingDispute(disputeMatch[1])});
    return true;
  }

  const invoicePaymentsMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/payments$/);
  if (req.method === 'POST' && invoicePaymentsMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await recordInvoicePayment({
      invoiceId:invoicePaymentsMatch[1],amount:body.amount,currency:body.currency||null,
      idempotencyKey:body.idempotencyKey,paymentReference:body.paymentReference||null,
      receivedAt:body.receivedAt||new Date(),metadata:body.metadata||null
    })});
    return true;
  }

  if (req.method === 'GET' && invoicePaymentsMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoicePaymentsMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await listInvoicePayments(invoicePaymentsMatch[1])});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/billing-ops/summary') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getBillingOperationsSummary({
      tenantId:requestedTenant,
      planKey:url.searchParams.get('planKey')||null,
      asOf:url.searchParams.get('asOf')||new Date()
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/billing-ops/receivables') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listReceivables({
      tenantId:requestedTenant,
      status:url.searchParams.get('status')||'OPEN',
      asOf:url.searchParams.get('asOf')||new Date(),
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/billing-ops/analytics') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getRevenueAnalytics({
      tenantId:requestedTenant,
      planKey:url.searchParams.get('planKey')||null,
      asOf:url.searchParams.get('asOf')||new Date()
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/billing-ops/revenue-performance') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getRevenuePerformance({
      tenantId:requestedTenant,
      planKey:url.searchParams.get('planKey')||null,
      asOf:url.searchParams.get('asOf')||new Date(),
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const invoiceCollectionMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)\/collection-case$/);
  if (req.method === 'POST' && invoiceCollectionMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await openCollectionCase({
      invoiceId:invoiceCollectionMatch[1],
      priority:body.priority||'NORMAL',
      assignedIdentityId:body.assignedIdentityId||null,
      openedAt:body.openedAt||new Date(),
      metadata:body.metadata||null
    })});
    return true;
  }
  if (req.method === 'GET' && invoiceCollectionMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoiceCollectionMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await getInvoiceCollectionCase(invoiceCollectionMatch[1])});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/collection-cases') {
    const requestedTenant=url.searchParams.get('tenantId')||(principal?.platformAdmin?null:principal?.tenantId);
    if(!principal?.platformAdmin){
      if(!requestedTenant) throw Object.assign(new Error('Tenant scope is required'),{code:'TENANT_SCOPE_REQUIRED',statusCode:403});
      await assertAccess({principal,permission:'billing:read',tenantId:requestedTenant,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listCollectionCases({
      tenantId:requestedTenant,
      status:url.searchParams.get('status')||'ACTIVE',
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const collectionActionMatch=match(url.pathname,/^\/api\/runtime\/collection-cases\/([^/]+)\/actions$/);
  if (req.method === 'POST' && collectionActionMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,201,{data:await recordCollectionAction({
      caseId:collectionActionMatch[1],
      actionType:body.actionType,
      idempotencyKey:body.idempotencyKey,
      occurredAt:body.occurredAt||new Date(),
      nextActionAt:body.nextActionAt||null,
      promisedAmount:body.promisedAmount??null,
      promiseDueAt:body.promiseDueAt||null,
      resolutionCode:body.resolutionCode||null,
      metadata:body.metadata||null
    })});
    return true;
  }

  const collectionCaseMatch=match(url.pathname,/^\/api\/runtime\/collection-cases\/([^/]+)$/);
  if (req.method === 'GET' && collectionCaseMatch) {
    if(!principal?.platformAdmin){const scope=await resolveCollectionCaseScope(collectionCaseMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await getCollectionCase(collectionCaseMatch[1])});
    return true;
  }

  const invoiceMatch=match(url.pathname,/^\/api\/runtime\/invoices\/([^/]+)$/);
  if (req.method === 'GET' && invoiceMatch) {
    if(!principal?.platformAdmin){const scope=await resolveInvoiceScope(invoiceMatch[1]);await assertAccess({principal,permission:'billing:read',...scope,method:req.method,path:url.pathname});}
    json(res,200,{data:await getInvoice(invoiceMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/identities') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createIdentity(await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/rbac-roles') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listRbacRoles()});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tenant-memberships') {
    const body=await readBody(req);
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'membership:write',tenantId:body.tenantId,method:req.method,path:url.pathname});
    json(res,201,{data:await upsertTenantMembership(body)});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/workspace-memberships') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'membership:write',...scope,method:req.method,path:url.pathname});
    json(res,201,{data:await upsertWorkspaceMembership(body)});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/api-credentials') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      await assertAccess({principal,permission:'credential:write',tenantId:body.tenantId,workspaceId:body.workspaceId||null,method:req.method,path:url.pathname});
      if(body.identityId!==principal.identityId) throw Object.assign(new Error('Scoped credentials may only create credentials for the authenticated identity'),{code:'CREDENTIAL_IDENTITY_ESCALATION',statusCode:403});
    }
    json(res,201,{data:await createApiCredential(body)});
    return true;
  }

  const revokeCredentialMatch=match(url.pathname,/^\/api\/runtime\/api-credentials\/([^/]+)\/revoke$/);
  if (req.method === 'POST' && revokeCredentialMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await revokeApiCredential(revokeCredentialMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/plans') {
    requirePlatformAdmin(principal);
    const result=await createPlan(await readBody(req));
    json(res,201,{data:result});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/plans') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listPlans()});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/plan-entitlements') {
    requirePlatformAdmin(principal);
    const result=await upsertPlanEntitlement(await readBody(req));
    json(res,201,{data:result});
    return true;
  }

  const planEntitlementsMatch=match(url.pathname,/^\/api\/runtime\/plans\/([^/]+)\/entitlements$/);
  if (req.method === 'GET' && planEntitlementsMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listPlanEntitlements(planEntitlementsMatch[1])});
    return true;
  }

  const tenantPlanMatch=match(url.pathname,/^\/api\/runtime\/tenants\/([^/]+)\/plan$/);
  if (req.method === 'PATCH' && tenantPlanMatch) {
    requirePlatformAdmin(principal);
    const body=await readBody(req);
    json(res,200,{data:await assignTenantPlan({tenantId:tenantPlanMatch[1],planKey:body.planKey})});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/rate-limit-policies') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ let scope={tenantId:body.tenantId||principal.tenantId,workspaceId:body.workspaceId||null}; if(body.scopeType==='PLAN') throw Object.assign(new Error('Platform administrator required for PLAN rate limits'),{code:'PLATFORM_ADMIN_REQUIRED',statusCode:403}); if(body.scopeType==='WORKSPACE') scope=await resolveWorkspaceScope(body.workspaceId); await assertAccess({principal,permission:'commercial:write',...scope,method:req.method,path:url.pathname}); }
    const result=await upsertRateLimitPolicy(body);
    json(res,201,{data:result});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/rate-limit-policies') {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'commercial:read',tenantId:principal.tenantId,workspaceId:principal.workspaceId||null,method:req.method,path:url.pathname});
    json(res,200,{data:await listRateLimitPolicies({
      operationKey:url.searchParams.get('operationKey')||null,
      tenantId:principal?.platformAdmin?null:principal.tenantId,
      workspaceId:principal?.platformAdmin?null:principal.workspaceId,
      planKey:null
    })});
    return true;
  }

  const entitlementMatch=match(url.pathname,/^\/api\/runtime\/runs\/([^/]+)\/entitlement-evaluate$/);
  if (req.method === 'POST' && entitlementMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(entitlementMatch[1]); await assertAccess({principal,permission:'commercial:read',...scope,method:req.method,path:url.pathname}); }
    const body=await readBody(req);
    const result=await evaluateEntitlement({
      runId:entitlementMatch[1],entitlementKey:body.entitlementKey,
      persist:body.persist!==false,source:body.source||'RUNTIME_API'
    });
    json(res,200,{data:result});
    return true;
  }

  const commercialAuthorizeMatch=match(url.pathname,/^\/api\/runtime\/runs\/([^/]+)\/commercial-authorize$/);
  if (req.method === 'POST' && commercialAuthorizeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(commercialAuthorizeMatch[1]); await assertAccess({principal,permission:'commercial:write',...scope,method:req.method,path:url.pathname}); }
    const body=await readBody(req);
    const result=await authorizeCommercialExecution({
      runId:commercialAuthorizeMatch[1],
      entitlementKey:body.entitlementKey||'MODEL_EXECUTION',
      operationKey:body.operationKey||'MODEL_EXECUTION',
      reservationMetric:body.reservationMetric||'TOOL_EXECUTION_COUNT',
      reservationAmount:body.reservationAmount==null?1:body.reservationAmount,
      reservationCurrency:body.reservationCurrency||'USD',
      reservationTtlSeconds:body.reservationTtlSeconds==null?300:body.reservationTtlSeconds,
      source:body.source||'RUNTIME_API'
    });
    json(res,200,{data:result});
    return true;
  }

  const reservationCommitMatch=match(url.pathname,/^\/api\/runtime\/usage-reservations\/([^/]+)\/commit$/);
  if (req.method === 'POST' && reservationCommitMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveReservationScope(reservationCommitMatch[1]); await assertAccess({principal,permission:'commercial:write',...scope,method:req.method,path:url.pathname}); }
    json(res,200,{data:await commitUsageReservation(reservationCommitMatch[1],await readBody(req))});
    return true;
  }

  const reservationReleaseMatch=match(url.pathname,/^\/api\/runtime\/usage-reservations\/([^/]+)\/release$/);
  if (req.method === 'POST' && reservationReleaseMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveReservationScope(reservationReleaseMatch[1]); await assertAccess({principal,permission:'commercial:write',...scope,method:req.method,path:url.pathname}); }
    json(res,200,{data:await releaseUsageReservation(reservationReleaseMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/usage-reservations') {
    const reservationRunId=url.searchParams.get('runId')||null;
    if(!principal?.platformAdmin){
      if(!reservationRunId) throw Object.assign(new Error('runId is required for scoped reservation listing'),{code:'SCOPED_RUN_ID_REQUIRED',statusCode:400});
      const scope=await resolveRunScope(reservationRunId);
      await assertAccess({principal,permission:'commercial:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listUsageReservations({runId:reservationRunId})});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tenants') {
    requirePlatformAdmin(principal);
    const result = await createTenant(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/tenants') {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'tenant:read',tenantId:principal.tenantId,method:req.method,path:url.pathname});
    json(res, 200, { data: await listTenants({tenantId:principal?.platformAdmin?null:principal.tenantId}) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/workspaces') {
    const body=await readBody(req);
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'workspace:write',tenantId:body.tenantId,method:req.method,path:url.pathname});
    const result = await createWorkspace(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/workspaces') {
    const requestedTenant=url.searchParams.get('tenantId') || null;
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'workspace:read',tenantId:requestedTenant||principal.tenantId,workspaceId:principal.workspaceId||null,method:req.method,path:url.pathname});
    const result = await listWorkspaces({ tenantId:principal?.platformAdmin?requestedTenant:principal.tenantId, workspaceId:principal?.platformAdmin?null:principal.workspaceId });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/project-subtypes') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listProjectSubtypes({
      projectTypeKey:url.searchParams.get('projectTypeKey')||null,
      status:url.searchParams.get('status')||'ACTIVE'
    })});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/domain-presets/sync') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await syncStandardDomainPresets()});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/domain-presets') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listDomainWorkflowPresets({
      projectTypeKey:url.searchParams.get('projectTypeKey')||null
    })});
    return true;
  }

  const domainPresetMatch=match(url.pathname,/^\/api\/runtime\/domain-presets\/([^/]+)$/);
  if (req.method === 'GET' && domainPresetMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getDomainWorkflowPreset(domainPresetMatch[1])});
    return true;
  }

  const domainPresetReadinessMatch=match(url.pathname,/^\/api\/runtime\/domain-presets\/([^/]+)\/readiness$/);
  if (req.method === 'GET' && domainPresetReadinessMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getDomainPresetReadiness(domainPresetReadinessMatch[1])});
    return true;
  }

  const domainPresetCompileMatch=match(url.pathname,/^\/api\/runtime\/domain-presets\/([^/]+)\/compile$/);
  if (req.method === 'POST' && domainPresetCompileMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await compileDomainWorkflowPreset(domainPresetCompileMatch[1])});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/project-types') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await upsertProjectType(await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/project-types') {
    requirePlatformAdmin(principal);
    json(res,200,{data:await listProjectTypes({status:url.searchParams.get('status')||null})});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/capabilities') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await upsertCapability(await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/capabilities') {
    requirePlatformAdmin(principal);
    const routable=url.searchParams.get('routable');
    json(res,200,{data:await listCapabilities({
      capabilityType:url.searchParams.get('capabilityType')||null,
      status:url.searchParams.get('status')||null,
      routable:routable==null?null:routable==='true'
    })});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/agent-profiles') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await upsertAgentProfile(await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/agent-capability-grants') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await grantAgentCapability(await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/project-type-capabilities') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await bindProjectTypeCapability(await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/workflow-templates') {
    requirePlatformAdmin(principal);
    json(res,201,{data:await createWorkflowTemplate(await readBody(req))});
    return true;
  }

  const workflowMilestoneMatch=match(url.pathname,/^\/api\/runtime\/workflow-templates\/([^/]+)\/milestones$/);
  if (req.method === 'POST' && workflowMilestoneMatch) {
    requirePlatformAdmin(principal);
    json(res,201,{data:await addWorkflowMilestone(workflowMilestoneMatch[1],await readBody(req))});
    return true;
  }

  const workflowStageMatch=match(url.pathname,/^\/api\/runtime\/workflow-templates\/([^/]+)\/stages$/);
  if (req.method === 'POST' && workflowStageMatch) {
    requirePlatformAdmin(principal);
    json(res,201,{data:await addWorkflowStage(workflowStageMatch[1],await readBody(req))});
    return true;
  }

  const stageRequirementMatch=match(url.pathname,/^\/api\/runtime\/workflow-stages\/([^/]+)\/requirements$/);
  if (req.method === 'POST' && stageRequirementMatch) {
    requirePlatformAdmin(principal);
    json(res,201,{data:await addStageCapabilityRequirement(stageRequirementMatch[1],await readBody(req))});
    return true;
  }

  const stageKnowledgePolicyMatch=match(url.pathname,/^\/api\/runtime\/workflow-stages\/([^/]+)\/knowledge-policies$/);
  if (req.method === 'POST' && stageKnowledgePolicyMatch) {
    requirePlatformAdmin(principal);
    json(res,201,{data:await addStageKnowledgePolicy(stageKnowledgePolicyMatch[1],await readBody(req))});
    return true;
  }

  const workflowFreezeMatch=match(url.pathname,/^\/api\/runtime\/workflow-templates\/([^/]+)\/freeze$/);
  if (req.method === 'POST' && workflowFreezeMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await freezeWorkflowTemplate(workflowFreezeMatch[1])});
    return true;
  }

  const workflowTemplateMatch=match(url.pathname,/^\/api\/runtime\/workflow-templates\/([^/]+)$/);
  if (req.method === 'GET' && workflowTemplateMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getWorkflowTemplate(workflowTemplateMatch[1])});
    return true;
  }

  const projectWorkflowBindMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/workflow-bind$/);
  if (req.method === 'POST' && projectWorkflowBindMatch) {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(projectWorkflowBindMatch[1]); await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname}); }
    json(res,200,{data:await bindProjectWorkflow(projectWorkflowBindMatch[1],body.workflowTemplateId)});
    return true;
  }

  const projectLifecycleMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/lifecycle$/);
  if (req.method === 'GET' && projectLifecycleMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(projectLifecycleMatch[1]); await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname}); }
    json(res,200,{data:await getProjectLifecycle(projectLifecycleMatch[1])});
    return true;
  }

  const projectKnowledgeBindingMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/knowledge-bindings$/);
  if (req.method === 'POST' && projectKnowledgeBindingMatch) {
    const projectId=projectKnowledgeBindingMatch[1];
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await bindProjectKnowledgeSource({...body,projectId})});
    return true;
  }

  if (req.method === 'GET' && projectKnowledgeBindingMatch) {
    const projectId=projectKnowledgeBindingMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listProjectKnowledgeBindings(projectId)});
    return true;
  }

  const projectStageTransitionMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/stage-transitions$/);
  if (req.method === 'POST' && projectStageTransitionMatch) {
    const body=await readBody(req);
    const projectId=projectStageTransitionMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname});
    }
    const actorKey=principal?.platformAdmin
      ? 'PLATFORM_ADMIN'
      : (principal?.identityId||principal?.credentialId||'SCOPED_IDENTITY');
    json(res,201,{data:await transitionProjectStage({...body,projectId,actorKey})});
    return true;
  }

  if (req.method === 'GET' && projectStageTransitionMatch) {
    const projectId=projectStageTransitionMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listStageTransitionEvents({
      projectId,
      runId:url.searchParams.get('runId')||null,
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const stageTransitionEventMatch=match(url.pathname,/^\/api\/runtime\/stage-transitions\/([^/]+)$/);
  if (req.method === 'GET' && stageTransitionEventMatch) {
    const data=await getStageTransitionEvent(stageTransitionEventMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  const projectOrchestrationMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/orchestrations$/);
  if (req.method === 'POST' && projectOrchestrationMatch) {
    const projectId=projectOrchestrationMatch[1];
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'agent:execute',...scope,method:req.method,path:url.pathname});
    }
    const actorKey=principal?.platformAdmin
      ? 'PLATFORM_ADMIN'
      : (principal?.identityId||principal?.credentialId||'SCOPED_IDENTITY');
    json(res,201,{data:await orchestrateProjectWorkflow({...body,projectId,actorKey})});
    return true;
  }

  if (req.method === 'GET' && projectOrchestrationMatch) {
    const projectId=projectOrchestrationMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listWorkflowOrchestrationSessions({
      projectId,limit:url.searchParams.get('limit')||50
    })});
    return true;
  }

  const orchestrationSessionMatch=match(url.pathname,/^\/api\/runtime\/orchestrations\/([^/]+)$/);
  if (req.method === 'GET' && orchestrationSessionMatch) {
    const data=await getWorkflowOrchestrationSession(orchestrationSessionMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  const projectKnowledgeWritebackMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/knowledge-writebacks$/);
  if (req.method === 'GET' && projectKnowledgeWritebackMatch) {
    const projectId=projectKnowledgeWritebackMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listKnowledgeWritebacks({
      projectId,status:url.searchParams.get('status')||null,limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const knowledgeWritebackDecisionMatch=match(url.pathname,/^\/api\/runtime\/knowledge-writebacks\/([^/]+)\/decision$/);
  if (req.method === 'POST' && knowledgeWritebackDecisionMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await decideKnowledgeWriteback(
      knowledgeWritebackDecisionMatch[1],await readBody(req)
    )});
    return true;
  }

  const knowledgeWritebackMatch=match(url.pathname,/^\/api\/runtime\/knowledge-writebacks\/([^/]+)$/);
  if (req.method === 'GET' && knowledgeWritebackMatch) {
    const data=await getKnowledgeWriteback(knowledgeWritebackMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/capability-invocations') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(body.projectId);
      await assertAccess({principal,permission:'agent:execute',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await invokeStageCapability(body)});
    return true;
  }

  const capabilityInvocationMatch=match(url.pathname,/^\/api\/runtime\/capability-invocations\/([^/]+)$/);
  if (req.method === 'GET' && capabilityInvocationMatch) {
    const data=await getCapabilityInvocation(capabilityInvocationMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/strategic-items') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await createStrategicItem(body)});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/strategic-items') {
    const workspaceId=url.searchParams.get('workspaceId');
    const scope=await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listStrategicItems({
      workspaceId,
      itemType:url.searchParams.get('itemType')||null,
      status:url.searchParams.get('status')||null
    })});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/portfolios') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await createPortfolio(body)});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/portfolios') {
    const workspaceId=url.searchParams.get('workspaceId');
    const scope=await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listPortfolios({
      workspaceId,status:url.searchParams.get('status')||null
    })});
    return true;
  }

  const portfolioRoadmapMatch=match(url.pathname,/^\/api\/runtime\/portfolios\/([^/]+)\/roadmap$/);
  if (req.method === 'GET' && portfolioRoadmapMatch) {
    const data=await getPortfolioRoadmap(portfolioRoadmapMatch[1]);
    const scope=await resolveWorkspaceScope(data.portfolio.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data});
    return true;
  }

  const portfolioIntelligenceMatch=match(url.pathname,/^\/api\/runtime\/portfolios\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && portfolioIntelligenceMatch) {
    const target=await resolvePortfolioScope(portfolioIntelligenceMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getPortfolioIntelligence(portfolioIntelligenceMatch[1],{
      asOf:url.searchParams.get('asOf')||new Date()
    })});
    return true;
  }

  const portfolioIntelligenceRefreshMatch=match(url.pathname,/^\/api\/runtime\/portfolios\/([^/]+)\/intelligence\/refresh$/);
  if (req.method === 'POST' && portfolioIntelligenceRefreshMatch) {
    const target=await resolvePortfolioScope(portfolioIntelligenceRefreshMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshPortfolioIntelligence(
      portfolioIntelligenceRefreshMatch[1],await readBody(req)
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/strategy-project-links') {
    const body=await readBody(req);
    const scope=await resolveProjectScope(body.projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await linkStrategicItemProject(body)});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/portfolio-project-links') {
    const body=await readBody(req);
    const scope=await resolveProjectScope(body.projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await linkPortfolioProject(body)});
    return true;
  }

  const projectGovernanceMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/governance$/);
  if (req.method === 'GET' && projectGovernanceMatch) {
    const projectId=projectGovernanceMatch[1];
    const scope=await resolveProjectScope(projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:read',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await getProjectGovernance(projectId)});
    return true;
  }

  if (req.method === 'PATCH' && projectGovernanceMatch) {
    const projectId=projectGovernanceMatch[1];
    const scope=await resolveProjectScope(projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await updateProjectGovernance(projectId,await readBody(req))});
    return true;
  }

  const governanceCreateRoutes=[
    ['baselines',createProjectBaseline],
    ['structure-nodes',createProjectStructureNode],
    ['iterations',createProjectIteration],
    ['milestones',createProjectMilestone],
    ['work-items',createProjectWorkItem],
    ['dependencies',createProjectDependency],
    ['risks',createProjectRisk],
    ['issues',createProjectIssue],
    ['blockers',createProjectBlocker],
    ['decisions',createProjectDecision],
    ['changes',createProjectChange]
  ];
  for(const [segment,handler] of governanceCreateRoutes){
    const m=match(url.pathname,new RegExp('^/api/runtime/projects/([^/]+)/'+segment+'$'));
    if(req.method==='POST'&&m){
      const projectId=m[1];
      const scope=await resolveProjectScope(projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
      json(res,201,{data:await handler(projectId,await readBody(req))});
      return true;
    }
  }

  const workItemPatchMatch=match(url.pathname,/^\/api\/runtime\/work-items\/([^/]+)$/);
  if (req.method === 'PATCH' && workItemPatchMatch) {
    const target=await resolveProjectGovernanceObjectScope('WORK_ITEM',workItemPatchMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectWorkItem(workItemPatchMatch[1],await readBody(req))});
    return true;
  }

  const dependencyPatchMatch=match(url.pathname,/^\/api\/runtime\/dependencies\/([^/]+)$/);
  if (req.method === 'PATCH' && dependencyPatchMatch) {
    const target=await resolveProjectGovernanceObjectScope('DEPENDENCY',dependencyPatchMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectDependency(dependencyPatchMatch[1],await readBody(req))});
    return true;
  }

  const riskPatchMatch=match(url.pathname,/^\/api\/runtime\/risks\/([^/]+)$/);
  if (req.method === 'PATCH' && riskPatchMatch) {
    const target=await resolveProjectGovernanceObjectScope('RISK',riskPatchMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectRisk(riskPatchMatch[1],await readBody(req))});
    return true;
  }

  const blockerResolveMatch=match(url.pathname,/^\/api\/runtime\/blockers\/([^/]+)\/resolve$/);
  if (req.method === 'POST' && blockerResolveMatch) {
    const target=await resolveProjectGovernanceObjectScope('BLOCKER',blockerResolveMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await resolveProjectBlocker(blockerResolveMatch[1],await readBody(req))});
    return true;
  }

  const milestonePlanMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/plan$/);
  if (req.method === 'PATCH' && milestonePlanMatch) {
    const target=await resolveProjectGovernanceObjectScope('MILESTONE',milestonePlanMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectMilestonePlan(milestonePlanMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/governance-updates') {
    const body=await readBody(req);
    const target=await resolveGovernanceTargetScope(body.targetType,body.targetId);
    if(!principal?.platformAdmin){
      if(target.projectId){
        const scope=await resolveProjectScope(target.projectId);
        await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
      }else{
        const scope=await resolveWorkspaceScope(target.workspaceId);
        await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
      }
    }
    json(res,201,{data:await createGovernanceUpdate(body)});
    return true;
  }

  const strategicUpdatesMatch=match(url.pathname,/^\/api\/runtime\/strategic-items\/([^/]+)\/governance-updates$/);
  if (req.method === 'GET' && strategicUpdatesMatch) {
    const target=await resolveGovernanceTargetScope('STRATEGIC_ITEM',strategicUpdatesMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listGovernanceUpdates({
      targetType:'STRATEGIC_ITEM',targetId:strategicUpdatesMatch[1],
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const projectUpdatesMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/governance-updates$/);
  if (req.method === 'GET' && projectUpdatesMatch) {
    const projectId=projectUpdatesMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listGovernanceUpdates({
      projectId,targetType:url.searchParams.get('targetType')||null,
      targetId:url.searchParams.get('targetId')||null,
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const productDomainMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/product-domain$/);
  if (req.method === 'GET' && productDomainMatch) {
    const projectId=productDomainMatch[1];
    const scope=await resolveProductProjectScope(projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:read',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await getProductDiscoveryState(projectId)});
    return true;
  }

  const productCreateRoutes=[
    ['product-evidence',createProductEvidence],
    ['product-insights',createProductInsight],
    ['product-opportunities',createProductOpportunity],
    ['product-solution-candidates',createSolutionCandidate],
    ['product-hypotheses',createProductHypothesis],
    ['product-prioritizations',createProductPrioritization],
    ['product-goals',createProductGoal],
    ['product-bets',createProductBet],
    ['product-requirements',createProductRequirement],
    ['product-trace-links',createProductTraceLink],
    ['product-baselines',createProductRequirementBaseline]
  ];
  for(const [segment,handler] of productCreateRoutes){
    const m=match(url.pathname,new RegExp('^/api/runtime/projects/([^/]+)/'+segment+'
  if (req.method === 'GET' && milestoneIntelligenceMatch) {
    const data=await getMilestoneIntelligence(milestoneIntelligenceMatch[1],{
      asOf:url.searchParams.get('asOf')||new Date()
    });
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  const milestoneRefreshMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/intelligence\/refresh$/);
  if (req.method === 'POST' && milestoneRefreshMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneRefreshMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshMilestoneIntelligence(
      milestoneRefreshMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneOverrideMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/progress-override$/);
  if (req.method === 'POST' && milestoneOverrideMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneOverrideMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await overrideMilestoneProgress(
      milestoneOverrideMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneCapacityMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/capacity-snapshots$/);
  if (req.method === 'POST' && milestoneCapacityMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneCapacityMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,201,{data:await createCapacitySnapshot({
      ...body,projectId:target.projectId,targetType:'MILESTONE',targetId:milestoneCapacityMatch[1]
    })});
    return true;
  }

  const milestoneCompleteMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/complete$/);
  if (req.method === 'POST' && milestoneCompleteMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneCompleteMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await completeMilestone(
      milestoneCompleteMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneVersionLinkMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/version-links$/);
  if (req.method === 'POST' && milestoneVersionLinkMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneVersionLinkMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await linkMilestoneVersion(
      milestoneVersionLinkMatch[1],await readBody(req)
    )});
    return true;
  }

  const projectHealthMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/health$/);
  if (req.method === 'GET' && projectHealthMatch) {
    const projectId=projectHealthMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectHealth(projectId,{asOf:url.searchParams.get('asOf')||new Date()})});
    return true;
  }

  const projectHealthRefreshMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/health\/refresh$/);
  if (req.method === 'POST' && projectHealthRefreshMatch) {
    const projectId=projectHealthRefreshMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshProjectHealth(projectId,await readBody(req))});
    return true;
  }

  const projectClosureReadinessMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/closure-readiness$/);
  if (req.method === 'GET' && projectClosureReadinessMatch) {
    const projectId=projectClosureReadinessMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectClosureReadiness(projectId,{asOf:url.searchParams.get('asOf')||new Date()})});
    return true;
  }

  const projectCompleteMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/complete$/);
  if (req.method === 'POST' && projectCompleteMatch) {
    const projectId=projectCompleteMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,200,{data:await completeProject(projectId,{
      ...body,createdByIdentityId:body.createdByIdentityId||principal?.identityId||null
    })});
    return true;
  }

  const projectArchiveMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/archive$/);
  if (req.method === 'POST' && projectArchiveMatch) {
    const projectId=projectArchiveMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await archiveProject(projectId,await readBody(req))});
    return true;
  }

  const projectIntelligenceMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && projectIntelligenceMatch) {
    const projectId=projectIntelligenceMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectIntelligence(projectId,{
      asOf:url.searchParams.get('asOf')||new Date()
    })});
    return true;
  }

  const projectIntelligenceRefreshMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/intelligence\/refresh$/);
  if (req.method === 'POST' && projectIntelligenceRefreshMatch) {
    const projectId=projectIntelligenceRefreshMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshProjectIntelligence(projectId,await readBody(req))});
    return true;
  }

  const projectCapacityMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/capacity-snapshots$/);
  if (req.method === 'POST' && projectCapacityMatch) {
    const projectId=projectCapacityMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,201,{data:await createCapacitySnapshot({
      ...body,projectId,targetType:'PROJECT',targetId:projectId
    })});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-dimensions') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await createBenchmarkDimension(body)});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-subjects') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createBenchmarkSubject(body)});
    return true;
  }

  const benchmarkSubjectSnapshotMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/snapshots$/);
  if (req.method === 'POST' && benchmarkSubjectSnapshotMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkSubjectSnapshotMatch[1]);
    if(!principal?.platformAdmin){
      if(target.projectId){
        const scope=await resolveProjectScope(target.projectId);
        await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
      }else{
        const scope=await resolveWorkspaceScope(target.workspaceId);
        await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
      }
    }
    json(res,201,{data:await createBenchmarkSnapshot(
      benchmarkSubjectSnapshotMatch[1],await readBody(req)
    )});
    return true;
  }

  const benchmarkObservationMatch=match(url.pathname,/^\/api\/runtime\/benchmark-snapshots\/([^/]+)\/observations$/);
  if (req.method === 'POST' && benchmarkObservationMatch) {
    const target=await resolveBenchmarkSnapshotScope(benchmarkObservationMatch[1]);
    if(!principal?.platformAdmin){
      if(target.projectId){
        const scope=await resolveProjectScope(target.projectId);
        await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
      }else{
        const scope=await resolveWorkspaceScope(target.workspaceId);
        await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
      }
    }
    json(res,201,{data:await addBenchmarkObservation(
      benchmarkObservationMatch[1],await readBody(req)
    )});
    return true;
  }

  const benchmarkCapabilityRunMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/capability-runs$/);
  if (req.method === 'POST' && benchmarkCapabilityRunMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkCapabilityRunMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createCapabilityBenchmarkRun(
      benchmarkCapabilityRunMatch[1],await readBody(req)
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/market-signals') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createMarketSignal(body)});
    return true;
  }

  const benchmarkChangeMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/change-events$/);
  if (req.method === 'POST' && benchmarkChangeMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkChangeMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createCompetitorChangeEvent(
      benchmarkChangeMatch[1],await readBody(req)
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-decision-links') {
    const body=await readBody(req);
    const scope=await resolveProjectScope(body.projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await linkBenchmarkDecision(body)});
    return true;
  }

  const benchmarkSubjectIntelMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && benchmarkSubjectIntelMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkSubjectIntelMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:read':'workspace:read',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await getBenchmarkSubjectIntelligence(
      benchmarkSubjectIntelMatch[1],{asOf:url.searchParams.get('asOf')||new Date()}
    )});
    return true;
  }

  const projectCompetitiveMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/competitive-intelligence$/);
  if (req.method === 'GET' && projectCompetitiveMatch) {
    const projectId=projectCompetitiveMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectCompetitiveIntelligence(
      projectId,{asOf:url.searchParams.get('asOf')||new Date()}
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/approval-requests') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createApprovalRequest({
      ...body,requestedByIdentityId:principal?.platformAdmin
        ? body.requestedByIdentityId||null
        : principal?.identityId||null
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/approval-inbox') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    if(projectId){
      const scope=await resolveProjectScope(projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:read',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await listApprovalInbox({
      workspaceId,projectId,status:url.searchParams.get('status')||'PENDING',
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const approvalDecisionMatch=match(url.pathname,/^\/api\/runtime\/approval-requests\/([^/]+)\/decisions$/);
  if (req.method === 'POST' && approvalDecisionMatch) {
    const target=await resolveApprovalScope(approvalDecisionMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await decideApproval(
      approvalDecisionMatch[1],{
        ...await readBody(req),
        decidedByIdentityId:principal?.platformAdmin?null:principal?.identityId||null,
        adminOverride:Boolean(principal?.platformAdmin)
      }
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/approval-deadlines/refresh') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await refreshApprovalDeadlines(body)});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/notifications') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    const scope=projectId?await resolveProjectScope(projectId):await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:projectId?'project:read':'workspace:read',
      ...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listNotifications({
      workspaceId,projectId,recipientIdentityId:url.searchParams.get('recipientIdentityId')||null,
      status:url.searchParams.get('status')||null,limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const notificationMatch=match(url.pathname,/^\/api\/runtime\/notifications\/([^/]+)$/);
  if (req.method === 'PATCH' && notificationMatch) {
    const target=await resolveNotificationScope(notificationMatch[1]);
    if(!principal?.platformAdmin){
      const ownNotification=target.recipientIdentityId&&target.recipientIdentityId===principal?.identityId;
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:ownNotification?(target.projectId?'project:read':'workspace:read'):(target.projectId?'project:write':'workspace:write'),
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await updateNotification(notificationMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/activity') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    const scope=projectId?await resolveProjectScope(projectId):await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:projectId?'project:read':'workspace:read',
      ...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listActivityEvents({
      workspaceId,projectId,limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const projectVersionsMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/versions$/);
  if (req.method === 'POST' && projectVersionsMatch) {
    const projectId=projectVersionsMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await createProjectVersion(projectId,await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && projectVersionsMatch) {
    const projectId=projectVersionsMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listProjectVersions(projectId)});
    return true;
  }

  const projectVersionMatch=match(url.pathname,/^\/api\/runtime\/project-versions\/([^/]+)$/);
  if (req.method === 'PATCH' && projectVersionMatch) {
    const target=await resolveProjectVersionScope(projectVersionMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectVersion(projectVersionMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/projects') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      const scope=await resolveWorkspaceScope(body.workspaceId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    let workflowTemplateId=body.workflowTemplateId||null;
    if(body.domainPresetKey){
      if(workflowTemplateId) throw Object.assign(
        new Error('Use either domainPresetKey or workflowTemplateId, not both'),
        {code:'PROJECT_WORKFLOW_SELECTION_CONFLICT',statusCode:409}
      );
      workflowTemplateId=await resolveDomainPresetWorkflow({
        presetKey:body.domainPresetKey,projectTypeKey:body.projectType
      });
    }
    const result=await createProject(body);
    const data=workflowTemplateId
      ? {...result,lifecycle:await bindProjectWorkflow(result.id,workflowTemplateId)}
      : result;
    json(res,201,{data});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/runs') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(body.projectId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await createRun(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tasks') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await createTask(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/routes') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await routeAndRecord(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/providers') {
    requirePlatformAdmin(principal);
    const result = await upsertProvider(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/models') {
    requirePlatformAdmin(principal);
    const result = await upsertModel(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/provider-registry') {
    requirePlatformAdmin(principal);
    const result = await listProviderRegistry();
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/pricing-versions') {
    requirePlatformAdmin(principal);
    const result = await createPricingVersion(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/pricing-versions') {
    requirePlatformAdmin(principal);
    const result = await listPricingVersions({
      providerKey:url.searchParams.get('providerKey') || null,
      modelKey:url.searchParams.get('modelKey') || null,
      serviceTier:url.searchParams.get('serviceTier') || null,
    });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/quota-policies') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=body.subjectType==='WORKSPACE'?await resolveWorkspaceScope(body.subjectId):{tenantId:body.subjectId,workspaceId:null}; await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const result = await upsertQuotaPolicy(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/quota-policies') {
    const requestedWorkspace=url.searchParams.get('workspaceId')||null; const requestedTenant=url.searchParams.get('tenantId')||principal?.tenantId||null;
    if(!principal?.platformAdmin){ const scope=requestedWorkspace?await resolveWorkspaceScope(requestedWorkspace):{tenantId:requestedTenant,workspaceId:null}; await assertAccess({principal,permission:'quota:read',...scope,method:req.method,path:url.pathname}); }
    const result = await listQuotaPolicies({
      tenantId:principal?.platformAdmin?(url.searchParams.get('tenantId') || null):principal.tenantId,
      workspaceId:principal?.platformAdmin?(url.searchParams.get('workspaceId') || null):(principal.workspaceId || requestedWorkspace),
      enabledOnly:url.searchParams.get('enabledOnly') === 'true',
    });
    json(res, 200, { data: result });
    return true;
  }

  const workspaceMeterMatch = match(url.pathname, /^\/api\/runtime\/workspaces\/([^/]+)\/usage-meter$/);
  if (req.method === 'GET' && workspaceMeterMatch) {
    const meterScope=await resolveWorkspaceScope(workspaceMeterMatch[1]);
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'usage:read',...meterScope,method:req.method,path:url.pathname});
    const result = await getUsageMeter({
      workspaceId:workspaceMeterMatch[1],
      periodType:url.searchParams.get('periodType') || 'MONTH',
      at:url.searchParams.get('at') || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  const tenantMeterMatch = match(url.pathname, /^\/api\/runtime\/tenants\/([^/]+)\/usage-meter$/);
  if (req.method === 'GET' && tenantMeterMatch) {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'usage:read',tenantId:tenantMeterMatch[1],method:req.method,path:url.pathname});
    const result = await getUsageMeter({
      tenantId:tenantMeterMatch[1],
      periodType:url.searchParams.get('periodType') || 'MONTH',
      at:url.searchParams.get('at') || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  const runQuotaMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/quota-evaluate$/);
  if (req.method === 'POST' && runQuotaMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(runQuotaMatch[1]); await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const body = await readBody(req);
    const result = await evaluateRunQuota({
      runId:runQuotaMatch[1],
      persist:body.persist !== false,
      source:body.source || 'RUNTIME_API',
      at:body.at || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/budget-policies') {
    requirePlatformAdmin(principal);
    const result = await upsertProjectBudgetPolicy(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const providerHealthMatch = match(url.pathname, /^\/api\/runtime\/providers\/([^/]+)\/health$/);
  if (req.method === 'PATCH' && providerHealthMatch) {
    requirePlatformAdmin(principal);
    const result = await setProviderHealth(providerHealthMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tool-executions') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordToolExecution(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/gate-results') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordGateResult(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/qa-evidence') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordQaEvidence(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/context-packets') {
    requirePlatformAdmin(principal);
    const result = createEphemeralContextPacket(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const contextMetadataMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/metadata$/);
  if (req.method === 'GET' && contextMetadataMatch) {
    requirePlatformAdmin(principal);
    const result = getEphemeralContextPacketMetadata(contextMetadataMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const contextExecuteMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/execute$/);
  if (req.method === 'POST' && contextExecuteMatch) {
    requirePlatformAdmin(principal);
    const body = await readBody(req);
    const packet = consumeEphemeralContextPacket(contextExecuteMatch[1]);
    const result = await executeScriptContinuityAgent({
      ...body,
      query: body.query || packet.query,
      scope: body.scope || packet.scope,
      contextPacket: {
        precedence: packet.precedence,
        items: packet.items,
      },
    });
    json(res, 200, {
      data: {
        ...result,
        contextPacketId: packet.id,
        contextPacketConsumed: true,
        contextPacketHash: packet.contextHash,
      },
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/agent-executions') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'agent:execute',...scope,method:req.method,path:url.pathname}); }
    const result = await executeScriptContinuityAgent(body);
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/orchestrate') {
    requirePlatformAdmin(principal);
    const result = await orchestrateContextPacket(await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const taskMatch = match(url.pathname, /^\/api\/runtime\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && taskMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveTaskScope(taskMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await updateTask(taskMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const observabilityMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/observability$/);
  if (req.method === 'GET' && observabilityMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(observabilityMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getRunObservability(observabilityMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const runCostMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && runCostMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(runCostMatch[1]); await assertAccess({principal,permission:'usage:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getRunCostSummary(runCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const projectCostMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && projectCostMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(projectCostMatch[1]); await assertAccess({principal,permission:'usage:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getProjectCostSummary(projectCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const budgetEvaluateMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/budget-evaluate$/);
  if (req.method === 'POST' && budgetEvaluateMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(budgetEvaluateMatch[1]); await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const body = await readBody(req);
    const result = await evaluateBudgetPolicy({
      projectId:budgetEvaluateMatch[1],
      runId:body.runId || null,
    });
    json(res, 200, { data: result });
    return true;
  }

  const knowledgeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/knowledge-contexts$/);
  if (req.method === 'POST' && knowledgeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(knowledgeMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await addKnowledgeContexts(knowledgeMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }
  if (req.method === 'GET' && knowledgeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(knowledgeMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const items = await listKnowledgeContexts(knowledgeMatch[1]);
    const fingerprint = await getKnowledgeContextFingerprint(knowledgeMatch[1]);
    json(res, 200, { data: { runId: knowledgeMatch[1], fingerprint, items } });
    return true;
  }

  const checkpointMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints$/);
  if (req.method === 'POST' && checkpointMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(checkpointMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await saveCheckpoint(checkpointMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const latestMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints\/latest$/);
  if (req.method === 'GET' && latestMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(latestMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getLatestCheckpoint(latestMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const resumeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/resume$/);
  if (req.method === 'POST' && resumeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(resumeMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await resumeRun(resumeMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  json(res, 404, { error: 'RUNTIME_ROUTE_NOT_FOUND' });
  return true;
};
));
    if(req.method==='POST'&&m){
      const projectId=m[1];
      const scope=await resolveProductProjectScope(projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
      json(res,201,{data:await handler(projectId,await readBody(req),principal?.identityId||null)});
      return true;
    }
  }

  const productGateMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/product-gates\/([^/]+)\/evaluate$/);
  if (req.method === 'POST' && productGateMatch) {
    const projectId=productGateMatch[1],gateKey=decodeURIComponent(productGateMatch[2]);
    const scope=await resolveProductProjectScope(projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await evaluateProductGate(
      projectId,gateKey,await readBody(req),principal?.identityId||null
    )});
    return true;
  }

  const productRequirementMatch=match(url.pathname,/^\/api\/runtime\/product-requirements\/([^/]+)$/);
  if (req.method === 'GET' && productRequirementMatch) {
    const target=await resolveProductRequirementScope(productRequirementMatch[1]);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:read',...target,method:req.method,path:url.pathname
    });
    json(res,200,{data:await getProductRequirement(productRequirementMatch[1])});
    return true;
  }

  const productRequirementVersionMatch=match(url.pathname,/^\/api\/runtime\/product-requirements\/([^/]+)\/versions$/);
  if (req.method === 'POST' && productRequirementVersionMatch) {
    const target=await resolveProductRequirementScope(productRequirementVersionMatch[1]);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...target,method:req.method,path:url.pathname
    });
    json(res,201,{data:await reviseProductRequirement(
      productRequirementVersionMatch[1],await readBody(req),principal?.identityId||null
    )});
    return true;
  }

  const milestoneIntelligenceMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && milestoneIntelligenceMatch) {
    const data=await getMilestoneIntelligence(milestoneIntelligenceMatch[1],{
      asOf:url.searchParams.get('asOf')||new Date()
    });
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(data.projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data});
    return true;
  }

  const milestoneRefreshMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/intelligence\/refresh$/);
  if (req.method === 'POST' && milestoneRefreshMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneRefreshMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshMilestoneIntelligence(
      milestoneRefreshMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneOverrideMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/progress-override$/);
  if (req.method === 'POST' && milestoneOverrideMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneOverrideMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await overrideMilestoneProgress(
      milestoneOverrideMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneCapacityMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/capacity-snapshots$/);
  if (req.method === 'POST' && milestoneCapacityMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneCapacityMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,201,{data:await createCapacitySnapshot({
      ...body,projectId:target.projectId,targetType:'MILESTONE',targetId:milestoneCapacityMatch[1]
    })});
    return true;
  }

  const milestoneCompleteMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/complete$/);
  if (req.method === 'POST' && milestoneCompleteMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneCompleteMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await completeMilestone(
      milestoneCompleteMatch[1],await readBody(req)
    )});
    return true;
  }

  const milestoneVersionLinkMatch=match(url.pathname,/^\/api\/runtime\/milestones\/([^/]+)\/version-links$/);
  if (req.method === 'POST' && milestoneVersionLinkMatch) {
    const target=await resolveGovernanceTargetScope('MILESTONE',milestoneVersionLinkMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await linkMilestoneVersion(
      milestoneVersionLinkMatch[1],await readBody(req)
    )});
    return true;
  }

  const projectHealthMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/health$/);
  if (req.method === 'GET' && projectHealthMatch) {
    const projectId=projectHealthMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectHealth(projectId,{asOf:url.searchParams.get('asOf')||new Date()})});
    return true;
  }

  const projectHealthRefreshMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/health\/refresh$/);
  if (req.method === 'POST' && projectHealthRefreshMatch) {
    const projectId=projectHealthRefreshMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshProjectHealth(projectId,await readBody(req))});
    return true;
  }

  const projectClosureReadinessMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/closure-readiness$/);
  if (req.method === 'GET' && projectClosureReadinessMatch) {
    const projectId=projectClosureReadinessMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectClosureReadiness(projectId,{asOf:url.searchParams.get('asOf')||new Date()})});
    return true;
  }

  const projectCompleteMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/complete$/);
  if (req.method === 'POST' && projectCompleteMatch) {
    const projectId=projectCompleteMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,200,{data:await completeProject(projectId,{
      ...body,createdByIdentityId:body.createdByIdentityId||principal?.identityId||null
    })});
    return true;
  }

  const projectArchiveMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/archive$/);
  if (req.method === 'POST' && projectArchiveMatch) {
    const projectId=projectArchiveMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await archiveProject(projectId,await readBody(req))});
    return true;
  }

  const projectIntelligenceMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && projectIntelligenceMatch) {
    const projectId=projectIntelligenceMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectIntelligence(projectId,{
      asOf:url.searchParams.get('asOf')||new Date()
    })});
    return true;
  }

  const projectIntelligenceRefreshMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/intelligence\/refresh$/);
  if (req.method === 'POST' && projectIntelligenceRefreshMatch) {
    const projectId=projectIntelligenceRefreshMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await refreshProjectIntelligence(projectId,await readBody(req))});
    return true;
  }

  const projectCapacityMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/capacity-snapshots$/);
  if (req.method === 'POST' && projectCapacityMatch) {
    const projectId=projectCapacityMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    const body=await readBody(req);
    json(res,201,{data:await createCapacitySnapshot({
      ...body,projectId,targetType:'PROJECT',targetId:projectId
    })});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-dimensions') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await createBenchmarkDimension(body)});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-subjects') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createBenchmarkSubject(body)});
    return true;
  }

  const benchmarkSubjectSnapshotMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/snapshots$/);
  if (req.method === 'POST' && benchmarkSubjectSnapshotMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkSubjectSnapshotMatch[1]);
    if(!principal?.platformAdmin){
      if(target.projectId){
        const scope=await resolveProjectScope(target.projectId);
        await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
      }else{
        const scope=await resolveWorkspaceScope(target.workspaceId);
        await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
      }
    }
    json(res,201,{data:await createBenchmarkSnapshot(
      benchmarkSubjectSnapshotMatch[1],await readBody(req)
    )});
    return true;
  }

  const benchmarkObservationMatch=match(url.pathname,/^\/api\/runtime\/benchmark-snapshots\/([^/]+)\/observations$/);
  if (req.method === 'POST' && benchmarkObservationMatch) {
    const target=await resolveBenchmarkSnapshotScope(benchmarkObservationMatch[1]);
    if(!principal?.platformAdmin){
      if(target.projectId){
        const scope=await resolveProjectScope(target.projectId);
        await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
      }else{
        const scope=await resolveWorkspaceScope(target.workspaceId);
        await assertAccess({principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname});
      }
    }
    json(res,201,{data:await addBenchmarkObservation(
      benchmarkObservationMatch[1],await readBody(req)
    )});
    return true;
  }

  const benchmarkCapabilityRunMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/capability-runs$/);
  if (req.method === 'POST' && benchmarkCapabilityRunMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkCapabilityRunMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createCapabilityBenchmarkRun(
      benchmarkCapabilityRunMatch[1],await readBody(req)
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/market-signals') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createMarketSignal(body)});
    return true;
  }

  const benchmarkChangeMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/change-events$/);
  if (req.method === 'POST' && benchmarkChangeMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkChangeMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createCompetitorChangeEvent(
      benchmarkChangeMatch[1],await readBody(req)
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/benchmark-decision-links') {
    const body=await readBody(req);
    const scope=await resolveProjectScope(body.projectId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'project:write',...scope,method:req.method,path:url.pathname
    });
    json(res,201,{data:await linkBenchmarkDecision(body)});
    return true;
  }

  const benchmarkSubjectIntelMatch=match(url.pathname,/^\/api\/runtime\/benchmark-subjects\/([^/]+)\/intelligence$/);
  if (req.method === 'GET' && benchmarkSubjectIntelMatch) {
    const target=await resolveBenchmarkSubjectScope(benchmarkSubjectIntelMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:read':'workspace:read',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await getBenchmarkSubjectIntelligence(
      benchmarkSubjectIntelMatch[1],{asOf:url.searchParams.get('asOf')||new Date()}
    )});
    return true;
  }

  const projectCompetitiveMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/competitive-intelligence$/);
  if (req.method === 'GET' && projectCompetitiveMatch) {
    const projectId=projectCompetitiveMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await getProjectCompetitiveIntelligence(
      projectId,{asOf:url.searchParams.get('asOf')||new Date()}
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/approval-requests') {
    const body=await readBody(req);
    if(body.projectId){
      const scope=await resolveProjectScope(body.projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:write',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(body.workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,201,{data:await createApprovalRequest({
      ...body,requestedByIdentityId:principal?.platformAdmin
        ? body.requestedByIdentityId||null
        : principal?.identityId||null
    })});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/approval-inbox') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    if(projectId){
      const scope=await resolveProjectScope(projectId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'project:read',...scope,method:req.method,path:url.pathname
      });
    }else{
      const scope=await resolveWorkspaceScope(workspaceId);
      if(!principal?.platformAdmin) await assertAccess({
        principal,permission:'workspace:read',...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await listApprovalInbox({
      workspaceId,projectId,status:url.searchParams.get('status')||'PENDING',
      limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const approvalDecisionMatch=match(url.pathname,/^\/api\/runtime\/approval-requests\/([^/]+)\/decisions$/);
  if (req.method === 'POST' && approvalDecisionMatch) {
    const target=await resolveApprovalScope(approvalDecisionMatch[1]);
    if(!principal?.platformAdmin){
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:target.projectId?'project:write':'workspace:write',
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await decideApproval(
      approvalDecisionMatch[1],{
        ...await readBody(req),
        decidedByIdentityId:principal?.platformAdmin?null:principal?.identityId||null,
        adminOverride:Boolean(principal?.platformAdmin)
      }
    )});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/approval-deadlines/refresh') {
    const body=await readBody(req);
    const scope=await resolveWorkspaceScope(body.workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:'workspace:write',...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await refreshApprovalDeadlines(body)});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/notifications') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    const scope=projectId?await resolveProjectScope(projectId):await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:projectId?'project:read':'workspace:read',
      ...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listNotifications({
      workspaceId,projectId,recipientIdentityId:url.searchParams.get('recipientIdentityId')||null,
      status:url.searchParams.get('status')||null,limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const notificationMatch=match(url.pathname,/^\/api\/runtime\/notifications\/([^/]+)$/);
  if (req.method === 'PATCH' && notificationMatch) {
    const target=await resolveNotificationScope(notificationMatch[1]);
    if(!principal?.platformAdmin){
      const ownNotification=target.recipientIdentityId&&target.recipientIdentityId===principal?.identityId;
      const scope=target.projectId
        ? await resolveProjectScope(target.projectId)
        : await resolveWorkspaceScope(target.workspaceId);
      await assertAccess({
        principal,permission:ownNotification?(target.projectId?'project:read':'workspace:read'):(target.projectId?'project:write':'workspace:write'),
        ...scope,method:req.method,path:url.pathname
      });
    }
    json(res,200,{data:await updateNotification(notificationMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/activity') {
    const workspaceId=url.searchParams.get('workspaceId');
    const projectId=url.searchParams.get('projectId')||null;
    const scope=projectId?await resolveProjectScope(projectId):await resolveWorkspaceScope(workspaceId);
    if(!principal?.platformAdmin) await assertAccess({
      principal,permission:projectId?'project:read':'workspace:read',
      ...scope,method:req.method,path:url.pathname
    });
    json(res,200,{data:await listActivityEvents({
      workspaceId,projectId,limit:url.searchParams.get('limit')||100
    })});
    return true;
  }

  const projectVersionsMatch=match(url.pathname,/^\/api\/runtime\/projects\/([^/]+)\/versions$/);
  if (req.method === 'POST' && projectVersionsMatch) {
    const projectId=projectVersionsMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,201,{data:await createProjectVersion(projectId,await readBody(req))});
    return true;
  }

  if (req.method === 'GET' && projectVersionsMatch) {
    const projectId=projectVersionsMatch[1];
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(projectId);
      await assertAccess({principal,permission:'project:read',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await listProjectVersions(projectId)});
    return true;
  }

  const projectVersionMatch=match(url.pathname,/^\/api\/runtime\/project-versions\/([^/]+)$/);
  if (req.method === 'PATCH' && projectVersionMatch) {
    const target=await resolveProjectVersionScope(projectVersionMatch[1]);
    if(!principal?.platformAdmin){
      const scope=await resolveProjectScope(target.projectId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    json(res,200,{data:await updateProjectVersion(projectVersionMatch[1],await readBody(req))});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/projects') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){
      const scope=await resolveWorkspaceScope(body.workspaceId);
      await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname});
    }
    let workflowTemplateId=body.workflowTemplateId||null;
    if(body.domainPresetKey){
      if(workflowTemplateId) throw Object.assign(
        new Error('Use either domainPresetKey or workflowTemplateId, not both'),
        {code:'PROJECT_WORKFLOW_SELECTION_CONFLICT',statusCode:409}
      );
      workflowTemplateId=await resolveDomainPresetWorkflow({
        presetKey:body.domainPresetKey,projectTypeKey:body.projectType
      });
    }
    const result=await createProject(body);
    const data=workflowTemplateId
      ? {...result,lifecycle:await bindProjectWorkflow(result.id,workflowTemplateId)}
      : result;
    json(res,201,{data});
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/runs') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(body.projectId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await createRun(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tasks') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await createTask(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/routes') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await routeAndRecord(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/providers') {
    requirePlatformAdmin(principal);
    const result = await upsertProvider(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/models') {
    requirePlatformAdmin(principal);
    const result = await upsertModel(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/provider-registry') {
    requirePlatformAdmin(principal);
    const result = await listProviderRegistry();
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/pricing-versions') {
    requirePlatformAdmin(principal);
    const result = await createPricingVersion(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/pricing-versions') {
    requirePlatformAdmin(principal);
    const result = await listPricingVersions({
      providerKey:url.searchParams.get('providerKey') || null,
      modelKey:url.searchParams.get('modelKey') || null,
      serviceTier:url.searchParams.get('serviceTier') || null,
    });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/quota-policies') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=body.subjectType==='WORKSPACE'?await resolveWorkspaceScope(body.subjectId):{tenantId:body.subjectId,workspaceId:null}; await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const result = await upsertQuotaPolicy(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/quota-policies') {
    const requestedWorkspace=url.searchParams.get('workspaceId')||null; const requestedTenant=url.searchParams.get('tenantId')||principal?.tenantId||null;
    if(!principal?.platformAdmin){ const scope=requestedWorkspace?await resolveWorkspaceScope(requestedWorkspace):{tenantId:requestedTenant,workspaceId:null}; await assertAccess({principal,permission:'quota:read',...scope,method:req.method,path:url.pathname}); }
    const result = await listQuotaPolicies({
      tenantId:principal?.platformAdmin?(url.searchParams.get('tenantId') || null):principal.tenantId,
      workspaceId:principal?.platformAdmin?(url.searchParams.get('workspaceId') || null):(principal.workspaceId || requestedWorkspace),
      enabledOnly:url.searchParams.get('enabledOnly') === 'true',
    });
    json(res, 200, { data: result });
    return true;
  }

  const workspaceMeterMatch = match(url.pathname, /^\/api\/runtime\/workspaces\/([^/]+)\/usage-meter$/);
  if (req.method === 'GET' && workspaceMeterMatch) {
    const meterScope=await resolveWorkspaceScope(workspaceMeterMatch[1]);
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'usage:read',...meterScope,method:req.method,path:url.pathname});
    const result = await getUsageMeter({
      workspaceId:workspaceMeterMatch[1],
      periodType:url.searchParams.get('periodType') || 'MONTH',
      at:url.searchParams.get('at') || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  const tenantMeterMatch = match(url.pathname, /^\/api\/runtime\/tenants\/([^/]+)\/usage-meter$/);
  if (req.method === 'GET' && tenantMeterMatch) {
    if(!principal?.platformAdmin) await assertAccess({principal,permission:'usage:read',tenantId:tenantMeterMatch[1],method:req.method,path:url.pathname});
    const result = await getUsageMeter({
      tenantId:tenantMeterMatch[1],
      periodType:url.searchParams.get('periodType') || 'MONTH',
      at:url.searchParams.get('at') || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  const runQuotaMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/quota-evaluate$/);
  if (req.method === 'POST' && runQuotaMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(runQuotaMatch[1]); await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const body = await readBody(req);
    const result = await evaluateRunQuota({
      runId:runQuotaMatch[1],
      persist:body.persist !== false,
      source:body.source || 'RUNTIME_API',
      at:body.at || new Date(),
    });
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/budget-policies') {
    requirePlatformAdmin(principal);
    const result = await upsertProjectBudgetPolicy(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const providerHealthMatch = match(url.pathname, /^\/api\/runtime\/providers\/([^/]+)\/health$/);
  if (req.method === 'PATCH' && providerHealthMatch) {
    requirePlatformAdmin(principal);
    const result = await setProviderHealth(providerHealthMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/tool-executions') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordToolExecution(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/gate-results') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordGateResult(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/qa-evidence') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await recordQaEvidence(body);
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/context-packets') {
    requirePlatformAdmin(principal);
    const result = createEphemeralContextPacket(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const contextMetadataMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/metadata$/);
  if (req.method === 'GET' && contextMetadataMatch) {
    requirePlatformAdmin(principal);
    const result = getEphemeralContextPacketMetadata(contextMetadataMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const contextExecuteMatch = match(url.pathname, /^\/api\/runtime\/context-packets\/([^/]+)\/execute$/);
  if (req.method === 'POST' && contextExecuteMatch) {
    requirePlatformAdmin(principal);
    const body = await readBody(req);
    const packet = consumeEphemeralContextPacket(contextExecuteMatch[1]);
    const result = await executeScriptContinuityAgent({
      ...body,
      query: body.query || packet.query,
      scope: body.scope || packet.scope,
      contextPacket: {
        precedence: packet.precedence,
        items: packet.items,
      },
    });
    json(res, 200, {
      data: {
        ...result,
        contextPacketId: packet.id,
        contextPacketConsumed: true,
        contextPacketHash: packet.contextHash,
      },
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/agent-executions') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(body.runId); await assertAccess({principal,permission:'agent:execute',...scope,method:req.method,path:url.pathname}); }
    const result = await executeScriptContinuityAgent(body);
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/orchestrate') {
    requirePlatformAdmin(principal);
    const result = await orchestrateContextPacket(await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const taskMatch = match(url.pathname, /^\/api\/runtime\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && taskMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveTaskScope(taskMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await updateTask(taskMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  const observabilityMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/observability$/);
  if (req.method === 'GET' && observabilityMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(observabilityMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getRunObservability(observabilityMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const runCostMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && runCostMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(runCostMatch[1]); await assertAccess({principal,permission:'usage:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getRunCostSummary(runCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const projectCostMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/cost-summary$/);
  if (req.method === 'GET' && projectCostMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(projectCostMatch[1]); await assertAccess({principal,permission:'usage:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getProjectCostSummary(projectCostMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const budgetEvaluateMatch = match(url.pathname, /^\/api\/runtime\/projects\/([^/]+)\/budget-evaluate$/);
  if (req.method === 'POST' && budgetEvaluateMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveProjectScope(budgetEvaluateMatch[1]); await assertAccess({principal,permission:'quota:write',...scope,method:req.method,path:url.pathname}); }
    const body = await readBody(req);
    const result = await evaluateBudgetPolicy({
      projectId:budgetEvaluateMatch[1],
      runId:body.runId || null,
    });
    json(res, 200, { data: result });
    return true;
  }

  const knowledgeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/knowledge-contexts$/);
  if (req.method === 'POST' && knowledgeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(knowledgeMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await addKnowledgeContexts(knowledgeMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }
  if (req.method === 'GET' && knowledgeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(knowledgeMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const items = await listKnowledgeContexts(knowledgeMatch[1]);
    const fingerprint = await getKnowledgeContextFingerprint(knowledgeMatch[1]);
    json(res, 200, { data: { runId: knowledgeMatch[1], fingerprint, items } });
    return true;
  }

  const checkpointMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints$/);
  if (req.method === 'POST' && checkpointMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(checkpointMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await saveCheckpoint(checkpointMatch[1], await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const latestMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/checkpoints\/latest$/);
  if (req.method === 'GET' && latestMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(latestMatch[1]); await assertAccess({principal,permission:'run:read',...scope,method:req.method,path:url.pathname}); }
    const result = await getLatestCheckpoint(latestMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  const resumeMatch = match(url.pathname, /^\/api\/runtime\/runs\/([^/]+)\/resume$/);
  if (req.method === 'POST' && resumeMatch) {
    if(!principal?.platformAdmin){ const scope=await resolveRunScope(resumeMatch[1]); await assertAccess({principal,permission:'run:write',...scope,method:req.method,path:url.pathname}); }
    const result = await resumeRun(resumeMatch[1], await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  json(res, 404, { error: 'RUNTIME_ROUTE_NOT_FOUND' });
  return true;
};
