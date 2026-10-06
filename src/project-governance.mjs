import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const PROJECT_STATUSES=new Set(['DRAFT','READY','ACTIVE','BLOCKED','PAUSED','COMPLETED','ARCHIVED','CANCELLED']);
const HEALTH_VALUES=new Set(['GREEN','AMBER','RED']);
const MILESTONE_STATUSES=new Set(['PLANNED','ACTIVE','BLOCKED','PAUSED','COMPLETED','CANCELLED']);
const ITERATION_STATUSES=new Set(['PLANNED','ACTIVE','COMPLETED','CANCELLED']);
const WORK_ITEM_TYPES=new Set(['REQUIREMENT','FEATURE','TASK','BUG','IMPROVEMENT','EXPERIMENT','RESEARCH','CONTENT_ITEM','OPERATIONS_ITEM','TECH_DEBT']);
const DEPENDENCY_TYPES=new Set(['BLOCKS','REQUIRES','PRODUCES','VALIDATES','SUPERSEDES','RELATED']);
const STRUCTURE_TYPES=new Set(['BUSINESS_DOMAIN','MODULE','EPIC']);

const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
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
const validateHealth=value=>{
  const v=upper(value||'GREEN');
  if(!HEALTH_VALUES.has(v)) throw errorOf('health must be GREEN, AMBER or RED','INVALID_PROJECT_HEALTH');
  return v;
};
const validateProjectStatus=value=>{
  const v=upper(value);
  if(!PROJECT_STATUSES.has(v)) throw errorOf(
    'Invalid project lifecycle status','INVALID_PROJECT_STATUS',400,
    {allowed:Array.from(PROJECT_STATUSES),received:v}
  );
  return v;
};
const validateMilestoneStatus=value=>{
  const v=upper(value||'PLANNED');
  if(!MILESTONE_STATUSES.has(v)) throw errorOf('Invalid milestone management status','INVALID_MILESTONE_STATUS');
  return v;
};
const projectScope=async(projectId,db=getRuntimePool())=>{
  const [rows]=await db.execute('SELECT * FROM projects WHERE id=?',[projectId]);
  if(!rows.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
  return rows[0];
};
const normalizeProject=row=>({
  id:row.id,tenantId:row.tenant_id,workspaceId:row.workspace_id,
  projectKey:row.project_key,name:row.name,projectType:row.project_type,
  projectSubtype:row.project_subtype||null,status:row.status,priority:row.priority,
  health:row.health,ownerIdentityId:row.owner_identity_id||null,
  projectManagerIdentityId:row.project_manager_identity_id||null,
  goal:row.goal||null,successCriteria:parseJson(row.success_criteria_json),
  scope:parseJson(row.scope_json),outOfScope:parseJson(row.out_of_scope_json),
  startDate:row.start_date||null,targetDate:row.target_date||null,actualEndDate:row.actual_end_date||null,
  currentMilestoneId:row.current_milestone_id||null,currentIterationId:row.current_iteration_id||null,
  currentBaselineId:row.current_baseline_id||null,currentStageKey:row.current_stage_key||null,
  riskLevel:row.risk_level||null,budgetGuardrailAmount:row.budget_guardrail_amount==null?null:Number(row.budget_guardrail_amount),
  budgetGuardrailCurrency:row.budget_guardrail_currency||null,
  releaseDistributionStatus:row.release_distribution_status||null,tags:parseJson(row.tags_json),
  closure:parseJson(row.closure_json),archivedAt:row.archived_at||null,
  createdAt:row.created_at,updatedAt:row.updated_at
});

export const updateProjectGovernance=async(projectId,input={})=>{
  const db=getRuntimePool();
  const current=await projectScope(projectId,db);
  const sets=[],values=[];
  const assign=(column,value)=>{sets.push(`${column}=?`);values.push(value);};

  if(input.status!==undefined){
    const status=validateProjectStatus(input.status);
    if(status==='ARCHIVED'){
      if(!current.current_baseline_id&&!input.currentBaselineId) throw errorOf(
        'Project archive requires a final baseline','PROJECT_ARCHIVE_BASELINE_REQUIRED',409
      );
      if(!input.closure&&current.closure_json==null) throw errorOf(
        'Project archive requires closure evidence','PROJECT_ARCHIVE_CLOSURE_REQUIRED',409
      );
      assign('archived_at',new Date());
    }
    assign('status',status);
  }
  if(input.health!==undefined) assign('health',validateHealth(input.health));
  if(input.projectSubtype!==undefined) assign('project_subtype',input.projectSubtype||null);
  if(input.ownerIdentityId!==undefined) assign('owner_identity_id',input.ownerIdentityId||null);
  if(input.projectManagerIdentityId!==undefined) assign('project_manager_identity_id',input.projectManagerIdentityId||null);
  if(input.goal!==undefined) assign('goal',input.goal||null);
  if(input.successCriteria!==undefined) assign('success_criteria_json',asJson(input.successCriteria));
  if(input.scope!==undefined) assign('scope_json',asJson(input.scope));
  if(input.outOfScope!==undefined) assign('out_of_scope_json',asJson(input.outOfScope));
  if(input.priority!==undefined) assign('priority',upper(input.priority));
  if(input.startDate!==undefined) assign('start_date',dateOrNull(input.startDate));
  if(input.targetDate!==undefined) assign('target_date',dateOrNull(input.targetDate));
  if(input.actualEndDate!==undefined) assign('actual_end_date',dateOrNull(input.actualEndDate));
  if(input.currentMilestoneId!==undefined) assign('current_milestone_id',input.currentMilestoneId||null);
  if(input.currentIterationId!==undefined) assign('current_iteration_id',input.currentIterationId||null);
  if(input.currentBaselineId!==undefined) assign('current_baseline_id',input.currentBaselineId||null);
  if(input.riskLevel!==undefined) assign('risk_level',upper(input.riskLevel));
  if(input.budgetGuardrailAmount!==undefined) assign('budget_guardrail_amount',input.budgetGuardrailAmount==null?null:Number(input.budgetGuardrailAmount));
  if(input.budgetGuardrailCurrency!==undefined) assign('budget_guardrail_currency',input.budgetGuardrailCurrency?upper(input.budgetGuardrailCurrency):null);
  if(input.releaseDistributionStatus!==undefined) assign('release_distribution_status',input.releaseDistributionStatus||null);
  if(input.tags!==undefined) assign('tags_json',asJson(input.tags));
  if(input.closure!==undefined) assign('closure_json',asJson(input.closure));
  if(!sets.length) return normalizeProject(current);
  values.push(projectId);
  await db.execute(`UPDATE projects SET ${sets.join(',')} WHERE id=?`,values);
  return normalizeProject((await db.execute('SELECT * FROM projects WHERE id=?',[projectId]))[0][0]);
};

export const createStrategicItem=async input=>{
  if(!input?.workspaceId||!input?.itemKey||!input?.itemType||!input?.title||!input?.goal) throw errorOf(
    'workspaceId, itemKey, itemType, title and goal are required','INVALID_STRATEGIC_ITEM'
  );
  const type=upper(input.itemType);
  if(!['OBJECTIVE','INITIATIVE'].includes(type)) throw errorOf('itemType must be OBJECTIVE or INITIATIVE','INVALID_STRATEGIC_ITEM_TYPE');
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO strategic_items
      (id,workspace_id,parent_id,item_key,item_type,title,goal,theme,scope_json,owner_identity_id,
       target_start,target_end,success_metric_json,priority,health,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.parentId||null,input.itemKey,type,input.title,input.goal,input.theme||null,
      asJson(input.scope||null),input.ownerIdentityId||null,dateOrNull(input.targetStart),dateOrNull(input.targetEnd),
      asJson(input.successMetric||null),upper(input.priority||'MEDIUM'),validateHealth(input.health||'GREEN'),
      upper(input.status||'ACTIVE'),asJson(input.evidence||null)
    ]
  );
  return {id,workspaceId:input.workspaceId,itemKey:input.itemKey,itemType:type,title:input.title,status:upper(input.status||'ACTIVE')};
};

