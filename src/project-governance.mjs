import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const PROJECT_STATUSES=new Set(['DRAFT','READY','ACTIVE','BLOCKED','PAUSED','COMPLETED','ARCHIVED','CANCELLED']);
const HEALTH_VALUES=new Set(['GREEN','AMBER','RED']);
const MILESTONE_STATUSES=new Set(['PLANNED','ACTIVE','BLOCKED','PAUSED','COMPLETED','CANCELLED']);
const ITERATION_STATUSES=new Set(['PLANNED','ACTIVE','COMPLETED','CANCELLED']);
const WORK_ITEM_TYPES=new Set([
  'REQUIREMENT','FEATURE','TASK','BUG','IMPROVEMENT','EXPERIMENT',
  'RESEARCH','CONTENT_ITEM','OPERATIONS_ITEM','TECH_DEBT'
]);
const WORK_ITEM_STATUSES=new Set(['PLANNED','READY','IN_PROGRESS','BLOCKED','PAUSED','COMPLETED','CANCELLED']);
const DEPENDENCY_STATUSES=new Set(['ACTIVE','BLOCKED','RESOLVED','COMPLETED','CANCELLED','INACTIVE']);
const RISK_STATUSES=new Set(['OPEN','MITIGATING','ACCEPTED','RESOLVED','CLOSED']);
const DEPENDENCY_TYPES=new Set(['BLOCKS','REQUIRES','PRODUCES','VALIDATES','SUPERSEDES','RELATED']);
const STRUCTURE_TYPES=new Set(['BUSINESS_DOMAIN','MODULE','EPIC']);
const PRIORITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details) error.details=details;
  return error;
};
const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const upper=value=>value==null?null:String(value).toUpperCase();
const dateOrNull=value=>{
  if(value==null||value==='') return null;
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) throw errorOf('Invalid date','INVALID_DATE',400,{value});
  return d;
};
const validateEnum=(value,set,code,label)=>{
  const v=upper(value);
  if(!set.has(v)) throw errorOf(`Invalid ${label}`,code,400,{allowed:Array.from(set),received:v});
  return v;
};
const validateHealth=value=>validateEnum(value||'GREEN',HEALTH_VALUES,'INVALID_PROJECT_HEALTH','health');
const validatePriority=value=>validateEnum(value||'MEDIUM',PRIORITIES,'INVALID_PRIORITY','priority');
const validateProjectStatus=value=>validateEnum(value,PROJECT_STATUSES,'INVALID_PROJECT_STATUS','project lifecycle status');
const validateMilestoneStatus=value=>validateEnum(value||'PLANNED',MILESTONE_STATUSES,'INVALID_MILESTONE_STATUS','milestone lifecycle status');

const projectScope=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const assertWorkspace=async(workspaceId,db)=>{
  const [rows]=await db.execute('SELECT id,status FROM workspaces WHERE id=?',[workspaceId]);
  if(!rows.length) throw errorOf('Workspace not found','WORKSPACE_NOT_FOUND',404);
  if(rows[0].status!=='ACTIVE') throw errorOf('Workspace is not active','WORKSPACE_NOT_ACTIVE',409);
};
const assertSameWorkspace=async(projectId,workspaceId,db)=>{
  const project=await projectScope(projectId,db);
  if(project.workspace_id!==workspaceId) throw errorOf(
    'Linked governance object must be in the same workspace as the project',
    'GOVERNANCE_WORKSPACE_MISMATCH',409,{projectId,workspaceId,projectWorkspaceId:project.workspace_id}
  );
  return project;
};
const normalizeProject=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  projectKey:row.project_key,name:row.name,projectType:row.project_type,
  projectSubtypeKey:row.project_subtype_key||null,status:row.status,
  priority:row.priority,health:row.health,
  ownerIdentityId:row.owner_identity_id||null,
  projectManagerIdentityId:row.project_manager_identity_id||null,
  goal:row.goal||null,successCriteria:parseJson(row.success_criteria_json),
  scope:parseJson(row.scope_json),outOfScope:parseJson(row.out_of_scope_json),
  startDate:row.start_date||null,targetDate:row.target_date||null,actualEndDate:row.actual_end_date||null,
  currentMilestoneId:row.current_milestone_id||null,currentIterationId:row.current_iteration_id||null,
  currentBaselineId:row.current_baseline_id||null,currentStageKey:row.current_stage_key||null,
  riskLevel:row.risk_level||null,
  budgetGuardrailAmount:row.budget_guardrail_amount==null?null:Number(row.budget_guardrail_amount),
  budgetGuardrailCurrency:row.budget_guardrail_currency||null,
  releaseDistributionStatus:row.release_distribution_status||null,
  tags:parseJson(row.tags_json),closure:parseJson(row.closure_json),
  archivedAt:row.archived_at||null,createdAt:row.created_at,updatedAt:row.updated_at
});

