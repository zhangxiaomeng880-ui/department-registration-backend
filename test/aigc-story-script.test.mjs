import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:4800';
const platformToken=process.env.RUNTIME_API_TOKEN||'m282-platform-token';
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const suffix=randomUUID().slice(0,8);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const moduleNames=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(moduleNames.AIGC_STORY_KNOWLEDGE,'故事知识库');
assert.equal(moduleNames.AIGC_SCRIPT_VERSION,'剧本版本');
assert.equal(moduleNames.AIGC_SCRIPT_LOCK_CHANGE,'剧本锁定与变更');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-SCRIPT').displayName,'剧本锁定门禁');
assert.equal(r.body.data.find(x=>x.labelType==='KNOWLEDGE_STATUS'&&x.stableKey==='FACT').displayName,'事实');

// M28.1 has already compiled the standard AIGC workflow in the full regression chain.
const planKey=`M282_PLAN_${suffix}`;
r=await request('POST','/api/runtime/plans',{planKey,name:'M28.2 验证计划'});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/plan-entitlements',{planKey,entitlementKey:'MODEL_EXECUTION',enabled:true});
assert.equal(r.status,201,JSON.stringify(r.body));
r=await request('POST','/api/runtime/tenants',{tenantKey:`m282-${suffix}`,name:'M28.2 租户',planKey});
assert.equal(r.status,201,JSON.stringify(r.body));
const tenantId=r.body.data.id;
r=await request('POST','/api/runtime/workspaces',{tenantId,workspaceKey:'main',name:'主工作区'});
assert.equal(r.status,201,JSON.stringify(r.body));
const workspaceId=r.body.data.id;

r=await request('POST','/api/runtime/projects',{
  workspaceId,projectKey:`m282-xia-${suffix}`,name:'你好，那年夏天',
  projectType:'AIGC_CONTENT',projectSubtypeKey:'SHORT_DRAMA',
  domainPresetKey:'AIGC_CONTENT_STANDARD'
});
assert.equal(r.status,201,JSON.stringify(r.body));
const projectId=r.body.data.id;
assert.equal(r.body.data.lifecycle.stages.length,15);
assert.equal(r.body.data.lifecycle.stages[3].displayName,'故事 / 剧本 / 结构');

