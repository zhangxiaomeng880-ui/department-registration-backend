import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const token=process.env.RUNTIME_API_TOKEN||'m273-platform-token';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const expectStatus=(r,status)=>assert.equal(r.status,status,JSON.stringify(r.body));
const suffix=randomUUID().slice(0,8);
const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});

let r=await request('POST','/api/runtime/tenants',{tenantKey:`m273-${suffix}`,name:'M27.3 Tenant'});
expectStatus(r,201);const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'M27.3 Workspace'});
expectStatus(r,201);const workspaceId=r.body.data.id;

// Non-AI product projects explicitly SKIP the specialized gate.
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`saas-${suffix}`,name:'Non AI Product',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'SAAS_PLATFORM'
});
expectStatus(r,201);const nonAiProjectId=r.body.data.id;
r=await request('POST',`/api/runtime/projects/${nonAiProjectId}/product-gates/G-PD-AI-CONTRACT/evaluate`,{});
expectStatus(r,200);
assert.equal(r.body.data.status,'SKIPPED');
assert.deepEqual(r.body.data.reasonCodes,['NOT_AI_APPLICATION']);

// AI Application project.
r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`ai-${suffix}`,name:'AI Product',
  projectType:'PRODUCT_DEVELOPMENT',projectSubtypeKey:'AI_APPLICATION'
});
expectStatus(r,201);const projectId=r.body.data.id;

// Seed a valid M27.1 + M27.2 baseline using the already-tested schema.
// M27.1/M27.2 API behavior is covered by their own full integration gates.
const goalId=randomUUID(),opportunityId=randomUUID(),betId=randomUUID();
const projectBaselineId=randomUUID(),productBaselineId=randomUUID();
const feasibilityId=randomUUID(),releaseVersionId=randomUUID(),planId=randomUUID();
const designContractId=randomUUID(),designVersionId=randomUUID();
const technicalContractId=randomUUID(),technicalVersionId=randomUUID();
const requirementVersionId=randomUUID();

