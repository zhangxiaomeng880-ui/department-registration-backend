import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const SCALE=10000000000n;
const EXPORT_FORMATS=new Set(['JSON','CSV']);
const secretPattern=/(api[_-]?key|secret|password|credential|authorization|access[_-]?token|refresh[_-]?token)/i;
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const parseDate=value=>{
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw errorOf('Invalid finance close date','INVALID_FINANCE_CLOSE_DATE');
  return date;
};
const rejectSecrets=value=>{
  const visit=(node,path='')=>{
    if(!node||typeof node!=='object') return;
    for(const [key,child] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(secretPattern.test(key)) throw errorOf('Finance close metadata must not persist credentials or secrets','FINANCE_CLOSE_METADATA_SECRET_NOT_ALLOWED',400,{field:next});
      visit(child,next);
    }
  };
  visit(value);
};
const asJson=value=>value==null?null:JSON.stringify(value);
const toUnits=value=>{
  const text=String(value??0).trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(text)) throw errorOf('Invalid finance decimal','INVALID_FINANCE_AMOUNT');
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
const sha256=text=>createHash('sha256').update(text).digest('hex');
const normalizeClose=row=>({
  id:row.id,periodStart:row.period_start,periodEnd:row.period_end,status:row.status,
  currencyCount:Number(row.currency_count),snapshotSha256:row.snapshot_sha256,
  idempotencyKey:row.idempotency_key,sourceLabel:row.source_label||null,
  metadata:row.metadata_json,closedAt:row.closed_at,createdAt:row.created_at
});
const normalizeSnapshot=row=>({
  currency:row.currency,invoiceCount:Number(row.invoice_count),
  openingAr:Number(row.opening_ar),openingOverpayment:Number(row.opening_overpayment),
  originalBilled:Number(row.original_billed),creditNotes:Number(row.credit_notes),
  debitAdjustments:Number(row.debit_adjustments),adjustedBilledRevenue:Number(row.adjusted_billed_revenue),
  writeOffs:Number(row.write_offs),grossCashCollected:Number(row.gross_cash_collected),
  refunds:Number(row.refunds),netCashCollected:Number(row.net_cash_collected),
  endingAr:Number(row.ending_ar),endingOverpayment:Number(row.ending_overpayment),
  providerCost:Number(row.provider_cost),grossMargin:Number(row.gross_margin),
  reconciliationDelta:Number(row.reconciliation_delta)
});
const normalizeExport=row=>({
  id:row.id,closeId:row.close_id,format:row.format,contentSha256:row.content_sha256,
  rowCount:Number(row.row_count),generatedAt:row.generated_at,createdAt:row.created_at
});
const csvEscape=value=>{
  const text=String(value??'');
  return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
};
const canonicalClosePayload=({periodStart,periodEnd,snapshots})=>({
  schemaVersion:'M23.5_FINANCE_CLOSE_V1',
  periodStart:new Date(periodStart).toISOString(),
  periodEnd:new Date(periodEnd).toISOString(),
  currencies:snapshots.map(x=>({
    currency:x.currency,invoiceCount:x.invoiceCount,
    openingAr:x.openingAr,openingOverpayment:x.openingOverpayment,
    originalBilled:x.originalBilled,creditNotes:x.creditNotes,debitAdjustments:x.debitAdjustments,
    adjustedBilledRevenue:x.adjustedBilledRevenue,writeOffs:x.writeOffs,
    grossCashCollected:x.grossCashCollected,refunds:x.refunds,netCashCollected:x.netCashCollected,
    endingAr:x.endingAr,endingOverpayment:x.endingOverpayment,
    providerCost:x.providerCost,grossMargin:x.grossMargin,reconciliationDelta:x.reconciliationDelta
  }))
});
const renderJsonExport=payload=>JSON.stringify(payload,null,2)+'\n';
const CSV_COLUMNS=[
  'currency','invoiceCount','openingAr','openingOverpayment','originalBilled','creditNotes',
  'debitAdjustments','adjustedBilledRevenue','writeOffs','grossCashCollected','refunds',
  'netCashCollected','endingAr','endingOverpayment','providerCost','grossMargin','reconciliationDelta'
];
const renderCsvExport=payload=>{
  const lines=[CSV_COLUMNS.join(',')];
  for(const row of payload.currencies){
    lines.push(CSV_COLUMNS.map(key=>csvEscape(row[key])).join(','));
  }
  return lines.join('\n')+'\n';
};

