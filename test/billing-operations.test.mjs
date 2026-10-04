import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3900';
const platformToken=process.env.RUNTIME_API_TOKEN||'m231-platform-token';

const request=async(method,path,body,token=platformToken)=>{
  const headers={'content-type':'application/json'};
  if(token) headers.authorization=`Bearer ${token}`;
  const response=await fetch(baseUrl+path,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};

const suffix=randomUUID().slice(0,8);
const planKey=`OPS_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'M23.1 Billing Ops Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:12,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-07-01T00:00:00.000Z',sourceLabel:'M23_1_GATE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`ops-tenant-${suffix}`,name:'M23.1 Ops Tenant',planKey
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
assert.equal(r.body.data.amountPaid,0);
assert.equal(r.body.data.outstandingAmount,12);
assert.equal(r.body.data.status,'FINALIZED');

r=await request('GET',`/api/runtime/billing-ops/summary?tenantId=${tenantId}&asOf=2026-09-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.currencies.length,1);
let summary=r.body.data.currencies[0];
assert.equal(summary.currency,'USD');
assert.equal(summary.invoiceCount,1);
assert.equal(summary.openInvoiceCount,1);
assert.equal(summary.paidInvoiceCount,0);
assert.equal(summary.overdueInvoiceCount,1);
assert.equal(summary.totalBilled,12);
assert.equal(summary.amountPaid,0);
assert.equal(summary.outstanding,12);
assert.equal(summary.overdueOutstanding,12);

r=await request('GET',`/api/runtime/billing-ops/receivables?tenantId=${tenantId}&status=OVERDUE&asOf=2026-09-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,invoiceId);
assert.equal(r.body.data[0].overdue,true);

const partialKey=`ops-payment-partial-${suffix}`;
r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:5,currency:'USD',idempotencyKey:partialKey,
  paymentReference:`BANK-${suffix}-1`,receivedAt:'2026-09-15T12:00:00.000Z',
  metadata:{channel:'MANUAL_BANK_TRANSFER'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.payment.amount,5);
assert.equal(r.body.data.invoice.amountPaid,5);
assert.equal(r.body.data.invoice.outstandingAmount,7);
assert.equal(r.body.data.invoice.status,'PARTIALLY_PAID');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:5,currency:'USD',idempotencyKey:partialKey,
  paymentReference:`BANK-${suffix}-1`,receivedAt:'2026-09-15T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.invoice.amountPaid,5);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:4,currency:'USD',idempotencyKey:partialKey
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PAYMENT_IDEMPOTENCY_CONFLICT');

r=await request('GET',`/api/runtime/invoices/${invoiceId}/payments`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].amount,5);

r=await request('GET',`/api/runtime/invoices/${invoiceId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.amountPaid,5);
assert.equal(r.body.data.outstandingAmount,7);
assert.equal(r.body.data.status,'PARTIALLY_PAID');

r=await request('GET',`/api/runtime/billing-ops/summary?tenantId=${tenantId}&asOf=2026-09-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
summary=r.body.data.currencies[0];
assert.equal(summary.amountPaid,5);
assert.equal(summary.outstanding,7);
assert.equal(summary.overdueOutstanding,7);
assert.equal(summary.overdueInvoiceCount,1);

r=await request('POST','/api/runtime/identities',{
  identityKey:`ops-owner-${suffix}`,displayName:'M23.1 Billing Owner'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'M23.1 Billing Read Key',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/billing-ops/summary?tenantId=${tenantId}&asOf=2026-09-20T00:00:00.000Z`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.currencies[0].outstanding,7);

r=await request('GET',`/api/runtime/invoices/${invoiceId}/payments`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:1,idempotencyKey:`owner-payment-${suffix}`
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`ops-other-${suffix}`,name:'M23.1 Other Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherTenantId=r.body.data.id;

r=await request('GET',`/api/runtime/billing-ops/summary?tenantId=${otherTenantId}`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:7,currency:'USD',idempotencyKey:`ops-payment-final-${suffix}`,
  paymentReference:`BANK-${suffix}-2`,receivedAt:'2026-09-21T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.amountPaid,12);
assert.equal(r.body.data.invoice.outstandingAmount,0);
assert.equal(r.body.data.invoice.status,'PAID');
assert.ok(r.body.data.invoice.paidAt);

r=await request('GET',`/api/runtime/billing-ops/summary?tenantId=${tenantId}&asOf=2026-09-22T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
summary=r.body.data.currencies[0];
assert.equal(summary.openInvoiceCount,0);
assert.equal(summary.paidInvoiceCount,1);
assert.equal(summary.overdueInvoiceCount,0);
assert.equal(summary.amountPaid,12);
assert.equal(summary.outstanding,0);
assert.equal(summary.overdueOutstanding,0);

r=await request('GET',`/api/runtime/billing-ops/receivables?tenantId=${tenantId}&status=OVERDUE&asOf=2026-09-22T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,0);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:1,idempotencyKey:`ops-overpay-${suffix}`
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'INVOICE_ALREADY_PAID');

const noAuth=await request('GET','/api/runtime/billing-ops/summary',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[paymentCount]]=await db.execute('SELECT COUNT(*) AS count FROM invoice_payments WHERE invoice_id=?',[invoiceId]);
assert.equal(Number(paymentCount.count),2);
const [[invoiceRow]]=await db.execute('SELECT amount_paid,status,paid_at FROM invoices WHERE id=?',[invoiceId]);
assert.equal(Number(invoiceRow.amount_paid),12);
assert.equal(invoiceRow.status,'PAID');
assert.ok(invoiceRow.paid_at);
await db.end();

console.log('G23_1_BILLING_OPERATIONS_PASS');
