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

const loadInvoiceRows=async({tenantId=null,planKey=null}={})=>{
  const db=getRuntimePool();
  const clauses=[],params=[];
  if(tenantId){clauses.push('i.tenant_id=?');params.push(tenantId);}
  if(planKey){clauses.push('s.plan_key=?');params.push(planKey);}
  const [rows]=await db.execute(
    `SELECT
       i.id,i.tenant_id,i.subscription_id,i.currency,i.total_due,i.amount_paid,
       i.issued_at,i.due_at,i.paid_at,i.status,
       s.plan_key,
       COALESCE(b.provider_cost_total,0) AS provider_cost_total
     FROM invoices i
     LEFT JOIN subscriptions s ON s.id=i.subscription_id
     LEFT JOIN billing_cycles b ON b.id=i.billing_cycle_id
     ${clauses.length?'WHERE '+clauses.join(' AND '):''}
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

export const getRevenueAnalytics=async({tenantId=null,planKey=null,asOf=new Date()}={})=>{
  const at=parseDate(asOf);
  const rows=await loadInvoiceRows({tenantId,planKey});
  const byCurrency=new Map();

  for(const row of rows){
    const currency=row.currency;
    if(!byCurrency.has(currency)){
      byCurrency.set(currency,{
        currency,invoiceCount:0,paidInvoiceCount:0,openInvoiceCount:0,overdueInvoiceCount:0,
        totalBilled:0,amountPaid:0,outstanding:0,overdueOutstanding:0,
        aging:{current:0,days1To30:0,days31To60:0,days61To90:0,days90Plus:0}
      });
    }
    const x=byCurrency.get(currency);
    const billed=Number(row.total_due||0),paid=Number(row.amount_paid||0);
    const outstanding=Math.max(0,billed-paid);
    x.invoiceCount+=1;
    x.totalBilled+=billed;
    x.amountPaid+=paid;
    x.outstanding+=outstanding;
    if(outstanding<=0){
      x.paidInvoiceCount+=1;
    }else{
      x.openInvoiceCount+=1;
      const bucket=classifyAging(row.due_at,at);
      x.aging[bucket]+=outstanding;
      if(bucket!=='current'){
        x.overdueInvoiceCount+=1;
        x.overdueOutstanding+=outstanding;
      }
    }
  }

  const currencies=[...byCurrency.values()].map(x=>({
    ...x,
    totalBilled:round(x.totalBilled),
    amountPaid:round(x.amountPaid),
    outstanding:round(x.outstanding),
    overdueOutstanding:round(x.overdueOutstanding),
    collectionRatePct:pct(x.amountPaid,x.totalBilled),
    aging:Object.fromEntries(Object.entries(x.aging).map(([k,v])=>[k,round(v)]))
  }));

  const db=getRuntimePool();
  const promiseParams=[at],promiseClauses=["a.action_type='PROMISE_TO_PAY'","a.promise_due_at<=?"];
  if(tenantId){promiseClauses.push('a.tenant_id=?');promiseParams.push(tenantId);}
  const [promises]=await db.execute(
    `SELECT a.id,a.invoice_id,a.tenant_id,a.amount,a.occurred_at,a.promise_due_at,
       COALESCE((
         SELECT SUM(p.amount) FROM invoice_payments p
         WHERE p.invoice_id=a.invoice_id
           AND p.received_at>=a.occurred_at
           AND p.received_at<=a.promise_due_at
       ),0) AS paid_by_due
     FROM collection_actions a
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
    tenantId:tenantId||null,
    planKey:planKey||null,
    asOf:at.toISOString(),
    currencies,
    promiseToPay:{
      duePromises:promises.length,
      fulfilledPromises:fulfilled,
      brokenPromises:promises.length-fulfilled,
      fulfillmentRatePct:pct(fulfilled,promises.length),
      promisedAmountDue:round(promisedAmountDue),
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
  const rows=await loadInvoiceRows({tenantId,planKey});
  const groups=new Map();
  for(const row of rows){
    if(new Date(row.issued_at).getTime()>at.getTime()) continue;
    const key=`${row.tenant_id}::${row.plan_key||'UNASSIGNED'}::${row.currency}`;
    if(!groups.has(key)){
      groups.set(key,{
        tenantId:row.tenant_id,planKey:row.plan_key||null,currency:row.currency,
        invoiceCount:0,billedRevenue:0,collectedRevenue:0,outstandingRevenue:0,
        providerCost:0,grossMargin:0
      });
    }
    const x=groups.get(key);
    const billed=Number(row.total_due||0),paid=Number(row.amount_paid||0),provider=Number(row.provider_cost_total||0);
    x.invoiceCount+=1;
    x.billedRevenue+=billed;
    x.collectedRevenue+=paid;
    x.outstandingRevenue+=Math.max(0,billed-paid);
    x.providerCost+=provider;
  }
  return [...groups.values()]
    .map(x=>({
      ...x,
      billedRevenue:round(x.billedRevenue),
      collectedRevenue:round(x.collectedRevenue),
      outstandingRevenue:round(x.outstandingRevenue),
      providerCost:round(x.providerCost),
      grossMargin:round(x.billedRevenue-x.providerCost),
      collectionRatePct:pct(x.collectedRevenue,x.billedRevenue)
    }))
    .sort((a,b)=>b.billedRevenue-a.billedRevenue||String(a.tenantId).localeCompare(String(b.tenantId)))
    .slice(0,parsedLimit);
};