export const createPortfolio=async input=>{
  if(!input?.workspaceId||!input?.portfolioKey||!input?.name) throw errorOf(
    'workspaceId, portfolioKey and name are required','INVALID_PORTFOLIO'
  );
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO portfolios
      (id,workspace_id,portfolio_key,name,strategic_theme,owner_identity_id,target_start,target_end,
       priority,health,status,capacity_signal_json,budget_signal_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,input.workspaceId,input.portfolioKey,input.name,input.strategicTheme||null,input.ownerIdentityId||null,
      dateOrNull(input.targetStart),dateOrNull(input.targetEnd),upper(input.priority||'MEDIUM'),
      validateHealth(input.health||'GREEN'),upper(input.status||'ACTIVE'),
      asJson(input.capacitySignal||null),asJson(input.budgetSignal||null)
    ]
  );
  return {id,workspaceId:input.workspaceId,portfolioKey:input.portfolioKey,name:input.name};
};

export const linkStrategicItemProject=async(input)=>{
  if(!input?.strategicItemId||!input?.projectId) throw errorOf('strategicItemId and projectId are required','INVALID_STRATEGY_PROJECT_LINK');
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO strategic_item_project_links(strategic_item_id,project_id,link_role,weight_bps)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE link_role=VALUES(link_role),weight_bps=VALUES(weight_bps)`,
    [input.strategicItemId,input.projectId,input.linkRole||'CONTRIBUTES_TO',input.weightBps==null?null:Number(input.weightBps)]
  );
  return {strategicItemId:input.strategicItemId,projectId:input.projectId,linkRole:input.linkRole||'CONTRIBUTES_TO'};
};

export const linkPortfolioProject=async(input)=>{
  if(!input?.portfolioId||!input?.projectId) throw errorOf('portfolioId and projectId are required','INVALID_PORTFOLIO_PROJECT_LINK');
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO portfolio_project_links(portfolio_id,project_id,roadmap_order,target_window)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE roadmap_order=VALUES(roadmap_order),target_window=VALUES(target_window)`,
    [input.portfolioId,input.projectId,input.roadmapOrder==null?null:Number(input.roadmapOrder),input.targetWindow||null]
  );
  return {portfolioId:input.portfolioId,projectId:input.projectId};
};

