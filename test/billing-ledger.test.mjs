import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3600';
const platformToken=process.env.RUNTIME_API_TOKEN||'billing-ci-platform-token';
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
const planKey=`BILLING_${suffix}`;

let r=await request('POST','/api/runtime/plans',{planKey,name:'Billing Gate Plan'});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'MODEL_EXECUTION',enabled:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',
  recurringFee:10,includedUsageCredit:0.001,
  overageMode:'PAYG',overageMarkupBps:5000,paymentDueDays:7,
  effectiveFrom:'2026-08-01T00:00:00.000Z',sourceLabel:'M22_5_GATE_V1'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const termV1=r.body.data;
assert.equal(termV1.termVersion,1);
assert.equal(termV1.recurringFee,10);
assert.equal(termV1.includedUsageCredit,0.001);

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`billing-tenant-${suffix}`,name:'Billing Tenant',planKey
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/subscriptions',{
  tenantId,planKey,billingTermId:termV1.id,startedAt:'2026-09-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const subscriptionId=r.body.data.id;
const cycleId=r.body.data.currentCycle.id;
assert.equal(r.body.data.currentCycle.recurringFee,10);
assert.equal(r.body.data.currentCycle.includedUsageCredit,0.001);
assert.equal(r.body.data.currentCycle.overageMarkupBps,5000);

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',
  recurringFee:99,includedUsageCredit:50,
  overageMode:'PAYG',overageMarkupBps:0,paymentDueDays:30,
  effectiveFrom:'2026-09-15T00:00:00.000Z',sourceLabel:'M22_5_GATE_V2'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.termVersion,2);

r=await request('GET',`/api/runtime/tenants/${tenantId}/subscription`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.billingTermId,termV1.id);
assert.equal(r.body.data.currentCycle.id,cycleId);
assert.equal(r.body.data.currentCycle.recurringFee,10);
assert.equal(r.body.data.currentCycle.includedUsageCredit,0.001);

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:`billing-workspace-${suffix}`,name:'Billing Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`billing-project-${suffix}`,name:'Billing Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'BILLING',taskKey:'priced-usage',taskType:'SCRIPT_CONTINUITY',sequenceNo:1
});
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;

const providerKey=`billing-provider-${suffix}`;
const modelKey=`billing-model-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'TEST',displayName:'Billing Provider',adapterKey:'openai-responses',
  healthStatus:'HEALTHY',priority:1,supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'Billing Model',qualityTier:'STANDARD',
  latencyTier:'BALANCED',costTier:'LOW',priority:1
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey,serviceTier:'STANDARD',currency:'USD',
  inputRatePerMillion:1,outputRatePerMillion:5,
  effectiveFrom:'2026-01-01T00:00:00.000Z',sourceLabel:'M22_5_GATE_PRICE'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tool-executions',{
  runId,taskId,toolType:'MODEL_PROVIDER',toolKey:'billing.priced',
  providerKey,modelKey,status:'PASS',tokenInput:1000,tokenOutput:600,durationMs:10
});
assert.equal(r.status,201,JSON.stringify(r.body));
const pricedToolId=r.body.data.id;
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.estimatedCost,0.004);

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});
await db.execute(
  "UPDATE usage_ledger SET recorded_at='2026-09-15 12:00:00.000000' WHERE tool_execution_id=?",
  [pricedToolId]
);

r=await request('POST','/api/runtime/credits',{
  tenantId,subscriptionId,entryType:'GRANT',amount:2,currency:'USD',
  idempotencyKey:`billing-credit-${suffix}`,note:'Gate service credit'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.amount,2);
assert.equal(r.body.data.idempotent,false);

r=await request('POST','/api/runtime/credits',{
  tenantId,subscriptionId,entryType:'GRANT',amount:2,currency:'USD',
  idempotencyKey:`billing-credit-${suffix}`,note:'Duplicate gate credit'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/tenants/${tenantId}/credit-balance?currency=USD`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.balance,2);

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-10-04T12:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
const invoiceId=r.body.data.id;
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.subtotal,10.0045);
assert.equal(r.body.data.creditApplied,2);
assert.equal(r.body.data.totalDue,8.0045);
assert.ok(r.body.data.items.some(x=>x.itemType==='BASE_SUBSCRIPTION'&&x.amount===10));
assert.ok(r.body.data.items.some(x=>x.itemType==='USAGE_OVERAGE'&&x.amount===0.0045));
assert.ok(r.body.data.items.some(x=>x.itemType==='CREDIT_APPLIED'&&x.amount===-2));

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-10-04T12:01:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.id,invoiceId);
assert.equal(r.body.data.idempotent,true);

r=await request('GET',`/api/runtime/tenants/${tenantId}/credit-balance?currency=USD`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.balance,0);

r=await request('GET',`/api/runtime/billing-cycles/${cycleId}/reconcile`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.reconciled,true);

const [[settlement]]=await db.execute(
  `SELECT provider_cost_amount,included_credit_amount,overage_cost_basis,revenue_amount
   FROM billing_usage_settlements WHERE usage_ledger_id=(SELECT id FROM usage_ledger WHERE tool_execution_id=?)`,
  [pricedToolId]
);
assert.equal(Number(settlement.provider_cost_amount),0.004);
assert.equal(Number(settlement.included_credit_amount),0.001);
assert.equal(Number(settlement.overage_cost_basis),0.003);
assert.equal(Number(settlement.revenue_amount),0.0045);

