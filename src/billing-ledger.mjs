import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SCALE=10000000000n;
const TERM_INTERVALS=new Set(['MONTHLY','ANNUAL']);
const OVERAGE_MODES=new Set(['PAYG','BLOCK']);
const CREDIT_ENTRY_TYPES=new Set(['GRANT','ADJUSTMENT','REFUND']);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Billing metadata must not persist credentials or secrets','BILLING_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const toUnits=value=>{
  const text=String(value??0).trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(text)) throw errorOf('Invalid decimal amount','INVALID_BILLING_AMOUNT');
  const negative=text.startsWith('-');
  const raw=negative?text.slice(1):text;
  const [whole,fraction='']=raw.split('.');
  const frac=(fraction+'0000000000').slice(0,10);
  const units=BigInt(whole)*SCALE+BigInt(frac);
  return negative?-units:units;
};
const unitsToString=units=>{
  const negative=units<0n;
  const abs=negative?-units:units;
  const whole=abs/SCALE;
  const fraction=String(abs%SCALE).padStart(10,'0');
  return `${negative?'-':''}${whole}.${fraction}`;
};
const unitsToNumber=units=>Number(unitsToString(units));
const minUnits=(a,b)=>a<b?a:b;
const parseDate=value=>{
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime())) throw errorOf('Invalid billing date','INVALID_BILLING_DATE');
  return d;
};
const addInterval=(date,interval)=>{
  const d=new Date(date);
  if(interval==='MONTHLY') d.setUTCMonth(d.getUTCMonth()+1);
  else if(interval==='ANNUAL') d.setUTCFullYear(d.getUTCFullYear()+1);
  else throw errorOf('Unsupported billing interval','INVALID_BILLING_INTERVAL');
  return d;
};
const normalizeTerm=row=>({
  id:row.id,planKey:row.plan_key,termVersion:Number(row.term_version),currency:row.currency,
  billingInterval:row.billing_interval,recurringFee:Number(row.recurring_fee),
  includedUsageCredit:Number(row.included_usage_credit),overageMode:row.overage_mode,
  overageMarkupBps:Number(row.overage_markup_bps),paymentDueDays:Number(row.payment_due_days),
  effectiveFrom:row.effective_from,status:row.status,sourceLabel:row.source_label,
  metadata:row.metadata_json,createdAt:row.created_at
});
const normalizeCycle=row=>({
  id:row.id,subscriptionId:row.subscription_id,tenantId:row.tenant_id,planKey:row.plan_key,
  billingTermId:row.billing_term_id,cycleNo:Number(row.cycle_no),periodStart:row.period_start,
  periodEnd:row.period_end,currency:row.currency,status:row.status,
  recurringFee:Number(row.recurring_fee_snapshot),includedUsageCredit:Number(row.included_usage_credit_snapshot),
  overageMode:row.overage_mode_snapshot,overageMarkupBps:Number(row.overage_markup_bps_snapshot),
  paymentDueDays:Number(row.payment_due_days_snapshot),providerCostTotal:row.provider_cost_total==null?null:Number(row.provider_cost_total),
  includedUsageConsumed:row.included_usage_consumed==null?null:Number(row.included_usage_consumed),
  overageCostBasis:row.overage_cost_basis==null?null:Number(row.overage_cost_basis),
  usageRevenue:row.usage_revenue==null?null:Number(row.usage_revenue),
  invoiceSubtotal:row.invoice_subtotal==null?null:Number(row.invoice_subtotal),
  creditApplied:row.credit_applied==null?null:Number(row.credit_applied),
  totalDue:row.total_due==null?null:Number(row.total_due),finalizedAt:row.finalized_at
});
const normalizeSubscription=row=>({
  id:row.id,tenantId:row.tenant_id,planKey:row.plan_key,billingTermId:row.billing_term_id,
  status:row.status,startedAt:row.started_at,cancelAtPeriodEnd:Boolean(row.cancel_at_period_end),
  canceledAt:row.canceled_at,metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeInvoice=row=>{
  const totalDue=Number(row.total_due);
  const amountPaid=Number(row.amount_paid||0);
  return {
    id:row.id,invoiceNumber:row.invoice_number,tenantId:row.tenant_id,subscriptionId:row.subscription_id,
    billingCycleId:row.billing_cycle_id,currency:row.currency,subtotal:Number(row.subtotal),
    creditApplied:Number(row.credit_applied),totalDue,amountPaid,
    outstandingAmount:Math.max(0,totalDue-amountPaid),status:row.status,
    issuedAt:row.issued_at,dueAt:row.due_at,paidAt:row.paid_at||null,
    metadata:row.metadata_json,createdAt:row.created_at
  };
};
const normalizePayment=row=>({
  id:row.id,invoiceId:row.invoice_id,tenantId:row.tenant_id,amount:Number(row.amount),
  currency:row.currency,paymentReference:row.payment_reference,idempotencyKey:row.idempotency_key,
  receivedAt:row.received_at,metadata:row.metadata_json,createdAt:row.created_at
});
const createCycleRow=async(connection,{subscription,term,cycleNo,periodStart})=>{
  const periodEnd=addInterval(periodStart,term.billing_interval);
  const id=randomUUID();
  await connection.execute(
    `INSERT INTO billing_cycles (
      id,subscription_id,tenant_id,plan_key,billing_term_id,cycle_no,period_start,period_end,
      currency,recurring_fee_snapshot,included_usage_credit_snapshot,overage_mode_snapshot,
      overage_markup_bps_snapshot,payment_due_days_snapshot,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN')`,
    [id,subscription.id,subscription.tenant_id,subscription.plan_key,subscription.billing_term_id,
     cycleNo,periodStart,periodEnd,term.currency,term.recurring_fee,term.included_usage_credit,
     term.overage_mode,term.overage_markup_bps,term.payment_due_days]
  );
  const [rows]=await connection.execute('SELECT * FROM billing_cycles WHERE id=?',[id]);
  return rows[0];
};

export const createPlanBillingTerm=async input=>{
  if(!input?.planKey) throw errorOf('planKey is required','INVALID_BILLING_TERM');
  const interval=String(input.billingInterval||'MONTHLY').toUpperCase();
  const overageMode=String(input.overageMode||'PAYG').toUpperCase();
  const currency=String(input.currency||'USD').toUpperCase();
  if(!TERM_INTERVALS.has(interval)) throw errorOf('billingInterval must be MONTHLY or ANNUAL','INVALID_BILLING_INTERVAL');
  if(!OVERAGE_MODES.has(overageMode)) throw errorOf('overageMode must be PAYG or BLOCK','INVALID_OVERAGE_MODE');
  if(!/^[A-Z]{3}$/.test(currency)) throw errorOf('currency must be a 3-letter code','INVALID_BILLING_CURRENCY');
  const recurring=toUnits(input.recurringFee??0),included=toUnits(input.includedUsageCredit??0);
  if(recurring<0n||included<0n) throw errorOf('Billing amounts must be non-negative','INVALID_BILLING_AMOUNT');
  const markup=Number(input.overageMarkupBps||0),dueDays=Number(input.paymentDueDays??7);
  if(!Number.isInteger(markup)||markup<0||markup>100000) throw errorOf('overageMarkupBps must be an integer from 0 to 100000','INVALID_OVERAGE_MARKUP');
  if(!Number.isInteger(dueDays)||dueDays<0||dueDays>365) throw errorOf('paymentDueDays must be an integer from 0 to 365','INVALID_PAYMENT_DUE_DAYS');
  const effectiveFrom=parseDate(input.effectiveFrom||new Date());
  rejectSecrets(input.metadata||null);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [plans]=await connection.execute('SELECT plan_key FROM plans WHERE plan_key=? FOR UPDATE',[input.planKey]);
    if(!plans.length) throw errorOf('Plan not found','PLAN_NOT_FOUND',404);
    const [[versionRow]]=await connection.execute(
      'SELECT COALESCE(MAX(term_version),0)+1 AS next_version FROM plan_billing_terms WHERE plan_key=?',
      [input.planKey]
    );
    const id=randomUUID(),version=Number(versionRow.next_version);
    await connection.execute(
      `INSERT INTO plan_billing_terms (
        id,plan_key,term_version,currency,billing_interval,recurring_fee,included_usage_credit,
        overage_mode,overage_markup_bps,payment_due_days,effective_from,status,source_label,metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,input.planKey,version,currency,interval,unitsToString(recurring),unitsToString(included),
       overageMode,markup,dueDays,effectiveFrom,input.status||'ACTIVE',input.sourceLabel||null,
       asJson(input.metadata||null)]
    );
    const [rows]=await connection.execute('SELECT * FROM plan_billing_terms WHERE id=?',[id]);
    await connection.commit();
    return normalizeTerm(rows[0]);
  }catch(error){
    await connection.rollback();
    if(error?.code==='ER_DUP_ENTRY') throw errorOf('Billing term effectiveFrom already exists for plan','BILLING_TERM_VERSION_CONFLICT',409);
    throw error;
  }finally{connection.release();}
};

export const listPlanBillingTerms=async({planKey=null}={})=>{
  const db=getRuntimePool();
  const [rows]=planKey
    ? await db.execute('SELECT * FROM plan_billing_terms WHERE plan_key=? ORDER BY term_version',[planKey])
    : await db.execute('SELECT * FROM plan_billing_terms ORDER BY plan_key,term_version');
  return rows.map(normalizeTerm);
};

export const createSubscription=async input=>{
  if(!input?.tenantId) throw errorOf('tenantId is required','INVALID_SUBSCRIPTION');
  const start=parseDate(input.startedAt||new Date());
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [tenants]=await connection.execute('SELECT id,plan_key,status FROM tenants WHERE id=? FOR UPDATE',[input.tenantId]);
    if(!tenants.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
    if(tenants[0].status!=='ACTIVE') throw errorOf('Tenant is not active','TENANT_NOT_ACTIVE',409);
    const planKey=input.planKey||tenants[0].plan_key;
    const [existing]=await connection.execute("SELECT id FROM subscriptions WHERE tenant_id=? AND status='ACTIVE' FOR UPDATE",[input.tenantId]);
    if(existing.length) throw errorOf('Tenant already has an active subscription','ACTIVE_SUBSCRIPTION_EXISTS',409);
    let terms;
    if(input.billingTermId){
      [terms]=await connection.execute('SELECT * FROM plan_billing_terms WHERE id=? AND plan_key=? AND status=\'ACTIVE\' AND effective_from<=?',[input.billingTermId,planKey,start]);
    }else{
      [terms]=await connection.execute(
        `SELECT * FROM plan_billing_terms
         WHERE plan_key=? AND status='ACTIVE' AND effective_from<=?
         ORDER BY effective_from DESC,term_version DESC LIMIT 1`,
        [planKey,start]
      );
    }
    if(!terms.length) throw errorOf('No active billing term is effective for subscription start','BILLING_TERM_NOT_FOUND',404);
    const term=terms[0],id=randomUUID();
    await connection.execute(
      `INSERT INTO subscriptions (
        id,tenant_id,plan_key,billing_term_id,status,started_at,cancel_at_period_end,metadata_json
      ) VALUES (?,?,?,?, 'ACTIVE', ?, ?, ?)`,
      [id,input.tenantId,planKey,term.id,start,input.cancelAtPeriodEnd?1:0,asJson(input.metadata||null)]
    );
    await connection.execute('UPDATE tenants SET plan_key=? WHERE id=?',[planKey,input.tenantId]);
    const subscription={id,tenant_id:input.tenantId,plan_key:planKey,billing_term_id:term.id};
    const cycle=await createCycleRow(connection,{subscription,term,cycleNo:1,periodStart:start});
    const [rows]=await connection.execute('SELECT * FROM subscriptions WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeSubscription(rows[0]),currentCycle:normalizeCycle(cycle)};
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{connection.release();}
};

export const getTenantSubscription=async tenantId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM subscriptions WHERE tenant_id=? ORDER BY
       CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    [tenantId]
  );
  if(!rows.length) throw errorOf('Subscription not found','SUBSCRIPTION_NOT_FOUND',404);
  const subscription=normalizeSubscription(rows[0]);
  const [cycles]=await db.execute(
    'SELECT * FROM billing_cycles WHERE subscription_id=? ORDER BY cycle_no DESC LIMIT 1',
    [subscription.id]
  );
  return {...subscription,currentCycle:cycles.length?normalizeCycle(cycles[0]):null};
};

export const issueCredit=async input=>{
  if(!input?.tenantId||!input?.idempotencyKey) throw errorOf('tenantId and idempotencyKey are required','INVALID_CREDIT');
  const amount=toUnits(input.amount);
  if(amount<=0n) throw errorOf('Credit amount must be positive','INVALID_CREDIT_AMOUNT');
  const currency=String(input.currency||'USD').toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw errorOf('currency must be a 3-letter code','INVALID_BILLING_CURRENCY');
  const entryType=String(input.entryType||'GRANT').toUpperCase();
  if(!CREDIT_ENTRY_TYPES.has(entryType)) throw errorOf('entryType must be GRANT, ADJUSTMENT or REFUND','INVALID_CREDIT_ENTRY_TYPE');
  const db=getRuntimePool(),id=randomUUID();
  const [tenants]=await db.execute('SELECT id FROM tenants WHERE id=?',[input.tenantId]);
  if(!tenants.length) throw errorOf('Tenant not found','TENANT_NOT_FOUND',404);
  if(input.subscriptionId){
    const [subscriptions]=await db.execute('SELECT id,tenant_id FROM subscriptions WHERE id=?',[input.subscriptionId]);
    if(!subscriptions.length) throw errorOf('Subscription not found','SUBSCRIPTION_NOT_FOUND',404);
    if(subscriptions[0].tenant_id!==input.tenantId) throw errorOf('Subscription does not belong to tenant','SUBSCRIPTION_TENANT_MISMATCH',409);
  }
  try{
    await db.execute(
      `INSERT INTO credit_ledger (
        id,tenant_id,subscription_id,entry_type,amount,currency,idempotency_key,note
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [id,input.tenantId,input.subscriptionId||null,entryType,unitsToString(amount),currency,input.idempotencyKey,input.note||null]
    );
  }catch(error){
    if(error?.code==='ER_DUP_ENTRY'){
      const [rows]=await db.execute('SELECT * FROM credit_ledger WHERE idempotency_key=?',[input.idempotencyKey]);
      return {id:rows[0].id,tenantId:rows[0].tenant_id,entryType:rows[0].entry_type,amount:Number(rows[0].amount),currency:rows[0].currency,idempotent:true};
    }
    throw error;
  }
  return {id,tenantId:input.tenantId,entryType,amount:unitsToNumber(amount),currency,idempotent:false};
};

export const getCreditBalance=async({tenantId,currency='USD'}={})=>{
  if(!tenantId) throw errorOf('tenantId is required','INVALID_CREDIT_SCOPE');
  const normalized=String(currency).toUpperCase();
  const db=getRuntimePool();
  const [[row]]=await db.execute(
    'SELECT COALESCE(SUM(amount),0) AS balance FROM credit_ledger WHERE tenant_id=? AND currency=?',
    [tenantId,normalized]
  );
  return {tenantId,currency:normalized,balance:Number(row.balance||0)};
};

const invoiceWithItems=async(db,invoice)=>{
  const [items]=await db.execute('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at,id',[invoice.id]);
  return {
    ...normalizeInvoice(invoice),
    items:items.map(x=>({
      id:x.id,itemType:x.item_type,description:x.description,quantity:Number(x.quantity),
      unitAmount:Number(x.unit_amount),amount:Number(x.amount),metadata:x.metadata_json
    }))
  };
};

export const getInvoice=async invoiceId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM invoices WHERE id=?',[invoiceId]);
  if(!rows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  return invoiceWithItems(db,rows[0]);
};

export const listTenantInvoices=async tenantId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM invoices WHERE tenant_id=? ORDER BY issued_at DESC,id DESC',[tenantId]);
  return rows.map(normalizeInvoice);
};

export const resolveInvoiceScope=async invoiceId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id FROM invoices WHERE id=?',[invoiceId]);
  if(!rows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:null};
};

