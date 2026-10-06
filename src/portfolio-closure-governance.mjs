import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';
import { getProjectIntelligence } from './milestone-intelligence.mjs';
import { getProjectCostSummary } from './cost-ledger.mjs';

const ACTIVE_RISK_STATUSES=new Set(['OPEN','MITIGATING','ACCEPTED']);
const CLOSED_ISSUE_STATUSES=new Set(['RESOLVED','CLOSED','CANCELLED']);
const TERMINAL_PROJECT_STATUSES=new Set(['COMPLETED','ARCHIVED','CANCELLED']);
const HEALTH_RANK={GREEN:0,AMBER:1,RED:2};
const PRIORITY_RANK={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};
const upper=value=>value==null?null:String(value).toUpperCase();
const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asDate=value=>{
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime())) throw errorOf('Invalid date','INVALID_DATE',400,{value});
  return d;
};
const dateOnly=value=>value?asDate(value).toISOString().slice(0,10):null;
const worstHealth=values=>values.reduce((worst,value)=>
  (HEALTH_RANK[value]??-1)>(HEALTH_RANK[worst]??-1)?value:worst,'GREEN'
);
const isHigh=value=>['HIGH','CRITICAL'].includes(upper(value));
const isCritical=value=>upper(value)==='CRITICAL';