// M28.1 prerequisites: initialization -> discovery -> production planning.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-initializations`,{
  initializationKey:'LX-M282-INIT',workTitle:'你好，那年夏天',
  targetAudience:{primary:'中文情感叙事受众'},
  roles:{owner:'作者 / 产品负责人',creativeLead:'创作负责人',productionLead:'AIGC 制作负责人',reviewer:'最终审核人'},
  knowledgeSources:[
    {provider:'CHATGPT_LIBRARY',scope:'/你好那年夏天/',role:'PROJECT_CURRENT'},
    {provider:'CHATGPT_LIBRARY',scope:'/你好那年夏天/剧本/',role:'STORY_KNOWLEDGE'}
  ],
  assetStorage:{projectLibrary:'/你好那年夏天/视觉素材/'},
  capabilityEnvironment:{models:['GPT'],tools:['Image Generation','Runway'],connections:['ChatGPT Library'],credentialBoundary:'平台连接'},
  budgetGuardrail:{currency:'CNY',maxSpend:5000},
  timelineStrategy:{milestones:'AG-M0..AG-M9'},
  rightsBoundary:{copyright:'原创',likeness:'虚构角色',music:'原创/授权',font:'授权',brand:'需确认',aiDisclosure:'按平台要求'},
  formatDelivery:{masterFormat:{aspect:'1.85:1'},workingFormat:{type:'可重建'},deliveryFormats:['电影版','剧集版','切片']},
  backupArchive:{backup:'持续备份',export:'最终母版',archive:'版本冻结'},
  evidence:{source:'《你好，那年夏天》CURRENT 基线'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-market-benchmarks`,{
  benchmarkKey:'LX-M282-MARKET',platform:'多平台',marketRegion:'中国大陆 / 海外候选',
  categoryFormat:'情感叙事',workCreatorAccount:{scope:'同类内容'},
  publishDate:'2026-10-01',snapshotDate:'2026-10-07',freshUntil:'2026-11-07',
  observablePerformance:{dimensions:['播放','互动','完播']},releaseCadence:{mode:'完整版+切片'},
  audiencePositioning:{audience:'真实感情与成长叙事受众'},structureHook:{principle:'真实关系细节'},
  sourceEvidence:{asOf:'2026-10-07'},insight:{statement:'创作母体优先'},limitation:{statement:'表现随时间变化'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const marketId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-creative-references`,{
  referenceKey:'LX-M282-REF',source:{description:'生活质感与真实情感叙事参考'},
  rightsStatus:'LIMITED',referenceRoles:['STYLE','PERFORMANCE','EDITING_RHYTHM'],
  allowedUsage:{scope:'抽象风格研究'},forbiddenCopying:{rules:['不得复制具体镜头/对白/角色']},
  attributionProvenance:{recorded:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const refId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-model-tool-benchmarks`,{
  benchmarkKey:'LX-M282-MODEL',provider:'多提供商评测',modelTool:'图像 / 视频生成工具组合',
  modelToolVersion:'2026-10-07-current',capability:{identityConsistency:true},
  supportedReferenceTypes:['IDENTITY','LOOK','SCENE','MOTION'],outputLimits:{duration:'镜头级分段'},
  controllability:{identity:'母版锁定'},apiBatchQueue:{batch:true,queue:true},
  costLatencyReliability:{cost:'按 Job 记录',latency:'实测',reliability:'版本化评测'},
  rightsTermsDisclosure:{reviewed:true},evalDate:'2026-10-07',freshUntil:'2026-11-07',
  evidence:{source:'M28.2 capability snapshot'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const modelId=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-creative-hypotheses`,{
  hypothesisKey:'LX-M282-HYP',hypothesisType:'FORMAT',
  statement:'保持 Story Fact 不变，电影母版优先并派生剧集与平台切片',
  benchmarkIds:[marketId],creativeReferenceIds:[refId],modelToolBenchmarkIds:[modelId],
  unknowns:['平台切片长度后续验证'],confidence:'MEDIUM',storyFactMutation:false,
  decision:{status:'APPROVED'},evidence:{source:'M28.2'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-production-plans`,{
  planKey:'LX-M282-PLAN',
  projectHierarchy:{project:'你好，那年夏天',version:'CURRENT',unit:'电影 / 剧集 / 切片',scene:'001—071',shot:'镜头级'},
  milestoneKeys:['AG-M0','AG-M1','AG-M2','AG-M3','AG-M4','AG-M5','AG-M6','AG-M7','AG-M8','AG-M9'],
  workBreakdown:{stages:['故事','资产','图像','视频音频','剪辑','母版','分发','表现','复盘']},
  productionOrder:{principle:'已 PASS 上游不重跑'},dependency:{critical:['Script→Shot→Asset→Generation→Timeline→Master']},
  assetCoveragePlan:{source:'001—071 全剧资产覆盖矩阵'},modelToolStrategy:{router:'按能力/质量/成本/时延'},
  budgetAllocation:{currency:'CNY',total:5000,byStage:{script:0,asset:1000,image:1000,video:2500,audio:500}},
  batchQueueConcurrency:{batch:true,queue:true},humanReviewPoints:{required:['Script Lock','Master QA']},
  versionStrategy:{master:'电影母版优先',derivatives:['剧集版','切片'],history:'历史不可覆盖'},
  localizationCandidates:{status:'CANDIDATE',markets:['中文主版本','海外候选']},evidence:{source:'M28.2'}
});
assert.equal(r.status,201,JSON.stringify(r.body));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PLAN/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));

// Story Knowledge must explicitly classify formal knowledge.
const storyEntries=[
  ['WORLD-001','WORLD','RULE','世界与时代规则',{setting:'2022—2026 北京 / 深圳现实都市，不做虚构反转'},true],
  ['CHAR-LX','CHARACTER','FACT','林夏',{age:25,role:'北漂产品经理',cat:'岁岁'},true],
  ['CHAR-CM','CHARACTER','FACT','陈默',{age:30,traits:['逃避型','完美主义']},true],
  ['REL-LX-CM','RELATIONSHIP','FACT','林夏与陈默关系',{type:'恋爱关系',principle:'多年后仍可能相爱，但隔阂会循环'},true],
  ['TIMELINE-MAIN','TIMELINE','FACT','主时间线',{start:'2022',firstBreakup:'2024夏',shenzhen:'2024',returnBeijing:'2026'},true],
  ['BEAT-MAIN','BEAT','CURRENT','主要剧情节拍',{range:'001—071',middle:['失业互助','父亲去世','借条翻包','521蓝港','新工作']},false],
  ['SCENE-INDEX','SCENE','CURRENT','场景索引',{sceneStart:1,sceneEnd:71,sceneCount:71},true],
  ['DIALOGUE-RULE','DIALOGUE','RULE','对白规则',{style:'自然、克制，不用降智强误会'},true],
  ['THEME-MAIN','THEME','RULE','主题',{statement:'回去面对不等于复合成功'},true],
  ['NATURAL-UNIT','NATURAL_UNIT','CURRENT','自然单元',{principle:'自然单元先于固定集数'},true],
  ['SPOILER-RULE','SPOILER','RULE','剧透规则',{ending:'开放式结局，071不给观众难过的镜头'},true],
  ['CULTURE-DEP','CULTURAL_DEPENDENCY','CURRENT','文化依赖',{items:['北京城市生活','除夕','家庭关系']},false]
];
for(const [key,category,status,title,data,critical] of storyEntries){
  r=await request('POST',`/api/runtime/projects/${projectId}/aigc-story-knowledge`,{
    knowledgeKey:key,category,knowledgeStatus:status,title,content:data,
    scope:{project:'你好，那年夏天'},sourceRef:{source:'CURRENT 项目基线'},
    gateCritical:critical,immutable:['FACT','RULE'].includes(status),evidence:{verified:true}
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
}

// Gate is HOLD until a script version is actually locked.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-SCRIPT/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_CURRENT_LOCKED_SCRIPT_REQUIRED'));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-script-versions`,{
  versionKey:'LX-SCRIPT-V1',versionNo:1,title:'《你好，那年夏天》001—071 母剧本',
  scriptFormat:'SCREENPLAY',sourceLocator:{libraryPath:'/你好那年夏天/剧本/',baseline:'001—071 CURRENT'},
  sceneStart:1,sceneEnd:71,sceneCount:71,
  naturalUnits:{source:'自然拆集 V0.4 / 19 候选集'},structure:{type:'Narrative',ending:'开放式'},
  contentSha256:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  evidence:{qa:'001—071 可拍摄性终检 PASS'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const v1=r.body.data.id;

r=await request('POST',`/api/runtime/aigc-script-versions/${v1}/lock`,{
  lockKey:'LX-SCRIPT-LOCK-V1',
  continuityQa:{character:'PASS',relationship:'PASS',timeline:'PASS',fact:'PASS',naturalUnit:'PASS'},
  approval:{status:'APPROVED',approver:'作者 / 最终审核人'},
  evidence:{source:'001—071 全量冷读 / QA PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
const v1Lock=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-SCRIPT/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.sceneRange.count,71);

// Silent post-lock revision is forbidden.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-script-versions`,{
  versionKey:'LX-SCRIPT-V2',versionNo:2,title:'《你好，那年夏天》001—071 母剧本 V2',
  scriptFormat:'SCREENPLAY',sourceLocator:{libraryPath:'/你好那年夏天/剧本/',baseline:'V2'},
  sceneStart:1,sceneEnd:71,sceneCount:71,naturalUnits:{count:19},structure:{type:'Narrative'},
  contentSha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  evidence:{reason:'测试静默改版拦截'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_SCRIPT_CHANGE_REQUEST_REQUIRED');

// Incomplete impact analysis is also forbidden.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-script-change-requests`,{
  changeKey:'LX-CR-BAD',fromScriptVersionId:v1,proposedVersionKey:'LX-SCRIPT-V2',
  reason:'测试缺失影响域',before:{version:'V1'},after:{version:'V2'},
  impacts:{
    SCENE:{disposition:'AFFECTED',affectedObjects:['SC055'],rationale:'场景内容调整',revalidation:{required:true}}
  },
  approval:{status:'APPROVED',approver:'作者'},evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_SCRIPT_CHANGE_IMPACT_INCOMPLETE');

const impacts={
  SCENE:{disposition:'AFFECTED',affectedObjects:['SC055'],rationale:'对白与冲突节奏调整',revalidation:{required:true,gate:'G-AIGC-SCRIPT'}},
  SHOT:{disposition:'AFFECTED',affectedObjects:['SC055_SHOTS'],rationale:'后续镜头拆解需重算',revalidation:{required:true,gate:'G-AIGC-BREAKDOWN'}},
  ASSET:{disposition:'N_A',affectedObjects:[],rationale:'不改变人物/造型/场景母版',revalidation:{required:false}},
  AUDIO:{disposition:'AFFECTED',affectedObjects:['SC055_DIALOGUE'],rationale:'对白音频需随新剧本重建',revalidation:{required:true,gate:'G-AIGC-PRODUCTION'}},
  DISTRIBUTION:{disposition:'N_A',affectedObjects:[],rationale:'不改变母体发行结构',revalidation:{required:false}}
};
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-script-change-requests`,{
  changeKey:'LX-CR-001',fromScriptVersionId:v1,proposedVersionKey:'LX-SCRIPT-V2',
  reason:'SC055 对白与冲突节奏精修',
  before:{scriptVersion:'LX-SCRIPT-V1',scene:'SC055'},after:{scriptVersion:'LX-SCRIPT-V2',scene:'SC055 精修'},
  impacts,approval:{status:'APPROVED',approver:'作者 / 最终审核人'},
  evidence:{decision:'允许修改，但不得改变既有硬事实'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const crId=r.body.data.id;
const projectChangeId=r.body.data.projectChangeId;

// Approved but unapplied change makes Script Gate HOLD.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-SCRIPT/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_APPROVED_SCRIPT_CHANGE_PENDING'));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-script-versions`,{
  versionKey:'LX-SCRIPT-V2',versionNo:2,title:'《你好，那年夏天》001—071 母剧本 V2',
  scriptFormat:'SCREENPLAY',sourceLocator:{libraryPath:'/你好那年夏天/剧本/',baseline:'V2'},
  sceneStart:1,sceneEnd:71,sceneCount:71,naturalUnits:{source:'自然拆集 V0.4',count:19},
  structure:{type:'Narrative',changeScope:['SC055']},
  contentSha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  changeRequestId:crId,evidence:{changeRequest:'LX-CR-001'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const v2=r.body.data.id;
assert.equal(r.body.data.parentScriptVersionId,v1);
assert.equal(r.body.data.changeRequestId,crId);

r=await request('POST',`/api/runtime/aigc-script-versions/${v2}/lock`,{
  lockKey:'LX-SCRIPT-LOCK-V2',
  continuityQa:{character:'PASS',relationship:'PASS',timeline:'PASS',fact:'PASS',naturalUnit:'PASS'},
  approval:{status:'APPROVED',approver:'作者 / 最终审核人'},
  evidence:{changeRequest:'LX-CR-001',qa:'针对性精修后连续性 QA PASS'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
const v2Lock=r.body.data.id;

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-SCRIPT/evaluate`,{asOf:'2026-10-07T02:00:00Z'});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.currentScriptVersionId,v2);
assert.deepEqual(r.body.data.evidenceSnapshot.pendingApprovedChangeIds,[]);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-script-domain`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'剧本锁定门禁');
assert.equal(r.body.data.storyKnowledge.length,12);
assert.equal(r.body.data.scriptVersions.length,2);
assert.equal(r.body.data.locks.length,2);
assert.equal(r.body.data.changeRequests.length,1);
assert.equal(r.body.data.impacts.length,5);
const sv1=r.body.data.scriptVersions.find(x=>x.id===v1);
const sv2=r.body.data.scriptVersions.find(x=>x.id===v2);
assert.equal(sv1.status,'HISTORICAL');
assert.equal(sv1.isCurrent,false);
assert.equal(sv2.status,'LOCKED');
assert.equal(sv2.isCurrent,true);
assert.equal(r.body.data.changeRequests[0].status,'APPLIED');
assert.equal(r.body.data.changeRequests[0].projectChangeId,projectChangeId);
assert.equal(r.body.data.changeRequests[0].appliedScriptVersionId,v2);
assert.ok(r.body.data.locks.some(x=>x.id===v1Lock));
assert.ok(r.body.data.locks.some(x=>x.id===v2Lock));

const db=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  database:process.env.DB_NAME||'ai_native_runtime',user:process.env.DB_USER||'ai_native_runtime',
  password:process.env.DB_PASSWORD||'ci'
});
const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM project_changes WHERE id=? AND project_id=?) generic_change,
    (SELECT COUNT(*) FROM aigc_script_change_impacts WHERE script_change_request_id=?) impact_count,
    (SELECT COUNT(*) FROM aigc_trace_links WHERE project_id=? AND target_type='SCRIPT_VERSION' AND target_id=? AND link_type='LOCKS_INTO') story_to_v2,
    (SELECT COUNT(*) FROM aigc_script_versions WHERE project_id=? AND is_current=TRUE AND status='LOCKED') current_locked`,
  [projectChangeId,projectId,crId,projectId,v2,projectId]
);
assert.equal(Number(truth.generic_change),1);
assert.equal(Number(truth.impact_count),5);
assert.equal(Number(truth.story_to_v2),12);
assert.equal(Number(truth.current_locked),1);
await db.end();

console.log('M28_2_AIGC_STORY_SCRIPT_LOCK_PASS');