const loadBalanceAt=async(db,cutoff)=>{
  const [rows]=await db.execute(
    `SELECT i.id,i.currency,i.total_due,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
         WHERE a.invoice_id=i.id AND a.adjustment_type='DEBIT_ADJUSTMENT' AND a.effective_at<?),0) AS debit_adjustments,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
         WHERE a.invoice_id=i.id AND a.adjustment_type='CREDIT_NOTE' AND a.effective_at<?),0) AS credit_notes,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
         WHERE a.invoice_id=i.id AND a.adjustment_type='WRITE_OFF' AND a.effective_at<?),0) AS write_offs,
       COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
         WHERE p.invoice_id=i.id AND p.received_at<?),0) AS gross_paid,
       COALESCE((SELECT SUM(r.amount) FROM payment_refunds r
         WHERE r.invoice_id=i.id AND r.refunded_at<?),0) AS refunds
     FROM invoices i
     WHERE i.issued_at<?`,
    [cutoff,cutoff,cutoff,cutoff,cutoff,cutoff]
  );
  const result=new Map();
  for(const row of rows){
    const collectible=toUnits(row.total_due)+toUnits(row.debit_adjustments)-toUnits(row.credit_notes)-toUnits(row.write_offs);
    const netCollected=toUnits(row.gross_paid)-toUnits(row.refunds);
    const signed=collectible-netCollected;
    if(!result.has(row.currency)) result.set(row.currency,{ar:0n,overpayment:0n});
    const x=result.get(row.currency);
    if(signed>=0n) x.ar+=signed; else x.overpayment+=-signed;
  }
  return result;
};
const addGrouped=(map,rows,key,valueKey)=>{
  for(const row of rows){
    if(!map.has(row.currency)) map.set(row.currency,{});
    map.get(row.currency)[key]=toUnits(row[valueKey]||0);
  }
};
const loadPeriodActivity=async(db,start,end)=>{
  const activity=new Map();
  const [invoiceRows]=await db.execute(
    `SELECT i.currency,COUNT(*) AS invoice_count,COALESCE(SUM(i.total_due),0) AS original_billed,
            COALESCE(SUM(b.provider_cost_total),0) AS provider_cost
     FROM invoices i
     LEFT JOIN billing_cycles b ON b.id=i.billing_cycle_id
     WHERE i.issued_at>=? AND i.issued_at<?
     GROUP BY i.currency`,[start,end]
  );
  for(const row of invoiceRows){
    activity.set(row.currency,{
      invoiceCount:Number(row.invoice_count),originalBilled:toUnits(row.original_billed||0),
      providerCost:toUnits(row.provider_cost||0)
    });
  }
  const [adjustmentRows]=await db.execute(
    `SELECT currency,adjustment_type,COALESCE(SUM(amount),0) AS amount
     FROM invoice_adjustments WHERE effective_at>=? AND effective_at<?
     GROUP BY currency,adjustment_type`,[start,end]
  );
  for(const row of adjustmentRows){
    if(!activity.has(row.currency)) activity.set(row.currency,{invoiceCount:0,originalBilled:0n,providerCost:0n});
    const x=activity.get(row.currency);
    if(row.adjustment_type==='CREDIT_NOTE') x.creditNotes=toUnits(row.amount);
    if(row.adjustment_type==='WRITE_OFF') x.writeOffs=toUnits(row.amount);
    if(row.adjustment_type==='DEBIT_ADJUSTMENT') x.debitAdjustments=toUnits(row.amount);
  }
  const [paymentRows]=await db.execute(
    `SELECT currency,COALESCE(SUM(amount),0) AS amount FROM invoice_payments
     WHERE received_at>=? AND received_at<? GROUP BY currency`,[start,end]
  );
  addGrouped(activity,paymentRows,'grossCash','amount');
  const [refundRows]=await db.execute(
    `SELECT currency,COALESCE(SUM(amount),0) AS amount FROM payment_refunds
     WHERE refunded_at>=? AND refunded_at<? GROUP BY currency`,[start,end]
  );
  addGrouped(activity,refundRows,'refunds','amount');
  return activity;
};
const buildSnapshots=async(db,start,end)=>{
  const [opening,ending,activity]=await Promise.all([
    loadBalanceAt(db,start),loadBalanceAt(db,end),loadPeriodActivity(db,start,end)
  ]);
  const currencies=[...new Set([...opening.keys(),...ending.keys(),...activity.keys()])].sort();
  return currencies.map(currency=>{
    const o=opening.get(currency)||{ar:0n,overpayment:0n};
    const e=ending.get(currency)||{ar:0n,overpayment:0n};
    const a=activity.get(currency)||{};
    const originalBilled=a.originalBilled||0n,creditNotes=a.creditNotes||0n;
    const debitAdjustments=a.debitAdjustments||0n,writeOffs=a.writeOffs||0n;
    const grossCash=a.grossCash||0n,refunds=a.refunds||0n,providerCost=a.providerCost||0n;
    const adjustedRevenue=originalBilled+debitAdjustments-creditNotes;
    const netCash=grossCash-refunds;
    const openingSigned=o.ar-o.overpayment;
    const endingSigned=e.ar-e.overpayment;
    const expectedEnding=openingSigned+adjustedRevenue-writeOffs-netCash;
    const delta=expectedEnding-endingSigned;
    return {
      currency,invoiceCount:Number(a.invoiceCount||0),
      openingAr:unitsToNumber(o.ar),openingOverpayment:unitsToNumber(o.overpayment),
      originalBilled:unitsToNumber(originalBilled),creditNotes:unitsToNumber(creditNotes),
      debitAdjustments:unitsToNumber(debitAdjustments),adjustedBilledRevenue:unitsToNumber(adjustedRevenue),
      writeOffs:unitsToNumber(writeOffs),grossCashCollected:unitsToNumber(grossCash),
      refunds:unitsToNumber(refunds),netCashCollected:unitsToNumber(netCash),
      endingAr:unitsToNumber(e.ar),endingOverpayment:unitsToNumber(e.overpayment),
      providerCost:unitsToNumber(providerCost),grossMargin:unitsToNumber(adjustedRevenue-providerCost),
      reconciliationDelta:unitsToNumber(delta),_delta:delta
    };
  });
};

