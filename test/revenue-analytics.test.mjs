import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4100';
const platformToken=process.env.RUNTIME_API_TOKEN||'m233-platform-token';

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
const planKey=`ANL_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'M23.3 Revenue Analytics Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:12,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-07-01T00:00:00.000Z',sourceLabel:'M23_3_GATE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;

const makeInvoice=async(label)=>{
  let x=await request('POST','/api/runtime/tenants',{
    tenantKey:`analytics-${label}-${suffix}`,name:`M23.3 ${label} Tenant`,planKey
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const tenantId=x.body.data.id;

  x=await request('POST','/api/runtime/subscriptions',{
    tenantId,planKey,billingTermId:termId,startedAt:'2026-08-01T00:00:00.000Z'
  });
  assert.equal(x.status,201,JSON.stringify(x.body));
  const cycleId=x.body.data.currentCycle.id;

  x=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
    finalizedAt:'2026-09-02T00:00:00.000Z'
  });
  assert.equal(x.status,200,JSON.stringify(x.body));
  return {tenantId,invoiceId:x.body.data.id};
};

const a=await makeInvoice('A');
const b=await makeInvoice('B');

r=await request('POST',`/api/runtime/invoices/${a.invoiceId}/collection-case`,{
  openedAt:'2026-09-20T00:00:00.000Z',priority:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const caseId=r.body.data.id;

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'PROMISE_TO_PAY',idempotencyKey:`promise-${suffix}`,
  promisedAmount:7,promiseDueAt:'2026-09-25T00:00:00.000Z',
  occurredAt:'2026-09-20T11:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${a.invoiceId}/payments`,{
  amount:5,currency:'USD',idempotencyKey:`a-partial-${suffix}`,
  receivedAt:'2026-09-21T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/invoices/${a.invoiceId}/payments`,{
  amount:7,currency:'USD',idempotencyKey:`a-final-${suffix}`,
  receivedAt:'2026-09-22T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.status,'PAID');

r=await request('GET',`/api/runtime/billing-ops/analytics?tenantId=${a.tenantId}&asOf=2026-09-26T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.currencies.length,1);
let usd=r.body.data.currencies[0];
assert.equal(usd.currency,'USD');
assert.equal(usd.invoiceCount,1);
assert.equal(usd.totalBilled,12);
assert.equal(usd.amountPaid,12);
assert.equal(usd.outstanding,0);
assert.equal(usd.collectionRatePct,100);
assert.equal(r.body.data.promiseToPay.duePromises,1);
assert.equal(r.body.data.promiseToPay.fulfilledPromises,1);
assert.equal(r.body.data.promiseToPay.brokenPromises,0);
assert.equal(r.body.data.promiseToPay.fulfillmentRatePct,100);
assert.equal(r.body.data.promiseToPay.promisedAmountDue,7);
assert.equal(r.body.data.promiseToPay.fulfilledAmount,7);

r=await request('GET',`/api/runtime/billing-ops/analytics?tenantId=${b.tenantId}&asOf=2026-10-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
usd=r.body.data.currencies[0];
assert.equal(usd.totalBilled,12);
assert.equal(usd.amountPaid,0);
assert.equal(usd.outstanding,12);
assert.equal(usd.overdueOutstanding,12);
assert.equal(usd.collectionRatePct,0);
assert.equal(usd.aging.current,0);
assert.equal(usd.aging.days1To30,0);
assert.equal(usd.aging.days31To60,12);
assert.equal(usd.aging.days61To90,0);
assert.equal(usd.aging.days90Plus,0);

r=await request('GET',`/api/runtime/billing-ops/analytics?planKey=${planKey}&asOf=2026-10-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
usd=r.body.data.currencies[0];
assert.equal(usd.invoiceCount,2);
assert.equal(usd.totalBilled,24);
assert.equal(usd.amountPaid,12);
assert.equal(usd.outstanding,12);
assert.equal(usd.overdueOutstanding,12);
assert.equal(usd.collectionRatePct,50);

r=await request('GET',`/api/runtime/billing-ops/revenue-performance?planKey=${planKey}&asOf=2026-10-20T00:00:00.000Z`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,2);
const rowA=r.body.data.find(x=>x.tenantId===a.tenantId);
const rowB=r.body.data.find(x=>x.tenantId===b.tenantId);
assert.ok(rowA&&rowB,JSON.stringify(r.body));
assert.equal(rowA.planKey,planKey);
assert.equal(rowA.billedRevenue,12);
assert.equal(rowA.collectedRevenue,12);
assert.equal(rowA.outstandingRevenue,0);
assert.equal(rowA.collectionRatePct,100);
assert.equal(rowB.billedRevenue,12);
assert.equal(rowB.collectedRevenue,0);
assert.equal(rowB.outstandingRevenue,12);
assert.equal(rowB.collectionRatePct,0);

r=await request('POST','/api/runtime/identities',{
  identityKey:`analytics-owner-${suffix}`,displayName:'M23.3 Analytics Owner'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId:a.tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId:a.tenantId,name:'M23.3 Analytics Read Key',
  allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/billing-ops/analytics?tenantId=${a.tenantId}&asOf=2026-09-26T00:00:00.000Z`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.currencies[0].collectionRatePct,100);

r=await request('GET',`/api/runtime/billing-ops/revenue-performance?tenantId=${b.tenantId}`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

const noAuth=await request('GET','/api/runtime/billing-ops/analytics',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

console.log('G23_3_REVENUE_ANALYTICS_PASS');