const latestGateRows=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT gate_key,status,blocking_reason,decided_at FROM (
       SELECT g.gate_key,g.status,g.blocking_reason,g.decided_at,g.id,
              ROW_NUMBER() OVER(PARTITION BY g.gate_key ORDER BY g.decided_at DESC,g.id DESC) AS rn
         FROM gate_results g
         JOIN runs r ON r.id=g.run_id
        WHERE r.project_id=?
      ) x WHERE rn=1`,[projectId]
  );
  return rows;
};
const latestQaRows=async(projectId,db)=>{
  const [rows]=await db.execute(
    `SELECT qa_case_key,status,issue_severity,issue_summary,verified_at FROM (
       SELECT q.qa_case_key,q.status,q.issue_severity,q.issue_summary,q.verified_at,q.id,
              ROW_NUMBER() OVER(PARTITION BY q.qa_case_key ORDER BY q.verified_at DESC,q.id DESC) AS rn
         FROM qa_evidence q
         JOIN runs r ON r.id=q.run_id
        WHERE r.project_id=?
      ) x WHERE rn=1`,[projectId]
  );
  return rows;
};
const loadProject=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const loadPortfolio=async(portfolioId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM portfolios WHERE id=?',[portfolioId]);
  if(!rows.length) throw errorOf('Portfolio not found','PORTFOLIO_NOT_FOUND',404);
  return rows[0];
};

export const resolvePortfolioScope=async portfolioId=>{
  const db=getRuntimePool();
  const portfolio=await loadPortfolio(portfolioId,db);
  const [workspaces]=await db.execute('SELECT tenant_id FROM workspaces WHERE id=?',[portfolio.workspace_id]);
  if(!workspaces.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  return {portfolioId,workspaceId:portfolio.workspace_id,tenantId:workspaces[0].tenant_id};
};

const scopeSignal=async(project,db)=>{
  if(!project.current_baseline_id){
    const [[changes]]=await db.execute('SELECT COUNT(*) AS count FROM project_changes WHERE project_id=?',[project.id]);
    const count=Number(changes.count||0);
    return {health:count?'AMBER':'GREEN',reason:count?'CHANGE_WITHOUT_CURRENT_BASELINE':'NO_UNBASELINED_CHANGE',unbaselinedChangeCount:count};
  }
  const [baselines]=await db.execute('SELECT effective_from FROM project_baselines WHERE id=? AND project_id=?',[project.current_baseline_id,project.id]);
  if(!baselines.length) return {health:'AMBER',reason:'CURRENT_BASELINE_REFERENCE_INVALID',unbaselinedChangeCount:null};
  const [[changes]]=await db.execute(
    'SELECT COUNT(*) AS count FROM project_changes WHERE project_id=? AND created_at>?',[project.id,baselines[0].effective_from]
  );
  const count=Number(changes.count||0);
  return {health:count?'AMBER':'GREEN',reason:count?'UNBASELINED_CHANGE':'BASELINE_CURRENT',unbaselinedChangeCount:count};
};

const riskSignal=rows=>{
  let health='GREEN';
  const material=[];
  for(const row of rows){
    if(!ACTIVE_RISK_STATUSES.has(upper(row.status))) continue;
    const impact=upper(row.impact),probability=upper(row.probability);
    if((isCritical(impact)&&isHigh(probability))||(isHigh(impact)&&upper(probability)==='HIGH')) health='RED';
    else if(health!=='RED'&&(isHigh(impact)||upper(probability)==='HIGH')) health='AMBER';
    if(isHigh(impact)||upper(probability)==='HIGH') material.push({id:row.id,riskKey:row.risk_key,impact,probability,status:row.status});
  }
  return {health,activeCount:rows.filter(r=>ACTIVE_RISK_STATUSES.has(upper(r.status))).length,material};
};
const issueSignal=rows=>{
  const open=rows.filter(r=>!CLOSED_ISSUE_STATUSES.has(upper(r.status)));
  const critical=open.filter(r=>isCritical(r.severity));
  const high=open.filter(r=>upper(r.severity)==='HIGH');
  return {health:critical.length?'RED':high.length?'AMBER':'GREEN',openCount:open.length,criticalCount:critical.length,highCount:high.length};
};
const gateSignal=rows=>{
  const fail=rows.filter(r=>upper(r.status)==='FAIL');
  const hold=rows.filter(r=>upper(r.status)==='HOLD');
  return {health:fail.length?'RED':hold.length?'AMBER':'GREEN',failCount:fail.length,holdCount:hold.length,latest:rows};
};
const qaSignal=rows=>{
  const failures=rows.filter(r=>upper(r.status)==='FAIL');
  const critical=failures.filter(r=>isHigh(r.issue_severity));
  return {health:critical.length?'RED':failures.length?'AMBER':'GREEN',failureCount:failures.length,criticalOrHighFailureCount:critical.length};
};
const dependencySignal=rows=>{
  const active=rows.filter(r=>['ACTIVE','BLOCKED'].includes(upper(r.status)));
  const blocked=active.filter(r=>upper(r.status)==='BLOCKED');
  const critical=active.filter(r=>Boolean(r.critical_path));
  const crossProject=active.filter(r=>upper(r.source_type)==='PROJECT'&&upper(r.target_type)==='PROJECT');
  return {health:blocked.length?'RED':critical.length?'AMBER':'GREEN',activeCount:active.length,blockedCount:blocked.length,criticalPathCount:critical.length,crossProjectCount:crossProject.length};
};
const costSignal=(project,cost)=>{
  const guardrail=project.budget_guardrail_amount==null?null:Number(project.budget_guardrail_amount);
  const guardrailCurrency=project.budget_guardrail_currency||null;
  if(!cost.usageCount) return {health:'GREEN',status:'NO_USAGE',estimatedCost:0,currency:null,guardrailAmount:guardrail,guardrailCurrency};
  if(cost.unknownCount>0) return {health:guardrail==null?'GREEN':'AMBER',status:'UNKNOWN_COST',estimatedCost:cost.estimatedCost,currency:cost.currency,unknownCount:cost.unknownCount,guardrailAmount:guardrail,guardrailCurrency};
  if(cost.costStatus==='MIXED_CURRENCY') return {health:guardrail==null?'GREEN':'AMBER',status:'MIXED_CURRENCY',estimatedCost:cost.estimatedCost,currency:null,guardrailAmount:guardrail,guardrailCurrency};
  if(guardrail==null) return {health:'GREEN',status:'NO_GUARDRAIL',estimatedCost:cost.estimatedCost,currency:cost.currency,guardrailAmount:null,guardrailCurrency:null};
  if(cost.currency&&guardrailCurrency&&cost.currency!==guardrailCurrency) return {health:'AMBER',status:'CURRENCY_MISMATCH',estimatedCost:cost.estimatedCost,currency:cost.currency,guardrailAmount:guardrail,guardrailCurrency};
  const utilization=guardrail>0?Number((cost.estimatedCost/guardrail*100).toFixed(2)):null;
  return {health:utilization!=null&&utilization>100?'RED':utilization!=null&&utilization>=85?'AMBER':'GREEN',status:utilization!=null&&utilization>100?'GUARDRAIL_EXCEEDED':utilization!=null&&utilization>=85?'GUARDRAIL_TIGHT':'WITHIN_GUARDRAIL',estimatedCost:cost.estimatedCost,currency:cost.currency,guardrailAmount:guardrail,guardrailCurrency,utilizationPercent:utilization};
};

export const getProjectHealth=async(projectId,{asOf=new Date(),persist=false}={})=>{
  const db=getRuntimePool();
  const project=await loadProject(projectId,db);
  const at=asDate(asOf);
  const intelligence=await getProjectIntelligence(projectId,{asOf:at,persist:false});
  const [risks,issues,blockers,dependencies,gates,qa,cost,scope]=await Promise.all([
    db.execute('SELECT * FROM project_risks WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute('SELECT * FROM project_issues WHERE project_id=? ORDER BY created_at,id',[projectId]).then(x=>x[0]),
    db.execute("SELECT * FROM project_blockers WHERE project_id=? AND status='OPEN' ORDER BY created_at,id",[projectId]).then(x=>x[0]),
    db.execute("SELECT * FROM project_dependencies WHERE project_id=? AND status IN ('ACTIVE','BLOCKED') ORDER BY created_at,id",[projectId]).then(x=>x[0]),
    latestGateRows(projectId,db),
    latestQaRows(projectId,db),
    getProjectCostSummary(projectId),
    scopeSignal(project,db)
  ]);
  const risk=riskSignal(risks),issue=issueSignal(issues),gate=gateSignal(gates),quality=qaSignal(qa),dependency=dependencySignal(dependencies),costState=costSignal(project,cost);
  const blocker={health:blockers.length?'RED':'GREEN',openCount:blockers.length};
  const targetDate=project.target_date?asDate(project.target_date):null;
  const projectOverdue=Boolean(targetDate&&!TERMINAL_PROJECT_STATUSES.has(upper(project.status))&&targetDate.getTime()<new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate())).getTime());
  const forecastLate=Boolean(project.target_date&&intelligence.forecastEnd&&dateOnly(intelligence.forecastEnd)>dateOnly(project.target_date));
  const schedule={health:projectOverdue?'RED':forecastLate||intelligence.derivedMilestoneHealth==='AT_RISK'?'AMBER':intelligence.derivedMilestoneHealth==='OFF_TRACK'?'RED':'GREEN',projectOverdue,forecastLate,targetDate:project.target_date||null,forecastEnd:intelligence.forecastEnd||null};
  if(intelligence.derivedMilestoneHealth==='OFF_TRACK') schedule.health='RED';
  const outcome={health:'GREEN',status:project.status==='COMPLETED'?(parseJson(project.closure_json)?.outcome?'RECORDED':'MISSING'):'NOT_DUE'};
  if(project.status==='COMPLETED'&&outcome.status==='MISSING') outcome.health='RED';
  const signals={schedule,scope,quality,risk,blocker,gate,cost:costState,dependency,outcome};
  const signalHealth=Object.values(signals).map(s=>s.health).filter(Boolean);
  let health=worstHealth(signalHealth);
  if(upper(project.status)==='BLOCKED') health='RED';
  const reasonCodes=[];
  for(const [key,signal] of Object.entries(signals)) if(signal.health&&signal.health!=='GREEN') reasonCodes.push(`${key.toUpperCase()}_${signal.health}`);
  if(upper(project.status)==='BLOCKED') reasonCodes.push('PROJECT_STATUS_BLOCKED');
  const result={projectId,status:project.status,health,reasonCodes,signals,currentMilestone:intelligence.currentMilestone,forecastEnd:intelligence.forecastEnd,staleness:intelligence.staleness,asOf:at};
  if(persist){
    await db.execute('UPDATE projects SET health=? WHERE id=?',[health,projectId]);
    await db.execute(
      `INSERT INTO project_health_snapshots(id,project_id,health,reason_codes_json,signals_json,evidence_json,as_of)
       VALUES (?,?,?,?,?,?,?)`,
      [randomUUID(),projectId,health,asJson(reasonCodes),asJson(signals),asJson({source:'M26.4_PROJECT_HEALTH'}),at]
    );
  }
  return result;
};

export const refreshProjectHealth=(projectId,input={})=>getProjectHealth(projectId,{asOf:input.asOf||new Date(),persist:true});

export const getPortfolioIntelligence=async(portfolioId,{asOf=new Date(),persist=false}={})=>{
  const db=getRuntimePool(),portfolio=await loadPortfolio(portfolioId,db),at=asDate(asOf);
  const [links]=await db.execute(
    `SELECT l.roadmap_order,l.target_window,p.* FROM portfolio_project_links l
      JOIN projects p ON p.id=l.project_id WHERE l.portfolio_id=?
      ORDER BY COALESCE(l.roadmap_order,2147483647),p.priority,p.project_key`,[portfolioId]
  );
  const projects=[];
  for(const row of links){
    const health=await getProjectHealth(row.id,{asOf:at,persist});
    projects.push({
      projectId:row.id,projectKey:row.project_key,name:row.name,status:row.status,
      priority:row.priority,roadmapOrder:row.roadmap_order==null?null:Number(row.roadmap_order),
      targetWindow:row.target_window||null,health:health.health,reasonCodes:health.reasonCodes,
      currentMilestone:health.currentMilestone,forecastEnd:health.forecastEnd,
      cost:health.signals.cost,capacityStatus:health.currentMilestone?.health==='OFF_TRACK'?'AT_RISK':'NORMAL'
    });
  }
  const ids=projects.map(p=>p.projectId);
  let crossDependencies=[];
  if(ids.length){
    const placeholders=ids.map(()=>'?').join(',');
    const [rows]=await db.execute(
      `SELECT * FROM project_dependencies
        WHERE source_type='PROJECT' AND target_type='PROJECT'
          AND source_id IN (${placeholders}) AND target_id IN (${placeholders})
          AND status IN ('ACTIVE','BLOCKED')`,[...ids,...ids]
    );
    crossDependencies=rows.map(row=>({
      id:row.id,sourceProjectId:row.source_id,targetProjectId:row.target_id,
      dependencyType:row.dependency_type,status:row.status,criticalPath:Boolean(row.critical_path)
    }));
  }
  const health=worstHealth(projects.map(p=>p.health));
  const atRiskCount=projects.filter(p=>p.health==='AMBER').length;
  const blockedCount=projects.filter(p=>p.status==='BLOCKED'||p.health==='RED').length;
  const forecasts=projects.map(p=>p.forecastEnd).filter(Boolean).sort();
  const forecastEnd=forecasts.length?forecasts[forecasts.length-1]:null;
  const overBudget=projects.filter(p=>p.cost?.health==='RED').length;
  const budgetTight=projects.filter(p=>p.cost?.health==='AMBER').length;
  const capacitySignal={status:blockedCount?'CONSTRAINED':atRiskCount?'TIGHT':'AVAILABLE',atRiskProjectCount:atRiskCount,blockedProjectCount:blockedCount};
  const budgetSignal={status:overBudget?'OVER_GUARDRAIL':budgetTight?'TIGHT':'WITHIN_SIGNAL',overBudgetProjectCount:overBudget,tightProjectCount:budgetTight};
  const attentionOrder=[...projects].sort((a,b)=>{
    const healthDelta=(HEALTH_RANK[b.health]??0)-(HEALTH_RANK[a.health]??0);if(healthDelta) return healthDelta;
    if((a.status==='BLOCKED')!==(b.status==='BLOCKED')) return a.status==='BLOCKED'?-1:1;
    const priorityDelta=(PRIORITY_RANK[a.priority]??9)-(PRIORITY_RANK[b.priority]??9);if(priorityDelta) return priorityDelta;
    return (a.roadmapOrder??2147483647)-(b.roadmapOrder??2147483647);
  }).map((p,index)=>({rank:index+1,projectId:p.projectId,projectKey:p.projectKey,health:p.health,status:p.status,priority:p.priority,reasonCodes:p.reasonCodes}));
  const result={
    portfolio:{id:portfolio.id,workspaceId:portfolio.workspace_id,portfolioKey:portfolio.portfolio_key,name:portfolio.name,status:portfolio.status,health},
    summary:{projectCount:projects.length,greenCount:projects.filter(p=>p.health==='GREEN').length,atRiskCount,blockedCount,forecastEnd,crossProjectDependencyCount:crossDependencies.length},
    capacitySignal,budgetSignal,crossProjectDependencies:crossDependencies,attentionOrder,projects,asOf:at
  };
  if(persist){
    await db.execute(
      `UPDATE portfolios SET health=?,capacity_signal_json=?,budget_signal_json=?,last_intelligence_at=? WHERE id=?`,
      [health,asJson(capacitySignal),asJson(budgetSignal),at,portfolioId]
    );
    await db.execute(
      `INSERT INTO portfolio_intelligence_snapshots
        (id,portfolio_id,health,project_count,at_risk_count,blocked_count,forecast_end,
         cross_project_dependency_count,capacity_signal_json,budget_signal_json,project_summary_json,evidence_json,as_of)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(),portfolioId,health,projects.length,atRiskCount,blockedCount,forecastEnd,
       crossDependencies.length,asJson(capacitySignal),asJson(budgetSignal),asJson(projects),
       asJson({source:'M26.4_PORTFOLIO_INTELLIGENCE'}),at]
    );
  }
  return result;
};

