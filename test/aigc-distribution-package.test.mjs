import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5006';
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
     JOIN aigc_master_versions m ON m.project_id=p.id
    WHERE p.project_type='AIGC_CONTENT' AND m.status='LOCKED' AND m.is_current=TRUE
    ORDER BY m.version_no DESC,m.created_at DESC LIMIT 1`
);
assert.ok(project,'M28.12 current locked Master project is required');
const projectId=project.id;

const [[master]]=await db.execute(
  "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='LOCKED' AND is_current=TRUE ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
assert.ok(master);

const [[candidateMaster]]=await db.execute(
  "SELECT * FROM aigc_master_versions WHERE project_id=? AND status='CANDIDATE' ORDER BY version_no DESC LIMIT 1",
  [projectId]
);
assert.ok(candidateMaster);

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_DERIVATION_VERSION,'内容衍生版本');
assert.equal(modules.AIGC_LOCALIZATION_VARIANT,'本地化版本');
assert.equal(modules.AIGC_DISTRIBUTION_PACKAGE,'发行素材包');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-DISTRIBUTION-PACKAGE').displayName,'发行素材包门禁');
assert.equal(r.body.data.find(x=>x.labelType==='LOCALIZATION_LEVEL'&&x.stableKey==='SUBTITLE').displayName,'字幕本地化');

const qaPass=(localized=false)=>({
  sourceLineage:'PASS',motherAssetBinding:'PASS',spoilerRisk:'PASS',targetFit:'PASS',
  platformSpec:'PASS',formatSpec:'PASS',localization:localized?'PASS':'N_A',
  cta:'PASS',rightsCompliance:'PASS',technicalIntegrity:'PASS'
});
const baseInput=(key,type,versionNo=1)=>({
  distributionKey:key,versionNo,derivationType:type,masterVersionId:master.id,
  motherAsset:{masterVersionId:master.id,sourceExportId:master.source_export_id},
  spoilerRisk:type==='FULL_MASTER'?'NONE':'LOW',
  target:{audience:'general',goal:'distribution-ready derivative'},
  platform:{channel:'BILIBILI',region:'CN',language:'zh-CN'},
  format:{aspect:'16:9',resolution:'1920x1080',container:'mp4'},
  localizationLevel:'NONE',localization:{enabled:false,language:'zh-CN'},
  cta:{mode:'NONE'},qa:qaPass(false),
  rights:{status:'APPROVED',scope:'PROJECT_DISTRIBUTION'},
  contentLocator:{provider:'CI_TEST',ref:`ci://m2813/${key}/v${versionNo}`},
  evidence:{source:'M28.13 structural derivation validation'}
});

// Candidate/non-current Master must never become a distribution source.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-distribution-versions`,{
  ...baseInput('STALE-MASTER','TRAILER'),
  masterVersionId:candidateMaster.id,
  motherAsset:{masterVersionId:candidateMaster.id,sourceExportId:candidateMaster.source_export_id}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_DISTRIBUTION_CURRENT_MASTER_REQUIRED');

// Incomplete localized QA is rejected before persistence.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-distribution-versions`,{
  ...baseInput('LOC-BAD','HOOK'),
  localizationLevel:'SUBTITLE',
  localization:{enabled:true,language:'en-US',subtitleFormat:'SRT'},
  qa:{...qaPass(false),localization:'N_A'}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_DISTRIBUTION_LOCALIZATION_QA_REQUIRED');

// A QA-failed derivative is retained as BLOCKED evidence rather than overwritten.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-distribution-versions`,{
  ...baseInput('TRAILER-BLOCKED','TRAILER'),
  qa:{...qaPass(false),technicalIntegrity:'FAIL'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'BLOCKED');

