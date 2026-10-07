import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{
  const value=process.env[name];
  if(!value)throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl=process.env.RUNTIME_API_BASE_URL||'http://127.0.0.1:5007';
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

const [[pkg]]=await db.execute(
  `SELECT p.* FROM aigc_distribution_packages p
    WHERE p.status='FROZEN' AND p.is_current=TRUE
    ORDER BY p.frozen_at DESC,p.created_at DESC LIMIT 1`
);
assert.ok(pkg,'M28.13 current frozen Distribution Package is required');
const projectId=pkg.project_id;

const [versions]=await db.execute(
  `SELECT v.*
     FROM aigc_distribution_package_items i
     JOIN aigc_content_derivation_versions v ON v.id=i.distribution_version_id
    WHERE i.package_id=? ORDER BY v.distribution_key`,[pkg.id]
);
const versionByKey=new Map(versions.map(x=>[x.distribution_key,x]));
assert.ok(versionByKey.get('FULL-MASTER'));
assert.ok(versionByKey.get('CHARACTER-POV-EN'));

let r=await request('GET','/api/runtime/aigc-modules');
assert.equal(r.status,200,JSON.stringify(r.body));
const modules=Object.fromEntries(r.body.data.map(x=>[x.moduleKey,x.displayName]));
assert.equal(modules.AIGC_CHANNEL_CONNECTION,'渠道 / 账号连接');
assert.equal(modules.AIGC_RELEASE_PLAN,'发布计划 / 内容日历');
assert.equal(modules.AIGC_PUBLICATION_RECORD,'发布记录');
assert.equal(modules.AIGC_POST_PUBLISH_VERIFY,'发布后核验');

r=await request('GET','/api/runtime/aigc-ui-labels');
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.find(x=>x.stableKey==='G-AIGC-PUBLISH').displayName,'发布门禁');
assert.equal(r.body.data.find(x=>x.labelType==='CHANNEL_RISK'&&x.stableKey==='HIGH').displayName,'高风险');

// Credentials must never be stored in channel metadata.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-channel-connections`,{
  connectionKey:'BAD-SECRET',platformKey:'YOUTUBE',accountRef:'channel-test',
  connectionRef:{provider:'TEST',token:'forbidden'},regions:['US'],languages:['en-US'],
  riskLevel:'HIGH',rightsBoundary:{status:'APPROVED'},disclosurePolicy:{status:'READY'},
  status:'CONNECTED',evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_CHANNEL_CREDENTIAL_FORBIDDEN');