export const createProjectBaseline=async(projectId,input={})=>{
  const db=getRuntimePool(),conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [projects]=await conn.execute('SELECT * FROM projects WHERE id=? FOR UPDATE',[projectId]);
    if(!projects.length) throw errorOf('Project not found','PROJECT_NOT_FOUND',404);
    const project=projects[0];
    const [[next]]=await conn.execute(
      'SELECT COALESCE(MAX(baseline_no),0)+1 AS next_no FROM project_baselines WHERE project_id=? FOR UPDATE',[projectId]
    );
    const baselineNo=Number(next.next_no),id=randomUUID();
    const versionLabel=input.versionLabel||`B${baselineNo}`;
    const [currentRows]=await conn.execute(
      "SELECT id FROM project_baselines WHERE project_id=? AND status='CURRENT' FOR UPDATE",[projectId]
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
        asJson(input.scope??parseJson(project.scope_json)),asJson(input.outOfScope??parseJson(project.out_of_scope_json)),
        asJson(input.architecture||null),asJson(input.workflow||{
          workflowTemplateId:project.workflow_template_id||null,currentWorkflowVersion:project.current_workflow_version||null,
          currentStageKey:project.current_stage_key||null
        }),
        asJson(input.managementState||{
          currentMilestoneId:project.current_milestone_id||null,currentIterationId:project.current_iteration_id||null,
          status:project.status,health:project.health,priority:project.priority
        }),
        asJson(input.environment||null),asJson(input.knowledgePointers||null),asJson(input.assetPointers||null),
        asJson(input.dataPointers||null),asJson(input.releaseDistribution||{
          status:project.release_distribution_status||null
        }),asJson(input.decisions||null),asJson(input.risksBlockers||null),
        asJson(input.snapshot||null),asJson(input.evidence||null),input.createdByIdentityId||null
      ]
    );
    for(const row of currentRows){
      await conn.execute(
        "UPDATE project_baselines SET status='HISTORICAL',replaced_by_id=? WHERE id=?",[id,row.id]
      );
    }
    await conn.execute('UPDATE projects SET current_baseline_id=? WHERE id=?',[id,projectId]);
    await conn.commit();
    return {id,projectId,baselineNo,versionLabel,status:'CURRENT'};
  }catch(error){
    try{await conn.rollback();}catch{}
    throw error;
  }finally{conn.release();}
};

