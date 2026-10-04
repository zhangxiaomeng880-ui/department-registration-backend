import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir=await mkdtemp(path.join(tmpdir(),'release-readiness-'));
const script=path.resolve('scripts/build-release-readiness.mjs');

const base={
  releaseCandidate:'ai-native-runtime-v2.1-rc1',
  generatedAt:'2026-10-04T00:00:00.000Z',
  candidate:{commitSha:'a'.repeat(40),branch:'feat/ai-native-runtime-v2.1-productization'},
  rollback:{
    runtimeCommitSha:'b'.repeat(40),
    deploymentId:'deployment-v2-0-production'
  },
  production:{currentStatus:'SUCCESS'},
  staging:{
    verified:true,
    deploymentId:'staging-deploy-001',
    candidateCommitSha:'a'.repeat(40),
    readinessHttpStatus:200,
    providerSmokePass:true
  },
  milestones:[
    {milestone:'M21.1',status:'PASS'},
    {milestone:'M21.2',status:'PASS'},
    {milestone:'M21.3',status:'PASS'}
  ],
  ci:[
    {name:'Backend Validation',conclusion:'success'},
    {name:'Railway Runtime Compatibility',conclusion:'success'},
    {name:'Runtime Orchestrator Validation',conclusion:'success'},
    {name:'Runtime v2.1 Observability Gate',conclusion:'success'},
    {name:'Runtime v2.1 Policy Router Gate',conclusion:'success'},
    {name:'Runtime v2.1 Cost Ledger Gate',conclusion:'success'}
  ],
  manualApproval:{approved:false},
  productionPromotion:{performed:false}
};

const run=async (name,data,extra=[])=>{
  const input=path.join(dir,`${name}-input.json`);
  const output=path.join(dir,`${name}-output.json`);
  await writeFile(input,JSON.stringify(data,null,2));
  const child=spawnSync(process.execPath,[script,'--input',input,'--output',output,...extra],{
    encoding:'utf8'
  });
  let result=null;
  try { result=JSON.parse(await readFile(output,'utf8')); } catch {}
  return {child,result};
};

let x=await run('awaiting',base);
assert.equal(x.child.status,0,x.child.stderr);
assert.equal(x.result.verdict,'AWAITING_MANUAL_APPROVAL');
assert.equal(x.result.readyForManualApproval,true);
assert.equal(x.result.approvedForPromotion,false);
assert.ok(x.result.checks.holds.some(h=>h.code==='MANUAL_APPROVAL_REQUIRED'));

x=await run('approved',{
  ...base,
  manualApproval:{
    approved:true,
    approvedBy:'release-owner',
    approvedAt:'2026-10-04T00:01:00.000Z'
  }
});
assert.equal(x.child.status,0,x.child.stderr);
assert.equal(x.result.verdict,'APPROVED_FOR_MANUAL_PRODUCTION_PROMOTION');
assert.equal(x.result.readyForManualApproval,true);
assert.equal(x.result.approvedForPromotion,true);
assert.equal(x.result.productionPromotion.automated,false);

x=await run('no-staging',{
  ...base,
  staging:{verified:false},
  manualApproval:{approved:false}
},['--require-ready']);
assert.equal(x.child.status,3);
assert.equal(x.result.verdict,'HOLD');
assert.equal(x.result.readyForManualApproval,false);
assert.ok(x.result.checks.holds.some(h=>h.code==='STAGING_NOT_VERIFIED'));

x=await run('mismatch',{
  ...base,
  staging:{
    ...base.staging,
    candidateCommitSha:'c'.repeat(40)
  }
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='STAGING_SHA_MISMATCH'));

x=await run('rollback-missing',{
  ...base,
  rollback:{runtimeCommitSha:null,deploymentId:null}
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='ROLLBACK_TARGET_MISSING'));

x=await run('failed-ci',{
  ...base,
  ci:base.ci.map(item=>item.name==='Runtime v2.1 Cost Ledger Gate'
    ? {...item,conclusion:'failure'}
    : item)
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='CI_NOT_SUCCESS'));

x=await run('secret-field',{
  ...base,
  staging:{
    ...base.staging,
    metadata:{apiKey:'redacted-value'}
  }
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='SECRET_KEY_FIELD_DETECTED'));

x=await run('secret-value',{
  ...base,
  staging:{
    ...base.staging,
    metadata:{note:'sk-proj-abcdefghijklmnop'}
  }
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='SECRET_VALUE_DETECTED'));

x=await run('auto-promotion-forbidden',{
  ...base,
  manualApproval:{approved:true,approvedBy:'release-owner'},
  productionPromotion:{performed:true}
});
assert.equal(x.result.verdict,'HOLD');
assert.ok(x.result.checks.holds.some(h=>h.code==='AUTOMATIC_PRODUCTION_PROMOTION_FORBIDDEN'));

console.log('G21_RELEASE_PROMOTION_PASS');
