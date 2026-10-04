import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SCALE=10000000000n;
const ADJUSTMENT_TYPES=new Set(['CREDIT_NOTE','WRITE_OFF','DEBIT_ADJUSTMENT']);
const DISPUTE_ACTIONS=new Set(['UNDER_REVIEW','ACCEPT','REJECT']);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Financial metadata must not persist credentials or secrets','FINANCIAL_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const asJson=value=>value==null?null:JSON.stringify(value);
const parseDate=value=>{
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw errorOf('Invalid financial event date','INVALID_FINANCIAL_DATE');
  return date;
};
const toUnits=value=>{
  const text=String(value??0).trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(text)) throw errorOf('Invalid financial amount','INVALID_FINANCIAL_AMOUNT');
  const negative=text.startsWith('-'),raw=negative?text.slice(1):text;
  const [whole,fraction='']=raw.split('.');
  const units=BigInt(whole)*SCALE+BigInt((fraction+'0000000000').slice(0,10));
  return negative?-units:units;
};
const unitsToString=units=>{
  const negative=units<0n,abs=negative?-units:units;
  return `${negative?'-':''}${abs/SCALE}.${String(abs%SCALE).padStart(10,'0')}`;
};
const unitsToNumber=units=>Number(unitsToString(units));
const normalizeAdjustment=row=>({
  id:row.id,invoiceId:row.invoice_id,tenantId:row.tenant_id,adjustmentType:row.adjustment_type,
  amount:Number(row.amount),currency:row.currency,reasonCode:row.reason_code,
  sourceDisputeId:row.source_dispute_id||null,idempotencyKey:row.idempotency_key,
  effectiveAt:row.effective_at,metadata:row.metadata_json,createdAt:row.created_at
});
const normalizeRefund=row=>({
  id:row.id,paymentId:row.payment_id,invoiceId:row.invoice_id,tenantId:row.tenant_id,
  amount:Number(row.amount),currency:row.currency,refundReference:row.refund_reference||null,
  idempotencyKey:row.idempotency_key,refundedAt:row.refunded_at,
  metadata:row.metadata_json,createdAt:row.created_at
});
const normalizeDispute=row=>({
  id:row.id,invoiceId:row.invoice_id,tenantId:row.tenant_id,status:row.status,
  disputedAmount:Number(row.disputed_amount),acceptedAmount:Number(row.accepted_amount||0),
  currency:row.currency,reasonCode:row.reason_code,openedAt:row.opened_at,
  resolvedAt:row.resolved_at||null,resolutionNote:row.resolution_note||null,
  metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeDisputeAction=row=>({
  id:row.id,disputeId:row.dispute_id,invoiceId:row.invoice_id,tenantId:row.tenant_id,
  actionType:row.action_type,amount:row.amount==null?null:Number(row.amount),
  idempotencyKey:row.idempotency_key,occurredAt:row.occurred_at,
  metadata:row.metadata_json,createdAt:row.created_at
});

export const getInvoiceFinancialPosition=async(db,invoiceId,{asOf=new Date(),lockInvoice=false}={})=>{
  const at=parseDate(asOf);
  const [invoiceRows]=await db.execute(
    `SELECT * FROM invoices WHERE id=?${lockInvoice?' FOR UPDATE':''}`,
    [invoiceId]
  );
  if(!invoiceRows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  const invoice=invoiceRows[0];
  const [[payments]]=await db.execute(
    'SELECT COALESCE(SUM(amount),0) AS gross_paid FROM invoice_payments WHERE invoice_id=? AND received_at<=?',
    [invoiceId,at]
  );
  const [[refunds]]=await db.execute(
    'SELECT COALESCE(SUM(amount),0) AS refund_total FROM payment_refunds WHERE invoice_id=? AND refunded_at<=?',
    [invoiceId,at]
  );
  const [[adjustments]]=await db.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN adjustment_type='CREDIT_NOTE' THEN amount ELSE 0 END),0) AS credit_notes,
       COALESCE(SUM(CASE WHEN adjustment_type='WRITE_OFF' THEN amount ELSE 0 END),0) AS write_offs,
       COALESCE(SUM(CASE WHEN adjustment_type='DEBIT_ADJUSTMENT' THEN amount ELSE 0 END),0) AS debit_adjustments
     FROM invoice_adjustments WHERE invoice_id=? AND effective_at<=?`,
    [invoiceId,at]
  );
  const original=toUnits(invoice.total_due);
  const grossPaid=toUnits(payments.gross_paid||0);
  const refundTotal=toUnits(refunds.refund_total||0);
  const creditNotes=toUnits(adjustments.credit_notes||0);
  const writeOffs=toUnits(adjustments.write_offs||0);
  const debitAdjustments=toUnits(adjustments.debit_adjustments||0);
  const adjustedBilled=original+debitAdjustments-creditNotes;
  const collectible=adjustedBilled-writeOffs;
  const netCollected=grossPaid-refundTotal;
  const outstanding=collectible>netCollected?collectible-netCollected:0n;
  const overpaid=netCollected>collectible?netCollected-collectible:0n;
  return {
    invoice,
    asOf:at,
    originalTotalDue:unitsToNumber(original),
    creditNotes:unitsToNumber(creditNotes),
    writeOffs:unitsToNumber(writeOffs),
    debitAdjustments:unitsToNumber(debitAdjustments),
    adjustedBilledRevenue:unitsToNumber(adjustedBilled),
    collectibleAmount:unitsToNumber(collectible),
    grossPaid:unitsToNumber(grossPaid),
    refundTotal:unitsToNumber(refundTotal),
    netCollected:unitsToNumber(netCollected),
    outstandingAmount:unitsToNumber(outstanding),
    overpaidAmount:unitsToNumber(overpaid),
    _units:{original,grossPaid,refundTotal,creditNotes,writeOffs,debitAdjustments,adjustedBilled,collectible,netCollected,outstanding,overpaid}
  };
};

const syncInvoiceAndCollection=async(connection,invoiceId,occurredAt,reason)=>{
  const position=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:occurredAt,lockInvoice:true});
  const u=position._units;
  let status='FINALIZED',paidAt=null;
  if(u.outstanding===0n){
    status=(u.creditNotes>0n||u.writeOffs>0n||u.debitAdjustments>0n||u.refundTotal>0n)?'SETTLED':'PAID';
    if(status==='PAID') paidAt=occurredAt;
  }else if(u.netCollected>0n){
    status='PARTIALLY_PAID';
  }
  await connection.execute('UPDATE invoices SET status=?,paid_at=? WHERE id=?',[status,paidAt,invoiceId]);

  const [cases]=await connection.execute('SELECT * FROM collection_cases WHERE invoice_id=? LIMIT 1 FOR UPDATE',[invoiceId]);
  if(cases.length){
    const current=cases[0];
    if(u.outstanding===0n&&current.status!=='RESOLVED'){
      await connection.execute(
        `UPDATE collection_cases SET status='RESOLVED',next_action_at=NULL,resolved_at=?,resolution_code=? WHERE id=?`,
        [occurredAt,reason,current.id]
      );
      await connection.execute(
        `INSERT INTO collection_actions
         (id,case_id,invoice_id,tenant_id,action_type,amount,promise_due_at,idempotency_key,metadata_json,occurred_at)
         VALUES (?,?,?,?, 'AUTO_RESOLVED_ADJUSTMENT',NULL,NULL,?,NULL,?)`,
        [randomUUID(),current.id,invoiceId,current.tenant_id,`auto-financial-resolve:${reason}:${invoiceId}:${occurredAt.toISOString()}`,occurredAt]
      );
    }else if(u.outstanding>0n&&current.status==='RESOLVED'){
      await connection.execute(
        `UPDATE collection_cases SET status='OPEN',resolved_at=NULL,resolution_code=NULL,next_action_at=? WHERE id=?`,
        [occurredAt,current.id]
      );
      await connection.execute(
        `INSERT INTO collection_actions
         (id,case_id,invoice_id,tenant_id,action_type,amount,promise_due_at,idempotency_key,metadata_json,occurred_at)
         VALUES (?,?,?,?, 'AUTO_REOPEN_FINANCIAL',NULL,NULL,?,NULL,?)`,
        [randomUUID(),current.id,invoiceId,current.tenant_id,`auto-financial-reopen:${reason}:${invoiceId}:${occurredAt.toISOString()}`,occurredAt]
      );
    }
  }
  return position;
};

export const createInvoiceAdjustment=async({
  invoiceId,adjustmentType,amount,currency=null,reasonCode,idempotencyKey,
  effectiveAt=new Date(),sourceDisputeId=null,metadata=null
}={})=>{
  if(!invoiceId||!adjustmentType||!reasonCode||!idempotencyKey) throw errorOf(
    'invoiceId, adjustmentType, reasonCode and idempotencyKey are required','INVALID_INVOICE_ADJUSTMENT'
  );
  const type=String(adjustmentType).toUpperCase();
  if(!ADJUSTMENT_TYPES.has(type)) throw errorOf('Unsupported invoice adjustment type','INVALID_ADJUSTMENT_TYPE');
  const amountUnits=toUnits(amount);
  if(amountUnits<=0n) throw errorOf('Adjustment amount must be positive','INVALID_ADJUSTMENT_AMOUNT');
  const effective=parseDate(effectiveAt);
  if(effective.getTime()>Date.now()+60000) throw errorOf('Future-dated adjustments are not supported','FUTURE_ADJUSTMENT_NOT_ALLOWED');
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT * FROM invoice_adjustments WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existing.length){
      const row=existing[0];
      if(row.invoice_id!==invoiceId||row.adjustment_type!==type||toUnits(row.amount)!==amountUnits){
        throw errorOf('Idempotency key was already used for a different adjustment','ADJUSTMENT_IDEMPOTENCY_CONFLICT',409);
      }
      const position=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:new Date()});
      await connection.commit();
      return {adjustment:normalizeAdjustment(row),position:{...position,_units:undefined},idempotent:true};
    }
    const before=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:new Date(),lockInvoice:true});
    const invoice=before.invoice;
    const normalizedCurrency=String(currency||invoice.currency).toUpperCase();
    if(normalizedCurrency!==invoice.currency) throw errorOf('Adjustment currency does not match invoice','ADJUSTMENT_CURRENCY_MISMATCH',409);
    if(effective.getTime()<new Date(invoice.issued_at).getTime()) throw errorOf('Adjustment cannot predate invoice issuance','ADJUSTMENT_PREDATES_INVOICE',409);
    if(type==='WRITE_OFF'&&amountUnits>before._units.outstanding){
      throw errorOf('Write-off exceeds current outstanding balance','WRITE_OFF_EXCEEDS_OUTSTANDING',409,{outstandingAmount:before.outstandingAmount});
    }
    if(type==='CREDIT_NOTE'&&amountUnits>before._units.adjustedBilled){
      throw errorOf('Credit note exceeds adjusted billed revenue','CREDIT_NOTE_EXCEEDS_BILLED',409,{adjustedBilledRevenue:before.adjustedBilledRevenue});
    }
    const id=randomUUID();
    await connection.execute(
      `INSERT INTO invoice_adjustments
       (id,invoice_id,tenant_id,adjustment_type,amount,currency,reason_code,source_dispute_id,idempotency_key,effective_at,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id,invoiceId,invoice.tenant_id,type,unitsToString(amountUnits),normalizedCurrency,reasonCode,
       sourceDisputeId||null,idempotencyKey,effective,asJson(metadata)]
    );
    await syncInvoiceAndCollection(connection,invoiceId,new Date(),type);
    const [rows]=await connection.execute('SELECT * FROM invoice_adjustments WHERE id=?',[id]);
    const after=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:new Date()});
    await connection.commit();
    return {adjustment:normalizeAdjustment(rows[0]),position:{...after,_units:undefined},idempotent:false};
  }catch(error){
    await connection.rollback();throw error;
  }finally{connection.release();}
};