export const createProjectStructureNode=async(projectId,input)=>{
  if(!input?.nodeKey||!input?.nodeType||!input?.name) throw errorOf('nodeKey, nodeType and name are required','INVALID_PROJECT_STRUCTURE_NODE');
  const type=upper(input.nodeType);
  if(!STRUCTURE_TYPES.has(type)) throw errorOf('Unsupported project structure node type','INVALID_PROJECT_STRUCTURE_TYPE');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_structure_nodes
      (id,project_id,parent_id,node_key,node_type,name,owner_identity_id,status,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.parentId||null,input.nodeKey,type,input.name,input.ownerIdentityId||null,upper(input.status||'ACTIVE'),asJson(input.metadata||null)]
  );
  return {id,projectId,nodeKey:input.nodeKey,nodeType:type,name:input.name};
};

export const createProjectIteration=async(projectId,input)=>{
  if(!input?.iterationKey||!input?.name||input.sequenceNo==null) throw errorOf('iterationKey, name and sequenceNo are required','INVALID_PROJECT_ITERATION');
  const status=upper(input.status||'PLANNED');
  if(!ITERATION_STATUSES.has(status)) throw errorOf('Invalid iteration status','INVALID_ITERATION_STATUS');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_iterations
      (id,project_id,iteration_key,name,sequence_no,goal,start_date,end_date,status,outcome_json,retrospective_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.iterationKey,input.name,Number(input.sequenceNo),input.goal||null,dateOrNull(input.startDate),dateOrNull(input.endDate),
     status,asJson(input.outcome||null),asJson(input.retrospective||null)]
  );
  if(input.makeCurrent===true) await db.execute('UPDATE projects SET current_iteration_id=? WHERE id=?',[id,projectId]);
  return {id,projectId,iterationKey:input.iterationKey,name:input.name,status};
};

export const createProjectMilestone=async(projectId,input)=>{
  if(!input?.milestoneKey||!input?.displayName||input.sequenceNo==null) throw errorOf(
    'milestoneKey, displayName and sequenceNo are required','INVALID_PROJECT_MILESTONE'
  );
  const managementStatus=validateMilestoneStatus(input.status||'PLANNED');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_milestones
      (id,project_id,workflow_template_milestone_id,milestone_key,display_name,objective,owner_identity_id,
       sequence_no,status,management_status,acceptance_json,state_json,planned_start,planned_end,
       progress_percent,exit_criteria_json,required_deliverables_json,required_gates_json,evidence_json,milestone_version)
     VALUES (?,?,NULL,?,?,?,?,?,'PENDING',?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.milestoneKey,input.displayName,input.objective||null,input.ownerIdentityId||null,
      Number(input.sequenceNo),managementStatus,asJson(input.acceptance||null),asJson(input.state||null),
      dateOrNull(input.plannedStart),dateOrNull(input.plannedEnd),Number(input.progressPercent||0),
      asJson(input.exitCriteria||null),asJson(input.requiredDeliverables||null),asJson(input.requiredGates||null),
      asJson(input.evidence||null),input.version||null
    ]
  );
  if(input.makeCurrent===true) await db.execute('UPDATE projects SET current_milestone_id=? WHERE id=?',[id,projectId]);
  return {id,projectId,milestoneKey:input.milestoneKey,displayName:input.displayName,managementStatus};
};

export const createProjectWorkItem=async(projectId,input)=>{
  if(!input?.itemKey||!input?.itemType||!input?.title) throw errorOf('itemKey, itemType and title are required','INVALID_WORK_ITEM');
  const type=upper(input.itemType);
  if(!WORK_ITEM_TYPES.has(type)) throw errorOf('Unsupported work item type','INVALID_WORK_ITEM_TYPE');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_work_items
      (id,project_id,structure_node_id,milestone_id,iteration_id,item_key,item_type,title,stage_key,
       owner_identity_id,priority,status,estimate_hours,actual_work_minutes,waiting_minutes,blocked_minutes,
       acceptance_criteria_json,evidence_json,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,projectId,input.structureNodeId||null,input.milestoneId||null,input.iterationId||null,input.itemKey,type,
      input.title,input.stageKey||null,input.ownerIdentityId||null,upper(input.priority||'MEDIUM'),upper(input.status||'PLANNED'),
      input.estimateHours==null?null:Number(input.estimateHours),Number(input.actualWorkMinutes||0),
      Number(input.waitingMinutes||0),Number(input.blockedMinutes||0),
      asJson(input.acceptanceCriteria||null),asJson(input.evidence||null),asJson(input.metadata||null)
    ]
  );
  return {id,projectId,itemKey:input.itemKey,itemType:type,title:input.title,status:upper(input.status||'PLANNED')};
};