export const updateProjectGovernance=async(projectId,input={})=>{
  const db=getRuntimePool();
  const current=await projectScope(projectId,db);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};

  if(input.status!==undefined){
    const status=validateProjectStatus(input.status);
    if(status==='ARCHIVED'){
      const baselineId=input.currentBaselineId??current.current_baseline_id;
      const closure=input.closure??parseJson(current.closure_json);
      if(!baselineId) throw errorOf(
        'Project archive requires a final baseline','PROJECT_ARCHIVE_BASELINE_REQUIRED',409
      );
      if(!closure||typeof closure!=='object'||Object.keys(closure).length===0) throw errorOf(
        'Project archive requires closure evidence','PROJECT_ARCHIVE_CLOSURE_REQUIRED',409
      );
      assign('archived_at',new Date());
    }else if(current.status==='ARCHIVED'){
      throw errorOf('Archived project lifecycle is terminal','PROJECT_ARCHIVED_TERMINAL',409);
    }
    assign('status',status);
  }
  if(input.health!==undefined) assign('health',validateHealth(input.health));
  if(input.ownerIdentityId!==undefined) assign('owner_identity_id',input.ownerIdentityId||null);
  if(input.projectManagerIdentityId!==undefined) assign('project_manager_identity_id',input.projectManagerIdentityId||null);
  if(input.goal!==undefined) assign('goal',input.goal||null);
  if(input.successCriteria!==undefined) assign('success_criteria_json',asJson(input.successCriteria));
  if(input.scope!==undefined) assign('scope_json',asJson(input.scope));
  if(input.outOfScope!==undefined) assign('out_of_scope_json',asJson(input.outOfScope));
  if(input.priority!==undefined) assign('priority',validatePriority(input.priority));
  if(input.startDate!==undefined) assign('start_date',dateOrNull(input.startDate));
  if(input.targetDate!==undefined) assign('target_date',dateOrNull(input.targetDate));
  if(input.actualEndDate!==undefined) assign('actual_end_date',dateOrNull(input.actualEndDate));
  if(input.currentMilestoneId!==undefined) assign('current_milestone_id',input.currentMilestoneId||null);
  if(input.currentIterationId!==undefined) assign('current_iteration_id',input.currentIterationId||null);
  if(input.currentBaselineId!==undefined) assign('current_baseline_id',input.currentBaselineId||null);
  if(input.riskLevel!==undefined) assign('risk_level',upper(input.riskLevel));
  if(input.budgetGuardrailAmount!==undefined) assign(
    'budget_guardrail_amount',
    input.budgetGuardrailAmount==null?null:Number(input.budgetGuardrailAmount)
  );
  if(input.budgetGuardrailCurrency!==undefined) assign(
    'budget_guardrail_currency',
    input.budgetGuardrailCurrency?upper(input.budgetGuardrailCurrency):null
  );
  if(input.releaseDistributionStatus!==undefined) assign(
    'release_distribution_status',input.releaseDistributionStatus||null
  );
  if(input.tags!==undefined) assign('tags_json',asJson(input.tags));
  if(input.closure!==undefined) assign('closure_json',asJson(input.closure));
  if(!sets.length) return normalizeProject(current);
  values.push(projectId);
  await db.execute(`UPDATE projects SET ${sets.join(',')} WHERE id=?`,values);
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  return normalizeProject(rows[0]);
};

export const createStrategicItem=async input=>{
  if(!input?.workspaceId||!input?.itemKey||!input?.itemType||!input?.title||!input?.goal) throw errorOf(
    'workspaceId, itemKey, itemType, title and goal are required','INVALID_STRATEGIC_ITEM'
  );
  const type=upper(input.itemType);
  if(!['OBJECTIVE','INITIATIVE'].includes(type)) throw errorOf(
    'itemType must be OBJECTIVE or INITIATIVE','INVALID_STRATEGIC_ITEM_TYPE'
  );
  const db=getRuntimePool();
  await assertWorkspace(input.workspaceId,db);
  if(input.parentId){
    const [parents]=await db.execute(
      'SELECT id,workspace_id,item_type FROM strategic_items WHERE id=?',[input.parentId]
    );
    if(!parents.length) throw errorOf('Strategic parent not found','STRATEGIC_PARENT_NOT_FOUND',404);
    if(parents[0].workspace_id!==input.workspaceId) throw errorOf(
      'Strategic parent must be in same workspace','STRATEGIC_PARENT_WORKSPACE_MISMATCH',409
    );
    if(type==='OBJECTIVE') throw errorOf(
      'Objective cannot have a strategic parent','OBJECTIVE_PARENT_NOT_ALLOWED',409
    );
  }
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO strategic_items
      (id,workspace_id,parent_id,item_key,item_type,title,goal,theme,scope_json,owner_identity_id,
       target_start,target_end,success_metric_json,priority,health,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.parentId||null,input.itemKey,type,input.title,input.goal,input.theme||null,
      asJson(input.scope||null),input.ownerIdentityId||null,dateOrNull(input.targetStart),dateOrNull(input.targetEnd),
      asJson(input.successMetric||null),validatePriority(input.priority),validateHealth(input.health),
      upper(input.status||'ACTIVE'),asJson(input.evidence||null)
    ]
  );
  return {id,workspaceId:input.workspaceId,itemKey:input.itemKey,itemType:type,title:input.title,status:upper(input.status||'ACTIVE')};
};

export const listStrategicItems=async({workspaceId,itemType=null,status=null}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_STRATEGIC_ITEM_QUERY');
  const db=getRuntimePool();
  await assertWorkspace(workspaceId,db);
  const where=['workspace_id=?'],params=[workspaceId];
  if(itemType){where.push('item_type=?');params.push(upper(itemType));}
  if(status){where.push('status=?');params.push(upper(status));}
  const [rows]=await db.execute(
    `SELECT * FROM strategic_items WHERE ${where.join(' AND ')}
      ORDER BY CASE item_type WHEN 'OBJECTIVE' THEN 0 ELSE 1 END,priority,target_end,item_key`,
    params
  );
  return rows.map(row=>({
    id:row.id,workspaceId:row.workspace_id,parentId:row.parent_id||null,itemKey:row.item_key,
    itemType:row.item_type,title:row.title,goal:row.goal,theme:row.theme||null,
    scope:parseJson(row.scope_json),ownerIdentityId:row.owner_identity_id||null,
    targetStart:row.target_start||null,targetEnd:row.target_end||null,
    successMetric:parseJson(row.success_metric_json),priority:row.priority,
    health:row.health,status:row.status,evidence:parseJson(row.evidence_json)
  }));
};

