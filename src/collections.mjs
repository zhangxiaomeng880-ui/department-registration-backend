import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getInvoiceFinancialPosition } from './financial-adjustments.mjs';

const SCALE=10000000000n;
const CASE_STATUSES=new Set(['OPEN','CONTACTED','PROMISE_TO_PAY','RESOLVED']);
const CASE_PRIORITIES=new Set(['LOW','NORMAL','HIGH','URGENT']);
const ACTION_TYPES=new Set(['CONTACTED','PROMISE_TO_PAY','RESOLVE','REOPEN']);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Collection metadata must not persist credentials or secrets','COLLECTION_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const asJson=value=>value==null?null:JSON.stringify(value);
const parseDate=value=>{
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw errorOf('Invalid collection date','INVALID_COLLECTION_DATE');
  return date;
};
const toUnits=value=>{
  const text=String(value??0).trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(text)) throw errorOf('Invalid decimal amount','INVALID_COLLECTION_AMOUNT');
  const negative=text.startsWith('-');
  const raw=negative?text.slice(1):text;
  const [whole,fraction='']=raw.split('.');
  const frac=(fraction+'0000000000').slice(0,10);
  const units=BigInt(whole)*SCALE+BigInt(frac);
  return negative?-units:units;
};
const unitsToString=units=>{
  const negative=units<0n,abs=negative?-units:units;
  return `${negative?'-':''}${abs/SCALE}.${String(abs%SCALE).padStart(10,'0')}`;
};
const normalizeCase=row=>({
  id:row.id,invoiceId:row.invoice_id,tenantId:row.tenant_id,status:row.status,priority:row.priority,
  assignedIdentityId:row.assigned_identity_id,openedAt:row.opened_at,lastContactedAt:row.last_contacted_at,
  nextActionAt:row.next_action_at,promisedAmount:row.promised_amount==null?null:Number(row.promised_amount),
  promisedPaymentAt:row.promised_payment_at,resolvedAt:row.resolved_at,resolutionCode:row.resolution_code,
  metadata:row.metadata_json,createdAt:row.created_at,updatedAt:row.updated_at
});
const normalizeAction=row=>({
  id:row.id,caseId:row.case_id,invoiceId:row.invoice_id,tenantId:row.tenant_id,
  actionType:row.action_type,amount:row.amount==null?null:Number(row.amount),
  promiseDueAt:row.promise_due_at,idempotencyKey:row.idempotency_key,
  metadata:row.metadata_json,occurredAt:row.occurred_at,createdAt:row.created_at
});

export const resolveCollectionCaseScope=async caseId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT tenant_id FROM collection_cases WHERE id=?',[caseId]);
  if(!rows.length) throw errorOf('Collection case not found','COLLECTION_CASE_NOT_FOUND',404);
  return {tenantId:rows[0].tenant_id,workspaceId:null};
};