export const createProjectDependency=async(projectId,input)=>{
  if(!input?.sourceType||!input?.sourceId||!input?.targetType||!input?.targetId||!input?.dependencyType) throw errorOf(
    'sourceType, sourceId, targetType, targetId and dependencyType are required','INVALID_PROJECT_DEPENDENCY'
  );
  const type=upper(input.dependencyType);
  if(!DEPENDENCY_TYPES.has(type)) throw errorOf('Unsupported dependency type','INVALID_DEPENDENCY_TYPE');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_dependencies
      (id,project_id,source_type,source_id,target_type,target_id,dependency_type,status,critical_path,
       external_reference_json,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,upper(input.sourceType),String(input.sourceId),upper(input.targetType),String(input.targetId),type,
     upper(input.status||'ACTIVE'),input.criticalPath===true?1:0,asJson(input.externalReference||null),asJson(input.evidence||null)]
  );
  return {id,projectId,dependencyType:type,criticalPath:input.criticalPath===true};
};

export const createProjectRisk=async(projectId,input)=>{
  if(!input?.riskKey||!input?.title||!input?.probability||!input?.impact) throw errorOf('riskKey, title, probability and impact are required','INVALID_PROJECT_RISK');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_risks
      (id,project_id,risk_key,title,probability,impact,trigger_text,owner_identity_id,mitigation,contingency,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.riskKey,input.title,upper(input.probability),upper(input.impact),input.trigger||null,
     input.ownerIdentityId||null,input.mitigation||null,input.contingency||null,upper(input.status||'OPEN'),asJson(input.evidence||null)]
  );
  return {id,projectId,riskKey:input.riskKey,status:upper(input.status||'OPEN')};
};

export const createProjectIssue=async(projectId,input)=>{
  if(!input?.issueKey||!input?.title||!input?.severity) throw errorOf('issueKey, title and severity are required','INVALID_PROJECT_ISSUE');
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_issues
      (id,project_id,issue_key,title,severity,source,affected_scope_json,root_cause,fix_summary,
       retest_json,resolution_evidence_json,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.issueKey,input.title,upper(input.severity),input.source||null,asJson(input.affectedScope||null),
     input.rootCause||null,input.fixSummary||null,asJson(input.retest||null),asJson(input.resolutionEvidence||null),upper(input.status||'OPEN')]
  );
  return {id,projectId,issueKey:input.issueKey,status:upper(input.status||'OPEN')};
};

export const createProjectBlocker=async(projectId,input)=>{
  if(!input?.blockerKey||!input?.blockingObjectType||!input?.blockingObjectId||!input?.reason) throw errorOf(
    'blockerKey, blockingObjectType, blockingObjectId and reason are required','INVALID_PROJECT_BLOCKER'
  );
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_blockers
      (id,project_id,blocker_key,blocking_object_type,blocking_object_id,reason,waiting_on,
       resume_condition,resume_point_json,owner_identity_id,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.blockerKey,upper(input.blockingObjectType),String(input.blockingObjectId),input.reason,
     input.waitingOn||null,input.resumeCondition||null,asJson(input.resumePoint||null),input.ownerIdentityId||null,
     upper(input.status||'OPEN'),asJson(input.evidence||null)]
  );
  return {id,projectId,blockerKey:input.blockerKey,status:upper(input.status||'OPEN')};
};

export const createProjectDecision=async(projectId,input)=>{
  if(!input?.decisionKey||!input?.title||!input?.context||!input?.decision) throw errorOf(
    'decisionKey, title, context and decision are required','INVALID_PROJECT_DECISION'
  );
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_decisions
      (id,project_id,decision_key,title,context_json,options_json,decision_json,owner_identity_id,
       approver_identity_id,impact_json,reversible,effective_version,status,evidence_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.decisionKey,input.title,asJson(input.context),asJson(input.options||null),asJson(input.decision),
     input.ownerIdentityId||null,input.approverIdentityId||null,asJson(input.impact||null),input.reversible===false?0:1,
     input.effectiveVersion||null,upper(input.status||'EFFECTIVE'),asJson(input.evidence||null)]
  );
  return {id,projectId,decisionKey:input.decisionKey,status:upper(input.status||'EFFECTIVE')};
};

