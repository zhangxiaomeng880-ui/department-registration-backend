import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4300';
const platformToken=process.env.RUNTIME_API_TOKEN||'m235-platform-token';
const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const sha256=text=>createHash('sha256').update(text).digest('hex');

const suffix=randomUUID().slice(0,8);
const planKey=`CLOSE_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'M23.5 Finance Close Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:20,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-04-01T00:00:00.000Z',sourceLabel:'M23_5_GATE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`close-tenant-${suffix}`,name:'M23.5 Close Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/subscriptions',{
  tenantId,planKey,billingTermId:termId,startedAt:'2026-05-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const cycleId=r.body.data.currentCycle.id;

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-06-02T00:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
const invoiceId=r.body.data.id;
assert.equal(r.body.data.totalDue,20);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:8,currency:'USD',idempotencyKey:`close-pay-${suffix}`,
  receivedAt:'2026-06-03T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const paymentId=r.body.data.payment.id;

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'CREDIT_NOTE',amount:2,currency:'USD',reasonCode:'CLOSE_TEST_CREDIT',
  idempotencyKey:`close-credit-${suffix}`,effectiveAt:'2026-06-04T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'DEBIT_ADJUSTMENT',amount:1,currency:'USD',reasonCode:'CLOSE_TEST_DEBIT',
  idempotencyKey:`close-debit-${suffix}`,effectiveAt:'2026-06-05T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'WRITE_OFF',amount:3,currency:'USD',reasonCode:'CLOSE_TEST_WRITEOFF',
  idempotencyKey:`close-writeoff-${suffix}`,effectiveAt:'2026-06-06T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/payments/${paymentId}/refunds`,{
  amount:1,idempotencyKey:`close-refund-${suffix}`,refundReference:`CLOSE-RF-${suffix}`,
  refundedAt:'2026-06-07T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/disputes`,{
  disputedAmount:4,currency:'USD',reasonCode:'CLOSE_TEST_DISPUTE',
  idempotencyKey:`close-dispute-${suffix}`,openedAt:'2026-06-08T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const disputeId=r.body.data.id;

const closeKey=`finance-close-${suffix}`;
r=await request('POST','/api/runtime/finance-closes',{
  periodStart:'2026-06-01T00:00:00.000Z',periodEnd:'2026-07-01T00:00:00.000Z',
  idempotencyKey:closeKey,sourceLabel:'M23_5_GATE',metadata:{scope:'GLOBAL_LEDGER'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.status,'CLOSED');
assert.ok(/^[a-f0-9]{64}$/.test(r.body.data.snapshotSha256));
const closeId=r.body.data.id;
const usd=r.body.data.currencies.find(x=>x.currency==='USD');
assert.ok(usd,JSON.stringify(r.body));
assert.equal(usd.invoiceCount,1);
assert.equal(usd.originalBilled,20);
assert.equal(usd.creditNotes,2);
assert.equal(usd.debitAdjustments,1);
assert.equal(usd.adjustedBilledRevenue,19);
assert.equal(usd.writeOffs,3);
assert.equal(usd.grossCashCollected,8);
assert.equal(usd.refunds,1);
assert.equal(usd.netCashCollected,7);
assert.equal(usd.providerCost,0);
assert.equal(usd.grossMargin,19);
assert.equal(usd.reconciliationDelta,0);
assert.equal(Number((usd.endingAr-usd.openingAr+usd.endingOverpayment-usd.openingOverpayment).toFixed(10)),9);
assert.equal(r.body.data.exports.length,2);

r=await request('POST','/api/runtime/finance-closes',{
  periodStart:'2026-06-01T00:00:00.000Z',periodEnd:'2026-07-01T00:00:00.000Z',
  idempotencyKey:closeKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.id,closeId);

r=await request('POST','/api/runtime/finance-closes',{
  periodStart:'2026-06-01T00:00:00.000Z',periodEnd:'2026-06-30T00:00:00.000Z',
  idempotencyKey:closeKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_CLOSE_IDEMPOTENCY_CONFLICT');

r=await request('POST','/api/runtime/finance-closes',{
  periodStart:'2026-08-01T00:00:00.000Z',periodEnd:'2026-09-01T00:00:00.000Z',
  idempotencyKey:`noncontiguous-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_CLOSE_NOT_CONTIGUOUS');

r=await request('GET',`/api/runtime/finance-closes/${closeId}/export?format=JSON`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.format,'JSON');
assert.equal(sha256(r.body.data.content),r.body.data.contentSha256);
assert.equal(r.body.data.rowCount,r.body.data.content.match(/"currency"/g)?.length||0);
assert.ok(r.body.data.content.includes('"adjustedBilledRevenue": 19'));

r=await request('GET',`/api/runtime/finance-closes/${closeId}/export?format=CSV`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.format,'CSV');
assert.equal(sha256(r.body.data.content),r.body.data.contentSha256);
assert.ok(r.body.data.content.startsWith('currency,invoiceCount,openingAr'));
assert.ok(r.body.data.content.includes('USD,1,'));

r=await request('GET','/api/runtime/finance-closes?limit=10');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.id===closeId));

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:1,currency:'USD',idempotencyKey:`closed-pay-${suffix}`,
  receivedAt:'2026-06-20T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_PERIOD_CLOSED');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/adjustments`,{
  adjustmentType:'DEBIT_ADJUSTMENT',amount:1,reasonCode:'BACKDATE',
  idempotencyKey:`closed-adjust-${suffix}`,effectiveAt:'2026-06-20T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_PERIOD_CLOSED');

r=await request('POST',`/api/runtime/payments/${paymentId}/refunds`,{
  amount:1,idempotencyKey:`closed-refund-${suffix}`,refundedAt:'2026-06-20T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_PERIOD_CLOSED');

r=await request('POST',`/api/runtime/billing-disputes/${disputeId}/actions`,{
  actionType:'ACCEPT',acceptedAmount:1,idempotencyKey:`closed-dispute-accept-${suffix}`,
  occurredAt:'2026-06-25T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'FINANCE_PERIOD_CLOSED');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:9,currency:'USD',idempotencyKey:`open-period-pay-${suffix}`,
  receivedAt:'2026-09-30T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.financialPosition.outstandingAmount,0);

r=await request('POST','/api/runtime/identities',{
  identityKey:`close-owner-${suffix}`,displayName:'M23.5 Tenant Reader'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;
r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'M23.5 Read Key',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET','/api/runtime/finance-closes',undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

const noAuth=await request('GET','/api/runtime/finance-closes',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[closeRow]]=await db.execute('SELECT status,currency_count,snapshot_sha256 FROM finance_close_periods WHERE id=?',[closeId]);
assert.equal(closeRow.status,'CLOSED');
assert.ok(Number(closeRow.currency_count)>=1);
assert.ok(/^[a-f0-9]{64}$/.test(closeRow.snapshot_sha256));
const [[snapshotCount]]=await db.execute('SELECT COUNT(*) AS count FROM finance_close_currency_snapshots WHERE close_id=?',[closeId]);
assert.ok(Number(snapshotCount.count)>=1);
const [[exportCount]]=await db.execute('SELECT COUNT(*) AS count FROM finance_close_exports WHERE close_id=?',[closeId]);
assert.equal(Number(exportCount.count),2);
await db.end();

console.log('G23_5_FINANCE_CLOSE_PASS');
