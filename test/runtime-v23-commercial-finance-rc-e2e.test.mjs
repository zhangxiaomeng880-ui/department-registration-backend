import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4500';
const platformToken=process.env.RUNTIME_API_TOKEN||'m236-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const sha256=text=>createHash('sha256').update(text).digest('hex');

const suffix=randomUUID().slice(0,8);
const planKey=`RC23_${suffix}`;

let r=await request('GET','/ready',undefined,null);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.components.runtimeAuth.required,true);

r=await request('POST','/api/runtime/plans',{planKey,name:'V2.3 Finance RC Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'CHF',billingInterval:'MONTHLY',recurringFee:30,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-06-01T00:00:00.000Z',sourceLabel:'M23_6_RC'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingTermId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`rc23-tenant-${suffix}`,name:'V2.3 Finance RC Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/subscriptions',{
  tenantId,planKey,billingTermId,startedAt:'2026-06-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const cycleId=r.body.data.currentCycle.id;

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-07-02T00:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
const invoiceId=r.body.data.id;
assert.equal(r.body.data.currency,'CHF');
assert.equal(r.body.data.totalDue,30);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/collection-case`,{
  openedAt:'2026-07-10T00:00:00.000Z',priority:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const caseId=r.body.data.id;

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'PROMISE_TO_PAY',amount:12,promiseDueAt:'2026-07-15T00:00:00.000Z',
  idempotencyKey:`rc23-promise-${suffix}`,occurredAt:'2026-07-10T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:12,currency:'CHF',idempotencyKey:`rc23-pay-1-${suffix}`,
  receivedAt:'2026-07-14T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const paymentId=r.body.data.payment.id;
assert.equal(r.body.data.financialPosition.outstandingAmount,18);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'CREDIT_NOTE',amount:3,currency:'CHF',reasonCode:'RC_SERVICE_CREDIT',
  idempotencyKey:`rc23-credit-${suffix}`,effectiveAt:'2026-07-16T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.position.adjustedBilledRevenue,27);
assert.equal(r.body.data.position.outstandingAmount,15);

r=await request('POST',`/api/runtime/payments/${paymentId}/refunds`,{
  amount:2,idempotencyKey:`rc23-refund-${suffix}`,refundReference:`RC23-RF-${suffix}`,
  refundedAt:'2026-07-17T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.position.netCollected,10);
assert.equal(r.body.data.position.outstandingAmount,17);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/disputes`,{
  disputedAmount:2,currency:'CHF',reasonCode:'RC_BILLING_DISPUTE',
  idempotencyKey:`rc23-dispute-${suffix}`,openedAt:'2026-07-18T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const disputeId=r.body.data.id;

r=await request('POST',`/api/runtime/billing-disputes/${disputeId}/actions`,{
  actionType:'ACCEPT',acceptedAmount:2,idempotencyKey:`rc23-accept-${suffix}`,
  resolutionNote:'RC accepted',occurredAt:'2026-07-19T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.dispute.status,'RESOLVED_ACCEPTED');

r=await request('GET',`/api/runtime/invoices/${invoiceId}/financial-position?asOf=2026-07-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.originalTotalDue,30);
assert.equal(r.body.data.creditNotes,5);
assert.equal(r.body.data.refundTotal,2);
assert.equal(r.body.data.netCollected,10);
assert.equal(r.body.data.adjustedBilledRevenue,25);
assert.equal(r.body.data.outstandingAmount,15);

r=await request('GET',`/api/runtime/billing-ops/analytics?tenantId=${tenantId}&asOf=2026-07-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
const chfAnalytics=r.body.data.currencies.find(x=>x.currency==='CHF');
assert.ok(chfAnalytics,JSON.stringify(r.body));
assert.equal(chfAnalytics.adjustedBilledRevenue,25);
assert.equal(chfAnalytics.netCollected,10);
assert.equal(chfAnalytics.outstanding,15);
assert.equal(r.body.data.promiseToPay.fulfilledPromises,1);

r=await request('GET',`/api/runtime/billing-ops/revenue-performance?tenantId=${tenantId}&planKey=${planKey}&asOf=2026-07-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
const perf=r.body.data.find(x=>x.currency==='CHF');
assert.ok(perf,JSON.stringify(r.body));
assert.equal(perf.billedRevenue,25);
assert.equal(perf.collectedRevenue,10);
assert.equal(perf.outstandingRevenue,15);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:15,currency:'CHF',idempotencyKey:`rc23-pay-2-${suffix}`,
  receivedAt:'2026-07-25T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.status,'SETTLED');
assert.equal(r.body.data.financialPosition.outstandingAmount,0);

r=await request('GET',`/api/runtime/collection-cases/${caseId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RESOLVED');

r=await request('POST','/api/runtime/finance-closes',{
  periodStart:'2026-07-01T00:00:00.000Z',
  periodEnd:'2026-08-01T00:00:00.000Z',
  idempotencyKey:`rc23-close-${suffix}`,
  sourceLabel:'M23_6_RC'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'CLOSED');
const closeId=r.body.data.id;
const closeChf=r.body.data.currencies.find(x=>x.currency==='CHF');
assert.ok(closeChf,JSON.stringify(r.body));
assert.equal(closeChf.originalBilled,30);
assert.equal(closeChf.creditNotes,5);
assert.equal(closeChf.adjustedBilledRevenue,25);
assert.equal(closeChf.grossCashCollected,27);
assert.equal(closeChf.refunds,2);
assert.equal(closeChf.netCashCollected,25);
assert.equal(closeChf.endingAr,0);
assert.equal(closeChf.endingOverpayment,0);
assert.equal(closeChf.reconciliationDelta,0);

r=await request('GET',`/api/runtime/finance-closes/${closeId}/export?format=JSON`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(sha256(r.body.data.content),r.body.data.contentSha256);

r=await request('GET',`/api/runtime/finance-closes/${closeId}/export?format=CSV`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(sha256(r.body.data.content),r.body.data.contentSha256);
assert.ok(r.body.data.content.includes('CHF'));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:1,currency:'CHF',idempotencyKey:`rc23-backdate-${suffix}`,
  receivedAt:'2026-07-30T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_PERIOD_CLOSED');

r=await request('POST','/api/runtime/identities',{
  identityKey:`rc23-owner-${suffix}`,displayName:'V2.3 RC Tenant Owner'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'V2.3 RC Billing Reader',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/invoices/${invoiceId}/financial-position`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('GET','/api/runtime/finance-closes',undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

const noAuth=await request('GET','/api/runtime/finance-closes',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

console.log('G23_6_COMMERCIAL_FINANCE_RC_E2E_PASS');
