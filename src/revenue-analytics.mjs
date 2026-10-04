import { getRuntimePool } from './runtime-db.mjs';

const errorOf=(message,code,statusCode=400)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;return error;
};
const parseDate=value=>{
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw errorOf('Invalid analytics date','INVALID_ANALYTICS_DATE');
  return date;
};
const pct=(num,den)=>den>0?Number(((num/den)*100).toFixed(4)):0;
const round=value=>Number(Number(value||0).toFixed(10));

const loadInvoiceRows=async({tenantId=null,planKey=null,asOf=new Date()}={})=>{
  const at=parseDate(asOf);
  const db=getRuntimePool();
  const clauses=['i.issued_at<=?'];
  const params=[at,at,at,at,at,at];
  if(tenantId){clauses.push('i.tenant_id=?');params.push(tenantId);}
  if(planKey){clauses.push('s.plan_key=?');params.push(planKey);}
  const [rows]=await db.execute(
    `SELECT
       i.id,i.tenant_id,i.subscription_id,i.currency,i.total_due,i.issued_at,i.due_at,i.status,
       s.plan_key,
       COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
                 WHERE p.invoice_id=i.id AND p.received_at<=?),0) AS gross_paid_as_of,
       COALESCE((SELECT SUM(r.amount) FROM payment_refunds r
                 WHERE r.invoice_id=i.id AND r.refunded_at<=?),0) AS refunds_as_of,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
                 WHERE a.invoice_id=i.id AND a.adjustment_type='CREDIT_NOTE' AND a.effective_at<=?),0) AS credit_notes_as_of,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
                 WHERE a.invoice_id=i.id AND a.adjustment_type='WRITE_OFF' AND a.effective_at<=?),0) AS write_offs_as_of,
       COALESCE((SELECT SUM(a.amount) FROM invoice_adjustments a
                 WHERE a.invoice_id=i.id AND a.adjustment_type='DEBIT_ADJUSTMENT' AND a.effective_at<=?),0) AS debit_adjustments_as_of,
       COALESCE(b.provider_cost_total,0) AS provider_cost_total
     FROM invoices i
     LEFT JOIN subscriptions s ON s.id=i.subscription_id
     LEFT JOIN billing_cycles b ON b.id=i.billing_cycle_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY i.issued_at,i.id`,
    params
  );
  return rows;
};

const classifyAging=(dueAt,asOf)=>{
  const due=new Date(dueAt).getTime(),now=asOf.getTime();
  if(due>=now) return 'current';
  const days=Math.floor((now-due)/86400000);
  if(days<=30) return 'days1To30';
  if(days<=60) return 'days31To60';
  if(days<=90) return 'days61To90';
  return 'days90Plus';
};

const calculateRow=row=>{
  const originalBilled=Number(row.total_due||0);
  const grossPaid=Number(row.gross_paid_as_of||0);
  const refunds=Number(row.refunds_as_of||0);
  const creditNotes=Number(row.credit_notes_as_of||0);
  const writeOffs=Number(row.write_offs_as_of||0);
  const debitAdjustments=Number(row.debit_adjustments_as_of||0);
  const adjustedBilledRevenue=Math.max(0,originalBilled+debitAdjustments-creditNotes);
  const collectibleAmount=Math.max(0,adjustedBilledRevenue-writeOffs);
  const netCollected=Math.max(0,grossPaid-refunds);
  const outstanding=Math.max(0,collectibleAmount-netCollected);
  const overpaid=Math.max(0,netCollected-collectibleAmount);
  return {
    originalBilled,grossPaid,refunds,creditNotes,writeOffs,debitAdjustments,
    adjustedBilledRevenue,collectibleAmount,netCollected,outstanding,overpaid
  };
};