export const createPortfolio=async input=>{
  if(!input?.workspaceId||!input?.portfolioKey||!input?.name) throw errorOf(
    'workspaceId, portfolioKey and name are required','INVALID_PORTFOLIO'
  );
  const db=getRuntimePool();
  await assertWorkspace(input.workspaceId,db);
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO portfolios
      (id,workspace_id,portfolio_key,name,strategic_theme,owner_identity_id,target_start,target_end,
       priority,health,status,capacity_signal_json,budget_signal_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.portfolioKey,input.name,input.strategicTheme||null,input.ownerIdentityId||null,
      dateOrNull(input.targetStart),dateOrNull(input.targetEnd),validatePriority(input.priority),
      validateHealth(input.health),upper(input.status||'ACTIVE'),
      asJson(input.capacitySignal||null),asJson(input.budgetSignal||null)
    ]
  );
  return {id,workspaceId:input.workspaceId,portfolioKey:input.portfolioKey,name:input.name};
};

export const listPortfolios=async({workspaceId,status=null}={})=>{
  if(!workspaceId) throw errorOf('workspaceId is required','INVALID_PORTFOLIO_QUERY');
  const db=getRuntimePool();
  await assertWorkspace(workspaceId,db);
  const where=['workspace_id=?'],params=[workspaceId];
  if(status){where.push('status=?');params.push(upper(status));}
  const [rows]=await db.execute(
    `SELECT * FROM portfolios WHERE ${where.join(' AND ')}
      ORDER BY priority,target_end,portfolio_key`,
    params
  );
  return rows.map(row=>({
    id:row.id,workspaceId:row.workspace_id,portfolioKey:row.portfolio_key,name:row.name,
    strategicTheme:row.strategic_theme||null,ownerIdentityId:row.owner_identity_id||null,
    targetStart:row.target_start||null,targetEnd:row.target_end||null,
    priority:row.priority,health:row.health,status:row.status,
    capacitySignal:parseJson(row.capacity_signal_json),budgetSignal:parseJson(row.budget_signal_json)
  }));
};

export const getPortfolioRoadmap=async portfolioId=>{
  const db=getRuntimePool();
  const [portfolios]=await db.execute('SELECT * FROM portfolios WHERE id=?',[portfolioId]);
  if(!portfolios.length) throw errorOf('Portfolio not found','PORTFOLIO_NOT_FOUND',404);
  const [projects]=await db.execute(
    `SELECT l.roadmap_order,l.target_window,p.id,p.project_key,p.name,p.project_type,p.project_subtype_key,
            p.status,p.health,p.priority,p.target_date,p.current_milestone_id
       FROM portfolio_project_links l
       JOIN projects p ON p.id=l.project_id
      WHERE l.portfolio_id=?
      ORDER BY COALESCE(l.roadmap_order,2147483647),p.priority,p.project_key`,
    [portfolioId]
  );
  return {
    portfolio:{
      id:portfolios[0].id,workspaceId:portfolios[0].workspace_id,
      portfolioKey:portfolios[0].portfolio_key,name:portfolios[0].name,
      health:portfolios[0].health,status:portfolios[0].status
    },
    projects:projects.map(row=>({
      id:row.id,projectKey:row.project_key,name:row.name,projectType:row.project_type,
      projectSubtypeKey:row.project_subtype_key||null,status:row.status,
      health:row.health,priority:row.priority,targetDate:row.target_date||null,
      currentMilestoneId:row.current_milestone_id||null,
      roadmapOrder:row.roadmap_order==null?null:Number(row.roadmap_order),
      targetWindow:row.target_window||null
    }))
  };
};

export const linkStrategicItemProject=async input=>{
  if(!input?.strategicItemId||!input?.projectId) throw errorOf(
    'strategicItemId and projectId are required','INVALID_STRATEGY_PROJECT_LINK'
  );
  const db=getRuntimePool();
  const [strategicRows]=await db.execute(
    'SELECT id,workspace_id FROM strategic_items WHERE id=?',[input.strategicItemId]
  );
  if(!strategicRows.length) throw errorOf('Strategic item not found','STRATEGIC_ITEM_NOT_FOUND',404);
  await assertSameWorkspace(input.projectId,strategicRows[0].workspace_id,db);
  const weight=input.weightBps==null?null:Number(input.weightBps);
  if(weight!=null&&(weight<0||weight>10000)) throw errorOf(
    'weightBps must be between 0 and 10000','INVALID_STRATEGY_WEIGHT'
  );
  await db.execute(
    `INSERT INTO strategic_item_project_links(strategic_item_id,project_id,link_role,weight_bps)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE link_role=VALUES(link_role),weight_bps=VALUES(weight_bps)`,
    [input.strategicItemId,input.projectId,input.linkRole||'CONTRIBUTES_TO',weight]
  );
  return {
    strategicItemId:input.strategicItemId,projectId:input.projectId,
    linkRole:input.linkRole||'CONTRIBUTES_TO',weightBps:weight
  };
};