export const refreshPortfolioIntelligence=(portfolioId,input={})=>getPortfolioIntelligence(portfolioId,{asOf:input.asOf||new Date(),persist:true});

export const getProjectClosureReadiness=async(projectId,{asOf=new Date()}={})=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db),at=asDate(asOf);
  const health=await getProjectHealth(projectId,{asOf:at,persist:false});
  const [baselines,milestones,blockers,criticalIssues,pendingApprovals]=await Promise.all([
    db.execute("SELECT id,baseline_no,version_label,status,effective_from FROM project_baselines WHERE project_id=? AND status='CURRENT' ORDER BY baseline_no DESC LIMIT 1",[projectId]).then(x=>x[0]),
    db.execute("SELECT id,milestone_key,management_status FROM project_milestones WHERE project_id=? AND management_status NOT IN ('COMPLETED','CANCELLED') ORDER BY sequence_no,id",[projectId]).then(x=>x[0]),
    db.execute("SELECT id,blocker_key FROM project_blockers WHERE project_id=? AND status='OPEN'",[projectId]).then(x=>x[0]),
    db.execute("SELECT id,issue_key,severity FROM project_issues WHERE project_id=? AND status NOT IN ('RESOLVED','CLOSED','CANCELLED') AND severity IN ('HIGH','CRITICAL')",[projectId]).then(x=>x[0]),
    db.execute("SELECT id,request_key,risk_level FROM approval_requests WHERE project_id=? AND status='PENDING'",[projectId]).then(x=>x[0])
  ]);
  const blockersList=[];
  if(!baselines.length) blockersList.push('FINAL_BASELINE_REQUIRED');
  if(milestones.length) blockersList.push('MILESTONES_NOT_CLOSED');
  if(blockers.length) blockersList.push('ACTIVE_BLOCKERS');
  if(criticalIssues.length) blockersList.push('HIGH_SEVERITY_ISSUES_OPEN');
  if(pendingApprovals.length) blockersList.push('PENDING_APPROVALS');
  if(health.signals.gate.failCount>0) blockersList.push('LATEST_GATE_FAILURE');
  return {
    projectId,status:project.status,ready:blockersList.length===0,blockers:blockersList,
    finalBaseline:baselines[0]?{id:baselines[0].id,baselineNo:Number(baselines[0].baseline_no),versionLabel:baselines[0].version_label,effectiveFrom:baselines[0].effective_from}:null,
    openMilestones:milestones.map(x=>({id:x.id,milestoneKey:x.milestone_key,status:x.management_status})),
    openBlockers:blockers.map(x=>({id:x.id,blockerKey:x.blocker_key})),
    highSeverityIssues:criticalIssues.map(x=>({id:x.id,issueKey:x.issue_key,severity:x.severity})),
    pendingApprovals:pendingApprovals.map(x=>({id:x.id,requestKey:x.request_key,riskLevel:x.risk_level})),
    health,asOf:at
  };
};

