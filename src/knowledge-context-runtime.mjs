import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool, addKnowledgeContexts } from './runtime-db.mjs';
import { createEphemeralContextPacket,consumeEphemeralContextPacket } from './context-bridge.mjs';
import { recordKnowledgeRetrieval } from './knowledge-retrieval.mjs';

const sha256=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
const parseJson=value=>{
  if(value==null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const asJson=value=>value==null?null:JSON.stringify(value);
const errorOf=(message,code,statusCode=400,details)=>{
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details) error.details=details;return error;
};

const resolveProjectSourceKey=async(projectId,bindingOrSourceKey,db=getRuntimePool())=>{
  const [bindings]=await db.execute(
    `SELECT b.source_key,s.status AS source_status
       FROM project_knowledge_bindings b
       JOIN knowledge_sources s ON s.source_key=b.source_key
      WHERE b.project_id=? AND b.binding_key=? AND b.status='ACTIVE' LIMIT 1`,
    [projectId,bindingOrSourceKey]
  );
  if(bindings.length){
    if(bindings[0].source_status!=='ACTIVE') throw errorOf(
      'Bound knowledge source is not active','KNOWLEDGE_SOURCE_NOT_ACTIVE',409,
      {projectId,bindingKey:bindingOrSourceKey}
    );
    return bindings[0].source_key;
  }
  const [sources]=await db.execute(
    'SELECT source_key,status FROM knowledge_sources WHERE source_key=?',[bindingOrSourceKey]
  );
  if(sources.length&&sources[0].status==='ACTIVE') return sources[0].source_key;
  throw errorOf(
    'Project knowledge binding is missing','PROJECT_KNOWLEDGE_BINDING_MISSING',409,
    {projectId,bindingKey:bindingOrSourceKey}
  );
};

export const prepareStageKnowledgeContext=async({
  projectId,runId,taskId,stage,knowledgePackets={}
}={})=>{
  const policies=stage?.knowledgePolicies||[];
  if(!policies.length) return {contextCount:0,contextHash:null,contextText:null,policyContexts:[]};

  const policyContexts=[];
  const db=getRuntimePool();
  for(const policy of policies){
    const raw=knowledgePackets?.[stage.stageKey]?.[policy.policyKey];
    if(!raw){
      if(policy.required) throw errorOf(
        'Required knowledge context is missing','REQUIRED_KNOWLEDGE_CONTEXT_MISSING',409,
        {stageKey:stage.stageKey,policyKey:policy.policyKey,bindingKey:policy.sourceKey}
      );
      continue;
    }
    const resolvedSourceKey=await resolveProjectSourceKey(projectId,policy.sourceKey,db);
    if(!Array.isArray(raw.items)||!raw.items.length){
      if(policy.required) throw errorOf(
        'Required knowledge context contains no items','REQUIRED_KNOWLEDGE_CONTEXT_EMPTY',409,
        {stageKey:stage.stageKey,policyKey:policy.policyKey}
      );
      continue;
    }
    if(raw.items.length>policy.maxItems) throw errorOf(
      'Knowledge context exceeds stage policy maxItems','KNOWLEDGE_CONTEXT_POLICY_LIMIT',413,
      {stageKey:stage.stageKey,policyKey:policy.policyKey,maxItems:policy.maxItems}
    );
    const allowed=new Set((policy.allowedStatuses||[]).map(value=>String(value).toUpperCase()));
    for(const item of raw.items){
      const status=String(item.sourceStatus||'CURRENT').toUpperCase();
      if(allowed.size&&!allowed.has(status)) throw errorOf(
        'Knowledge item status is not allowed by stage policy','KNOWLEDGE_STATUS_NOT_ALLOWED',409,
        {policyKey:policy.policyKey,sourceStatus:status}
      );
    }

    const query=raw.query||policy.queryTemplate;
    const packetMeta=createEphemeralContextPacket({
      query,
      scope:{
        stageKey:stage.stageKey,policyKey:policy.policyKey,
        sourceKey:resolvedSourceKey,sourceBindingKey:policy.sourceKey
      },
      items:raw.items,
      ttlSeconds:120
    });
    const packet=consumeEphemeralContextPacket(packetMeta.id);

    await addKnowledgeContexts(runId,{
      items:packet.items.map((item,index)=>({
        taskId,
        sourceProvider:'CHATGPT_LIBRARY',
        sourceFileId:item.sourceFileId,
        sourceLibraryFileId:item.sourceLibraryFileId,
        sourceVersion:item.sourceVersion,
        sourcePath:item.sourcePath,
        sourceStatus:item.sourceStatus,
        precedenceRank:index+1,
        retrievalQuery:query,
        retrievalMode:'WORKFLOW_AUTO_CONTEXT',
        contextRole:policy.contextRole,
        sourceLineStart:item.lineStart,
        sourceLineEnd:item.lineEnd,
        contentSha256:item.contentSha256
      }))
    });

    const retrieval=await recordKnowledgeRetrieval({
      sourceKey:resolvedSourceKey,
      runId,taskId,query,
      retrievalMode:'WORKFLOW_AUTO_CONTEXT',
      status:'PASS',
      contextHash:packet.contextHash,
      policy:{
        stageKey:stage.stageKey,policyKey:policy.policyKey,contextRole:policy.contextRole,
        sourceBindingKey:policy.sourceKey,resolvedSourceKey,
        allowedStatuses:policy.allowedStatuses,injectionMode:policy.injectionMode
      },
      items:packet.items.map((item,index)=>({
        externalFileId:item.sourceFileId,
        libraryFileId:item.sourceLibraryFileId,
        versionId:item.sourceVersion,
        sourcePath:item.sourcePath,
        rankNo:index+1,
        selected:true,
        lineStart:item.lineStart,
        lineEnd:item.lineEnd,
        contentHash:item.contentSha256,
        metadata:{sourceStatus:item.sourceStatus,contextRole:policy.contextRole}
      }))
    });

    policyContexts.push({
      policy:{...policy,resolvedSourceKey},
      query,
      contextHash:packet.contextHash,
      retrievalId:retrieval.id,
      items:packet.items
    });
  }

  if(!policyContexts.length) return {contextCount:0,contextHash:null,contextText:null,policyContexts:[]};
  const contextHash=sha256(policyContexts.map(x=>x.contextHash).join('|'));
  const contextText=policyContexts.map(entry=>{
    const header=`[KNOWLEDGE:${entry.policy.policyKey} source=${entry.policy.resolvedSourceKey} role=${entry.policy.contextRole}]`;
    const body=entry.items.map(item=>{
      const loc=item.lineStart==null?'':` lines=${item.lineStart}-${item.lineEnd??item.lineStart}`;
      return `SOURCE file=${item.sourceFileId} version=${item.sourceVersion||''}${loc}\n${item.sourceText}`;
    }).join('\n\n');
    return `${header}\n${body}`;
  }).join('\n\n');

  return {
    contextCount:policyContexts.reduce((sum,x)=>sum+x.items.length,0),
    contextHash,
    contextText,
    policyContexts:policyContexts.map(entry=>({
      policyKey:entry.policy.policyKey,
      sourceKey:entry.policy.resolvedSourceKey,
      sourceBindingKey:entry.policy.sourceKey,
      contextRole:entry.policy.contextRole,
      contextHash:entry.contextHash,
      retrievalId:entry.retrievalId,
      itemCount:entry.items.length
    }))
  };
};

export const injectKnowledgeContext=(requirementInput,requirement,prepared)=>{
  if(!prepared?.contextText) return requirementInput;
  const base=requirementInput&&typeof requirementInput==='object'
    ? {...requirementInput}
    : {payload:requirementInput};
  if(requirement.capabilityType==='MODEL'){
    const original=base.input;
    const originalText=typeof original==='string'?original:JSON.stringify(original??{});
    return {
      ...base,
      input:`${originalText}\n\n${prepared.contextText}`,
      knowledgeContextHash:prepared.contextHash
    };
  }
  return {
    ...base,
    knowledgeContextText:prepared.contextText,
    knowledgeContextHash:prepared.contextHash
  };
};

const candidateList=output=>{
  const raw=output?.knowledgeWriteback??output?.payload?.knowledgeWriteback;
  if(raw==null) return [];
  return Array.isArray(raw)?raw:[raw];
};

export const queueKnowledgeWritebacks=async({
  project,runId,taskId,stageInstance,stage,outputs,sessionId
}={})=>{
  const policies=new Map((stage?.knowledgePolicies||[]).map(policy=>[policy.policyKey,policy]));
  const candidates=[];
  for(const item of outputs||[]){
    for(const candidate of candidateList(item.output)){
      if(!candidate?.policyKey||candidate.payload==null) continue;
      candidates.push({...candidate,requirementKey:item.requirementKey});
    }
  }
  if(!candidates.length) return [];
  const db=getRuntimePool();
  const queued=[];
  for(const candidate of candidates){
    const policy=policies.get(candidate.policyKey);
    if(!policy||policy.writebackMode!=='PROPOSE') continue;
    const resolvedSourceKey=await resolveProjectSourceKey(project.id,policy.sourceKey,db);
    const payloadHash=sha256(JSON.stringify(candidate.payload));
    const idempotencyKey=`${sessionId}:${stage.stageKey}:${candidate.policyKey}:${payloadHash}`;
    const id=randomUUID();
    await db.execute(
      `INSERT INTO knowledge_writeback_queue
        (id,tenant_id,workspace_id,project_id,run_id,task_id,project_stage_instance_id,
         knowledge_policy_id,source_key,target_path,status,payload_json,content_sha256,
         expected_source_version,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING',?,?,?,?)
       ON DUPLICATE KEY UPDATE id=id`,
      [
        id,project.tenantId,project.workspaceId,project.id,runId,taskId,stageInstance.id,
        policy.id,resolvedSourceKey,policy.writebackTargetPath||null,asJson(candidate.payload),
        payloadHash,candidate.expectedSourceVersion||null,idempotencyKey
      ]
    );
    const [rows]=await db.execute(
      'SELECT * FROM knowledge_writeback_queue WHERE idempotency_key=? LIMIT 1',[idempotencyKey]
    );
    queued.push({
      id:rows[0].id,policyKey:policy.policyKey,sourceKey:resolvedSourceKey,sourceBindingKey:policy.sourceKey,
      targetPath:policy.writebackTargetPath||null,status:rows[0].status,
      contentSha256:rows[0].content_sha256,requirementKey:candidate.requirementKey
    });
  }
  return queued;
};

export const decideKnowledgeWriteback=async(writebackId,input={})=>{
  const action=String(input.action||'').toUpperCase();
  if(!['APPLY','REJECT','FAIL'].includes(action)) throw errorOf(
    'action must be APPLY, REJECT or FAIL','INVALID_KNOWLEDGE_WRITEBACK_DECISION'
  );
  const db=getRuntimePool();
  const [rows]=await db.execute(
    'SELECT * FROM knowledge_writeback_queue WHERE id=?',[writebackId]
  );
  if(!rows.length) throw errorOf('Knowledge writeback not found','KNOWLEDGE_WRITEBACK_NOT_FOUND',404);
  if(rows[0].status!=='PENDING') throw errorOf(
    'Knowledge writeback is already terminal','KNOWLEDGE_WRITEBACK_ALREADY_DECIDED',409,
    {status:rows[0].status}
  );
  if(action==='APPLY'&&!input.externalWriteId) throw errorOf(
    'APPLY requires externalWriteId from the target connector','KNOWLEDGE_WRITEBACK_EXTERNAL_CONFIRMATION_REQUIRED',409
  );
  const status=action==='APPLY'?'APPLIED':action==='REJECT'?'REJECTED':'FAILED';
  await db.execute(
    `UPDATE knowledge_writeback_queue SET status=?,external_write_id=?,
      applied_source_version=?,decision_json=?,decided_at=CURRENT_TIMESTAMP(6),
      applied_at=CASE WHEN ?='APPLIED' THEN CURRENT_TIMESTAMP(6) ELSE NULL END
      WHERE id=?`,
    [
      status,input.externalWriteId||null,input.appliedSourceVersion||null,
      asJson(input.decision||null),status,writebackId
    ]
  );
  return getKnowledgeWriteback(writebackId);
};

export const getKnowledgeWriteback=async writebackId=>{
  const db=getRuntimePool();
  const [rows]=await db.execute(
    `SELECT q.*,p.policy_key FROM knowledge_writeback_queue q
      JOIN stage_knowledge_policies p ON p.id=q.knowledge_policy_id WHERE q.id=?`,
    [writebackId]
  );
  if(!rows.length) throw errorOf('Knowledge writeback not found','KNOWLEDGE_WRITEBACK_NOT_FOUND',404);
  const row=rows[0];
  return {
    id:row.id,projectId:row.project_id,runId:row.run_id,taskId:row.task_id||null,
    projectStageInstanceId:row.project_stage_instance_id,policyKey:row.policy_key,
    sourceKey:row.source_key,targetPath:row.target_path||null,status:row.status,
    payload:parseJson(row.payload_json),contentSha256:row.content_sha256,
    expectedSourceVersion:row.expected_source_version||null,
    appliedSourceVersion:row.applied_source_version||null,
    externalWriteId:row.external_write_id||null,decision:parseJson(row.decision_json),
    createdAt:row.created_at,decidedAt:row.decided_at||null,appliedAt:row.applied_at||null
  };
};

export const listKnowledgeWritebacks=async({projectId,status=null,limit=100}={})=>{
  if(!projectId) throw errorOf('projectId is required','INVALID_KNOWLEDGE_WRITEBACK_QUERY');
  const db=getRuntimePool();
  const safeLimit=Math.max(1,Math.min(500,Number(limit)||100));
  const [rows]=status
    ? await db.execute(
        `SELECT id FROM knowledge_writeback_queue WHERE project_id=? AND status=?
          ORDER BY created_at DESC LIMIT ${safeLimit}`,[projectId,status]
      )
    : await db.execute(
        `SELECT id FROM knowledge_writeback_queue WHERE project_id=?
          ORDER BY created_at DESC LIMIT ${safeLimit}`,[projectId]
      );
  return Promise.all(rows.map(row=>getKnowledgeWriteback(row.id)));
};
