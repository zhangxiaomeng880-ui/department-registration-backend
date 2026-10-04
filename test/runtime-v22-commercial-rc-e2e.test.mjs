import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:3800';
const platformToken=process.env.RUNTIME_API_TOKEN||'rc-ci-platform-token';
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
const planKey=`RC22_${suffix}`;

let r=await request('GET','/ready',undefined,null);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.components.runtimeAuth.required,true);

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`rc-tenant-${suffix}`,name:'V2.2 RC Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;

r=await request('POST','/api/runtime/workspaces',{
  tenantId,workspaceKey:`rc-workspace-${suffix}`,name:'V2.2 RC Workspace'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/identities',{
  identityKey:`rc-owner-${suffix}`,displayName:'V2.2 RC Tenant Owner'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerId=r.body.data.id;

r=await request('POST','/api/runtime/tenant-memberships',{
  tenantId,identityId:ownerId,roleKey:'TENANT_OWNER'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/api-credentials',{
  identityId:ownerId,
  tenantId,
  name:'V2.2 RC Scoped Owner',
  allowedPermissions:[
    'tenant:read','workspace:read',
    'project:read','project:write',
    'run:read','run:write',
    'usage:read',
    'quota:read','quota:write',
    'commercial:read','commercial:write',
    'billing:read'
  ]
});
assert.equal(r.status,201,JSON.stringify(r.body));
const ownerCredentialId=r.body.data.id;
const ownerToken=r.body.data.token;
assert.ok(/^rtk_[a-f0-9]{12}_/.test(ownerToken));

r=await request('GET','/api/runtime/workspaces',undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.ok(r.body.data.some(x=>x.id===workspaceId));

r=await request('POST','/api/runtime/plans',{
  planKey,name:'V2.2 RC Commercial Plan',metadata:{purpose:'M22.6 RC E2E'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-entitlements',{
  planKey,entitlementKey:'MODEL_EXECUTION',enabled:true,config:{maxContextTokens:500000}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',
  recurringFee:10,includedUsageCredit:0.001,
  overageMode:'PAYG',overageMarkupBps:5000,paymentDueDays:7,
  effectiveFrom:'2026-08-01T00:00:00.000Z',sourceLabel:'M22_6_RC_E2E'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const billingTermId=r.body.data.id;

r=await request('PATCH',`/api/runtime/tenants/${tenantId}/plan`,{planKey});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.planKey,planKey);

r=await request('POST','/api/runtime/subscriptions',{
  tenantId,planKey,billingTermId,startedAt:'2026-09-01T00:00:00.000Z'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const subscriptionId=r.body.data.id;
const cycleId=r.body.data.currentCycle.id;
assert.equal(r.body.data.currentCycle.recurringFee,10);
assert.equal(r.body.data.currentCycle.includedUsageCredit,0.001);
assert.equal(r.body.data.currentCycle.overageMarkupBps,5000);

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`rc-project-${suffix}`,name:'V2.2 RC Project',projectType:'AIGC_CONTENT'
},ownerToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;

r=await request('POST','/api/runtime/runs',{
  projectId,runType:'WORKFLOW',triggerSource:'CI',
  workflowVersion:'v2.2-rc1',routerVersion:'policy-router-v2',status:'RUNNING'
},ownerToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const runId=r.body.data.id;

r=await request('POST','/api/runtime/tasks',{
  runId,stageKey:'RC_E2E',taskKey:'commercial-runtime-chain',
  taskType:'SCRIPT_CONTINUITY',sequenceNo:1
},ownerToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const taskId=r.body.data.id;

r=await request('POST',`/api/runtime/runs/${runId}/entitlement-evaluate`,{
  entitlementKey:'MODEL_EXECUTION',source:'M22_6_RC_E2E'
},ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'ALLOW');
assert.equal(r.body.data.planKey,planKey);

r=await request('POST','/api/runtime/quota-policies',{
  subjectType:'WORKSPACE',subjectId:workspaceId,
  policyKey:`rc-tool-hard-${suffix}`,
  metricKey:'TOOL_EXECUTION_COUNT',periodType:'MONTH',
  hardLimit:2,actionOnHard:'BLOCK'
},ownerToken);
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/runs/${runId}/commercial-authorize`,{
  entitlementKey:'MODEL_EXECUTION',
  operationKey:'MODEL_EXECUTION',
  reservationMetric:'TOOL_EXECUTION_COUNT',
  reservationAmount:1,
  reservationTtlSeconds:300,
  source:'M22_6_RC_E2E'
},ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.decision,'ALLOW');
const reservationId=r.body.data.reservationId;

const providerKey=`rc-provider-${suffix}`;
const modelKey=`rc-model-${suffix}`;
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'TEST',displayName:'V2.2 RC Provider',
  adapterKey:'openai-responses',healthStatus:'HEALTHY',priority:1,
  supportsStructuredOutput:true
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'V2.2 RC Model',
  qualityTier:'STANDARD',latencyTier:'BALANCED',costTier:'LOW',priority:1,
  capabilities:{taskTypes:['SCRIPT_CONTINUITY'],structuredOutput:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/pricing-versions',{
  providerKey,modelKey,serviceTier:'STANDARD',currency:'USD',
  inputRatePerMillion:1,outputRatePerMillion:5,
  effectiveFrom:'2026-01-01T00:00:00.000Z',sourceLabel:'M22_6_RC_PRICE'
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST','/api/runtime/tool-executions',{
  runId,taskId,toolType:'MODEL_PROVIDER',toolKey:'rc.commercial.runtime',
  providerKey,modelKey,status:'PASS',tokenInput:1000,tokenOutput:600,durationMs:10
},ownerToken);
assert.equal(r.status,201,JSON.stringify(r.body));
const toolExecutionId=r.body.data.id;
assert.equal(r.body.data.costStatus,'CALCULATED');
assert.equal(r.body.data.estimatedCost,0.004);

r=await request('POST',`/api/runtime/usage-reservations/${reservationId}/commit`,{
  actualAmount:1
},ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'COMMITTED');
assert.equal(r.body.data.actualAmount,1);

r=await request('GET',`/api/runtime/workspaces/${workspaceId}/usage-meter?periodType=MONTH`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.usageCount,1);
assert.equal(r.body.data.tokenInput,1000);
assert.equal(r.body.data.tokenOutput,600);
assert.equal(r.body.data.tokenTotal,1600);
assert.equal(r.body.data.estimatedCost,0.004);
assert.equal(r.body.data.costStatus,'CALCULATED');

const db=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME
});

await db.execute(
  "UPDATE usage_ledger SET recorded_at='2026-09-15 12:00:00.000000' WHERE tool_execution_id=?",
  [toolExecutionId]
);

r=await request('POST','/api/runtime/credits',{
  tenantId,subscriptionId,entryType:'GRANT',amount:2,currency:'USD',
  idempotencyKey:`rc-credit-${suffix}`,note:'M22.6 RC service credit'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,false);

r=await request('POST','/api/runtime/credits',{
  tenantId,subscriptionId,entryType:'GRANT',amount:2,currency:'USD',
  idempotencyKey:`rc-credit-${suffix}`,note:'M22.6 RC duplicate credit'
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

r=await request('POST',`/api/runtime/billing-cycles/${cycleId}/finalize`,{
  finalizedAt:'2026-10-04T12:00:00.000Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
const invoiceId=r.body.data.id;
assert.equal(r.body.data.idempotent,false);
assert.equal(r.body.data.subtotal,10.0045);
assert.equal(r.body.data.creditApplied,2);
assert.equal(r.body.data.totalDue,8.0045);

r=await request('GET',`/api/runtime/invoices/${invoiceId}`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.totalDue,8.0045);
assert.ok(r.body.data.items.some(x=>x.itemType==='BASE_SUBSCRIPTION'&&x.amount===10));
assert.ok(r.body.data.items.some(x=>x.itemType==='USAGE_OVERAGE'&&x.amount===0.0045));
assert.ok(r.body.data.items.some(x=>x.itemType==='CREDIT_APPLIED'&&x.amount===-2));

r=await request('GET',`/api/runtime/billing-cycles/${cycleId}/reconcile`,undefined,ownerToken);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');
assert.equal(r.body.data.reconciled,true);

r=await request('POST','/api/runtime/plan-billing-terms',{
  planKey,currency:'USD',billingInterval:'MONTHLY',recurringFee:1,
  effectiveFrom:'2027-01-01T00:00:00.000Z'
},ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.error,'PLATFORM_ADMIN_REQUIRED');

r=await request('POST','/api/runtime/tenants',{
  tenantKey:`rc-other-${suffix}`,name:'V2.2 RC Other Tenant'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const otherTenantId=r.body.data.id;

r=await request('GET',`/api/runtime/tenants/${otherTenantId}/invoices`,undefined,ownerToken);
assert.equal(r.status,403,JSON.stringify(r.body));
assert.equal(r.body.details.reasonCode,'CROSS_TENANT_DENIED');

const [[settlement]]=await db.execute(
  `SELECT provider_cost_amount,included_credit_amount,overage_cost_basis,revenue_amount
   FROM billing_usage_settlements
   WHERE usage_ledger_id=(SELECT id FROM usage_ledger WHERE tool_execution_id=?)`,
  [toolExecutionId]
);
assert.equal(Number(settlement.provider_cost_amount),0.004);
assert.equal(Number(settlement.included_credit_amount),0.001);
assert.equal(Number(settlement.overage_cost_basis),0.003);
assert.equal(Number(settlement.revenue_amount),0.0045);

const [[reservation]]=await db.execute(
  'SELECT status,reserved_amount,actual_amount FROM usage_reservations WHERE id=?',
  [reservationId]
);
assert.equal(reservation.status,'COMMITTED');
assert.equal(Number(reservation.reserved_amount),1);
assert.equal(Number(reservation.actual_amount),1);

const [[denyAudit]]=await db.execute(
  `SELECT COUNT(*) AS count FROM authorization_decisions
   WHERE credential_id=? AND decision='DENY'`,
  [ownerCredentialId]
);
assert.ok(Number(denyAudit.count)>=1);

await db.end();

console.log('G22_6_COMMERCIAL_RUNTIME_RC_E2E_PASS');