const created=[];
for(const spec of [
  {key:'FULL-MASTER',type:'FULL_MASTER'},
  {key:'TRAILER',type:'TRAILER'},
  {key:'HOOK',type:'HOOK'},
  {key:'CHARACTER-POV-EN',type:'CHARACTER_POV',localized:true}
]){
  const body=baseInput(spec.key,spec.type);
  if(spec.localized){
    body.platform={channel:'YOUTUBE',region:'US',language:'en-US'};
    body.localizationLevel='SUBTITLE';
    body.localization={enabled:true,language:'en-US',mode:'SUBTITLE',subtitleFormat:'SRT'};
    body.qa=qaPass(true);
  }
  r=await request('POST',`/api/runtime/projects/${projectId}/aigc-distribution-versions`,body);
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.data.status,'READY');
  created.push(r.body.data.id);
}
assert.equal(created.length,4);

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-distribution-packages`,{
  packageKey:'M2813-DISTRIBUTION-PACKAGE',versionNo:1,title:'M28.13 Distribution Package',
  masterVersionId:master.id,distributionVersionIds:created,
  packageIntent:{goal:'Stage 12 release planning handoff',markets:['CN','US'],externalSideEffect:false},
  evidence:{source:'M28.13 derivation package assembly'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const packageId=r.body.data.id;
assert.equal(r.body.data.itemCount,4);
assert.equal(r.body.data.status,'CANDIDATE');

r=await request('POST',`/api/runtime/aigc-distribution-packages/${packageId}/freeze`,{
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'G_AIGC_DISTRIBUTION_PACKAGE_REQUIRED');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-DISTRIBUTION-PACKAGE/evaluate`,{
  packageId,asOf:'2026-10-07T05:30:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.itemCount,4);
assert.equal(r.body.data.evidenceSnapshot.requiredItemCount,4);
assert.equal(r.body.data.evidenceSnapshot.readyRequiredCount,4);
assert.equal(r.body.data.evidenceSnapshot.blockedVersionIds.length,0);
assert.equal(r.body.data.evidenceSnapshot.lineageInvalidVersionIds.length,0);
assert.equal(r.body.data.evidenceSnapshot.qaInvalidVersionIds.length,0);
assert.ok(r.body.data.evidenceSnapshot.derivationTypes.includes('FULL_MASTER'));
assert.ok(r.body.data.evidenceSnapshot.derivationTypes.includes('CHARACTER_POV'));
assert.ok(r.body.data.evidenceSnapshot.localizationLevels.includes('SUBTITLE'));
assert.equal(r.body.data.evidenceSnapshot.readyForReleasePlanning,true);

r=await request('POST',`/api/runtime/aigc-distribution-packages/${packageId}/freeze`,{
  approval:{mode:'GATE_AUTO_FREEZE',stage:'AIGC_11_DERIVATION'},
  evidence:{test:true,externalSideEffect:false}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.isCurrent,true);

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-distribution-package`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'发行素材包门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,['内容衍生版本','本地化版本','发行素材包']);
assert.equal(r.body.data.versions.filter(x=>x.status==='READY').length,4);
assert.equal(r.body.data.versions.filter(x=>x.status==='BLOCKED').length,1);
assert.equal(r.body.data.packages.length,1);
assert.equal(r.body.data.packages[0].status,'FROZEN');
assert.equal(r.body.data.packages[0].isCurrent,true);
assert.equal(r.body.data.packages[0].items.length,4);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_distribution_versions WHERE project_id=? AND status='READY') ready_versions,
    (SELECT COUNT(*) FROM aigc_distribution_versions WHERE project_id=? AND status='BLOCKED') blocked_versions,
    (SELECT COUNT(*) FROM aigc_distribution_packages WHERE project_id=? AND status='FROZEN' AND is_current=TRUE) current_package,
    (SELECT COUNT(*) FROM aigc_m2813_gate_evaluations WHERE project_id=? AND package_id=? AND gate_key='G-AIGC-DISTRIBUTION-PACKAGE' AND status='PASS') gate_pass`,
  [projectId,projectId,projectId,projectId,packageId]
);
assert.equal(Number(truth.ready_versions),4);
assert.equal(Number(truth.blocked_versions),1);
assert.equal(Number(truth.current_package),1);
assert.equal(Number(truth.gate_pass),1);

await db.end();
console.log('M28_13_AIGC_DISTRIBUTION_PACKAGE_PASS');