export const linkPortfolioProject=async input=>{
  if(!input?.portfolioId||!input?.projectId) throw errorOf(
    'portfolioId and projectId are required','INVALID_PORTFOLIO_PROJECT_LINK'
  );
  const db=getRuntimePool();
  const [portfolioRows]=await db.execute(
    'SELECT id,workspace_id FROM portfolios WHERE id=?',[input.portfolioId]
  );
  if(!portfolioRows.length) throw errorOf('Portfolio not found','PORTFOLIO_NOT_FOUND',404);
  await assertSameWorkspace(input.projectId,portfolioRows[0].workspace_id,db);
  await db.execute(
    `INSERT INTO portfolio_project_links(portfolio_id,project_id,roadmap_order,target_window)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE roadmap_order=VALUES(roadmap_order),target_window=VALUES(target_window)`,
    [
      input.portfolioId,input.projectId,
      input.roadmapOrder==null?null:Number(input.roadmapOrder),input.targetWindow||null
    ]
  );
  return {portfolioId:input.portfolioId,projectId:input.projectId};
};

export const createProjectBaseline=async(projectId,input={})=>{
  const db=getRuntimePool();
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [projects]=await conn.execute('SELECT * FROM projects WHERE id=? FOR UPDATE',[projectId]);
    if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
    const project=projects[0];
    const [[next]]=await conn.execute(
      'SELECT COALESCE(MAX(baseline_no),0)+1 AS next_no FROM project_baselines WHERE project_id=? FOR UPDATE',
      [projectId]
    );
    const baselineNo=Number(next.next_no);
    const id=randomUUID();
    const versionLabel=input.versionLabel||`B${baselineNo}`;
    const [currentRows]=await conn.execute(
      "SELECT id FROM project_baselines WHERE project_id=? AND status='CURRENT' FOR UPDATE",
      [projectId]
    );
    await conn.execute(
      `INSERT INTO project_baselines
        (id,project_id,baseline_no,version_label,status,goal,scope_json,out_of_scope_json,
         architecture_json,workflow_json,management_state_json,environment_json,knowledge_pointers_json,
         asset_pointers_json,data_pointers_json,release_distribution_json,decisions_json,risks_blockers_json,
         snapshot_json,evidence_json,created_by_identity_id)
       VALUES (?,?,?,?,'CURRENT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,projectId,baselineNo,versionLabel,input.goal??project.goal,
        asJson(input.scope??parseJson(project.scope_json)),
        asJson(input.outOfScope??parseJson(project.out_of_scope_json)),
        asJson(input.architecture||null),
        asJson(input.workflow||{
          workflowTemplateId:project.workflow_template_id||null,
          currentWorkflowVersion:project.current_workflow_version||null,
          currentStageKey:project.current_stage_key||null
        }),
        asJson(input.managementState||{
          currentMilestoneId:project.current_milestone_id||null,
          currentIterationId:project.current_iteration_id||null,
          status:project.status,health:project.health,priority:project.priority
        }),
        asJson(input.environment||null),asJson(input.knowledgePointers||null),
        asJson(input.assetPointers||null),asJson(input.dataPointers||null),
        asJson(input.releaseDistribution||{status:project.release_distribution_status||null}),
        asJson(input.decisions||null),asJson(input.risksBlockers||null),
        asJson(input.snapshot||null),asJson(input.evidence||null),
        input.createdByIdentityId||null
      ]
    );
    for(const row of currentRows){
      await conn.execute(
        "UPDATE project_baselines SET status='HISTORICAL',replaced_by_id=? WHERE id=?",
        [id,row.id]
      );
    }
    await conn.execute('UPDATE projects SET current_baseline_id=? WHERE id=?',[id,projectId]);
    await conn.commit();
    return {id,projectId,baselineNo,versionLabel,status:'CURRENT'};
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{
    conn.release();
  }
};

export const createProjectStructureNode=async(projectId,input)=>{
  if(!input?.nodeKey||!input?.nodeType||!input?.name) throw errorOf(
    'nodeKey, nodeType and name are required','INVALID_PROJECT_STRUCTURE_NODE'
  );
  const type=upper(input.nodeType);
  if(!STRUCTURE_TYPES.has(type)) throw errorOf(
    'Unsupported project structure node type','INVALID_PROJECT_STRUCTURE_TYPE'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  if(input.parentId){
    const [parents]=await db.execute(
      'SELECT id,project_id FROM project_structure_nodes WHERE id=?',[input.parentId]
    );
    if(!parents.length) throw errorOf('Project structure parent not found','PROJECT_STRUCTURE_PARENT_NOT_FOUND',404);
    if(parents[0].project_id!==projectId) throw errorOf(
      'Project structure parent must belong to same project','PROJECT_STRUCTURE_PARENT_MISMATCH',409
    );
  }
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_structure_nodes
      (id,project_id,parent_id,node_key,node_type,name,owner_identity_id,status,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.parentId||null,input.nodeKey,type,input.name,
      input.ownerIdentityId||null,upper(input.status||'ACTIVE'),asJson(input.metadata||null)
    ]
  );
  return {id,projectId,nodeKey:input.nodeKey,nodeType:type,name:input.name};
};

export const createProjectIteration=async(projectId,input)=>{
  if(!input?.iterationKey||!input?.name||input.sequenceNo==null) throw errorOf(
    'iterationKey, name and sequenceNo are required','INVALID_PROJECT_ITERATION'
  );
  const status=upper(input.status||'PLANNED');
  if(!ITERATION_STATUSES.has(status)) throw errorOf('Invalid iteration status','INVALID_ITERATION_STATUS');
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_iterations
      (id,project_id,iteration_key,name,sequence_no,goal,start_date,end_date,status,outcome_json,retrospective_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.iterationKey,input.name,Number(input.sequenceNo),input.goal||null,
      dateOrNull(input.startDate),dateOrNull(input.endDate),status,
      asJson(input.outcome||null),asJson(input.retrospective||null)
    ]
  );
  if(input.makeCurrent===true){
    await db.execute('UPDATE projects SET current_iteration_id=? WHERE id=?',[id,projectId]);
  }
  return {id,projectId,iterationKey:input.iterationKey,name:input.name,status};
};

export const createProjectMilestone=async(projectId,input)=>{
  if(!input?.milestoneKey||!input?.displayName||input.sequenceNo==null) throw errorOf(
    'milestoneKey, displayName and sequenceNo are required','INVALID_PROJECT_MILESTONE'
  );
  const managementStatus=validateMilestoneStatus(input.status||'PLANNED');
  const progress=Number(input.progressPercent||0);
  if(progress<0||progress>100) throw errorOf(
    'progressPercent must be between 0 and 100','INVALID_MILESTONE_PROGRESS'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_milestones
      (id,project_id,workflow_template_milestone_id,milestone_key,display_name,objective,owner_identity_id,
       sequence_no,status,management_status,acceptance_json,state_json,planned_start,planned_end,
       progress_percent,exit_criteria_json,required_deliverables_json,required_gates_json,evidence_json,
       milestone_version)
     VALUES (?,?,NULL,?,?,?,?,?,'PENDING',?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.milestoneKey,input.displayName,input.objective||null,input.ownerIdentityId||null,
      Number(input.sequenceNo),managementStatus,asJson(input.acceptance||null),asJson(input.state||null),
      dateOrNull(input.plannedStart),dateOrNull(input.plannedEnd),progress,
      asJson(input.exitCriteria||null),asJson(input.requiredDeliverables||null),
      asJson(input.requiredGates||null),asJson(input.evidence||null),input.version||null
    ]
  );
  if(input.makeCurrent===true){
    await db.execute('UPDATE projects SET current_milestone_id=? WHERE id=?',[id,projectId]);
  }
  return {
    id,projectId,milestoneKey:input.milestoneKey,
    displayName:input.displayName,managementStatus,progressPercent:progress
  };
};

export const updateProjectMilestonePlan=async(milestoneId,input={})=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_milestones WHERE id=?',[milestoneId]);
  if(!rows.length) throw errorOf('Milestone not found','MILESTONE_NOT_FOUND',404);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};
  if(input.status!==undefined){
    const status=validateMilestoneStatus(input.status);
    if(status==='COMPLETED') throw errorOf(
      'Use the milestone completion gate to complete a milestone',
      'MILESTONE_COMPLETION_GATE_REQUIRED',409
    );
    assign('management_status',status);
  }
  if(input.objective!==undefined) assign('objective',input.objective||null);
  if(input.plannedStart!==undefined) assign('planned_start',dateOrNull(input.plannedStart));
  if(input.plannedEnd!==undefined) assign('planned_end',dateOrNull(input.plannedEnd));
  if(input.exitCriteria!==undefined) assign('exit_criteria_json',asJson(input.exitCriteria));
  if(input.requiredDeliverables!==undefined) assign('required_deliverables_json',asJson(input.requiredDeliverables));
  if(input.requiredGates!==undefined) assign('required_gates_json',asJson(input.requiredGates));
  if(input.version!==undefined) assign('milestone_version',input.version||null);
  if(input.updateCadenceDays!==undefined){
    const cadence=input.updateCadenceDays==null?null:Number(input.updateCadenceDays);
    if(cadence!=null&&(!Number.isInteger(cadence)||cadence<1||cadence>365)) throw errorOf(
      'updateCadenceDays must be an integer between 1 and 365','INVALID_UPDATE_CADENCE'
    );
    assign('update_cadence_days',cadence);
  }
  if(sets.length){
    values.push(milestoneId);
    await db.execute(`UPDATE project_milestones SET ${sets.join(',')} WHERE id=?`,values);
  }
  const [updated]=await db.execute('SELECT * FROM project_milestones WHERE id=?',[milestoneId]);
  const row=updated[0];
  return {
    id:row.id,projectId:row.project_id,milestoneKey:row.milestone_key,
    managementStatus:row.management_status,plannedStart:row.planned_start||null,
    plannedEnd:row.planned_end||null,updateCadenceDays:row.update_cadence_days==null?null:Number(row.update_cadence_days)
  };
};

export const createProjectWorkItem=async(projectId,input)=>{
  if(!input?.itemKey||!input?.itemType||!input?.title) throw errorOf(
    'itemKey, itemType and title are required','INVALID_WORK_ITEM'
  );
  const type=upper(input.itemType);
  if(!WORK_ITEM_TYPES.has(type)) throw errorOf(
    'Unsupported work item type','INVALID_WORK_ITEM_TYPE'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_work_items
      (id,project_id,structure_node_id,milestone_id,iteration_id,item_key,item_type,title,stage_key,
       owner_identity_id,priority,status,estimate_hours,actual_work_minutes,waiting_minutes,blocked_minutes,
       acceptance_criteria_json,evidence_json,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.structureNodeId||null,input.milestoneId||null,input.iterationId||null,
      input.itemKey,type,input.title,input.stageKey||null,input.ownerIdentityId||null,
      validatePriority(input.priority),validateEnum(input.status||'PLANNED',WORK_ITEM_STATUSES,'INVALID_WORK_ITEM_STATUS','work item status'),
      input.estimateHours==null?null:Number(input.estimateHours),Number(input.actualWorkMinutes||0),
      Number(input.waitingMinutes||0),Number(input.blockedMinutes||0),
      asJson(input.acceptanceCriteria||null),asJson(input.evidence||null),asJson(input.metadata||null)
    ]
  );
  return {
    id,projectId,itemKey:input.itemKey,itemType:type,
    title:input.title,status:upper(input.status||'PLANNED')
  };
};

export const updateProjectWorkItem=async(workItemId,input={})=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_work_items WHERE id=?',[workItemId]);
  if(!rows.length) throw errorOf('Work item not found','WORK_ITEM_NOT_FOUND',404);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};
  if(input.status!==undefined) assign(
    'status',validateEnum(input.status,WORK_ITEM_STATUSES,'INVALID_WORK_ITEM_STATUS','work item status')
  );
  if(input.priority!==undefined) assign('priority',validatePriority(input.priority));
  if(input.estimateHours!==undefined) assign('estimate_hours',input.estimateHours==null?null:Number(input.estimateHours));
  if(input.actualWorkMinutes!==undefined) assign('actual_work_minutes',Math.max(0,Number(input.actualWorkMinutes)||0));
  if(input.waitingMinutes!==undefined) assign('waiting_minutes',Math.max(0,Number(input.waitingMinutes)||0));
  if(input.blockedMinutes!==undefined) assign('blocked_minutes',Math.max(0,Number(input.blockedMinutes)||0));
  if(input.milestoneId!==undefined) assign('milestone_id',input.milestoneId||null);
  if(input.iterationId!==undefined) assign('iteration_id',input.iterationId||null);
  if(input.stageKey!==undefined) assign('stage_key',input.stageKey||null);
  if(input.acceptanceCriteria!==undefined) assign('acceptance_criteria_json',asJson(input.acceptanceCriteria));
  if(input.evidence!==undefined) assign('evidence_json',asJson(input.evidence));
  if(input.metadata!==undefined) assign('metadata_json',asJson(input.metadata));
  if(sets.length){
    values.push(workItemId);
    await db.execute(`UPDATE project_work_items SET ${sets.join(',')} WHERE id=?`,values);
  }
  const [updated]=await db.execute('SELECT * FROM project_work_items WHERE id=?',[workItemId]);
  const row=updated[0];
  return {
    id:row.id,projectId:row.project_id,itemKey:row.item_key,itemType:row.item_type,
    title:row.title,status:row.status,priority:row.priority,
    estimateHours:row.estimate_hours==null?null:Number(row.estimate_hours),
    actualWorkMinutes:Number(row.actual_work_minutes||0),
    waitingMinutes:Number(row.waiting_minutes||0),blockedMinutes:Number(row.blocked_minutes||0)
  };
};

export const createProjectDependency=async(projectId,input)=>{
  if(!input?.sourceType||!input?.sourceId||!input?.targetType||!input?.targetId||!input?.dependencyType) throw errorOf(
    'sourceType, sourceId, targetType, targetId and dependencyType are required',
    'INVALID_PROJECT_DEPENDENCY'
  );
  const type=upper(input.dependencyType);
  if(!DEPENDENCY_TYPES.has(type)) throw errorOf(
    'Unsupported dependency type','INVALID_DEPENDENCY_TYPE'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_dependencies
      (id,project_id,source_type,source_id,target_type,target_id,dependency_type,status,critical_path,
       external_reference_json,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,upper(input.sourceType),String(input.sourceId),
      upper(input.targetType),String(input.targetId),type,
      upper(input.status||'ACTIVE'),input.criticalPath===true?1:0,
      asJson(input.externalReference||null),asJson(input.evidence||null)
    ]
  );
  return {id,projectId,dependencyType:type,criticalPath:input.criticalPath===true};
};

export const updateProjectDependency=async(dependencyId,input={})=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_dependencies WHERE id=?',[dependencyId]);
  if(!rows.length) throw errorOf('Dependency not found','PROJECT_DEPENDENCY_NOT_FOUND',404);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};
  if(input.status!==undefined) assign(
    'status',validateEnum(input.status,DEPENDENCY_STATUSES,'INVALID_DEPENDENCY_STATUS','dependency status')
  );
  if(input.criticalPath!==undefined) assign('critical_path',input.criticalPath===true?1:0);
  if(input.externalReference!==undefined) assign('external_reference_json',asJson(input.externalReference));
  if(input.evidence!==undefined) assign('evidence_json',asJson(input.evidence));
  if(sets.length){
    values.push(dependencyId);
    await db.execute(`UPDATE project_dependencies SET ${sets.join(',')} WHERE id=?`,values);
  }
  const [updated]=await db.execute('SELECT * FROM project_dependencies WHERE id=?',[dependencyId]);
  const row=updated[0];
  return {id:row.id,projectId:row.project_id,status:row.status,criticalPath:Boolean(row.critical_path)};
};

export const createProjectRisk=async(projectId,input)=>{
  if(!input?.riskKey||!input?.title||!input?.probability||!input?.impact) throw errorOf(
    'riskKey, title, probability and impact are required','INVALID_PROJECT_RISK'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_risks
      (id,project_id,risk_key,title,probability,impact,trigger_text,owner_identity_id,
       mitigation,contingency,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.riskKey,input.title,upper(input.probability),upper(input.impact),
      input.trigger||null,input.ownerIdentityId||null,input.mitigation||null,input.contingency||null,
      upper(input.status||'OPEN'),asJson(input.evidence||null)
    ]
  );
  return {id,projectId,riskKey:input.riskKey,status:upper(input.status||'OPEN')};
};

export const updateProjectRisk=async(riskId,input={})=>{
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_risks WHERE id=?',[riskId]);
  if(!rows.length) throw errorOf('Risk not found','PROJECT_RISK_NOT_FOUND',404);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};
  if(input.status!==undefined) assign(
    'status',validateEnum(input.status,RISK_STATUSES,'INVALID_RISK_STATUS','risk status')
  );
  if(input.probability!==undefined) assign('probability',upper(input.probability));
  if(input.impact!==undefined) assign('impact',upper(input.impact));
  if(input.mitigation!==undefined) assign('mitigation',input.mitigation||null);
  if(input.contingency!==undefined) assign('contingency',input.contingency||null);
  if(input.evidence!==undefined) assign('evidence_json',asJson(input.evidence));
  if(sets.length){
    values.push(riskId);
    await db.execute(`UPDATE project_risks SET ${sets.join(',')} WHERE id=?`,values);
  }
  const [updated]=await db.execute('SELECT * FROM project_risks WHERE id=?',[riskId]);
  const row=updated[0];
  return {id:row.id,projectId:row.project_id,riskKey:row.risk_key,status:row.status,probability:row.probability,impact:row.impact};
};

export const createProjectIssue=async(projectId,input)=>{
  if(!input?.issueKey||!input?.title||!input?.severity) throw errorOf(
    'issueKey, title and severity are required','INVALID_PROJECT_ISSUE'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_issues
      (id,project_id,issue_key,title,severity,source,affected_scope_json,root_cause,
       fix_summary,retest_json,resolution_evidence_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.issueKey,input.title,upper(input.severity),input.source||null,
      asJson(input.affectedScope||null),input.rootCause||null,input.fixSummary||null,
      asJson(input.retest||null),asJson(input.resolutionEvidence||null),upper(input.status||'OPEN')
    ]
  );
  return {id,projectId,issueKey:input.issueKey,status:upper(input.status||'OPEN')};
};

export const createProjectBlocker=async(projectId,input)=>{
  if(!input?.blockerKey||!input?.blockingObjectType||!input?.blockingObjectId||!input?.reason) throw errorOf(
    'blockerKey, blockingObjectType, blockingObjectId and reason are required',
    'INVALID_PROJECT_BLOCKER'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_blockers
      (id,project_id,blocker_key,blocking_object_type,blocking_object_id,reason,waiting_on,
       resume_condition,resume_point_json,owner_identity_id,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.blockerKey,upper(input.blockingObjectType),String(input.blockingObjectId),
      input.reason,input.waitingOn||null,input.resumeCondition||null,asJson(input.resumePoint||null),
      input.ownerIdentityId||null,upper(input.status||'OPEN'),asJson(input.evidence||null)
    ]
  );
  return {id,projectId,blockerKey:input.blockerKey,status:upper(input.status||'OPEN')};
};

export const resolveProjectBlocker=async(blockerId,input={})=>{
  if(!input.evidence) throw errorOf(
    'Resolving a blocker requires evidence','BLOCKER_RESOLUTION_EVIDENCE_REQUIRED',409
  );
  const db=getRuntimePool();
  const [rows]=await db.execute('SELECT * FROM project_blockers WHERE id=?',[blockerId]);
  if(!rows.length) throw errorOf('Blocker not found','PROJECT_BLOCKER_NOT_FOUND',404);
  if(rows[0].status!=='OPEN') throw errorOf(
    'Only an OPEN blocker may be resolved','BLOCKER_NOT_OPEN',409,{status:rows[0].status}
  );
  await db.execute(
    `UPDATE project_blockers SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP(6),
      evidence_json=? WHERE id=?`,
    [asJson(input.evidence),blockerId]
  );
  return {id:blockerId,projectId:rows[0].project_id,blockerKey:rows[0].blocker_key,status:'RESOLVED'};
};

export const createProjectDecision=async(projectId,input)=>{
  if(!input?.decisionKey||!input?.title||!input?.context||!input?.decision) throw errorOf(
    'decisionKey, title, context and decision are required','INVALID_PROJECT_DECISION'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_decisions
      (id,project_id,decision_key,title,context_json,options_json,decision_json,owner_identity_id,
       approver_identity_id,impact_json,reversible,effective_version,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.decisionKey,input.title,asJson(input.context),asJson(input.options||null),
      asJson(input.decision),input.ownerIdentityId||null,input.approverIdentityId||null,
      asJson(input.impact||null),input.reversible===false?0:1,
      input.effectiveVersion||null,upper(input.status||'EFFECTIVE'),asJson(input.evidence||null)
    ]
  );
  return {id,projectId,decisionKey:input.decisionKey,status:upper(input.status||'EFFECTIVE')};
};

export const createProjectChange=async(projectId,input)=>{
  if(!input?.changeKey||!input?.changeReason||!input?.changeScope||!input?.impactedObjects||input.after===undefined) throw errorOf(
    'changeKey, changeReason, changeScope, impactedObjects and after are required','INVALID_PROJECT_CHANGE'
  );
  await projectScope(projectId);
  const db=getRuntimePool();
  const id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_changes
      (id,project_id,change_key,before_json,change_reason,change_scope_json,
       impacted_objects_json,revalidation_scope_json,after_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.changeKey,asJson(input.before||null),input.changeReason,
      asJson(input.changeScope),asJson(input.impactedObjects),asJson(input.revalidationScope||null),
      asJson(input.after),asJson(input.evidence||null),input.createdByIdentityId||null
    ]
  );
  return {id,projectId,changeKey:input.changeKey};
};

export const resolveProjectGovernanceObjectScope=async(objectType,id)=>{
  const type=upper(objectType);
  const tables={
    WORK_ITEM:'project_work_items',
    DEPENDENCY:'project_dependencies',
    RISK:'project_risks',
    BLOCKER:'project_blockers',
    MILESTONE:'project_milestones'
  };
  const table=tables[type];
  if(!table) throw errorOf('Unsupported governance object type','INVALID_GOVERNANCE_OBJECT_TYPE');
  const db=getRuntimePool();
  const [rows]=await db.execute(`SELECT project_id FROM ${table} WHERE id=?`,[id]);
  if(!rows.length) throw errorOf('Governance object not found','GOVERNANCE_OBJECT_NOT_FOUND',404,{objectType:type,id});
  return {objectType:type,id,projectId:rows[0].project_id};
};

const list=async(db,sql,params=[])=> (await db.execute(sql,params))[0];

export const getProjectGovernance=async projectId=>{
  const db=getRuntimePool();
  const project=normalizeProject(await projectScope(projectId,db));
  const [
    baselines,structureNodes,iterations,milestones,workItems,dependencies,
    risks,issues,blockers,decisions,changes,strategyLinks,portfolioLinks
  ]=await Promise.all([
    list(db,'SELECT * FROM project_baselines WHERE project_id=? ORDER BY baseline_no',[projectId]),
    list(db,'SELECT * FROM project_structure_nodes WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_iterations WHERE project_id=? ORDER BY sequence_no,id',[projectId]),
    list(db,'SELECT * FROM project_milestones WHERE project_id=? ORDER BY sequence_no,id',[projectId]),
    list(db,'SELECT * FROM project_work_items WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_dependencies WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_risks WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_issues WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_blockers WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,'SELECT * FROM project_decisions WHERE project_id=? ORDER BY decided_at,id',[projectId]),
    list(db,'SELECT * FROM project_changes WHERE project_id=? ORDER BY created_at,id',[projectId]),
    list(db,`SELECT l.*,s.item_key,s.item_type,s.title
      FROM strategic_item_project_links l
      JOIN strategic_items s ON s.id=l.strategic_item_id
      WHERE l.project_id=?`,[projectId]),
    list(db,`SELECT l.*,p.portfolio_key,p.name
      FROM portfolio_project_links l
      JOIN portfolios p ON p.id=l.portfolio_id
      WHERE l.project_id=? ORDER BY l.roadmap_order`,[projectId])
  ]);
  return {
    project,
    baselines:baselines.map(row=>({
      id:row.id,baselineNo:Number(row.baseline_no),versionLabel:row.version_label,status:row.status,
      effectiveFrom:row.effective_from,replacedById:row.replaced_by_id||null,
      evidence:parseJson(row.evidence_json)
    })),
    structureNodes:structureNodes.map(row=>({
      id:row.id,parentId:row.parent_id||null,nodeKey:row.node_key,nodeType:row.node_type,
      name:row.name,status:row.status
    })),
    iterations:iterations.map(row=>({
      id:row.id,iterationKey:row.iteration_key,name:row.name,
      sequenceNo:Number(row.sequence_no),status:row.status,
      startDate:row.start_date,endDate:row.end_date
    })),
    milestones:milestones.map(row=>({
      id:row.id,milestoneKey:row.milestone_key,displayName:row.display_name,
      sequenceNo:Number(row.sequence_no),managementStatus:row.management_status,
      workflowStatus:row.status,objective:row.objective||null,
      plannedStart:row.planned_start||null,plannedEnd:row.planned_end||null,
      progressPercent:Number(row.progress_percent||0),
      workflowTemplateMilestoneId:row.workflow_template_milestone_id||null
    })),
    workItems:workItems.map(row=>({
      id:row.id,itemKey:row.item_key,itemType:row.item_type,title:row.title,
      status:row.status,priority:row.priority,milestoneId:row.milestone_id||null,
      iterationId:row.iteration_id||null,stageKey:row.stage_key||null
    })),
    dependencies:dependencies.map(row=>({
      id:row.id,sourceType:row.source_type,sourceId:row.source_id,
      targetType:row.target_type,targetId:row.target_id,
      dependencyType:row.dependency_type,status:row.status,
      criticalPath:Boolean(row.critical_path)
    })),
    risks:risks.map(row=>({
      id:row.id,riskKey:row.risk_key,title:row.title,
      probability:row.probability,impact:row.impact,status:row.status
    })),
    issues:issues.map(row=>({
      id:row.id,issueKey:row.issue_key,title:row.title,
      severity:row.severity,status:row.status
    })),
    blockers:blockers.map(row=>({
      id:row.id,blockerKey:row.blocker_key,blockingObjectType:row.blocking_object_type,
      blockingObjectId:row.blocking_object_id,reason:row.reason,status:row.status,
      resumeCondition:row.resume_condition||null
    })),
    decisions:decisions.map(row=>({
      id:row.id,decisionKey:row.decision_key,title:row.title,status:row.status,
      reversible:Boolean(row.reversible),effectiveVersion:row.effective_version||null
    })),
    changes:changes.map(row=>({
      id:row.id,changeKey:row.change_key,changeReason:row.change_reason,createdAt:row.created_at
    })),
    strategyLinks:strategyLinks.map(row=>({
      strategicItemId:row.strategic_item_id,itemKey:row.item_key,itemType:row.item_type,
      title:row.title,linkRole:row.link_role,
      weightBps:row.weight_bps==null?null:Number(row.weight_bps)
    })),
    portfolioLinks:portfolioLinks.map(row=>({
      portfolioId:row.portfolio_id,portfolioKey:row.portfolio_key,name:row.name,
      roadmapOrder:row.roadmap_order==null?null:Number(row.roadmap_order),
      targetWindow:row.target_window||null
    }))
  };
};
