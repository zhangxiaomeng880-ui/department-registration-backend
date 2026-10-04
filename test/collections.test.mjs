import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4000';
const platformToken=process.env.RUNTIME_API_TOKEN||'m232-platform-token';

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
const planKey=`COLL_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'M23.2 Collections Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:12,
  includedUsageCredit:0,overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:7,
  effectiveFrom:'2026-07-01T00:00:00.000Z',sourceLabel:'M23_2_GATE'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termId=r.body.data.id;

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`coll-tenant-${suffix}`,name:'M23.2 Collections Tenant',planKey
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
assert.equal(r.body.data.outstandingAmount,12);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/collection-case`,{
  openedAt:'2026-09-05T00:00:00.000Z',priority:'HIGH'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'INVOICE_NOT_OVERDUE');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/collection-case`,{
  openedAt:'2026-09-20T00:00:00.000Z',priority:'HIGH',
  metadata:{source:'MANUAL_AR_REVIEW'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.status,'OPEN');
assert.equal(r.body.data.priority,'HIGH');
const caseId=r.body.data.id;

r=await request('POST',`/api/runtime/invoices/${invoiceId}/collection-case`,{
  openedAt:'2026-09-20T00:00:00.000Z',priority:'HIGH'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);
assert.equal(r.body.data.id,caseId);

r=await request('GET',`/api/runtime/collection-cases?tenantId=${tenantId}&status=ACTIVE`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,caseId);

r=await request('POST','/api/runtime/identities',{
  identityKey:`coll-owner-${suffix}`,displayName:'M23.2 Billing Owner'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'M23.2 Billing Read Key',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/invoices/${invoiceId}/collection-case`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.id,caseId);

r=await request('GET',`/api/runtime/collection-cases?tenantId=${tenantId}&status=ACTIVE`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'CONTACTED',idempotencyKey:`contact-${suffix}`,
  occurredAt:'2026-09-20T10:00:00.000Z',nextActionAt:'2026-09-22T10:00:00.000Z'
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

const contactKey=`contact-${suffix}`;
r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'CONTACTED',idempotencyKey:contactKey,
  occurredAt:'2026-09-20T10:00:00.000Z',nextActionAt:'2026-09-22T10:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.collectionCase.status,'CONTACTED');

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'CONTACTED',idempotencyKey:contactKey,
  occurredAt:'2026-09-20T10:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'PROMISE_TO_PAY',idempotencyKey:contactKey,
  promisedAmount:7,promiseDueAt:'2026-09-25T00:00:00.000Z',
  occurredAt:'2026-09-20T11:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'COLLECTION_IDEMPOTENCY_CONFLICT');

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'PROMISE_TO_PAY',idempotencyKey:`promise-too-high-${suffix}`,
  promisedAmount:13,promiseDueAt:'2026-09-25T00:00:00.000Z',
  occurredAt:'2026-09-20T11:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'PROMISE_EXCEEDS_OUTSTANDING');

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'PROMISE_TO_PAY',idempotencyKey:`promise-${suffix}`,
  promisedAmount:7,promiseDueAt:'2026-09-25T00:00:00.000Z',
  occurredAt:'2026-09-20T11:00:00.000Z',
  metadata:{channel:'PHONE'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.collectionCase.status,'PROMISE_TO_PAY');
assert.equal(r.body.data.collectionCase.promisedAmount,7);

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:5,currency:'USD',idempotencyKey:`partial-${suffix}`,
  receivedAt:'2026-09-21T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.outstandingAmount,7);

r=await request('GET',`/api/runtime/collection-cases/${caseId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PROMISE_TO_PAY');
assert.equal(r.body.data.actions.length,2);

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'RESOLVE',idempotencyKey:`resolve-too-early-${suffix}`,
  occurredAt:'2026-09-21T13:00:00.000Z',resolutionCode:'PAID'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'COLLECTION_OUTSTANDING_REMAINS');

r=await request('POST',`/api/runtime/invoices/${invoiceId}/payments`,{
  amount:7,currency:'USD',idempotencyKey:`final-${suffix}`,
  receivedAt:'2026-09-22T12:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.invoice.status,'PAID');
assert.equal(r.body.data.invoice.outstandingAmount,0);

r=await request('GET',`/api/runtime/collection-cases/${caseId}`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'RESOLVED');
assert.equal(r.body.data.resolutionCode,'PAID');
assert.ok(r.body.data.resolvedAt);
assert.equal(r.body.data.actions.length,3);
assert.equal(r.body.data.actions[2].actionType,'AUTO_RESOLVED_PAYMENT');

r=await request('POST',`/api/runtime/collection-cases/${caseId}/actions`,{
  actionType:'REOPEN',idempotencyKey:`reopen-${suffix}`,
  occurredAt:'2026-09-23T00:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'COLLECTION_NOT_REOPENABLE');

r=await request('GET',`/api/runtime/collection-cases?tenantId=${tenantId}&status=ACTIVE`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,0);

r=await request('GET',`/api/runtime/collection-cases?tenantId=${tenantId}&status=RESOLVED`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,caseId);

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`coll-other-${suffix}`,name:'M23.2 Other Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherTenantId=r.body.data.id;

r=await request('GET',`/api/runtime/collection-cases?tenantId=${otherTenantId}`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

const noAuth=await request('GET','/api/runtime/collection-cases',undefined,null);
assert.equal(noAuth.status,401,JSON.stringify(noAuth.body));

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
const [[caseRow]]=await db.execute(
  'SELECT status,resolution_code,resolved_at FROM collection_cases WHERE id=?',[caseId]
);
assert.equal(caseRow.status,'RESOLVED');
assert.equal(caseRow.resolution_code,'PAID');
assert.ok(caseRow.resolved_at);
const [[actionCount]]=await db.execute('SELECT COUNT(*) AS count FROM collection_actions WHERE case_id=?',[caseId]);
assert.equal(Number(actionCount.count),3);
await db.end();

console.log('G23_2_COLLECTIONS_PASS');
