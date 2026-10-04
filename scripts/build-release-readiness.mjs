import fs from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const has = name => argv.includes(name);

const inputPath = arg('--input');
const outputPath = arg('--output');
if (!inputPath) {
  console.error('Usage: node scripts/build-release-readiness.mjs --input <json> [--output <json>]');
  process.exit(2);
}

const SECRET_KEY = /(api[_-]?key|secret|password|credential|authorization|bearer|token)$/i;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._-]{12,})/i;
const shaPattern = /^[0-9a-f]{40}$/i;

const readJson = async file => JSON.parse(await fs.readFile(file,'utf8'));

const scanSecrets = (value, pathKey = '$', issues = []) => {
  if (value == null) return issues;
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) issues.push({code:'SECRET_VALUE_DETECTED',path:pathKey});
    return issues;
  }
  if (Array.isArray(value)) {
    value.forEach((item,index)=>scanSecrets(item,`${pathKey}[${index}]`,issues));
    return issues;
  }
  if (typeof value === 'object') {
    for (const [key,child] of Object.entries(value)) {
      const next=`${pathKey}.${key}`;
      if (SECRET_KEY.test(key)) issues.push({code:'SECRET_KEY_FIELD_DETECTED',path:next});
      scanSecrets(child,next,issues);
    }
  }
  return issues;
};

const data = await readJson(inputPath);
const holds = [];
const passes = [];

const requiredMilestones = ['M21.1','M21.2','M21.3'];
const milestoneByKey = new Map((data.milestones || []).map(x=>[x.milestone,x]));
for (const key of requiredMilestones) {
  const item=milestoneByKey.get(key);
  if (!item) {
    holds.push({code:'MILESTONE_EVIDENCE_MISSING',detail:key});
  } else if (item.status !== 'PASS') {
    holds.push({code:'MILESTONE_GATE_NOT_PASS',detail:`${key}:${item.status}`});
  } else {
    passes.push({code:'MILESTONE_GATE_PASS',detail:key});
  }
}

const requiredCi = [
  'Backend Validation',
  'Railway Runtime Compatibility',
  'Runtime Orchestrator Validation',
  'Runtime v2.1 Observability Gate',
  'Runtime v2.1 Policy Router Gate',
  'Runtime v2.1 Cost Ledger Gate',
  'Runtime v2.1 Release Promotion Gate',
];
const ciByName=new Map((data.ci || []).map(x=>[x.name,x]));
for (const name of requiredCi) {
  const run=ciByName.get(name);
  if (!run) {
    holds.push({code:'CI_EVIDENCE_MISSING',detail:name});
  } else if (run.conclusion !== 'success') {
    holds.push({code:'CI_NOT_SUCCESS',detail:`${name}:${run.conclusion}`});
  } else {
    passes.push({code:'CI_SUCCESS',detail:name});
  }
}

if (!shaPattern.test(String(data.candidate?.commitSha || ''))) {
  holds.push({code:'CANDIDATE_SHA_INVALID'});
} else {
  passes.push({code:'CANDIDATE_SHA_VALID',detail:data.candidate.commitSha});
}

if (!shaPattern.test(String(data.rollback?.runtimeCommitSha || '')) ||
    !data.rollback?.deploymentId) {
  holds.push({code:'ROLLBACK_TARGET_MISSING'});
} else {
  passes.push({
    code:'ROLLBACK_TARGET_PRESENT',
    detail:`${data.rollback.runtimeCommitSha}:${data.rollback.deploymentId}`
  });
}

if (data.production?.currentStatus !== 'SUCCESS') {
  holds.push({code:'CURRENT_PRODUCTION_NOT_HEALTHY',detail:data.production?.currentStatus || 'UNKNOWN'});
} else {
  passes.push({code:'CURRENT_PRODUCTION_HEALTHY'});
}

if (data.staging?.verified !== true) {
  holds.push({code:'STAGING_NOT_VERIFIED'});
} else {
  passes.push({code:'STAGING_VERIFIED',detail:data.staging.deploymentId || null});
  if (data.staging?.candidateCommitSha !== data.candidate?.commitSha) {
    holds.push({code:'STAGING_SHA_MISMATCH'});
  }
  if (data.staging?.readinessHttpStatus !== 200) {
    holds.push({code:'STAGING_READINESS_NOT_200'});
  }
  if (data.staging?.providerSmokePass !== true) {
    holds.push({code:'STAGING_PROVIDER_SMOKE_NOT_PASS'});
  }
}

if (data.productionPromotion?.performed === true) {
  holds.push({code:'AUTOMATIC_PRODUCTION_PROMOTION_FORBIDDEN'});
}

if (data.manualApproval?.approved === true) {
  passes.push({code:'MANUAL_APPROVAL_RECORDED',detail:data.manualApproval.approvedBy || null});
} else {
  holds.push({code:'MANUAL_APPROVAL_REQUIRED'});
}

for (const issue of scanSecrets(data)) holds.push(issue);

const blockingCodes=new Set(holds.map(x=>x.code));
const readyForManualApproval =
  ![
    'MILESTONE_EVIDENCE_MISSING',
    'MILESTONE_GATE_NOT_PASS',
    'CI_EVIDENCE_MISSING',
    'CI_NOT_SUCCESS',
    'CANDIDATE_SHA_INVALID',
    'ROLLBACK_TARGET_MISSING',
    'CURRENT_PRODUCTION_NOT_HEALTHY',
    'STAGING_NOT_VERIFIED',
    'STAGING_SHA_MISMATCH',
    'STAGING_READINESS_NOT_200',
    'STAGING_PROVIDER_SMOKE_NOT_PASS',
    'SECRET_VALUE_DETECTED',
    'SECRET_KEY_FIELD_DETECTED',
    'AUTOMATIC_PRODUCTION_PROMOTION_FORBIDDEN',
  ].some(code=>blockingCodes.has(code));

const approvedForPromotion =
  readyForManualApproval &&
  data.manualApproval?.approved === true &&
  !blockingCodes.has('MANUAL_APPROVAL_REQUIRED');

const verdict = approvedForPromotion
  ? 'APPROVED_FOR_MANUAL_PRODUCTION_PROMOTION'
  : readyForManualApproval
    ? 'AWAITING_MANUAL_APPROVAL'
    : 'HOLD';

const result={
  schemaVersion:1,
  releaseCandidate:data.releaseCandidate,
  generatedAt:data.generatedAt || new Date().toISOString(),
  candidate:data.candidate,
  rollback:data.rollback,
  production:data.production,
  staging:data.staging,
  milestoneEvidence:requiredMilestones.map(key=>milestoneByKey.get(key) || {milestone:key,status:'MISSING'}),
  ciEvidence:requiredCi.map(name=>ciByName.get(name) || {name,conclusion:'missing'}),
  manualApproval:{
    required:true,
    approved:data.manualApproval?.approved === true,
    approvedBy:data.manualApproval?.approvedBy || null,
    approvedAt:data.manualApproval?.approvedAt || null,
  },
  productionPromotion:{
    automated:false,
    performed:data.productionPromotion?.performed === true,
  },
  checks:{passes,holds},
  verdict,
  readyForManualApproval,
  approvedForPromotion,
};

const json=JSON.stringify(result,null,2)+'\n';
if (outputPath) {
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,json,'utf8');
}
process.stdout.write(json);

if (has('--require-ready') && !readyForManualApproval) process.exit(3);
if (has('--require-approved') && !approvedForPromotion) process.exit(4);
