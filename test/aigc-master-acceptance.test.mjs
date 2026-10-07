import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5005';
const platformToken=must('RUNTIME_API_TOKEN');
const request=async(method,path,body)=>{
  const response=await fetch(baseUrl+path,{
    method,
    headers:{'content-type':'application/json',authorization:`Bearer ${platformToken}`},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,body:payload};
};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const [[project]]=await db.execute(
  `SELECT p.id,p.project_key,p.name
     FROM projects p
     JOIN aigc_m2811_gate_evaluations g ON g.project_id=p.id
    WHERE p.project_type='AIGC_CONTENT' AND g.gate_key='G-AIGC-EDIT' AND g.status='PASS'
    ORDER BY g.as_of DESC,g.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.11 PASS project is required');
const projectId=project.id;

const [[timeline]]=await db.execute(
  "SELECT * FROM aigc_timeline_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
assert.ok(timeline);

const [[editMaster]]=await db.execute(
  `SELECT * FROM aigc_render_exports
    WHERE project_id=? AND timeline_version_id=? AND export_type='EDIT_MASTER' AND status='PASS'
    ORDER BY export_version_no DESC,created_at DESC LIMIT 1`,
  [projectId,timeline.id]
);
assert.ok(editMaster);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_MASTER_VERSION,'母版版本');
assert.equal(modules.AIGC_CREATIVE_ACCEPTANCE,'创作验收');
assert.equal(modules.AIGC_MASTER_QA,'生产与技术质量验收');
assert.equal(modules.AIGC_COMPLIANCE_ACCEPTANCE,'权利、合规与本地化验收');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
for(const [key,label] of Object.entries({
  'G-AIGC-CREATIVE-ACCEPTANCE':'创作验收门禁',
  'G-AIGC-PRODUCTION-QA':'生产质量门禁',
  'G-AIGC-TECHNICAL-QA':'技术质量门禁',
  'G-AIGC-COMPLIANCE':'权利与合规门禁',
  'G-AIGC-LOCALIZATION-QA':'本地化质量门禁',
  'G-AIGC-MASTER':'母版综合门禁'
})){
  assert.equal(r.body.data.find(x=>x.stableKey===key).displayName,label);
}

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-master-versions`,{
  masterKey:'M2812-MASTER-V1',versionNo:1,title:'M28.12 Acceptance Master V1',
  timelineVersionId:timeline.id,sourceExportId:editMaster.id,
  contentLocator:{provider:'CI_TEST',ref:'ci://m2812/master/v1'},
  sourceFingerprintSha256:editMaster.source_fingerprint_sha256,
  masterSpec:{
    resolution:'1998x1080',fps:24,codec:'H.264',aspect:'1.85:1',
    durationMs:Number(timeline.duration_ms),audio:'48kHz',exportProfile:'EDIT_MASTER'
  },
  localizationEnabled:false,localizationScope:{enabled:false,targets:[]},
  evidence:{source:'M28.11 current locked timeline + PASS EDIT_MASTER'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const masterV1=r.body.data.id;
assert.equal(r.body.data.status,'CANDIDATE');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-MASTER/evaluate`,{
  masterVersionId:masterV1,asOf:'2026-10-07T05:10:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCKED');
assert.ok(r.body.data.reasonCodes.some(x=>x.includes('G-AIGC-CREATIVE-ACCEPTANCE')));

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-CREATIVE-ACCEPTANCE/evaluate`,{
  masterVersionId:masterV1,
  checks:{storyFact:'PASS'},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_MASTER_QA_CHECKS_INCOMPLETE');

const creativeChecks={
  storyFact:'PASS',characterRelationship:'PASS',timelineSceneContinuity:'PASS',
  dialoguePropContinuity:'PASS',creativeIntent:'PASS',performanceIntent:'PASS',editIntent:'PASS'
};
const productionChecks={
  identity:'PASS',look:'PASS',expression:'PASS',action:'PASS',anatomy:'PASS',sceneProp:'PASS',
  spatial:'PASS',cameraLightingColor:'PASS',textUiArtifact:'N_A',temporal:'PASS',audio:'PASS',edit:'PASS'
};
const technicalChecks={
  resolution:'PASS',fps:'PASS',codec:'PASS',aspect:'PASS',duration:'PASS',
  fileIntegrity:'PASS',loudness:'PASS',exportSpec:'PASS'
};
const complianceChecks={
  sourceLicense:'PASS',likeness:'PASS',font:'N_A',music:'PASS',brand:'N_A',
  regionalRights:'PASS',aiDisclosure:'PASS',platformRequirements:'PASS',contentCredentials:'N_A'
};
const gate=async(key,checks,extra={})=>{
  const res=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/${encodeURIComponent(key)}/evaluate`,{
    masterVersionId:masterV1,checks,evidence:{test:true,gate:key},...extra
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
  return res.body.data;
};

let g=await gate('G-AIGC-CREATIVE-ACCEPTANCE',creativeChecks,{asOf:'2026-10-07T05:11:00Z'});
assert.equal(g.status,'PASS');

g=await gate('G-AIGC-PRODUCTION-QA',productionChecks,{
  asOf:'2026-10-07T05:11:10Z',
  conditions:[{
    conditionKey:'MIX-FINAL-CHECK',owner:'Audio QA',
    resolutionBefore:'Stage 11 derivation',evidence:{note:'structural conditional-pass test'}
  }]
});
assert.equal(g.status,'CONDITIONAL_PASS');

g=await gate('G-AIGC-TECHNICAL-QA',technicalChecks,{asOf:'2026-10-07T05:11:20Z'});
assert.equal(g.status,'PASS');
g=await gate('G-AIGC-COMPLIANCE',complianceChecks,{asOf:'2026-10-07T05:11:30Z'});
assert.equal(g.status,'PASS');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-LOCALIZATION-QA/evaluate`,{
  masterVersionId:masterV1,checks:{},evidence:{test:true},asOf:'2026-10-07T05:11:40Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'N_A');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-MASTER/evaluate`,{
  masterVersionId:masterV1,asOf:'2026-10-07T05:12:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'CONDITIONAL_PASS',JSON.stringify(r.body));
assert.equal(r.body.data.conditions.length,1);

r=await request('POST',`/api/runtime/aigc-master-versions/${masterV1}/lock`,{
  approval:{status:'APPROVED',approver:'CI Creative Lead'},
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_MASTER_CONDITIONS_ACCEPTANCE_REQUIRED');

g=await gate('G-AIGC-PRODUCTION-QA',productionChecks,{asOf:'2026-10-07T05:13:00Z'});
assert.equal(g.status,'PASS');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-MASTER/evaluate`,{
  masterVersionId:masterV1,asOf:'2026-10-07T05:13:10Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.conditions.length,0);

r=await request('POST',`/api/runtime/aigc-master-versions/${masterV1}/lock`,{
  approval:{status:'APPROVED',approver:'CI Creative Lead'},
  evidence:{test:true,decision:'final master approved'}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'LOCKED');
assert.equal(r.body.data.isCurrent,true);
assert.equal(r.body.data.gateStatus,'PASS');

r=await request('POST',`/api/runtime/aigc-master-versions/${masterV1}/lock`,{
  approval:{status:'APPROVED',approver:'CI Creative Lead'},
  evidence:{test:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.idempotent,true);

// V2 enables localization: aggregate must require the independent localization sub-gate.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-master-versions`,{
  masterKey:'M2812-MASTER-V2-LOC',versionNo:2,title:'M28.12 Acceptance Master V2 Localization Candidate',
  timelineVersionId:timeline.id,sourceExportId:editMaster.id,parentMasterVersionId:masterV1,
  changeRef:{status:'APPROVED',reference:'DECISION:M2812:LOCALIZATION_ENABLE'},
  contentLocator:{provider:'CI_TEST',ref:'ci://m2812/master/v2-localized'},
  sourceFingerprintSha256:editMaster.source_fingerprint_sha256,
  masterSpec:{
    resolution:'1998x1080',fps:24,codec:'H.264',aspect:'1.85:1',
    durationMs:Number(timeline.duration_ms),audio:'48kHz',exportProfile:'EDIT_MASTER'
  },
  localizationEnabled:true,
  localizationScope:{enabled:true,targets:['en-US'],mode:'SUBTITLE'},
  evidence:{source:'localization QA structural validation'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const masterV2=r.body.data.id;

const gateV2=async(key,checks,asOf)=>{
  const res=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/${encodeURIComponent(key)}/evaluate`,{
    masterVersionId:masterV2,checks,evidence:{test:true,gate:key},asOf
  });
  assert.equal(res.status,200,JSON.stringify(res.body));
  return res.body.data;
};
assert.equal((await gateV2('G-AIGC-CREATIVE-ACCEPTANCE',creativeChecks,'2026-10-07T05:14:00Z')).status,'PASS');
assert.equal((await gateV2('G-AIGC-PRODUCTION-QA',productionChecks,'2026-10-07T05:14:10Z')).status,'PASS');
assert.equal((await gateV2('G-AIGC-TECHNICAL-QA',technicalChecks,'2026-10-07T05:14:20Z')).status,'PASS');
assert.equal((await gateV2('G-AIGC-COMPLIANCE',complianceChecks,'2026-10-07T05:14:30Z')).status,'PASS');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-MASTER/evaluate`,{
  masterVersionId:masterV2,asOf:'2026-10-07T05:14:40Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCKED');
assert.ok(r.body.data.reasonCodes.includes(
  'AIGC_MASTER_REQUIRED_GATE_MISSING:G-AIGC-LOCALIZATION-QA'
));

const localizationChecks={
  translation:'PASS',culturalMeaning:'PASS',subtitleLength:'PASS',
  dub:'N_A',sync:'N_A',localPlatformSpec:'PASS'
};
assert.equal((await gateV2('G-AIGC-LOCALIZATION-QA',localizationChecks,'2026-10-07T05:15:00Z')).status,'PASS');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-MASTER/evaluate`,{
  masterVersionId:masterV2,asOf:'2026-10-07T05:15:10Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-mastering`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.aggregateGateName,'母版综合门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,
  ['母版版本','创作验收','生产与技术质量验收','权利、合规与本地化验收']);
assert.equal(r.body.data.masters.length,2);
const stateV1=r.body.data.masters.find(x=>x.id===masterV1);
const stateV2=r.body.data.masters.find(x=>x.id===masterV2);
assert.equal(stateV1.status,'LOCKED');
assert.equal(stateV1.isCurrent,true);
assert.equal(stateV2.status,'CANDIDATE');
assert.equal(stateV2.localizationEnabled,true);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_master_versions WHERE project_id=?) master_count,
    (SELECT COUNT(*) FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE) current_locked,
    (SELECT COUNT(*) FROM aigc_master_gate_evaluations WHERE master_version_id=? AND gate_key='G-AIGC-MASTER' AND status='PASS') v1_master_pass,
    (SELECT COUNT(*) FROM aigc_master_gate_evaluations WHERE master_version_id=? AND gate_key='G-AIGC-MASTER' AND status='CONDITIONAL_PASS') v1_conditional,
    (SELECT COUNT(*) FROM aigc_master_gate_evaluations WHERE master_version_id=? AND gate_key='G-AIGC-LOCALIZATION-QA' AND status='PASS') v2_loc_pass`,
  [projectId,projectId,masterV1,masterV1,masterV2]
);
assert.equal(Number(truth.master_count),2);
assert.equal(Number(truth.current_locked),1);
assert.equal(Number(truth.v1_master_pass),1);
assert.equal(Number(truth.v1_conditional),1);
assert.equal(Number(truth.v2_loc_pass),1);

await db.end();
console.log('M28_12_AIGC_MASTER_ACCEPTANCE_PASS');
