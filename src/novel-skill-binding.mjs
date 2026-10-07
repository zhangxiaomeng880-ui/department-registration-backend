import { getRuntimePool } from './runtime-db.mjs';

export const NOVEL_SKILL_CAPABILITY_KEY='SKILL:NOVEL_CONTINUOUS_UPDATE';
export const NOVEL_SKILL_PROJECT_TYPE='AIGC_CONTENT';
export const NOVEL_SKILL_AGENT_KEY='AGENT:STANDARD:AIGC_CONTENT:OPERATIONS_CONTENT';

const parseJson=value=>{
  if(value==null)return null;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return null;}
};

export const syncNovelSkillBinding=async()=>{
  const db=getRuntimePool();
  await db.execute(
    `INSERT INTO capability_registry (
      capability_key,capability_type,display_name,version,status,routable,adapter_key,
      input_contract_json,output_contract_json,capabilities_json,policy_tags_json,metadata_json
    ) VALUES (
      ?,'SKILL','《你好，那年夏天》小说持续更新','1.0','ACTIVE',FALSE,'external-chatgpt-scheduler',
      ?,?,?,?,?
    )
    ON DUPLICATE KEY UPDATE
      capability_type='SKILL',display_name=VALUES(display_name),version='1.0',status='ACTIVE',
      routable=FALSE,adapter_key=VALUES(adapter_key),
      input_contract_json=VALUES(input_contract_json),output_contract_json=VALUES(output_contract_json),
      capabilities_json=VALUES(capabilities_json),policy_tags_json=VALUES(policy_tags_json),
      metadata_json=VALUES(metadata_json)`,
    [
      NOVEL_SKILL_CAPABILITY_KEY,
      JSON.stringify({
        type:'object',
        required:['projectKey','checkpointPath','sourceScopes'],
        properties:{
          projectKey:{type:'string'},checkpointPath:{type:'string'},
          sourceScopes:{type:'array',items:{type:'string'}},
          resumePoint:{type:['string','null']},triggerReason:{type:['string','null']}
        }
      }),
      JSON.stringify({
        type:'object',
        required:['status','checkpointPath','gateStatus'],
        properties:{
          status:{type:'string'},updatedChapters:{type:'array',items:{type:'string'}},
          reusedPassChapters:{type:'array',items:{type:'string'}},gateStatus:{type:'string'},
          checkpointPath:{type:'string'},resumePoint:{type:['string','null']},
          blockingReason:{type:['string','null']}
        }
      }),
      JSON.stringify({
        taskTypes:['NOVEL_CONTINUOUS_UPDATE','NARRATIVE_DERIVATION'],
        supportsCheckpoint:true,supportsIncrementalExecution:true,supportsQaGate:true
      }),
      JSON.stringify({
        domain:'AIGC',subdomain:'NARRATIVE_NOVEL',executionMode:'EXTERNAL_SCHEDULER',
        projectType:NOVEL_SKILL_PROJECT_TYPE,agentRoleHint:'OPERATIONS_CONTENT',
        stageHint:'AIGC_11_DERIVATION',humanGate:'P0_OR_CREATIVE_CHOICE',
        sourceOfTruth:'CHATGPT_LIBRARY'
      }),
      JSON.stringify({
        contractPath:'/AI_Native_Project/AI_NATIVE_2.0/knowledge/Skills/SKILL_NOVEL_CONTINUOUS_UPDATE_V1.0_CURRENT.md',
        checkpointPath:'/你好那年夏天/小说/00_规划与基线/你好那年夏天_小说持续更新状态_V1.0_CURRENT.md',
        projectRoot:'/你好那年夏天/',
        externalScheduler:'ChatGPT Scheduled Task',
        externalSchedule:{cadence:'DAILY',hour:9,timezone:'Asia/Shanghai',timingMode:'FLEXIBLE'},
        nativeRuntimeExecution:false,nativeTriggerRegistry:false,bindingStatus:'EXTERNAL_BOUND',source:'M28.2'
      })
    ]
  );

  await db.execute(
    `INSERT INTO project_type_capability_bindings
      (project_type_key,capability_key,binding_mode,priority,constraints_json)
     VALUES (?,?,'ALLOWED',40,?)
     ON DUPLICATE KEY UPDATE binding_mode='ALLOWED',priority=40,constraints_json=VALUES(constraints_json)`,
    [
      NOVEL_SKILL_PROJECT_TYPE,NOVEL_SKILL_CAPABILITY_KEY,
      JSON.stringify({executionMode:'EXTERNAL_SCHEDULER',stageHint:'AIGC_11_DERIVATION',nativeRuntimeExecution:false})
    ]
  );

  const [agents]=await db.execute(
    'SELECT capability_key FROM capability_registry WHERE capability_key=? AND capability_type=\'AGENT\' AND status=\'ACTIVE\'',
    [NOVEL_SKILL_AGENT_KEY]
  );
  if(agents.length){
    await db.execute(
      `INSERT INTO agent_capability_grants
        (agent_capability_key,child_capability_key,requirement_mode,priority,constraints_json)
       VALUES (?,?,'ALLOWED',40,?)
       ON DUPLICATE KEY UPDATE requirement_mode='ALLOWED',priority=40,constraints_json=VALUES(constraints_json)`,
      [
        NOVEL_SKILL_AGENT_KEY,NOVEL_SKILL_CAPABILITY_KEY,
        JSON.stringify({executionMode:'EXTERNAL_SCHEDULER',stageHint:'AIGC_11_DERIVATION',nativeRuntimeExecution:false})
      ]
    );
  }

  return getNovelSkillBindingStatus();
};

export const getNovelSkillBindingStatus=async()=>{
  const db=getRuntimePool();
  const [[capability]]=await db.execute(
    'SELECT * FROM capability_registry WHERE capability_key=? LIMIT 1',
    [NOVEL_SKILL_CAPABILITY_KEY]
  );
  const [[projectBinding]]=await db.execute(
    `SELECT * FROM project_type_capability_bindings
      WHERE project_type_key=? AND capability_key=? LIMIT 1`,
    [NOVEL_SKILL_PROJECT_TYPE,NOVEL_SKILL_CAPABILITY_KEY]
  );
  const [[agentGrant]]=await db.execute(
    `SELECT * FROM agent_capability_grants
      WHERE agent_capability_key=? AND child_capability_key=? LIMIT 1`,
    [NOVEL_SKILL_AGENT_KEY,NOVEL_SKILL_CAPABILITY_KEY]
  );

  return {
    capability:capability?{
      capabilityKey:capability.capability_key,
      capabilityType:capability.capability_type,
      displayName:capability.display_name,
      version:capability.version,
      status:capability.status,
      routable:Boolean(capability.routable),
      adapterKey:capability.adapter_key,
      policyTags:parseJson(capability.policy_tags_json),
      metadata:parseJson(capability.metadata_json)
    }:null,
    projectTypeBinding:projectBinding?{
      projectTypeKey:projectBinding.project_type_key,
      bindingMode:projectBinding.binding_mode,
      priority:Number(projectBinding.priority),
      constraints:parseJson(projectBinding.constraints_json)
    }:null,
    agentGrant:agentGrant?{
      agentCapabilityKey:agentGrant.agent_capability_key,
      childCapabilityKey:agentGrant.child_capability_key,
      requirementMode:agentGrant.requirement_mode,
      priority:Number(agentGrant.priority),
      constraints:parseJson(agentGrant.constraints_json)
    }:null,
    bindingStatus:capability&&projectBinding?'EXTERNAL_BOUND':'NOT_BOUND',
    nativeRuntimeExecution:false,
    nativeTriggerRegistry:false
  };
};