export const getRevenueAnalytics=async({tenantId=null,planKey=null,asOf=new Date()}={})=>{
  const at=parseDate(asOf);
  const rows=await loadInvoiceRows({tenantId,planKey,asOf:at});
  const byCurrency=new Map();

  for(const row of rows){
    const currency=row.currency;
    if(!byCurrency.has(currency)){
      byCurrency.set(currency,{
        currency,invoiceCount:0,paidInvoiceCount:0,openInvoiceCount:0,overdueInvoiceCount:0,
        originalBilled:0,creditNotes:0,writeOffs:0,debitAdjustments:0,refunds:0,
        adjustedBilledRevenue:0,collectibleAmount:0,netCollected:0,outstanding:0,overpaid:0,
        overdueOutstanding:0,aging:{current:0,days1To30:0,days31To60:0,days61To90:0,days90Plus:0}
      });
    }
    const x=byCurrency.get(currency),m=calculateRow(row);
    x.invoiceCount+=1;
    x.originalBilled+=m.originalBilled;
    x.creditNotes+=m.creditNotes;
    x.writeOffs+=m.writeOffs;
    x.debitAdjustments+=m.debitAdjustments;
    x.refunds+=m.refunds;
    x.adjustedBilledRevenue+=m.adjustedBilledRevenue;
    x.collectibleAmount+=m.collectibleAmount;
    x.netCollected+=m.netCollected;
    x.outstanding+=m.outstanding;
    x.overpaid+=m.overpaid;
    if(m.outstanding<=0){
      x.paidInvoiceCount+=1;
    }else{
      x.openInvoiceCount+=1;
      const bucket=classifyAging(row.due_at,at);
      x.aging[bucket]+=m.outstanding;
      if(bucket!=='current'){
        x.overdueInvoiceCount+=1;
        x.overdueOutstanding+=m.outstanding;
      }
    }
  }

  const currencies=[...byCurrency.values()].map(x=>({
    ...x,
    originalBilled:round(x.originalBilled),
    creditNotes:round(x.creditNotes),
    writeOffs:round(x.writeOffs),
    debitAdjustments:round(x.debitAdjustments),
    refunds:round(x.refunds),
    adjustedBilledRevenue:round(x.adjustedBilledRevenue),
    collectibleAmount:round(x.collectibleAmount),
    netCollected:round(x.netCollected),
    totalBilled:round(x.adjustedBilledRevenue),
    amountPaid:round(x.netCollected),
    outstanding:round(x.outstanding),
    overpaid:round(x.overpaid),
    overdueOutstanding:round(x.overdueOutstanding),
    collectionRatePct:pct(x.netCollected,x.adjustedBilledRevenue),
    writeOffRatePct:pct(x.writeOffs,x.adjustedBilledRevenue),
    refundRatePct:pct(x.refunds,x.grossPaid||0),
    aging:Object.fromEntries(Object.entries(x.aging).map(([k,v])=>[k,round(v)]))
  }));

  const db=getRuntimePool();
  const promiseParams=[at],promiseClauses=["a.action_type='PROMISE_TO_PAY'","a.promise_due_at<=?"];
  if(tenantId){promiseClauses.push('a.tenant_id=?');promiseParams.push(tenantId);}
  if(planKey){promiseClauses.push('s.plan_key=?');promiseParams.push(planKey);}
  const [promises]=await db.execute(
    `SELECT a.id,a.invoice_id,a.tenant_id,a.amount,a.occurred_at,a.promise_due_at,
       (
         COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
           WHERE p.invoice_id=a.invoice_id
             AND p.received_at>=a.occurred_at
             AND p.received_at<=a.promise_due_at),0)
         -
         COALESCE((SELECT SUM(r.amount)
           FROM payment_refunds r
           JOIN invoice_payments p2 ON p2.id=r.payment_id
           WHERE p2.invoice_id=a.invoice_id
             AND p2.received_at>=a.occurred_at
             AND p2.received_at<=a.promise_due_at
             AND r.refunded_at<=a.promise_due_at),0)
       ) AS paid_by_due
     FROM collection_actions a
     JOIN invoices i ON i.id=a.invoice_id
     LEFT JOIN subscriptions s ON s.id=i.subscription_id
     WHERE ${promiseClauses.join(' AND ')}
     ORDER BY a.promise_due_at,a.id`,
    promiseParams
  );

  let fulfilled=0,promisedAmountDue=0,fulfilledAmount=0;
  for(const row of promises){
    const promised=Number(row.amount||0),paidByDue=Number(row.paid_by_due||0);
    promisedAmountDue+=promised;
    const met=paidByDue+1e-10>=promised;
    if(met){fulfilled+=1;fulfilledAmount+=promised;}
  }

  return {
    tenantId:tenantId||null,planKey:planKey||null,asOf:at.toISOString(),currencies,
    promiseToPay:{
      duePromises:promises.length,fulfilledPromises:fulfilled,brokenPromises:promises.length-fulfilled,
      fulfillmentRatePct:pct(fulfilled,promises.length),promisedAmountDue:round(promisedAmountDue),
      fulfilledAmount:round(fulfilledAmount)
    }
  };
};