const [[settlementCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM billing_usage_settlements WHERE billing_cycle_id=?',[cycleId]
);
assert.equal(Number(settlementCount.count),1);

const [[cycleRow]]=await db.execute(
  `SELECT recurring_fee_snapshot,included_usage_credit_snapshot,overage_markup_bps_snapshot,
          provider_cost_total,usage_revenue,invoice_subtotal,credit_applied,total_due,status
   FROM billing_cycles WHERE id=?`,[cycleId]
);
assert.equal(Number(cycleRow.recurring_fee_snapshot),10);
assert.equal(Number(cycleRow.included_usage_credit_snapshot),0.001);
assert.equal(Number(cycleRow.overage_markup_bps_snapshot),5000);
assert.equal(Number(cycleRow.provider_cost_total),0.004);
assert.equal(Number(cycleRow.usage_revenue),0.0045);
assert.equal(Number(cycleRow.invoice_subtotal),10.0045);
assert.equal(Number(cycleRow.credit_applied),2);
assert.equal(Number(cycleRow.total_due),8.0045);
assert.equal(cycleRow.status,'INVOICED');

const [[nextCycle]]=await db.execute(
  'SELECT recurring_fee_snapshot,included_usage_credit_snapshot,overage_markup_bps_snapshot FROM billing_cycles WHERE subscription_id=? AND cycle_no=2',
  [subscriptionId]
);
assert.equal(Number(nextCycle.recurring_fee_snapshot),10);
assert.equal(Number(nextCycle.included_usage_credit_snapshot),0.001);
assert.equal(Number(nextCycle.overage_markup_bps_snapshot),5000);

r=await request('POST','/api/runtime/identities',{
  identityKey:`billing-owner-${suffix}`,displayName:'Billing Owner'
});
assert.equal(r.status,201);
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201);

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,tenantId,name:'Billing Read Key',allowedPermissions:['billing:read']
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerToken=r.body.data.token;

r=await request('GET',`/api/runtime/tenants/${tenantId}/invoices`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.length,1);
assert.equal(r.body.data[0].id,invoiceId);

r=await request('GET',`/api/runtime/invoices/${invoiceId}`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.totalDue,8.0045);

r=await request('GET',`/api/runtime/tenants/${tenantId}/subscription`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:1,
  effectiveFrom:'2027-01-01T00:00:00.000Z'
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`billing-other-${suffix}`,name:'Billing Other',planKey
});
assert.equal(r.status,201);
const otherTenantId=r.body.data.id;

r=await request('GET',`/api/runtime/tenants/${otherTenantId}/invoices`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`billing-unknown-${suffix}`,name:'Billing Unknown Cost',planKey
});
assert.equal(r.status,201);
const unknownTenantId=r.body.data.id;

r=await request('POST','/api/runtime/subscriptions',{
  tenantId:unknownTenantId,planKey,billingTermId:termV1.id,startedAt:'2026-09-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const unknownCycleId=r.body.data.currentCycle.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId:unknownTenantId,workspaceKey:`billing-unknown-ws-${suffix}`,name:'Unknown Billing Workspace'
});
assert.equal(r.status,201);
const unknownWorkspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId:unknownWorkspaceId,projectKey:`billing-unknown-project-${suffix}`,
  name:'Unknown Billing Project',projectType:'AIGC_CONTENT'
});
assert.equal(r.status,201);
const unknownProjectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{projectId:unknownProjectId,runType:'WORKFLOW',triggerSource:'CI',status:'RUNNING'});
assert.equal(r.status,201);
const unknownRunId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId:unknownRunId,stageKey:'BILLING',taskKey:'unknown-cost',taskType:'SCRIPT_CONTINUITY',sequenceNo:1
});
assert.equal(r.status,201);
const unknownTaskId=r.body.data.id;

r=await request('POST','/api/runtime/tool-executions',{
  runId:unknownRunId,taskId:unknownTaskId,toolType:'MODEL_PROVIDER',toolKey:'billing.unknown',
  providerKey:'unpriced-provider',modelKey:'unpriced-model',status:'PASS',tokenInput:100,tokenOutput:50
});
assert.equal(r.status,201,JSON.stringify(r.body));
const unknownToolId=r.body.data.id;
assert.equal(r.body.data.costStatus,'UNKNOWN');

await db.execute(
  "UPDATE usage_ledger SET recorded_at='2026-09-20 12:00:00.000000' WHERE tool_execution_id=?",
  [unknownToolId]
);

r=await request('POST',`/api/runtime/billing-cycles/${unknownCycleId}/finalize`,{
  finalizedAt:'2026-10-04T12:00:00.000Z'
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'BILLING_USAGE_COST_UNKNOWN');

const [[unknownInvoiceCount]]=await db.execute(
  'SELECT COUNT(*) AS count FROM invoices WHERE billing_cycle_id=?',[unknownCycleId]
);
assert.equal(Number(unknownInvoiceCount.count),0);

await db.end();
console.log('G22_5_BILLING_LEDGER_PASS');