const createChannel=async body=>{
  const res=await request('POST',`/api/runtime/projects/${projectId}/aigc-channel-connections`,body);
  assert.equal(res.status,201,JSON.stringify(res.body));
  return res.body.data;
};
const bilibili=await createChannel({
  connectionKey:'BILIBILI-MAIN',platformKey:'BILIBILI',accountRef:'bilibili-main',
  connectionRef:{provider:'STRUCTURAL_TEST',connectionId:'bilibili-ci'},
  regions:['CN'],languages:['zh-CN'],riskLevel:'LOW',
  rightsBoundary:{status:'APPROVED',scope:'CN'},disclosurePolicy:{status:'READY',aiDisclosure:true},
  status:'CONNECTED',evidence:{source:'M28.14 structural channel fixture'}
});
const youtube=await createChannel({
  connectionKey:'YOUTUBE-MAIN',platformKey:'YOUTUBE',accountRef:'youtube-main',
  connectionRef:{provider:'STRUCTURAL_TEST',connectionId:'youtube-ci'},
  regions:['US'],languages:['en-US'],riskLevel:'HIGH',
  rightsBoundary:{status:'APPROVED',scope:'US'},disclosurePolicy:{status:'READY',aiDisclosure:true},
  status:'CONNECTED',evidence:{source:'M28.14 structural channel fixture'}
});
assert.equal(bilibili.riskLevel,'LOW');
assert.equal(youtube.riskLevel,'HIGH');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-release-plans`,{
  planKey:'M2814-RELEASE-PLAN',versionNo:1,title:'M28.14 Release Plan',
  distributionPackageId:pkg.id,
  releaseWindow:{start:'2026-10-08T01:00:00Z',end:'2026-10-10T12:00:00Z'},
  calendar:{timezone:'UTC',policy:'STRUCTURAL_TEST_ONLY_NO_EXTERNAL_PUBLISH'},
  rights:{status:'APPROVED',scope:'PACKAGE'},
  disclosure:{status:'READY',aiDisclosure:true},
  items:[
    {
      itemKey:'BILIBILI-FULL',
      distributionVersionId:versionByKey.get('FULL-MASTER').id,
      channelConnectionId:bilibili.id,platformKey:'BILIBILI',region:'CN',language:'zh-CN',
      scheduledPublishAt:'2026-10-08T02:00:00Z',
      rights:{status:'APPROVED'},disclosure:{status:'READY',aiDisclosure:true},
      evidence:{test:true,externalSideEffect:false}
    },
    {
      itemKey:'YOUTUBE-POV-EN',
      distributionVersionId:versionByKey.get('CHARACTER-POV-EN').id,
      channelConnectionId:youtube.id,platformKey:'YOUTUBE',region:'US',language:'en-US',
      scheduledPublishAt:'2026-10-08T03:00:00Z',
      rights:{status:'APPROVED'},disclosure:{status:'READY',aiDisclosure:true},
      evidence:{test:true,externalSideEffect:false}
    }
  ],
  evidence:{source:'M28.14 structural release plan; no external publishing'}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const plan=r.body.data;
assert.equal(plan.status,'CANDIDATE');
assert.equal(plan.itemCount,2);
const lowItem=plan.items.find(x=>x.riskLevel==='LOW');
const highItem=plan.items.find(x=>x.riskLevel==='HIGH');
assert.ok(lowItem);
assert.ok(highItem);
assert.equal(lowItem.status,'PLANNED');
assert.equal(highItem.status,'APPROVAL_REQUIRED');

// High-risk channel prevents G-AIGC-PUBLISH PASS without explicit Human Gate.
r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PUBLISH/evaluate`,{
  releasePlanId:plan.id,asOf:'2026-10-07T06:00:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'HOLD');
assert.ok(r.body.data.reasonCodes.includes('AIGC_RELEASE_HUMAN_APPROVAL_REQUIRED'));
assert.equal(r.body.data.evidenceSnapshot.highRiskItemCount,1);
assert.equal(r.body.data.evidenceSnapshot.highRiskApprovedCount,0);
assert.equal(r.body.data.evidenceSnapshot.externalPublishExecuted,false);

r=await request('POST',`/api/runtime/aigc-release-plans/${plan.id}/freeze`,{
  evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'G_AIGC_PUBLISH_REQUIRED');

r=await request('POST',`/api/runtime/aigc-release-plan-items/${highItem.id}/approve`,{
  approval:{
    mode:'HUMAN',decision:'APPROVED',approvedByRef:'CI_HUMAN_REVIEW_FIXTURE',
    approvedAt:'2026-10-07T06:01:00Z',scope:'STRUCTURAL_TEST_ONLY'
  },
  evidence:{test:true,noExternalSideEffect:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'APPROVED');
assert.equal(r.body.data.approvalMode,'HUMAN');

r=await request('POST',`/api/runtime/projects/${projectId}/aigc-gates/G-AIGC-PUBLISH/evaluate`,{
  releasePlanId:plan.id,asOf:'2026-10-07T06:02:00Z'
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS',JSON.stringify(r.body));
assert.equal(r.body.data.evidenceSnapshot.highRiskApprovedCount,1);
assert.equal(r.body.data.evidenceSnapshot.readyForExternalPublish,true);
assert.equal(r.body.data.evidenceSnapshot.externalPublishExecuted,false);

r=await request('POST',`/api/runtime/aigc-release-plans/${plan.id}/freeze`,{
  approval:{mode:'GATE_PASS',gate:'G-AIGC-PUBLISH'},
  evidence:{test:true,noExternalSideEffect:true}
});
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.status,'FROZEN');
assert.equal(r.body.data.isCurrent,true);

// Runtime must not accept a direct publish command; it only records receipts from an external executor.
r=await request('POST',`/api/runtime/aigc-release-plan-items/${highItem.id}/publication-receipts`,{
  attemptNo:1,status:'PUBLISHED',executionMode:'DIRECT_PUBLISH',
  externalId:'should-not-write',publishedUrl:'https://example.invalid/should-not-write',
  providerReceipt:{test:true},evidence:{test:true}
});
assert.equal(r.status,409,JSON.stringify(r.body));
assert.equal(r.body.error,'AIGC_PUBLICATION_EXTERNAL_RECEIPT_ONLY');

// Mock receipt only: validates lineage/receipt handling without contacting a real platform.
r=await request('POST',`/api/runtime/aigc-release-plan-items/${highItem.id}/publication-receipts`,{
  attemptNo:1,status:'PUBLISHED',executionMode:'EXTERNAL_RECEIPT',
  externalId:'CI-MOCK-YOUTUBE-001',publishedUrl:'https://example.invalid/ci-mock-youtube-001',
  publishedAt:'2026-10-08T03:00:15Z',
  providerReceipt:{provider:'CI_MOCK',receiptId:'receipt-001',realExternalPublish:false},
  evidence:{test:true,realExternalPublish:false}
});
assert.equal(r.status,201,JSON.stringify(r.body));
const publicationId=r.body.data.id;
assert.equal(r.body.data.status,'PUBLISHED');
assert.equal(r.body.data.externalId,'CI-MOCK-YOUTUBE-001');

r=await request('POST',`/api/runtime/aigc-publications/${publicationId}/verify`,{
  status:'PASS',
  checks:{
    accessible:'PASS',versionMatch:'PASS',regionLanguage:'PASS',
    disclosure:'PASS',contentIntegrity:'PASS'
  },
  observed:{mode:'CI_MOCK',realExternalPublish:false},
  evidence:{test:true}
});
assert.equal(r.status,201,JSON.stringify(r.body));
assert.equal(r.body.data.status,'PASS');

r=await request('GET',`/api/runtime/projects/${projectId}/aigc-release-publishing`);
assert.equal(r.status,200,JSON.stringify(r.body));
assert.equal(r.body.data.frontend.language,'zh-CN');
assert.equal(r.body.data.frontend.gateName,'发布门禁');
assert.deepEqual(r.body.data.frontend.moduleNames,
  ['渠道 / 账号连接','发布计划 / 内容日历','发布记录','发布后核验']);
assert.match(r.body.data.frontend.externalSideEffectPolicy,/高风险渠道必须人工批准/);
assert.equal(r.body.data.channels.length,2);
assert.equal(r.body.data.plans.length,1);
assert.equal(r.body.data.plans[0].status,'FROZEN');
assert.equal(r.body.data.plans[0].isCurrent,true);
assert.equal(r.body.data.plans[0].items.length,2);
assert.equal(r.body.data.publications.length,1);
assert.equal(r.body.data.verifications.length,1);

const [[truth]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM aigc_channel_connections WHERE project_id=? AND status='CONNECTED') channels,
    (SELECT COUNT(*) FROM aigc_release_plans WHERE project_id=? AND status='FROZEN' AND is_current=TRUE) current_plan,
    (SELECT COUNT(*) FROM aigc_release_plan_items i JOIN aigc_release_plans p ON p.id=i.release_plan_id
      WHERE p.project_id=? AND i.status='APPROVED') approved_items,
    (SELECT COUNT(*) FROM aigc_publication_records WHERE project_id=? AND status='PUBLISHED') publications,
    (SELECT COUNT(*) FROM aigc_post_publish_verifications WHERE project_id=? AND status='PASS') verified,
    (SELECT COUNT(*) FROM aigc_m2814_gate_evaluations WHERE project_id=? AND gate_key='G-AIGC-PUBLISH' AND status='PASS') gate_pass`,
  [projectId,projectId,projectId,projectId,projectId,projectId]
);
assert.equal(Number(truth.channels),2);
assert.equal(Number(truth.current_plan),1);
assert.equal(Number(truth.approved_items),1);
assert.equal(Number(truth.publications),1);
assert.equal(Number(truth.verified),1);
assert.equal(Number(truth.gate_pass),1);

await db.end();
console.log('M28_14_AIGC_RELEASE_PUBLISHING_PASS');