export const lockFinanceCloseBarrier=async db=>{
  await db.execute('SELECT id FROM finance_close_lock WHERE id=1 FOR UPDATE');
};

export const getClosedThrough=async(db=getRuntimePool())=>{
  const [[row]]=await db.execute("SELECT MAX(period_end) AS closed_through FROM finance_close_periods WHERE status='CLOSED'");
  return row.closed_through?new Date(row.closed_through):null;
};

export const assertFinancePeriodOpen=async(db,eventAt)=>{
  const at=parseDate(eventAt);
  const [rows]=await db.execute(
    `SELECT id,period_start,period_end FROM finance_close_periods
     WHERE status='CLOSED' AND period_start<=? AND period_end>? LIMIT 1`,
    [at,at]
  );
  if(rows.length){
    throw errorOf('Financial event falls inside a closed accounting period','FINANCE_PERIOD_CLOSED',409,{
      closeId:rows[0].id,eventAt:at.toISOString(),
      periodStart:new Date(rows[0].period_start).toISOString(),
      periodEnd:new Date(rows[0].period_end).toISOString()
    });
  }
  return {eventAt:at,closedPeriod:null};
};

export const closeFinancePeriod=async({
  periodStart,periodEnd,idempotencyKey,sourceLabel=null,metadata=null
}={})=>{
  if(!periodStart||!periodEnd||!idempotencyKey) throw errorOf(
    'periodStart, periodEnd and idempotencyKey are required','INVALID_FINANCE_CLOSE'
  );
  const start=parseDate(periodStart),end=parseDate(periodEnd);
  if(start.getTime()>=end.getTime()) throw errorOf('periodStart must be before periodEnd','INVALID_FINANCE_CLOSE_RANGE');
  if(end.getTime()>Date.now()+60000) throw errorOf('Cannot close a future accounting period','FUTURE_FINANCE_CLOSE_NOT_ALLOWED',409);
  rejectSecrets(metadata);
  const db=getRuntimePool(),connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    await lockFinanceCloseBarrier(connection);
    const [idempotentRows]=await connection.execute(
      'SELECT * FROM finance_close_periods WHERE idempotency_key=? LIMIT 1 FOR UPDATE',[idempotencyKey]
    );
    if(idempotentRows.length){
      const row=idempotentRows[0];
      if(new Date(row.period_start).getTime()!==start.getTime()||new Date(row.period_end).getTime()!==end.getTime()){
        throw errorOf('Idempotency key was already used for another finance close','FINANCE_CLOSE_IDEMPOTENCY_CONFLICT',409);
      }
      await connection.commit();
      return {...await getFinanceClose(row.id),idempotent:true};
    }
    const [latestRows]=await connection.execute(
      "SELECT * FROM finance_close_periods WHERE status='CLOSED' ORDER BY period_end DESC LIMIT 1 FOR UPDATE"
    );
    if(latestRows.length&&new Date(latestRows[0].period_end).getTime()!==start.getTime()){
      throw errorOf('Finance close periods must be contiguous','FINANCE_CLOSE_NOT_CONTIGUOUS',409,{
        expectedPeriodStart:new Date(latestRows[0].period_end).toISOString()
      });
    }
    const [overlap]=await connection.execute(
      'SELECT id FROM finance_close_periods WHERE period_start<? AND period_end>? LIMIT 1 FOR UPDATE',[end,start]
    );
    if(overlap.length) throw errorOf('Finance close period overlaps an existing close','FINANCE_CLOSE_OVERLAP',409);

    const rawSnapshots=await buildSnapshots(connection,start,end);
    const bad=rawSnapshots.filter(x=>x._delta!==0n);
    if(bad.length) throw errorOf('Finance close reconciliation did not balance','FINANCE_CLOSE_RECONCILIATION_FAILED',409,{
      currencies:bad.map(x=>({currency:x.currency,reconciliationDelta:x.reconciliationDelta}))
    });
    const snapshots=rawSnapshots.map(({_delta,...x})=>x);
    const payload=canonicalClosePayload({periodStart:start,periodEnd:end,snapshots});
    const snapshotText=JSON.stringify(payload);
    const snapshotSha=sha256(snapshotText);
    const id=randomUUID(),closedAt=new Date();
    await connection.execute(
      `INSERT INTO finance_close_periods
       (id,period_start,period_end,status,currency_count,snapshot_sha256,idempotency_key,source_label,metadata_json,closed_at)
       VALUES (?,?,?,'CLOSED',?,?,?,?,?,?)`,
      [id,start,end,snapshots.length,snapshotSha,idempotencyKey,sourceLabel,asJson(metadata),closedAt]
    );
    for(const x of snapshots){
      await connection.execute(
        `INSERT INTO finance_close_currency_snapshots
         (close_id,currency,invoice_count,opening_ar,opening_overpayment,original_billed,credit_notes,
          debit_adjustments,adjusted_billed_revenue,write_offs,gross_cash_collected,refunds,net_cash_collected,
          ending_ar,ending_overpayment,provider_cost,gross_margin,reconciliation_delta)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,x.currency,x.invoiceCount,x.openingAr,x.openingOverpayment,x.originalBilled,x.creditNotes,
         x.debitAdjustments,x.adjustedBilledRevenue,x.writeOffs,x.grossCashCollected,x.refunds,x.netCashCollected,
         x.endingAr,x.endingOverpayment,x.providerCost,x.grossMargin,x.reconciliationDelta]
      );
    }
    const jsonContent=renderJsonExport(payload),csvContent=renderCsvExport(payload);
    await connection.execute(
      `INSERT INTO finance_close_exports (id,close_id,format,content_sha256,row_count,generated_at)
       VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)`,
      [randomUUID(),id,'JSON',sha256(jsonContent),snapshots.length,closedAt,
       randomUUID(),id,'CSV',sha256(csvContent),snapshots.length,closedAt]
    );
    await connection.commit();
    return {...await getFinanceClose(id),idempotent:false};
  }catch(error){
    await connection.rollback();throw error;
  }finally{connection.release();}
};

export const getFinanceClose=async closeId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM finance_close_periods WHERE id=?',[closeId]);
  if(!rows.length) throw errorOf('Finance close not found','FINANCE_CLOSE_NOT_FOUND',404);
  const [snapshots]=await db.execute(
    'SELECT * FROM finance_close_currency_snapshots WHERE close_id=? ORDER BY currency',[closeId]
  );
  const [exports]=await db.execute(
    'SELECT * FROM finance_close_exports WHERE close_id=? ORDER BY format',[closeId]
  );
  return {...normalizeClose(rows[0]),currencies:snapshots.map(normalizeSnapshot),exports:exports.map(normalizeExport)};
};

export const listFinanceCloses=async({limit=100}={})=>{
  const parsed=Number(limit);
  if(!Number.isInteger(parsed)||parsed<1||parsed>500) throw errorOf('limit must be an integer from 1 to 500','INVALID_FINANCE_CLOSE_LIMIT');
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT * FROM finance_close_periods ORDER BY period_end DESC,id DESC LIMIT ${parsed}`
  );
  return rows.map(normalizeClose);
};