await db.execute(
  `INSERT INTO product_opportunities
    (id,project_id,opportunity_key,opportunity_type,title,pain_opportunity,impact_json,confidence,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [opportunityId,projectId,'OPP-AI','OPPORTUNITY','AI assisted triage','Triage is slow',
   JSON.stringify({delivery:'faster'}),'HIGH','OPEN',JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_goal_definitions
    (id,project_id,goal_key,business_goal,product_goal,primary_metric_json,qualitative_acceptance_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [goalId,projectId,'GOAL-AI','Reduce triage time','Provide grounded AI assistance',
   JSON.stringify({metric:'triage_minutes'}),JSON.stringify(['grounded answer']),'CURRENT',JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_bets
    (id,project_id,goal_definition_id,opportunity_id,bet_key,statement,expected_outcome_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [betId,projectId,goalId,opportunityId,'BET-AI','Grounded AI can reduce triage time',
   JSON.stringify({triage_minutes:'-30%'}),'APPROVED',JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO project_baselines
    (id,project_id,baseline_no,version_label,status,scope_json,out_of_scope_json,evidence_json)
   VALUES (?,?,1,'AI-B1','CURRENT',?,?,?)`,
  [projectBaselineId,projectId,JSON.stringify({include:['AI triage']}),
   JSON.stringify({exclude:['autonomous destructive actions']}),JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_requirement_baselines
    (id,project_id,project_baseline_id,baseline_key,goal_definition_id,product_bet_id,requirement_versions_json,
     scope_json,business_rules_json,acceptance_criteria_json,metric_json,key_decisions_json,out_of_scope_json,status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT',?)`,
  [productBaselineId,projectId,projectBaselineId,'PD-AI-B1',goalId,betId,
   JSON.stringify([{versionId:requirementVersionId,requirementKey:'REQ-AI-1',versionNo:1}]),
   JSON.stringify({include:['AI triage']}),JSON.stringify({grounded:true}),
   JSON.stringify({required:['grounded response']}),JSON.stringify({primary:'triage_minutes'}),
   JSON.stringify([]),JSON.stringify({exclude:['destructive actions']}),JSON.stringify({fixture:'M27.3'})]
);
await db.execute('UPDATE projects SET current_baseline_id=? WHERE id=?',[projectBaselineId,projectId]);

const feasibilitySections=Object.fromEntries([
  'ARCHITECTURE','FRAMEWORK_RUNTIME','DATA','API_INTEGRATION','AUTH_PERMISSION',
  'SECURITY_PRIVACY_COMPLIANCE','PERFORMANCE_SCALABILITY','RELIABILITY_AVAILABILITY',
  'DEPLOYMENT_MIGRATION','THIRD_PARTY_DEPENDENCY','COST_QUOTA','OBSERVABILITY_SUPPORTABILITY','ROLLBACK'
].map(k=>[k,{status:'PASS'}]));
await db.execute(
  `INSERT INTO product_feasibility_reviews
    (id,project_id,product_baseline_id,review_key,overall_status,section_status_json,architecture_json,
     framework_runtime_json,data_json,api_integration_json,auth_permission_json,security_privacy_compliance_json,
     performance_scalability_json,reliability_availability_json,deployment_migration_json,third_party_dependency_json,
     cost_quota_json,observability_supportability_json,rollback_json,risk_summary_json,architecture_decision_required,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
  [feasibilityId,projectId,productBaselineId,'FEAS-AI','PASS',JSON.stringify(feasibilitySections),
   '{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}','{}',JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO project_versions(id,project_id,version_key,version_type,label,status)
   VALUES (?,?,?,'RELEASE_DISTRIBUTION','AI RC','DRAFT')`,
  [releaseVersionId,projectId,'REL-AI']
);
await db.execute(
  `INSERT INTO product_delivery_plans
    (id,project_id,product_baseline_id,feasibility_review_id,plan_key,target_release_version_id,
     milestone_ids_json,iteration_ids_json,work_item_ids_json,dependency_ids_json,capacity_snapshot_ids_json,
     critical_path_json,release_sequence_json,definition_of_done_json,acceptance_plan_json,risk_blocker_plan_json,
     status,evidence_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CURRENT',?)`,
  [planId,projectId,productBaselineId,feasibilityId,'PLAN-AI',releaseVersionId,
   '[]','[]','[]','[]','[]',JSON.stringify({path:['AI contract']}),
   JSON.stringify(['contract','engineering']),JSON.stringify(['AI contract PASS']),
   JSON.stringify({acceptance:'later'}),JSON.stringify({failClosed:true}),JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_design_contracts(id,project_id,contract_key,title,status,current_version_no)
   VALUES (?,?,?,?, 'APPROVED',1)`,
  [designContractId,projectId,'DESIGN-AI','AI triage design']
);
await db.execute(
  `INSERT INTO product_design_contract_versions
    (id,design_contract_id,project_id,product_baseline_id,version_no,source_locator_json,source_verification_json,
     information_architecture_json,user_flows_json,screens_pages_json,components_json,tokens_style_json,interaction_json,
     state_matrix_json,responsive_adaptive_json,accessibility_json,content_copy_json,platform_behavior_json,
     prototype_locator_json,design_acceptance_matrix_json,evidence_json)
   VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [designVersionId,designContractId,projectId,productBaselineId,
   JSON.stringify({provider:'FIGMA',ref:'fixture'}),
   JSON.stringify({readable:true,verifiedAt:'2026-10-07T00:00:00Z',evidenceRef:'fixture://design'}),
   '{}','{}','{}','{}','{}','{}',JSON.stringify({normal:true,error:true}),
   '{}','{}','{}','{}',JSON.stringify({ref:'fixture'}),JSON.stringify({REQ_AI_1:['pass']}),
   JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_trace_links
    (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json)
   VALUES (?,?,?,?,?,?,?,?)`,
  [randomUUID(),projectId,'REQUIREMENT_VERSION',requirementVersionId,'DESIGN_CONTRACT_VERSION',
   designVersionId,'DESIGNED_BY',JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_technical_contracts(id,project_id,contract_key,title,status,current_version_no)
   VALUES (?,?,?,?, 'APPROVED',1)`,
  [technicalContractId,projectId,'TECH-AI','AI triage technical contract']
);
const technicalSections={
  TECHNICAL_DESIGN:{status:'PASS'},API:{status:'PASS'},DATA:{status:'PASS'},
  INTEGRATION:{status:'N_A',rationale:'No external integration'},INSTRUMENTATION:{status:'PASS'}
};
await db.execute(
  `INSERT INTO product_technical_contract_versions
    (id,technical_contract_id,project_id,product_baseline_id,design_contract_version_id,version_no,
     technical_design_json,api_contract_json,data_contract_json,integration_contract_json,
     instrumentation_contract_json,section_status_json,evidence_json)
   VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?)`,
  [technicalVersionId,technicalContractId,projectId,productBaselineId,designVersionId,
   JSON.stringify({architecture:'existing runtime'}),JSON.stringify({api:'internal'}),
   JSON.stringify({sourceOfTruth:'MySQL'}),JSON.stringify({none:true}),
   JSON.stringify({events:['ai_triage_completed']}),JSON.stringify(technicalSections),
   JSON.stringify({fixture:'M27.3'})]
);
await db.execute(
  `INSERT INTO product_trace_links
    (id,project_id,source_type,source_id,target_type,target_id,link_type,evidence_json)
   VALUES (?,?,?,?,?,?,?,?)`,
  [randomUUID(),projectId,'REQUIREMENT_VERSION',requirementVersionId,'TECHNICAL_CONTRACT_VERSION',
   technicalVersionId,'IMPLEMENTED_BY_CONTRACT',JSON.stringify({fixture:'M27.3'})]
);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-AI-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AI_CONTRACT_REQUIRED'));

// Reuse existing Model Registry / Capability Registry / Knowledge Source / Eval foundations.
const providerKey=`m273-provider-${suffix}`,modelKey='ai-model';
r=await request('POST','/api/runtime/providers',{
  providerKey,providerType:'OPENAI',displayName:'M27.3 AI Provider',adapterKey:'openai-responses',
  healthStatus:'HEALTHY',supportsStructuredOutput:true
});
expectStatus(r,201);
r=await request('POST','/api/runtime/models',{
  providerKey,modelKey,displayName:'M27.3 AI Model',qualityTier:'HIGH',latencyTier:'FAST',costTier:'LOW',
  capabilities:{structuredOutput:true,taskTypes:['AI_PRODUCT_RUNTIME']}
});
expectStatus(r,201);

const toolKey=`TOOL:M273:SEARCH:${suffix}`;
r=await request('POST','/api/runtime/capabilities',{
  capabilityKey:toolKey,capabilityType:'TOOL',displayName:'受控检索工具',
  adapterKey:'internal-test',status:'ACTIVE',routable:true
});
expectStatus(r,201);

const knowledgeSourceId=randomUUID();
await db.execute(
  `INSERT INTO knowledge_sources
    (id,source_key,provider,source_type,transport_mode,status,root_scope,config_json)
   VALUES (?,?,?,?,?,'ACTIVE',?,?)`,
  [knowledgeSourceId,`M273-KNOW-${suffix}`,'LIBRARY','LIBRARY','CONNECTOR','/product/ai',
   JSON.stringify({fixture:true})]
);

r=await request('POST','/api/runtime/eval-suites',{
  suiteKey:`m273-eval-${suffix}`,name:'M27.3 AI Offline Eval'
});
expectStatus(r,201);const evalSuiteId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suites/${evalSuiteId}/versions`,{versionNo:1});
expectStatus(r,201);const evalVersionId=r.body.data.id;
r=await request('POST',`/api/runtime/eval-suite-versions/${evalVersionId}/cases`,{
  caseKey:'grounded-ai-output',sequenceNo:1,
  replayInput:{
    projectType:'PRODUCT_DEVELOPMENT',taskType:'AI_PRODUCT_RUNTIME',
    query:'Synthetic fixture: return grounded structured result only.',
    policyMode:'QUALITY_FIRST',requiredStructuredOutput:true
  },
  sourceRefs:[],
  assertions:{
    structuredOutput:{requiredKeys:['answer','evidence']},
    evidence:{required:false,minCount:0},
    router:{policyResult:'ALLOW'},
    execution:{status:'PASS',maxDurationMs:5000,maxEstimatedCost:0.1,costCurrency:'USD'}
  }
});
expectStatus(r,201);
r=await request('POST',`/api/runtime/eval-suite-versions/${evalVersionId}/freeze`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'FROZEN');

// Prompt is first-class and versioned.
r=await request('POST',`/api/runtime/projects/${projectId}/product-ai-prompt-versions`,{
  productBaselineId,promptKey:'AI-TRIAGE',
  instructionContract:{
    systemRole:'Grounded project triage assistant',
    rules:['Use supplied evidence only','Never invent missing facts','Escalate uncertainty']
  },
  structuredOutputSchema:{
    type:'object',required:['answer','evidence'],
    properties:{answer:{type:'string'},evidence:{type:'array'}}
  },
  evidence:{review:'PASS'}
});
expectStatus(r,201);const promptVersion1=r.body.data.id;
assert.equal(r.body.data.versionNo,1);
assert.match(r.body.data.instructionSha256,/^[a-f0-9]{64}$/);

const sectionStatus={
  MODEL_PROVIDER:{status:'PASS'},PROMPT:{status:'PASS'},RAG:{status:'PASS'},
  PERMISSIONS:{status:'PASS'},STRUCTURED_OUTPUT:{status:'PASS'},SAFETY_PII:{status:'PASS'},
  ADVERSARIAL_TEST:{status:'PASS'},FALLBACK_FAIL_CLOSED:{status:'PASS'},
  HUMAN_ESCALATION:{status:'PASS'},OFFLINE_EVAL:{status:'PASS'},THRESHOLDS:{status:'PASS'},
  ONLINE_FEEDBACK_DRIFT:{status:'PASS'},REPRODUCIBILITY:{status:'PASS'}
};
const validAiContract={
  productBaselineId,technicalContractVersionId:technicalVersionId,promptVersionId:promptVersion1,
  contractKey:'AI-CONTRACT-1',title:'AI 分诊专项契约',status:'APPROVED',
  modelProviderRequirements:{selectionPolicy:'QUALITY_FIRST',structuredOutput:true},
  ragContract:{enabled:true,retrievalMode:'LIBRARY_SEARCH_READ',freshnessRequired:true,unsupportedClaimPolicy:'BLOCK'},
  capabilityPermissionContract:{denyByDefault:true,explicitAllowOnly:true},
  structuredOutputContract:{validation:'STRICT',onInvalid:'FAIL_CLOSED'},
  safetyPolicyPiiContract:{policyMode:'FAIL_CLOSED',piiBoundary:'NO_NEW_PII',unsupportedClaim:'BLOCK'},
  adversarialTestContract:{
    promptInjection:{status:'REQUIRED',assertions:['System policy cannot be overridden']},
    toolAbuse:{status:'REQUIRED',assertions:['Unapproved tools are blocked']},
    dataExfiltration:{status:'REQUIRED',assertions:['Secrets and unrelated data are blocked']}
  },
  fallbackFailClosedContract:{failClosed:true,strategy:'HUMAN_ESCALATION'},
  humanEscalationContract:{triggers:['LOW_CONFIDENCE','POLICY_BLOCK'],actions:['QUEUE_HUMAN_REVIEW']},
  qualityThreshold:{groundedAccuracyMin:0.9},
  latencyThreshold:{p95MsMax:5000},
  costThreshold:{usdPerRequestMax:0.1},
  onlineFeedbackDrift:{signals:['negative_feedback_rate','eval_regression'],actions:['ALERT','PROMPT_ROLLBACK']},
  reproducibility:{
    runtimeVersion:'v2.7',workflowVersion:'1.3',
    modelSelectionPolicy:'CONTRACT_LOCKED',sourceVersionPolicy:'VERSIONED_ONLY'
  },
  sectionStatus,
  modelBindings:[{providerKey,modelKey,bindingRole:'PRIMARY',required:true}],
  knowledgeBindings:[{
    sourceId:knowledgeSourceId,bindingRole:'RAG_SOURCE',
    retrievalPolicy:{mode:'LIBRARY_SEARCH_READ',topK:8},
    freshnessPolicy:{maxAgeDays:30,onStale:'BLOCK'}
  }],
  capabilityBindings:[{
    capabilityKey:toolKey,permissionMode:'ALLOWED',capabilityRole:'TOOL',
    purpose:'Read-only grounded project search',dataScope:{mode:'PROJECT_ONLY'}
  }],
  evalBindings:[{
    suiteVersionId:evalVersionId,bindingRole:'OFFLINE_BASELINE',
    threshold:{passRateMin:1,groundedAccuracyMin:0.9}
  }],
  evidence:{product:'PASS',security:'PASS',eval:'FROZEN'}
};

// Deny-by-default is mandatory.
r=await request('POST',`/api/runtime/projects/${projectId}/product-ai-contracts`,{
  ...validAiContract,
  contractKey:'AI-CONTRACT-BAD',
  capabilityPermissionContract:{denyByDefault:false}
});
expectStatus(r,409);assert.equal(r.body.error,'AI_PERMISSION_DENY_BY_DEFAULT_REQUIRED');

// Valid AI Contract.
r=await request('POST',`/api/runtime/projects/${projectId}/product-ai-contracts`,validAiContract);
expectStatus(r,201);const aiContractId=r.body.data.id;const aiContractVersion1=r.body.data.currentVersionId;

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-AI-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Prompt cannot drift without Change Record.
r=await request('POST',`/api/runtime/projects/${projectId}/product-ai-prompt-versions`,{
  productBaselineId,promptKey:'AI-TRIAGE',
  instructionContract:{systemRole:'Changed without governance'},
  structuredOutputSchema:{type:'object'},evidence:{review:'NO'}
});
expectStatus(r,409);assert.equal(r.body.error,'AI_PROMPT_CHANGE_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/changes`,{
  changeKey:'CR-AI-PROMPT',before:{promptVersion:1},
  changeReason:'Strengthen grounded refusal and escalation behavior.',
  changeScope:{promptKey:'AI-TRIAGE'},
  impactedObjects:['AI_CONTRACT','EVAL','QA'],
  revalidationScope:['G-PD-AI-CONTRACT','G-PD-QA'],
  after:{promptVersion:2},evidence:{ownerReview:'PASS'}
});
expectStatus(r,201);const changeId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/product-ai-prompt-versions`,{
  productBaselineId,promptKey:'AI-TRIAGE',changeId,
  instructionContract:{
    systemRole:'Grounded project triage assistant',
    rules:['Use supplied evidence only','Refuse unsupported claims','Escalate low confidence']
  },
  structuredOutputSchema:{
    type:'object',required:['answer','evidence'],
    properties:{answer:{type:'string'},evidence:{type:'array'}}
  },
  evidence:{changeId,revalidation:'REQUIRED'}
});
expectStatus(r,201);const promptVersion2=r.body.data.id;
assert.equal(r.body.data.versionNo,2);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-AI-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AI_PROMPT_VERSION_STALE'));

// AI Contract revision also requires governed change.
r=await request('POST',`/api/runtime/product-ai-contracts/${aiContractId}/versions`,{
  ...validAiContract,promptVersionId:promptVersion2
});
expectStatus(r,409);assert.equal(r.body.error,'AI_CONTRACT_CHANGE_REQUIRED');

r=await request('POST',`/api/runtime/product-ai-contracts/${aiContractId}/versions`,{
  ...validAiContract,promptVersionId:promptVersion2,changeId,
  evidence:{changeId,product:'PASS',security:'PASS',eval:'FROZEN'}
});
expectStatus(r,201);const aiContractVersion2=r.body.data.currentVersionId;
assert.equal(r.body.data.currentVersionNo,2);

r=await request('POST',`/api/runtime/projects/${projectId}/product-gates/G-PD-AI-CONTRACT/evaluate`,{});
expectStatus(r,200);assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Read models retain exact bindings and version lineage.
r=await request('GET',`/api/runtime/product-ai-contracts/${aiContractId}`);
expectStatus(r,200);
assert.equal(r.body.data.versions.length,2);
assert.equal(r.body.data.versions[0].id,aiContractVersion1);
assert.equal(r.body.data.versions[1].id,aiContractVersion2);
assert.equal(r.body.data.versions[1].promptVersionId,promptVersion2);
assert.equal(r.body.data.versions[1].modelBindings[0].modelKey,modelKey);
assert.equal(r.body.data.versions[1].knowledgeBindings[0].sourceId,knowledgeSourceId);
assert.equal(r.body.data.versions[1].evalBindings[0].suiteVersionId,evalVersionId);

r=await request('GET',`/api/runtime/projects/${projectId}/product-ai-domain`);
expectStatus(r,200);
assert.equal(r.body.data.projectSubtypeKey,'AI_APPLICATION');
assert.equal(r.body.data.prompts.length,2);
assert.equal(r.body.data.prompts[0].status,'HISTORICAL');
assert.equal(r.body.data.prompts[1].status,'CURRENT');
assert.equal(r.body.data.contracts[0].currentVersionNo,2);

// Durable bindings point to existing registries, never duplicate model/RAG/eval definitions.
const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM product_ai_model_bindings WHERE ai_contract_version_id=?) model_bindings,
    (SELECT COUNT(*) FROM product_ai_knowledge_bindings WHERE ai_contract_version_id=?) knowledge_bindings,
    (SELECT COUNT(*) FROM product_ai_capability_bindings WHERE ai_contract_version_id=?) capability_bindings,
    (SELECT COUNT(*) FROM product_ai_eval_bindings WHERE ai_contract_version_id=?) eval_bindings,
    (SELECT COUNT(*) FROM product_m273_gate_evaluations WHERE project_id=? AND gate_key='G-PD-AI-CONTRACT' AND status='PASS') pass_gates`,
  [aiContractVersion2,aiContractVersion2,aiContractVersion2,aiContractVersion2,projectId]
);
assert.equal(Number(truth.model_bindings),1);
assert.equal(Number(truth.knowledge_bindings),1);
assert.equal(Number(truth.capability_bindings),1);
assert.equal(Number(truth.eval_bindings),1);
assert.ok(Number(truth.pass_gates)>=2);

await db.end();
console.log('Runtime V2.7 M27.3 AI application contract validation passed');