export const resolveBillingCycleScope=async cycleId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id FROM billing_cycles WHERE id=?',[cycleId]);
  if(!rows.length) throw errorOf('Billing cycle not found','BILLING_CYCLE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:null};
};

export const finalizeBillingCycle=async({cycleId,finalizedAt=new Date()}={})=>{
  if(!cycleId) throw errorOf('cycleId is required','INVALID_BILLING_CYCLE');
  const now=parseDate(finalizedAt);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [cycles]=await connection.execute('SELECT * FROM billing_cycles WHERE id=? FOR UPDATE',[cycleId]);
    if(!cycles.length) throw errorOf('Billing cycle not found','BILLING_CYCLE_NOT_FOUND',404);
    const cycle=cycles[0];
    const [existingInvoices]=await connection.execute('SELECT * FROM invoices WHERE billing_cycle_id=? LIMIT 1 FOR UPDATE',[cycleId]);
    if(existingInvoices.length){
      const result=await invoiceWithItems(connection,existingInvoices[0]);
      await connection.commit();
      return {...result,idempotent:true};
    }
    if(now.getTime()<new Date(cycle.period_end).getTime()) throw errorOf('Billing cycle has not ended','BILLING_CYCLE_NOT_ENDED',409);

    const [activeReservations]=await connection.execute(
      `SELECT id FROM usage_reservations
       WHERE tenant_id=? AND created_at>=? AND created_at<?
         AND status='RESERVED' AND expires_at>CURRENT_TIMESTAMP(6)
       LIMIT 1 FOR UPDATE`,
      [cycle.tenant_id,cycle.period_start,cycle.period_end]
    );
    if(activeReservations.length) throw errorOf('Active usage reservations still exist in billing period','BILLING_ACTIVE_RESERVATIONS',409);

    const [usageRows]=await connection.execute(
      `SELECT u.*,s.billing_cycle_id AS settled_cycle_id
       FROM usage_ledger u
       LEFT JOIN billing_usage_settlements s ON s.usage_ledger_id=u.id
       WHERE u.tenant_id=? AND u.recorded_at>=? AND u.recorded_at<?
       ORDER BY u.recorded_at,u.id
       FOR UPDATE`,
      [cycle.tenant_id,cycle.period_start,cycle.period_end]
    );
    for(const row of usageRows){
      if(row.settled_cycle_id&&row.settled_cycle_id!==cycleId) throw errorOf('Usage row already settled to another billing cycle','BILLING_USAGE_ALREADY_SETTLED',409,{usageLedgerId:row.id});
      if(row.cost_status!=='CALCULATED'||row.estimated_cost==null) throw errorOf('Usage contains unknown cost; invoice cannot be finalized','BILLING_USAGE_COST_UNKNOWN',409,{usageLedgerId:row.id});
      if(row.cost_currency!==cycle.currency) throw errorOf('Usage currency does not match billing cycle currency','BILLING_CURRENCY_MISMATCH',409,{usageLedgerId:row.id,costCurrency:row.cost_currency,billingCurrency:cycle.currency});
    }

    let includedRemaining=toUnits(cycle.included_usage_credit_snapshot);
    let providerTotal=0n,includedConsumed=0n,overageCost=0n,usageRevenue=0n;
    const settlements=[];
    for(const row of usageRows){
      const cost=toUnits(row.estimated_cost);
      providerTotal+=cost;
      const covered=minUnits(cost,includedRemaining);
      includedRemaining-=covered;
      includedConsumed+=covered;
      const billable=cost-covered;
      if(cycle.overage_mode_snapshot==='BLOCK'&&billable>0n){
        throw errorOf('Usage exceeded included allowance for a BLOCK overage plan','BILLING_OVERAGE_BLOCKED',409,{usageLedgerId:row.id});
      }
      const revenue=cycle.overage_mode_snapshot==='PAYG'
        ? (billable*BigInt(10000+Number(cycle.overage_markup_bps_snapshot)))/10000n
        : 0n;
      overageCost+=billable;
      usageRevenue+=revenue;
      settlements.push({row,cost,covered,billable,revenue});
    }

    const recurring=toUnits(cycle.recurring_fee_snapshot);
    const subtotal=recurring+usageRevenue;
    const [creditRows]=await connection.execute(
      'SELECT amount FROM credit_ledger WHERE tenant_id=? AND currency=? ORDER BY created_at,id FOR UPDATE',
      [cycle.tenant_id,cycle.currency]
    );
    const availableCredit=creditRows.reduce((sum,row)=>sum+toUnits(row.amount),0n);
    const creditApplied=availableCredit>0n?minUnits(availableCredit,subtotal):0n;
    const totalDue=subtotal-creditApplied;

    const invoiceId=randomUUID();
    const invoiceNumber=`INV-${String(cycle.id).replaceAll('-','').slice(0,16).toUpperCase()}`;
    const dueAt=new Date(now.getTime()+Number(cycle.payment_due_days_snapshot)*86400000);
    await connection.execute(
      `INSERT INTO invoices (
        id,invoice_number,tenant_id,subscription_id,billing_cycle_id,currency,
        subtotal,credit_applied,total_due,status,issued_at,due_at,metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,'FINALIZED',?,?,?)`,
      [invoiceId,invoiceNumber,cycle.tenant_id,cycle.subscription_id,cycle.id,cycle.currency,
       unitsToString(subtotal),unitsToString(creditApplied),unitsToString(totalDue),now,dueAt,
       asJson({providerCostTotal:unitsToNumber(providerTotal),revenueBasis:'COST_PLUS_SNAPSHOT'})]
    );

    if(recurring>0n){
      await connection.execute(
        `INSERT INTO invoice_items (id,invoice_id,item_type,description,quantity,unit_amount,amount)
         VALUES (?,?,'BASE_SUBSCRIPTION','Subscription recurring fee',1,?,?)`,
        [randomUUID(),invoiceId,unitsToString(recurring),unitsToString(recurring)]
      );
    }
    if(usageRevenue>0n){
      await connection.execute(
        `INSERT INTO invoice_items (id,invoice_id,item_type,description,quantity,unit_amount,amount,metadata_json)
         VALUES (?,?,'USAGE_OVERAGE','Usage overage revenue',1,?,?,?)`,
        [randomUUID(),invoiceId,unitsToString(usageRevenue),unitsToString(usageRevenue),
         asJson({providerCostBasis:unitsToNumber(overageCost),markupBps:Number(cycle.overage_markup_bps_snapshot)})]
      );
    }
    if(creditApplied>0n){
      await connection.execute(
        `INSERT INTO invoice_items (id,invoice_id,item_type,description,quantity,unit_amount,amount)
         VALUES (?,?,'CREDIT_APPLIED','Service credit applied',1,?,?)`,
        [randomUUID(),invoiceId,unitsToString(-creditApplied),unitsToString(-creditApplied)]
      );
      await connection.execute(
        `INSERT INTO credit_ledger (
          id,tenant_id,subscription_id,billing_cycle_id,invoice_id,entry_type,amount,currency,idempotency_key,note
        ) VALUES (?,?,?,?,?,'APPLY',?,?,?,?)`,
        [randomUUID(),cycle.tenant_id,cycle.subscription_id,cycle.id,invoiceId,unitsToString(-creditApplied),
         cycle.currency,`invoice:${invoiceId}:apply`,'Applied during invoice finalization']
      );
    }

    for(const item of settlements){
      await connection.execute(
        `INSERT INTO billing_usage_settlements (
          usage_ledger_id,tenant_id,billing_cycle_id,invoice_id,provider_cost_amount,
          included_credit_amount,overage_cost_basis,revenue_amount,currency,calculation_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [item.row.id,cycle.tenant_id,cycle.id,invoiceId,unitsToString(item.cost),unitsToString(item.covered),
         unitsToString(item.billable),unitsToString(item.revenue),cycle.currency,
         asJson({markupBps:Number(cycle.overage_markup_bps_snapshot),formula:'COST_PLUS_AFTER_INCLUDED_USAGE_CREDIT'})]
      );
    }

    await connection.execute(
      `UPDATE billing_cycles SET status='INVOICED',provider_cost_total=?,included_usage_consumed=?,
       overage_cost_basis=?,usage_revenue=?,invoice_subtotal=?,credit_applied=?,total_due=?,finalized_at=?
       WHERE id=?`,
      [unitsToString(providerTotal),unitsToString(includedConsumed),unitsToString(overageCost),
       unitsToString(usageRevenue),unitsToString(subtotal),unitsToString(creditApplied),
       unitsToString(totalDue),now,cycle.id]
    );

    const [subs]=await connection.execute('SELECT * FROM subscriptions WHERE id=? FOR UPDATE',[cycle.subscription_id]);
    if(subs.length&&subs[0].status==='ACTIVE'){
      if(Boolean(subs[0].cancel_at_period_end)){
        await connection.execute("UPDATE subscriptions SET status='CANCELED',canceled_at=? WHERE id=?",[now,cycle.subscription_id]);
      }else{
        const [terms]=await connection.execute('SELECT * FROM plan_billing_terms WHERE id=?',[cycle.billing_term_id]);
        await createCycleRow(connection,{
          subscription:subs[0],term:terms[0],cycleNo:Number(cycle.cycle_no)+1,periodStart:new Date(cycle.period_end)
        });
      }
    }

    const [invoiceRows]=await connection.execute('SELECT * FROM invoices WHERE id=?',[invoiceId]);
    const result=await invoiceWithItems(connection,invoiceRows[0]);
    await connection.commit();
    return {...result,idempotent:false};
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{connection.release();}
};

export const reconcileBillingCycle=async cycleId=>{
  const db=getRuntimePool();
  const [cycles]=await db.execute('SELECT * FROM billing_cycles WHERE id=?',[cycleId]);
  if(!cycles.length) throw errorOf('Billing cycle not found','BILLING_CYCLE_NOT_FOUND',404);
  const cycle=cycles[0];
  const [invoices]=await db.execute('SELECT * FROM invoices WHERE billing_cycle_id=?',[cycleId]);
  if(!invoices.length) return {cycleId,status:'OPEN',reconciled:false,checks:[]};
  const invoice=invoices[0];
  const [[settled]]=await db.execute(
    `SELECT COALESCE(SUM(provider_cost_amount),0) AS provider_cost,
            COALESCE(SUM(revenue_amount),0) AS usage_revenue
     FROM billing_usage_settlements WHERE billing_cycle_id=?`,
    [cycleId]
  );
  const [[items]]=await db.execute(
    'SELECT COALESCE(SUM(amount),0) AS item_total FROM invoice_items WHERE invoice_id=?',
    [invoice.id]
  );
  const checks=[
    {key:'PROVIDER_COST',pass:toUnits(settled.provider_cost||0)===toUnits(cycle.provider_cost_total||0)},
    {key:'USAGE_REVENUE',pass:toUnits(settled.usage_revenue||0)===toUnits(cycle.usage_revenue||0)},
    {key:'INVOICE_ITEMS',pass:toUnits(items.item_total||0)===toUnits(invoice.total_due||0)},
    {key:'INVOICE_TOTAL',pass:toUnits(invoice.subtotal)-toUnits(invoice.credit_applied)===toUnits(invoice.total_due)}
  ];
  return {cycleId,invoiceId:invoice.id,status:checks.every(x=>x.pass)?'PASS':'FAIL',reconciled:checks.every(x=>x.pass),checks};
};


export const recordInvoicePayment=async({
  invoiceId,amount,currency=null,idempotencyKey,paymentReference=null,receivedAt=new Date(),metadata=null
}={})=>{
  if(!invoiceId||!idempotencyKey) throw errorOf('invoiceId and idempotencyKey are required','INVALID_INVOICE_PAYMENT');
  const amountUnits=toUnits(amount);
  if(amountUnits<=0n) throw errorOf('Payment amount must be positive','INVALID_PAYMENT_AMOUNT');
  rejectSecrets(metadata);
  const received=parseDate(receivedAt);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();

    const [existing]=await connection.execute(
      'SELECT * FROM invoice_payments WHERE idempotency_key=? LIMIT 1 FOR UPDATE',
      [idempotencyKey]
    );
    if(existing.length){
      const row=existing[0];
      if(row.invoice_id!==invoiceId||toUnits(row.amount)!==amountUnits){
        throw errorOf('Idempotency key was already used for a different payment','PAYMENT_IDEMPOTENCY_CONFLICT',409);
      }
      const [invoiceRows]=await connection.execute('SELECT * FROM invoices WHERE id=?',[invoiceId]);
      await connection.commit();
      return {payment:normalizePayment(row),invoice:normalizeInvoice(invoiceRows[0]),idempotent:true};
    }

    const [invoiceRows]=await connection.execute('SELECT * FROM invoices WHERE id=? FOR UPDATE',[invoiceId]);
    if(!invoiceRows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
    const invoice=invoiceRows[0];
    const paymentCurrency=String(currency||invoice.currency).toUpperCase();
    if(paymentCurrency!==invoice.currency) throw errorOf('Payment currency does not match invoice','PAYMENT_CURRENCY_MISMATCH',409);

    const totalDue=toUnits(invoice.total_due);
    const alreadyPaid=toUnits(invoice.amount_paid||0);
    const outstanding=totalDue-alreadyPaid;
    if(outstanding<=0n) throw errorOf('Invoice is already fully paid','INVOICE_ALREADY_PAID',409);
    if(amountUnits>outstanding) throw errorOf('Payment exceeds invoice outstanding amount','PAYMENT_EXCEEDS_OUTSTANDING',409,{
      outstandingAmount:unitsToNumber(outstanding)
    });

    const paymentId=randomUUID();
    await connection.execute(
      `INSERT INTO invoice_payments (
        id,invoice_id,tenant_id,amount,currency,payment_reference,idempotency_key,received_at,metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [paymentId,invoice.id,invoice.tenant_id,unitsToString(amountUnits),paymentCurrency,
       paymentReference||null,idempotencyKey,received,asJson(metadata)]
    );

    const newPaid=alreadyPaid+amountUnits;
    const fullyPaid=newPaid===totalDue;
    await connection.execute(
      'UPDATE invoices SET amount_paid=?, status=?, paid_at=? WHERE id=?',
      [unitsToString(newPaid),fullyPaid?'PAID':'PARTIALLY_PAID',fullyPaid?received:null,invoiceId]
    );

    const [paymentRows]=await connection.execute('SELECT * FROM invoice_payments WHERE id=?',[paymentId]);
    const [updatedInvoices]=await connection.execute('SELECT * FROM invoices WHERE id=?',[invoiceId]);
    await connection.commit();
    return {payment:normalizePayment(paymentRows[0]),invoice:normalizeInvoice(updatedInvoices[0]),idempotent:false};
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{connection.release();}
};

export const listInvoicePayments=async invoiceId=>{
  const db=getRuntimePool();
  const [invoiceRows]=await db.execute('SELECT id FROM invoices WHERE id=?',[invoiceId]);
  if(!invoiceRows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  const [rows]=await db.execute(
    'SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY received_at,id',
    [invoiceId]
  );
  return rows.map(normalizePayment);
};

export const getBillingOperationsSummary=async({tenantId=null,asOf=new Date()}={})=>{
  const db=getRuntimePool();
  const at=parseDate(asOf);
  const params=[at,at];
  let where='';
  if(tenantId){where='WHERE tenant_id=?';params.push(tenantId);}
  const [rows]=await db.execute(
    `SELECT
       currency,
       COUNT(*) AS invoice_count,
       SUM(CASE WHEN total_due>amount_paid THEN 1 ELSE 0 END) AS open_invoice_count,
       SUM(CASE WHEN total_due<=amount_paid THEN 1 ELSE 0 END) AS paid_invoice_count,
       SUM(CASE WHEN due_at<? AND total_due>amount_paid THEN 1 ELSE 0 END) AS overdue_invoice_count,
       COALESCE(SUM(total_due),0) AS total_billed,
       COALESCE(SUM(amount_paid),0) AS amount_paid,
       COALESCE(SUM(GREATEST(total_due-amount_paid,0)),0) AS outstanding,
       COALESCE(SUM(CASE WHEN due_at<? THEN GREATEST(total_due-amount_paid,0) ELSE 0 END),0) AS overdue_outstanding
     FROM invoices
     ${where}
     GROUP BY currency
     ORDER BY currency`,
    params
  );
  return {
    tenantId,
    asOf:at,
    currencies:rows.map(row=>({
      currency:row.currency,
      invoiceCount:Number(row.invoice_count),
      openInvoiceCount:Number(row.open_invoice_count),
      paidInvoiceCount:Number(row.paid_invoice_count),
      overdueInvoiceCount:Number(row.overdue_invoice_count),
      totalBilled:Number(row.total_billed),
      amountPaid:Number(row.amount_paid),
      outstanding:Number(row.outstanding),
      overdueOutstanding:Number(row.overdue_outstanding)
    }))
  };
};

export const listReceivables=async({tenantId=null,status='OPEN',asOf=new Date(),limit=100}={})=>{
  const normalizedStatus=String(status||'OPEN').toUpperCase();
  if(!['OPEN','OVERDUE','ALL'].includes(normalizedStatus)) throw errorOf('status must be OPEN, OVERDUE, or ALL','INVALID_RECEIVABLE_STATUS');
  const parsedLimit=Number(limit);
  if(!Number.isInteger(parsedLimit)||parsedLimit<1||parsedLimit>500) throw errorOf('limit must be an integer from 1 to 500','INVALID_RECEIVABLE_LIMIT');
  const at=parseDate(asOf);
  const clauses=[],params=[];
  if(tenantId){clauses.push('tenant_id=?');params.push(tenantId);}
  if(normalizedStatus==='OPEN') clauses.push('total_due>amount_paid');
  if(normalizedStatus==='OVERDUE'){clauses.push('total_due>amount_paid');clauses.push('due_at<?');params.push(at);}
  const sql=`SELECT * FROM invoices ${clauses.length?'WHERE '+clauses.join(' AND '):''}
    ORDER BY due_at ASC,issued_at ASC,id ASC LIMIT ${parsedLimit}`;
  const [rows]=await db.execute(sql,params);
  return rows.map(row=>{
    const invoice=normalizeInvoice(row);
    return {...invoice,overdue:invoice.outstandingAmount>0&&new Date(invoice.dueAt).getTime()<at.getTime()};
  });
};