export const getFinanceCloseExport=async(closeId,{format='JSON'}={})=>{
  const normalized=String(format||'JSON').toUpperCase();
  if(!EXPORT_FORMATS.has(normalized)) throw errorOf('format must be JSON or CSV','INVALID_FINANCE_EXPORT_FORMAT');
  const close=await getFinanceClose(closeId);
  const payload=canonicalClosePayload({
    periodStart:close.periodStart,periodEnd:close.periodEnd,snapshots:close.currencies
  });
  const content=normalized==='JSON'?renderJsonExport(payload):renderCsvExport(payload);
  const manifest=close.exports.find(x=>x.format===normalized);
  if(!manifest) throw errorOf('Finance close export manifest not found','FINANCE_EXPORT_NOT_FOUND',404);
  const actualSha=sha256(content);
  if(actualSha!==manifest.contentSha256) throw errorOf('Finance close export hash mismatch','FINANCE_CLOSE_EXPORT_HASH_MISMATCH',500,{
    expected:manifest.contentSha256,actual:actualSha
  });
  return {
    closeId,format:normalized,contentSha256:actualSha,rowCount:manifest.rowCount,
    periodStart:new Date(close.periodStart).toISOString(),periodEnd:new Date(close.periodEnd).toISOString(),
    content
  };
};
