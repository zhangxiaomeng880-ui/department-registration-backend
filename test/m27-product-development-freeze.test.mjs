import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/runtime-v2.7-m27-product-development-final-frozen.json','utf8'));

assert.equal(evidence.schemaVersion,'1.0');
assert.equal(evidence.milestone,'M27');
assert.equal(evidence.domainKey,'PRODUCT_DEVELOPMENT');
assert.equal(evidence.status,'FINAL_FROZEN');
assert.equal(evidence.realProject.domainKey,'DEPARTMENT_REGISTRATION');

assert.equal(evidence.realSource.repositoryFullName,'zhangxiaomeng880-ui/department-registration-backend');
assert.equal(evidence.realSource.pullRequest.number,6);
assert.equal(evidence.realSource.pullRequest.state,'MERGED');
assert.equal(evidence.realSource.pullRequest.merged,true);
assert.equal(
  evidence.realSource.pullRequest.mergeCommitSha,
  '0f0181a8d357f1cda1489c036bbde854038efdb3'
);

assert.equal(evidence.realBuild.provider,'GITHUB_ACTIONS');
assert.equal(evidence.realBuild.runId,'37561165842');
assert.equal(evidence.realBuild.status,'SUCCESS');
assert.equal(evidence.realBuild.commitSha,evidence.realSource.pullRequest.mergeCommitSha);

assert.equal(evidence.realStaging.provider,'RAILWAY');
assert.equal(evidence.realStaging.environment,'staging');
assert.equal(evidence.realStaging.deploymentId,'fb280f6c-4fe2-4ade-8fc3-0ed53550bf6a');
assert.equal(evidence.realStaging.status,'SUCCESS');
assert.equal(evidence.realStaging.sourceCommitSha,evidence.realSource.pullRequest.mergeCommitSha);
assert.equal(evidence.realStaging.migrationCount,45);
assert.equal(evidence.realStaging.readinessHttpStatus,200);
assert.equal(evidence.realStaging.warningCount,0);
assert.equal(evidence.realStaging.criticalCount,0);

assert.equal(evidence.finalValidation.gateKey,'G-PD-FINAL');
assert.equal(evidence.finalValidation.status,'PASS');
assert.equal(evidence.finalValidation.githubActionsRunId,'37561607586');
assert.ok(evidence.finalValidation.validates.some(x=>x.includes('Requirement→Code')));

for(let i=1;i<=10;i++) assert.equal(evidence.gates[`M27.${i}`],'CLOSED');
assert.equal(evidence.gates['M27.11'],'FINAL_PASS');

assert.equal(evidence.production.changed,false);
assert.equal(evidence.production.branch,'feat/ai-native-runtime-v2.3-m23.6-finance-rc-freeze');
assert.equal(evidence.production.commitSha,'34578464f5d19e87978ccb81719fb23a4b79d6f1');
assert.equal(evidence.nextMilestone,'M28_AIGC_DOMAIN_E2E');

console.log('M27 Product Development FINAL/FROZEN evidence validation passed');