export const openCollectionCase=async({
  invoiceId,priority='NORMAL',assignedIdentityId=null,openedAt=new Date(),metadata=null
}={})=>{
  if(!invoiceId) throw errorOf('invoiceId is required','INVALID_COLLECTION_CASE');
  const normalizedPriority=String(priority||'NORMAL').toUpperCase();
  if(!CASE_PRIORITIES.has(normalizedPriority)) throw errorOf('priority must be LOW, NORMAL, HIGH, or URGENT','INVALID_COLLECTION_PRIORITY');
  const opened=parseDate(openedAt);
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [invoiceRows]=await connection.execute('SELECT * FROM invoices WHERE id=? FOR UPDATE',[invoiceId]);
    if(!invoiceRows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
    const invoice=invoiceRows[0];
    const position=await getInvoiceFinancialPosition(connection,invoiceId,{asOf:opened});
    const outstanding=position._units.outstanding;
    if(outstanding<=0n) throw errorOf('Invoice has no outstanding balance','INVOICE_NOT_COLLECTIBLE',409);
    if(new Date(invoice.due_at).getTime()>=opened.getTime()) throw errorOf('Invoice is not overdue','INVOICE_NOT_OVERDUE',409);

    const [existing]=await connection.execute('SELECT * FROM collection_cases WHERE invoice_id=? LIMIT 1 FOR UPDATE',[invoiceId]);
    if(existing.length){
      await connection.commit();
      return {...normalizeCase(existing[0]),idempotent:true};
    }
    if(assignedIdentityId){
      const [identities]=await connection.execute('SELECT id FROM identities WHERE id=?',[assignedIdentityId]);
      if(!identities.length) throw errorOf('Assigned identity not found','IDENTITY_NOT_FOUND',404);
    }

    const id=randomUUID();
    await connection.execute(
      `INSERT INTO collection_cases (
        id,invoice_id,tenant_id,status,priority,assigned_identity_id,opened_at,metadata_json
      ) VALUES (?,?,?,'OPEN',?,?,?,?)`,
      [id,invoiceId,invoice.tenant_id,normalizedPriority,assignedIdentityId||null,opened,asJson(metadata)]
    );
    const [rows]=await connection.execute('SELECT * FROM collection_cases WHERE id=?',[id]);
    await connection.commit();
    return {...normalizeCase(rows[0]),idempotent:false};
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{connection.release();}
};

export const getInvoiceCollectionCase=async invoiceId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM collection_cases WHERE invoice_id=?',[invoiceId]);
  if(!rows.length) throw errorOf('Collection case not found','COLLECTION_CASE_NOT_FOUND',404);
  const collectionCase=normalizeCase(rows[0]);
  const [actions]=await db.execute('SELECT * FROM collection_actions WHERE case_id=? ORDER BY occurred_at,id',[collectionCase.id]);
  return {...collectionCase,actions:actions.map(normalizeAction)};
};

export const getCollectionCase=async caseId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM collection_cases WHERE id=?',[caseId]);
  if(!rows.length) throw errorOf('Collection case not found','COLLECTION_CASE_NOT_FOUND',404);
  const [actions]=await db.execute('SELECT * FROM collection_actions WHERE case_id=? ORDER BY occurred_at,id',[caseId]);
  return {...normalizeCase(rows[0]),actions:actions.map(normalizeAction)};
};