export const createProjectChange=async(projectId,input)=>{
  if(!input?.changeKey||!input?.changeReason||!input?.changeScope||!input?.impactedObjects||input.after===undefined) throw errorOf(
    'changeKey, changeReason, changeScope, impactedObjects and after are required','INVALID_PROJECT_CHANGE'
  );
  await projectScope(projectId);
  const db=getRuntimePool(),id=input.id||randomUUID();
  await db.execute(
    `INSERT INTO project_changes
      (id,project_id,change_key,before_json,change_reason,change_scope_json,impacted_objects_json,
       revalidation_scope_json,after_json,evidence_json,created_by_identity_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id,projectId,input.changeKey,asJson(input.before||null),input.changeReason,asJson(input.changeScope),
     asJson(input.impactedObjects),asJson(input.revalidationScope||null),asJson(input.after),
     asJson(input.evidence||null),input.createdByIdentityId||null]
  );
  return {id,projectId,changeKey:input.changeKey};
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
    list(db,`SELECT l.*,s.item_key,s.item_type,s.title FROM strategic_item_project_links l
      JOIN strategic_items s ON s.id=l.strategic_item_id WHERE l.project_id=?`,[projectId]),
    list(db,`SELECT l.*,p.portfolio_key,p.name FROM portfolio_project_links l
      JOIN portfolios p ON p.id=l.portfolio_id WHERE l.project_id=? ORDER BY l.roadmap_order`,[projectId])
  ]);
  return {
    project,
    baselines:baselines.map(row=>({
      id:row.id,baselineNo:Number(row.baseline_no),versionLabel:row.version_label,status:row.status,
      effectiveFrom:row.effective_from,replacedById:row.replaced_by_id||null,evidence:parseJson(row.evidence_json)
    })),
    structureNodes:structureNodes.map(row=>({id:row.id,parentId:row.parent_id||null,nodeKey:row.node_key,nodeType:row.node_type,name:row.name,status:row.status})),
    iterations:iterations.map(row=>({id:row.id,iterationKey:row.iteration_key,name:row.name,sequenceNo:Number(row.sequence_no),status:row.status,startDate:row.start_date,endDate:row.end_date})),
    milestones:milestones.map(row=>({
      id:row.id,milestoneKey:row.milestone_key,displayName:row.display_name,sequenceNo:Number(row.sequence_no),
      managementStatus:row.management_status,workflowStatus:row.status,objective:row.objective||null,
      plannedStart:row.planned_start||null,plannedEnd:row.planned_end||null,progressPercent:Number(row.progress_percent||0),
      workflowTemplateMilestoneId:row.workflow_template_milestone_id||null
    })),
    workItems:workItems.map(row=>({id:row.id,itemKey:row.item_key,itemType:row.item_type,title:row.title,status:row.status,priority:row.priority,milestoneId:row.milestone_id||null,iterationId:row.iteration_id||null,stageKey:row.stage_key||null})),
    dependencies:dependencies.map(row=>({id:row.id,sourceType:row.source_type,sourceId:row.source_id,targetType:row.target_type,targetId:row.target_id,dependencyType:row.dependency_type,status:row.status,criticalPath:Boolean(row.critical_path)})),
    risks:risks.map(row=>({id:row.id,riskKey:row.risk_key,title:row.title,probability:row.probability,impact:row.impact,status:row.status})),
    issues:issues.map(row=>({id:row.id,issueKey:row.issue_key,title:row.title,severity:row.severity,status:row.status})),
    blockers:blockers.map(row=>({id:row.id,blockerKey:row.blocker_key,blockingObjectType:row.blocking_object_type,blockingObjectId:row.blocking_object_id,reason:row.reason,status:row.status,resumeCondition:row.resume_condition||null})),
    decisions:decisions.map(row=>({id:row.id,decisionKey:row.decision_key,title:row.title,status:row.status,reversible:Boolean(row.reversible),effectiveVersion:row.effective_version||null})),
    changes:changes.map(row=>({id:row.id,changeKey:row.change_key,changeReason:row.change_reason,createdAt:row.created_at})),
    strategyLinks:strategyLinks.map(row=>({strategicItemId:row.strategic_item_id,itemKey:row.item_key,itemType:row.item_type,title:row.title,linkRole:row.link_role,weightBps:row.weight_bps==null?null:Number(row.weight_bps)})),
    portfolioLinks:portfolioLinks.map(row=>({portfolioId:row.portfolio_id,portfolioKey:row.portfolio_key,name:row.name,roadmapOrder:row.roadmap_order==null?null:Number(row.roadmap_order),targetWindow:row.target_window||null}))
  };
};