export const completeProject=async(projectId,input={})=>{
  if(!input.finalReview||!input.archivePolicy||!input.evidence) throw errorOf(
    'finalReview, archivePolicy and evidence are required','PROJECT_CLOSURE_EVIDENCE_REQUIRED',409
  );
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  if(['ARCHIVED','CANCELLED'].includes(upper(project.status))) throw errorOf('Project lifecycle is terminal','PROJECT_TERMINAL',409,{status:project.status});
  const readiness=await getProjectClosureReadiness(projectId,{asOf:input.asOf||new Date()});
  if(!readiness.ready) throw errorOf('Project is not ready for completion','PROJECT_CLOSURE_NOT_READY',409,{blockers:readiness.blockers});
  const reviewStatus=upper(input.finalReview.status||input.finalReview.result||'PASS');
  if(!['PASS','ACCEPTED'].includes(reviewStatus)) throw errorOf('Final review must PASS or be ACCEPTED','PROJECT_FINAL_REVIEW_NOT_PASS',409,{reviewStatus});
  const baselineId=input.finalBaselineId||readiness.finalBaseline.id;
  if(baselineId!==readiness.finalBaseline.id) throw errorOf('Completion must reference the current final baseline','PROJECT_FINAL_BASELINE_MISMATCH',409,{expected:readiness.finalBaseline.id,received:baselineId});
  const reviewId=randomUUID();
  await db.execute(
    `INSERT INTO project_closure_reviews
      (id,project_id,final_baseline_id,final_review_status,final_review_json,archive_policy_json,
       outcome_json,residual_risks_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [reviewId,projectId,baselineId,reviewStatus,asJson(input.finalReview),asJson(input.archivePolicy),
     asJson(input.outcome||null),asJson(input.residualRisks||null),asJson(input.evidence),input.createdByIdentityId||null]
  );
  const closure={reviewId,finalBaselineId:baselineId,finalReview:input.finalReview,archivePolicy:input.archivePolicy,outcome:input.outcome||null,residualRisks:input.residualRisks||null,evidence:input.evidence,completedAt:new Date().toISOString()};
  await db.execute(
    `UPDATE projects SET status='COMPLETED',closure_json=?,actual_end_date=?,current_baseline_id=? WHERE id=?`,
    [asJson(closure),dateOnly(input.completedAt||new Date()),baselineId,projectId]
  );
  return {projectId,status:'COMPLETED',closureReviewId:reviewId,finalBaselineId:baselineId,closure};
};

export const archiveProject=async(projectId,input={})=>{
  const db=getRuntimePool(),project=await loadProject(projectId,db);
  if(project.status==='ARCHIVED') throw errorOf('Project is already archived','PROJECT_ARCHIVED_TERMINAL',409);
  if(project.status!=='COMPLETED') throw errorOf('Only a completed project may be archived','PROJECT_ARCHIVE_REQUIRES_COMPLETED',409,{status:project.status});
  const [reviews]=await db.execute(
    `SELECT * FROM project_closure_reviews WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1`,[projectId]
  );
  if(!reviews.length) throw errorOf('Project archive requires an immutable closure review','PROJECT_ARCHIVE_REVIEW_REQUIRED',409);
  const review=reviews[0],policy=parseJson(review.archive_policy_json);
  if(!policy||typeof policy!=='object'||!Object.keys(policy).length) throw errorOf('Project archive policy is required','PROJECT_ARCHIVE_POLICY_REQUIRED',409);
  if(project.current_baseline_id!==review.final_baseline_id) throw errorOf('Archive baseline must match closure baseline','PROJECT_ARCHIVE_BASELINE_MISMATCH',409);
  await db.execute("UPDATE projects SET status='ARCHIVED',archived_at=CURRENT_TIMESTAMP(6) WHERE id=?",[projectId]);
  return {projectId,status:'ARCHIVED',closureReviewId:review.id,finalBaselineId:review.final_baseline_id,archivePolicy:policy};
};