export const listCollectionCases=async({tenantId=null,status='ACTIVE',limit=100}={})=>{
  const normalizedStatus=String(status||'ACTIVE').toUpperCase();
  if(!['ACTIVE','OPEN','CONTACTED','PROMISE_TO_PAY','RESOLVED','ALL'].includes(normalizedStatus)){
    throw errorOf('status must be ACTIVE, OPEN, CONTACTED, PROMISE_TO_PAY, RESOLVED, or ALL','INVALID_COLLECTION_STATUS');
  }
  const parsedLimit=Number(limit);
  if(!Number.isInteger(parsedLimit)||parsedLimit<1||parsedLimit>500) throw errorOf('limit must be an integer from 1 to 500','INVALID_COLLECTION_LIMIT');
  const clauses=[],params=[];
  if(tenantId){clauses.push('tenant_id=?');params.push(tenantId);}
  if(normalizedStatus==='ACTIVE') clauses.push("status<>'RESOLVED'");
  else if(normalizedStatus!=='ALL'){clauses.push('status=?');params.push(normalizedStatus);}
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM collection_cases ${clauses.length?'WHERE '+clauses.join(' AND '):''}
     ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
              COALESCE(next_action_at,opened_at),opened_at,id
     LIMIT ${parsedLimit}`,
    params
  );
  return rows.map(normalizeCase);
};

export const recordCollectionAction=async({
  caseId,actionType,idempotencyKey,occurredAt=new Date(),nextActionAt=null,
  promisedAmount=null,promiseDueAt=null,resolutionCode=null,metadata=null
}={})=>{
  if(!caseId||!actionType||!idempotencyKey) throw errorOf('caseId, actionType and idempotencyKey are required','INVALID_COLLECTION_ACTION');
  const type=String(actionType).toUpperCase();
  if(!ACTION_TYPES.has(type)) throw errorOf('Unsupported collection action','INVALID_COLLECTION_ACTION_TYPE');
  const occurred=parseDate(occurredAt);
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [existing]=await connection.execute('SELECT * FROM collection_actions WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]);
    if(existing.length){
      const row=existing[0];
      if(row.case_id!==caseId||row.action_type!==type) throw errorOf('Idempotency key was already used for a different collection action','COLLECTION_IDEMPOTENCY_CONFLICT',409);
      const [caseRows]=await connection.execute('SELECT * FROM collection_cases WHERE id=?',[caseId]);
      await connection.commit();
      return {action:normalizeAction(row),collectionCase:normalizeCase(caseRows[0]),idempotent:true};
    }

    const [caseRows]=await connection.execute('SELECT * FROM collection_cases WHERE id=? FOR UPDATE',[caseId]);
    if(!caseRows.length) throw errorOf('Collection case not found','COLLECTION_CASE_NOT_FOUND',404);
    const current=caseRows[0];
    const [invoiceRows]=await connection.execute('SELECT * FROM invoices WHERE id=? FOR UPDATE',[current.invoice_id]);
    if(!invoiceRows.length) throw errorOf('Invoice not found','INVOICE_NOT_FOUND',404);
    const invoice=invoiceRows[0];
    const position=await getInvoiceFinancialPosition(connection,current.invoice_id,{asOf:occurred});
    const outstanding=position._units.outstanding;

    if(current.status==='RESOLVED'&&type!=='REOPEN') throw errorOf('Collection case is already resolved','COLLECTION_CASE_RESOLVED',409);

    let amountUnits=null,promiseDate=null,nextDate=nextActionAt?parseDate(nextActionAt):null;
    let status=current.status,resolvedAt=current.resolved_at,resolution=current.resolution_code;
    let lastContacted=current.last_contacted_at;
    let storedPromiseAmount=current.promised_amount,storedPromiseAt=current.promised_payment_at;

    if(type==='CONTACTED'){
      status='CONTACTED';
      lastContacted=occurred;
    }else if(type==='PROMISE_TO_PAY'){
      amountUnits=toUnits(promisedAmount);
      if(amountUnits<=0n) throw errorOf('promisedAmount must be positive','INVALID_PROMISE_AMOUNT');
      if(amountUnits>outstanding) throw errorOf('Promise amount exceeds invoice outstanding balance','PROMISE_EXCEEDS_OUTSTANDING',409,{outstandingAmount:Number(unitsToString(outstanding))});
      promiseDate=parseDate(promiseDueAt);
      if(promiseDate.getTime()<occurred.getTime()) throw errorOf('promiseDueAt cannot be before occurredAt','INVALID_PROMISE_DUE_DATE');
      status='PROMISE_TO_PAY';
      lastContacted=occurred;
      nextDate=promiseDate;
      storedPromiseAmount=unitsToString(amountUnits);
      storedPromiseAt=promiseDate;
    }else if(type==='RESOLVE'){
      if(outstanding>0n) throw errorOf('Invoice still has an outstanding balance','COLLECTION_OUTSTANDING_REMAINS',409,{outstandingAmount:Number(unitsToString(outstanding))});
      status='RESOLVED';
      resolvedAt=occurred;
      resolution=resolutionCode||'PAID';
      nextDate=null;
    }else if(type==='REOPEN'){
      if(outstanding<=0n) throw errorOf('Paid invoice collection case cannot be reopened','COLLECTION_NOT_REOPENABLE',409);
      status='OPEN';
      resolvedAt=null;
      resolution=null;
    }

    const actionId=randomUUID();
    await connection.execute(
      `INSERT INTO collection_actions (
        id,case_id,invoice_id,tenant_id,action_type,amount,promise_due_at,idempotency_key,metadata_json,occurred_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [actionId,current.id,current.invoice_id,current.tenant_id,type,amountUnits==null?null:unitsToString(amountUnits),
       promiseDate,idempotencyKey,asJson(metadata),occurred]
    );
    await connection.execute(
      `UPDATE collection_cases SET
        status=?,last_contacted_at=?,next_action_at=?,promised_amount=?,promised_payment_at=?,
        resolved_at=?,resolution_code=?
       WHERE id=?`,
      [status,lastContacted,nextDate,storedPromiseAmount,storedPromiseAt,resolvedAt,resolution,current.id]
    );
    const [actionRows]=await connection.execute('SELECT * FROM collection_actions WHERE id=?',[actionId]);
    const [updatedCases]=await connection.execute('SELECT * FROM collection_cases WHERE id=?',[caseId]);
    await connection.commit();
    return {action:normalizeAction(actionRows[0]),collectionCase:normalizeCase(updatedCases[0]),idempotent:false};
  }catch(error){
    await connection.rollback();
    throw error;
  }finally{connection.release();}
};