export const recordPaymentRefund=async({
  paymentId,amount,idempotencyKey,refundReference=null,refundedAt=new Date(),metadata=null
}={})=>{
  if(!paymentId||!idempotencyKey) throw errorOf('paymentId and idempotencyKey are required','INVALID_PAYMENT_REFUND');
  const amountUnits=toUnits(amount);
  if(amountUnits<=0n) throw errorOf('Refund amount must be positive','INVALID_REFUND_AMOUNT');
  const refunded=parseDate(refundedAt);
  if(refunded.getTime()>Date.now()+60000) throw errorOf('Future-dated refunds are not supported','FUTURE_REFUND_NOT_ALLOWED');
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT * FROM payment_refunds WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existing.length){
      const row=existing[0];
      if(row.payment_id!==paymentId||toUnits(row.amount)!==amountUnits) throw errorOf(
        'Idempotency key was already used for a different refund','REFUND_IDEMPOTENCY_CONFLICT',409
      );
      const position=await getInvoiceFinancialPosition(connection,row.invoice_id,{asOf:new Date()});
      await connection.commit();
      return {refund:normalizeRefund(row),position:{...position,_units:undefined},idempotent:true};
    }
    const [payments]=await connection.execute('SELECT * FROM invoice_payments WHERE id=? FOR UPDATE',[paymentId]);
    if(!payments.length) throw errorOf('Invoice payment not found','PAYMENT_NOT_FOUND',404);
    const payment=payments[0];
    if(refunded.getTime()<new Date(payment.received_at).getTime()) throw errorOf('Refund cannot predate payment','REFUND_PREDATES_PAYMENT',409);
    const [[refundedRow]]=await connection.execute(
      'SELECT COALESCE(SUM(amount),0) AS total_refunded FROM payment_refunds WHERE payment_id=?',
      [paymentId]
    );
    const remaining=toUnits(payment.amount)-toUnits(refundedRow.total_refunded||0);
    if(amountUnits>remaining) throw errorOf('Refund exceeds refundable payment amount','REFUND_EXCEEDS_PAYMENT',409,{refundableAmount:unitsToNumber(remaining)});
    const id=randomUUID();
    await connection.execute(
      `INSERT INTO payment_refunds
       (id,payment_id,invoice_id,tenant_id,amount,currency,refund_reference,idempotency_key,refunded_at,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id,payment.id,payment.invoice_id,payment.tenant_id,unitsToString(amountUnits),payment.currency,
       refundReference||null,idempotencyKey,refunded,asJson(metadata)]
    );
    await syncInvoiceAndCollection(connection,payment.invoice_id,new Date(),'REFUND');
    const [rows]=await connection.execute('SELECT * FROM payment_refunds WHERE id=?',[id]);
    const after=await getInvoiceFinancialPosition(connection,payment.invoice_id,{asOf:new Date()});
    await connection.commit();
    return {refund:normalizeRefund(rows[0]),position:{...after,_units:undefined},idempotent:false};
  }catch(error){
    await connection.rollback();throw error;
  }finally{connection.release();}
};

export const listInvoiceAdjustments=async invoiceId=>{
  const db=getRuntimePool();
  const [invoices]=await db.execute('SELECT id FROM invoices WHERE id=?',[invoiceId]);
  if(!invoices.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  const [rows]=await db.execute('SELECT * FROM invoice_adjustments WHERE invoice_id=? ORDER BY effective_at,id',[invoiceId]);
  return rows.map(normalizeAdjustment);
};
export const listInvoiceRefunds=async invoiceId=>{
  const db=getRuntimePool();
  const [invoices]=await db.execute('SELECT id FROM invoices WHERE id=?',[invoiceId]);
  if(!invoices.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
  const [rows]=await db.execute('SELECT * FROM payment_refunds WHERE invoice_id=? ORDER BY refunded_at,id',[invoiceId]);
  return rows.map(normalizeRefund);
};
export const getInvoiceFinancialSummary=async(invoiceId,{asOf=new Date()}={})=>{
  const db=getRuntimePool();
  const position=await getInvoiceFinancialPosition(db,invoiceId,{asOf});
  return {...position,_units:undefined,invoice:undefined,invoiceId,tenantId:position.invoice.tenant_id,currency:position.invoice.currency};
};

export const openBillingDispute=async({
  invoiceId,disputedAmount,currency=null,reasonCode,idempotencyKey,openedAt=new Date(),metadata=null
}={})=>{
  if(!invoiceId||!reasonCode||!idempotencyKey) throw errorOf('invoiceId, reasonCode and idempotencyKey are required','INVALID_BILLING_DISPUTE');
  const amountUnits=toUnits(disputedAmount);
  if(amountUnits<=0n) throw errorOf('Disputed amount must be positive','INVALID_DISPUTED_AMOUNT');
  const opened=parseDate(openedAt);rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existingAction]=await connection.execute('SELECT * FROM billing_dispute_actions WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existingAction.length){
      const [drows]=await connection.execute('SELECT * FROM billing_disputes WHERE id=?',[existingAction[0].dispute_id]);
      await connection.commit();
      return {...normalizeDispute(drows[0]),idempotent:true};
    }
    const position=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:new Date(),lockInvoice:true});
    if(amountUnits>position._units.outstanding) throw errorOf('Disputed amount exceeds current outstanding balance','DISPUTE_EXCEEDS_OUTSTANDING',409,{outstandingAmount:position.outstandingAmount});
    const invoice=position.invoice,normalizedCurrency=String(currency||invoice.currency).toUpperCase();
    if(normalizedCurrency!==invoice.currency) throw errorOf('Dispute currency does not match invoice','DISPUTE_CURRENCY_MISMATCH',409);
    const [active]=await connection.execute(
      `SELECT id FROM billing_disputes WHERE invoice_id=? AND status IN ('OPEN','UNDER_REVIEW') LIMIT 1 FOR UPDATE`,
      [invoiceId]
    );
    if(active.length) throw errorOf('Invoice already has an active dispute','ACTIVE_DISPUTE_EXISTS',409,{disputeId:active[0].id});
    const id=randomUUID(),actionId=randomUUID();
    await connection.execute(
      `INSERT INTO billing_disputes
       (id,invoice_id,tenant_id,status,disputed_amount,accepted_amount,currency,reason_code,opened_at,metadata_json)
       VALUES (?,?,?,'OPEN',?,0,?,?,?,?)`,
      [id,invoiceId,invoice.tenant_id,unitsToString(amountUnits),normalizedCurrency,reasonCode,opened,asJson(metadata)]
    );
    await connection.execute(
      `INSERT INTO billing_dispute_actions
       (id,dispute_id,invoice_id,tenant_id,action_type,amount,idempotency_key,occurred_at,metadata_json)
       VALUES (?,?,?,?, 'OPEN', ?,?,?,?)`,
      [actionId,id,invoiceId,invoice.tenant_id,unitsToString(amountUnits),idempotencyKey,opened,asJson(metadata)]
    );
    const [rows]=await connection.execute('SELECT * FROM billing_disputes WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeDispute(rows[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const recordBillingDisputeAction=async({
  disputeId,actionType,idempotencyKey,acceptedAmount=null,resolutionNote=null,occurredAt=new Date(),metadata=null
}={})=>{
  if(!disputeId||!actionType||!idempotencyKey) throw errorOf('disputeId, actionType and idempotencyKey are required','INVALID_DISPUTE_ACTION');
  const type=String(actionType).toUpperCase();
  if(!DISPUTE_ACTIONS.has(type)) throw errorOf('actionType must be UNDER_REVIEW, ACCEPT, or REJECT','INVALID_DISPUTE_ACTION_TYPE');
  const occurred=parseDate(occurredAt);rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT * FROM billing_dispute_actions WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existing.length){
      const [drows]=await connection.execute('SELECT * FROM billing_disputes WHERE id=?',[existing[0].dispute_id]);
      await connection.commit();
      return {action:normalizeDisputeAction(existing[0]),dispute:normalizeDispute(drows[0]),idempotent:true};
    }
    const [rows]=await connection.execute('SELECT * FROM billing_disputes WHERE id=? FOR UPDATE',[disputeId]);
    if(!rows.length) throw errorOf('Billing dispute not found','BILLING_DISPUTE_NOT_FOUND',404);
    const dispute=rows[0];
    if(dispute.status.startsWith('RESOLVED_')) throw errorOf('Billing dispute is already resolved','BILLING_DISPUTE_RESOLVED',409);
    let actionAmount=null,status=dispute.status,resolvedAt=null,accepted=toUnits(dispute.accepted_amount||0);
    if(type==='UNDER_REVIEW'){
      status='UNDER_REVIEW';
    }else if(type==='ACCEPT'){
      actionAmount=toUnits(acceptedAmount??dispute.disputed_amount);
      if(actionAmount<=0n||actionAmount>toUnits(dispute.disputed_amount)) throw errorOf('Accepted amount must be positive and cannot exceed disputed amount','INVALID_ACCEPTED_AMOUNT');
      const position=await getInvoiceFinancialPosition(connection,dispute.invoice_id,{asOf:new Date(),lockInvoice:true});
      if(actionAmount>position._units.adjustedBilled) throw errorOf('Accepted dispute credit exceeds adjusted billed revenue','DISPUTE_CREDIT_EXCEEDS_BILLED',409);
      const adjustmentId=randomUUID();
      await connection.execute(
        `INSERT INTO invoice_adjustments
         (id,invoice_id,tenant_id,adjustment_type,amount,currency,reason_code,source_dispute_id,idempotency_key,effective_at,metadata_json)
         VALUES (?,?,?,'CREDIT_NOTE',?,?,?,?,?,?,?)`,
        [adjustmentId,dispute.invoice_id,dispute.tenant_id,unitsToString(actionAmount),dispute.currency,
         'DISPUTE_ACCEPTED',dispute.id,`dispute-credit:${idempotencyKey}`,occurred,asJson({disputeId,source:'M23.4_DISPUTE'})]
      );
      accepted=actionAmount;status='RESOLVED_ACCEPTED';resolvedAt=occurred;
      await syncInvoiceAndCollection(connection,dispute.invoice_id,new Date(),'DISPUTE_ACCEPTED');
    }else{
      accepted=0n;status='RESOLVED_REJECTED';resolvedAt=occurred;
    }
    const actionId=randomUUID();
    await connection.execute(
      `INSERT INTO billing_dispute_actions
       (id,dispute_id,invoice_id,tenant_id,action_type,amount,idempotency_key,occurred_at,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [actionId,dispute.id,dispute.invoice_id,dispute.tenant_id,type,actionAmount==null?null:unitsToString(actionAmount),
       idempotencyKey,occurred,asJson(metadata)]
    );
    await connection.execute(
      'UPDATE billing_disputes SET status=?,accepted_amount=?,resolved_at=?,resolution_note=? WHERE id=?',
      [status,unitsToString(accepted),resolvedAt,resolutionNote||dispute.resolution_note,dispute.id]
    );
    const [actionRows]=await connection.execute('SELECT * FROM billing_dispute_actions WHERE id=?',[actionId]);
    const [updated]=await connection.execute('SELECT * FROM billing_disputes WHERE id=?',[dispute.id]);
    await connection.commit();
    return {action:normalizeDisputeAction(actionRows[0]),dispute:normalizeDispute(updated[0]),idempotent:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
};

export const getBillingDispute=async disputeId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM billing_disputes WHERE id=?',[disputeId]);
  if(!rows.length) throw errorOf('Billing dispute not found','BILLING_DISPUTE_NOT_FOUND',404);
  const [actions]=await db.execute('SELECT * FROM billing_dispute_actions WHERE dispute_id=? ORDER BY occurred_at,id',[disputeId]);
  return {...normalizeDispute(rows[0]),actions:actions.map(normalizeDisputeAction)};
};
export const listBillingDisputes=async({tenantId=null,status='ACTIVE',limit=100}={})=>{
  const normalized=String(status||'ACTIVE').toUpperCase();
  if(!['ACTIVE','OPEN','UNDER_REVIEW','RESOLVED_ACCEPTED','RESOLVED_REJECTED','ALL'].includes(normalized)) throw errorOf('Invalid dispute status','INVALID_DISPUTE_STATUS');
  const parsed=Number(limit);if(!Number.isInteger(parsed)||parsed<1||parsed>500) throw errorOf('limit must be an integer from 1 to 500','INVALID_DISPUTE_LIMIT');
  const clauses=[],params=[];
  if(tenantId){clauses.push('tenant_id=?');params.push(tenantId);}
  if(normalized==='ACTIVE') clauses.push("status IN ('OPEN','UNDER_REVIEW')");
  else if(normalized!=='ALL'){clauses.push('status=?');params.push(normalized);}
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM billing_disputes ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY opened_at,id LIMIT ${parsed}`,
    params
  );
  return rows.map(normalizeDispute);
};
export const resolveBillingDisputeScope=async disputeId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id FROM billing_disputes WHERE id=?',[disputeId]);
  if(!rows.length) throw errorOf('Billing dispute not found','BILLING_DISPUTE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:null};
};
