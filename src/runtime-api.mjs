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
import { compareEvalRuns,getEvalRegressionComparison,getEvalReleaseGate } from './eval-regression.mjs';
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
      runtimeCommitSha:resolveEvalRuntimeSha()
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

  const evalReleaseGateMatch=match(url.pathname,/^\/api\/runtime\/eval-release-gates\/([^/]+)$/);
  if (req.method === 'GET' && evalReleaseGateMatch) {
    requirePlatformAdmin(principal);
    json(res,200,{data:await getEvalReleaseGate(evalReleaseGateMatch[1])});
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

  if (req.method === 'POST' && url.pathname === '/api/runtime/projects') {
    const body=await readBody(req);
    if(!principal?.platformAdmin){ const scope=await resolveWorkspaceScope(body.workspaceId); await assertAccess({principal,permission:'project:write',...scope,method:req.method,path:url.pathname}); }
    const result = await createProject(body);
    json(res, 201, { data: result });
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