export const getRevenuePerformance=async({tenantId=null,planKey=null,asOf=new Date(),limit=100}={})=>{
  const at=parseDate(asOf);
  const parsedLimit=Number(limit);
  if(!Number.isInteger(parsedLimit)||parsedLimit<1||parsedLimit>500){
    throw errorOf('limit must be an integer from 1 to 500','INVALID_ANALYTICS_LIMIT');
  }
  const rows=await loadInvoiceRows({tenantId,planKey,asOf:at});
  const groups=new Map();
  for(const row of rows){
    const key=`${row.tenant_id}::${row.plan_key||'UNASSIGNED'}::${row.currency}`;
    if(!groups.has(key)){
      groups.set(key,{
        tenantId:row.tenant_id,planKey:row.plan_key||null,currency:row.currency,invoiceCount:0,
        originalBilledRevenue:0,creditNoteAmount:0,writeOffAmount:0,debitAdjustmentAmount:0,
        refundAmount:0,billedRevenue:0,collectibleRevenue:0,collectedRevenue:0,
        outstandingRevenue:0,overpaidAmount:0,providerCost:0
      });
    }
    const x=groups.get(key),m=calculateRow(row);
    x.invoiceCount+=1;
    x.originalBilledRevenue+=m.originalBilled;
    x.creditNoteAmount+=m.creditNotes;
    x.writeOffAmount+=m.writeOffs;
    x.debitAdjustmentAmount+=m.debitAdjustments;
    x.refundAmount+=m.refunds;
    x.billedRevenue+=m.adjustedBilledRevenue;
    x.collectibleRevenue+=m.collectibleAmount;
    x.collectedRevenue+=m.netCollected;
    x.outstandingRevenue+=m.outstanding;
    x.overpaidAmount+=m.overpaid;
    x.providerCost+=Number(row.provider_cost_total||0);
  }
  return [...groups.values()]
    .map(x=>({
      ...x,
      originalBilledRevenue:round(x.originalBilledRevenue),
      creditNoteAmount:round(x.creditNoteAmount),
      writeOffAmount:round(x.writeOffAmount),
      debitAdjustmentAmount:round(x.debitAdjustmentAmount),
      refundAmount:round(x.refundAmount),
      billedRevenue:round(x.billedRevenue),
      collectibleRevenue:round(x.collectibleRevenue),
      collectedRevenue:round(x.collectedRevenue),
      outstandingRevenue:round(x.outstandingRevenue),
      overpaidAmount:round(x.overpaidAmount),
      providerCost:round(x.providerCost),
      grossMargin:round(x.billedRevenue-x.providerCost),
      collectionRatePct:pct(x.collectedRevenue,x.billedRevenue),
      writeOffRatePct:pct(x.writeOffAmount,x.billedRevenue)
    }))
    .sort((a,b)=>b.billedRevenue-a.billedRevenue||String(a.tenantId).localeCompare(String(b.tenantId)))
    .slice(0,parsedLimit);
};
