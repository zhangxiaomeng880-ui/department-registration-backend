import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4200';
const platformToken=process.env.RUNTIME_API_TOKEN||'m234-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const planKey=`FIN_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'M23.4 Financial Adjustments Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:12,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-07-01T00:00:00.000Z',sourceLabel:'M23_4_GATE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`fin-tenant-${suffix}`,name:'M23.4 Finance Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/subscriptions',{
  tenantId,planKey,billingTermId:termId,startedAt:'2026-08-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const cycleId=r.body.data.currentCycle.id;

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-09-02T00:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
const invoiceId=r.body.data.id;
assert.equal(r.body.data.totalDue,12);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/collection-case`,{
  openedAt:'2026-09-20T00:00:00.000Z',priority:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const caseId=r.body.data.id;

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:5,currency:'USD',idempotencyKey:`fin-pay-1-${suffix}`,
  receivedAt:'2026-09-20T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const payment1Id=r.body.data.payment.id;

const creditKey=`credit-${suffix}`;
r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'CREDIT_NOTE',amount:2,currency:'USD',reasonCode:'SERVICE_CREDIT',
  idempotencyKey:creditKey,effectiveAt:'2026-09-21T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.position.adjustedBilledRevenue,10);
assert.equal(r.body.data.position.outstandingAmount,5);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'CREDIT_NOTE',amount:2,currency:'USD',reasonCode:'SERVICE_CREDIT',
  idempotencyKey:creditKey,effectiveAt:'2026-09-21T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'CREDIT_NOTE',amount:3,reasonCode:'CONFLICT',idempotencyKey:creditKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'ADJUSTMENT_IDEMPOTENCY_CONFLICT');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'WRITE_OFF',amount:1,currency:'USD',reasonCode:'BAD_DEBT_PARTIAL',
  idempotencyKey:`writeoff-${suffix}`,effectiveAt:'2026-09-22T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.position.writeOffs,1);
assert.equal(r.body.data.position.outstandingAmount,4);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'DEBIT_ADJUSTMENT',amount:3,currency:'USD',reasonCode:'MANUAL_CORRECTION',
  idempotencyKey:`debit-${suffix}`,effectiveAt:'2026-09-23T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.position.adjustedBilledRevenue,13);
assert.equal(r.body.data.position.collectibleAmount,12);
assert.equal(r.body.data.position.outstandingAmount,7);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:7,currency:'USD',idempotencyKey:`fin-pay-2-${suffix}`,
  receivedAt:'2026-09-23T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const payment2Id=r.body.data.payment.id;
assert.equal(r.body.data.invoice.status,'SETTLED');
assert.equal(r.body.data.financialPosition.outstandingAmount,0);

r=await request('GET',`/api/runtime/collection-cases/${caseId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RESOLVED');
assert.equal(r.body.data.resolutionCode,'PAID');

r=await request('POST',`/api/runtime/payments/${payment2Id}/refunds`,{
  amount:2,idempotencyKey:`refund-${suffix}`,refundReference:`RF-${suffix}`,
  refundedAt:'2026-09-24T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.position.refundTotal,2);
assert.equal(r.body.data.position.netCollected,10);
assert.equal(r.body.data.position.outstandingAmount,2);

r=await request('GET',`/api/runtime/collection-cases/${caseId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'OPEN');
assert.equal(r.body.data.actions.at(-1).actionType,'AUTO_REOPEN_FINANCIAL');

r=await request('POST',`/api/runtime/payments/${payment2Id}/refunds`,{
  amount:6,idempotencyKey:`refund-too-high-${suffix}`,refundedAt:'2026-09-24T01:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'REFUND_EXCEEDS_PAYMENT');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/disputes`,{
  disputedAmount:2,currency:'USD',reasonCode:'BILLING_ACCURACY',
  idempotencyKey:`dispute-open-${suffix}`,openedAt:'2026-09-25T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const disputeId=r.body.data.id;
assert.equal(r.body.data.status,'OPEN');

r=await request('POST',`/api/runtime/billing-disputes/${disputeId}/actions`,{
  actionType:'UNDER_REVIEW',idempotencyKey:`dispute-review-${suffix}`,
  occurredAt:'2026-09-25T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.dispute.status,'UNDER_REVIEW');

r=await request('POST',`/api/runtime/billing-disputes/${disputeId}/actions`,{
  actionType:'ACCEPT',acceptedAmount:1.5,idempotencyKey:`dispute-accept-${suffix}`,
  resolutionNote:'Validated billing issue',occurredAt:'2026-09-26T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.dispute.status,'RESOLVED_ACCEPTED');
assert.equal(r.body.data.dispute.acceptedAmount,1.5);

r=await request('GET',`/api/runtime/billing-disputes/${disputeId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.actions.length,3);
assert.deepEqual(r.body.data.actions.map(x=>x.actionType),['OPEN','UNDER_REVIEW','ACCEPT']);

r=await request('GET',`/api/runtime/invoices/${invoiceId}/financial-position?asOf=2026-09-27T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
const pos=r.body.data;
assert.equal(pos.originalTotalDue,12);
assert.equal(pos.creditNotes,3.5);
assert.equal(pos.writeOffs,1);
assert.equal(pos.debitAdjustments,3);
assert.equal(pos.adjustedBilledRevenue,11.5);
assert.equal(pos.collectibleAmount,10.5);
assert.equal(pos.grossPaid,12);
assert.equal(pos.refundTotal,2);
assert.equal(pos.netCollected,10);
assert.equal(pos.outstandingAmount,0.5);

r=await request('GET',`/api/runtime/billing-ops/analytics?tenantId=${tenantId}&asOf=2026-09-27T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
const usd=r.body.data.currencies[0];
assert.equal(usd.originalBilled,12);
assert.equal(usd.creditNotes,3.5);
assert.equal(usd.writeOffs,1);
assert.equal(usd.debitAdjustments,3);
assert.equal(usd.adjustedBilledRevenue,11.5);
assert.equal(usd.collectibleAmount,10.5);
assert.equal(usd.grossPaid,12);
assert.equal(usd.refunds,2);
assert.equal(usd.netCollected,10);
assert.equal(usd.totalBilled,11.5);
assert.equal(usd.amountPaid,10);
assert.equal(usd.outstanding,0.5);
assert.equal(usd.collectionRatePct,86.9565);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:0.5,currency:'USD',idempotencyKey:`fin-pay-3-${suffix}`,
  receivedAt:'2026-09-27T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.status,'SETTLED');
assert.equal(r.body.data.financialPosition.outstandingAmount,0);

r=await request('GET',`/api/runtime/invoices/${invoiceId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.amountPaid,12.5);
assert.equal(r.body.data.grossPaid,12.5);
assert.equal(r.body.data.refundTotal,2);
assert.equal(r.body.data.netCollected,10.5);
assert.equal(r.body.data.adjustedBilledRevenue,11.5);
assert.equal(r.body.data.collectibleAmount,10.5);
assert.equal(r.body.data.outstandingAmount,0);

r=await request('GET',`/api/runtime/invoices/${invoiceId}/adjustments`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,4);
assert.equal(r.body.data.filter(x=>x.adjustmentType==='CREDIT_NOTE').length,2);

r=await request('GET',`/api/runtime/invoices/${invoiceId}/refunds`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].paymentId,payment2Id);

r=await request('POST','/api/runtime/identities',{
  identityKey:`fin-owner-${suffix}`,displayName:'M23.4 Finance Reader'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'M23.4 Billing Read Key',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/invoices/${invoiceId}/financial-position`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.outstandingAmount,0);

r=await request('GET',`/api/runtime/billing-disputes?tenantId=${tenantId}&status=ALL`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'DEBIT_ADJUSTMENT',amount:1,reasonCode:'NOPE',idempotencyKey:`owner-adjust-${suffix}`
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`fin-other-${suffix}`,name:'M23.4 Other Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherTenantId=r.body.data.id;

r=await request('GET',`/api/runtime/billing-disputes?tenantId=${otherTenantId}&status=ALL`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

const noAuth=await request('GET',`/api/runtime/invoices/${invoiceId}/financial-position`,undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[adjustmentCount]]=await db.execute('SELECT COUNT(*) AS count FROM invoice_adjustments WHERE invoice_id=?',[invoiceId]);
assert.equal(Number(adjustmentCount.count),4);
const [[refundCount]]=await db.execute('SELECT COUNT(*) AS count FROM payment_refunds WHERE invoice_id=?',[invoiceId]);
assert.equal(Number(refundCount.count),1);
const [[disputeActionCount]]=await db.execute('SELECT COUNT(*) AS count FROM billing_dispute_actions WHERE dispute_id=?',[disputeId]);
assert.equal(Number(disputeActionCount.count),3);
await db.end();

console.log('G23_4_FINANCIAL_ADJUSTMENTS_PASS');
