import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const must=name=>{const v=process.env[name];if(!v)throw new Error(`Missing ${name}`);return v;};
const db=mysql.createPool({
  host:must('DB_HOST'),port:Number(must('DB_PORT')),database:must('DB_NAME'),
  user:must('DB_USER'),password:must('DB_PASSWORD')
});

const projectKey='c19-product-real-self-loop';
const [[project]]=await db.execute(
  'SELECT id,project_key,name,project_type,status FROM projects WHERE project_key=?',[projectKey]
);
assert.ok(project,'C19-P2 evidence mirror project missing');
assert.equal(project.project_type,'PRODUCT_DEVELOPMENT');
assert.equal(project.status,'ACTIVE');
assert.match(project.name,/证据镜像/);

const [[observation]]=await db.execute(
  `SELECT o.*,q.status quality_status,q.freshness_status,q.completeness_status,q.sample_status,q.source_quality_status,
          JSON_UNQUOTE(JSON_EXTRACT(o.source_evidence_json,'$.libraryFileId')) library_file_id,
          JSON_EXTRACT(o.dimensions_json,'$.issueKeys') issue_keys
     FROM m29_metric_observations o
     JOIN m29_data_quality_evaluations q ON q.metric_observation_id=o.id
    WHERE o.project_id=? AND o.observation_key='C19-P2-REAL-REVIEW-ISSUE-CATEGORIES'`,
  [project.id]
);
assert.ok(observation,'real observation missing');
assert.equal(Number(observation.numeric_value),6);
assert.equal(observation.source_object_type,'HISTORICAL_PRODUCT_REVIEW');
assert.equal(observation.source_quality_status,'PASS');
assert.equal(observation.quality_status,'PASS');
assert.equal(observation.freshness_status,'PASS');
assert.equal(observation.completeness_status,'PASS');
assert.equal(observation.sample_status,'PASS');
assert.equal(observation.library_file_id,'libfile_46b76fc847f08191a7d12fd60caa1816');
const issueKeys=typeof observation.issue_keys==='string'?JSON.parse(observation.issue_keys):observation.issue_keys;
assert.equal(issueKeys.length,6);
assert.deepEqual(issueKeys,[
  'RUNNER_WORKFLOW',
  'TOOL_OPERATION_BOUNDARY',
  'ACCEPTANCE_CLASSIFICATION',
  'QA_NOT_RUN_STATE',
  'RESPONSIVE_REQUIREMENT_TIMING',
  'MOCK_API_BOUNDARY'
]);

const [[signal]]=await db.execute(
  `SELECT s.*,JSON_UNQUOTE(JSON_EXTRACT(s.evidence_json,'$.realExternalOutcome')) real_external,
          JSON_UNQUOTE(JSON_EXTRACT(s.evidence_json,'$.isSynthetic')) synthetic
     FROM m29_detected_signals s
    WHERE s.project_id=? AND s.signal_key LIKE 'C19-P2-EXECUTION-CONTRACT-GAPS:%'`,
  [project.id]
);
assert.ok(signal,'real detected signal missing');
assert.equal(signal.severity,'HIGH');
assert.equal(signal.status,'CLOSED');
assert.equal(signal.real_external,'true');
assert.equal(signal.synthetic,'false');

const [[decision]]=await db.execute(
  `SELECT d.*,JSON_UNQUOTE(JSON_EXTRACT(d.context_json,'$.humanDecisionAlreadyOccurred')) human_already,
          JSON_UNQUOTE(JSON_EXTRACT(d.evidence_json,'$.realExternalOutcome')) real_external
     FROM project_decisions d
    WHERE d.project_id=? AND d.decision_key='M29:C19-P2-REAL-DECISION'`,
  [project.id]
);
assert.ok(decision,'historical human decision materialization missing');
assert.equal(decision.status,'EFFECTIVE');
assert.equal(decision.human_already,'true');
assert.equal(decision.real_external,'true');

const [[workItem]]=await db.execute(
  `SELECT * FROM project_work_items
    WHERE project_id=? AND item_key='M29-LOOP-C19-P2-REAL-DECISION'`,[project.id]
);
assert.ok(workItem,'next-round backlog/work item missing');
assert.equal(workItem.status,'COMPLETED');

const [[chain]]=await db.execute(
  `SELECT c.id closure_id,c.status closure_status,c.next_round_json,c.knowledge_refs_json,c.backlog_refs_json,
          e.id execution_id,e.status execution_status,e.execution_mode,
          dc.id candidate_id,dc.status candidate_status,dc.requires_human_approval,
          JSON_UNQUOTE(JSON_EXTRACT(c.evidence_json,'$.attestationCreated')) attestation_created,
          JSON_UNQUOTE(JSON_EXTRACT(c.evidence_json,'$.attestationPolicy')) attestation_policy
     FROM m29_loop_closures c
     JOIN m29_loop_executions e ON e.id=c.loop_execution_id
     JOIN m29_decision_candidates dc ON dc.id=e.decision_candidate_id
    WHERE c.project_id=? AND c.closure_key='C19-P2-REAL-PRODUCT-SELF-LOOP'`,
  [project.id]
);
assert.ok(chain,'real self-loop closure missing');
assert.equal(chain.closure_status,'FROZEN');
assert.equal(chain.execution_status,'PASS');
assert.equal(chain.execution_mode,'BACKLOG');
assert.equal(chain.candidate_status,'CLOSED');
assert.equal(Number(chain.requires_human_approval),0);
assert.equal(chain.attestation_created,'false');
assert.equal(chain.attestation_policy,'HUMAN_ONLY');
const nextRound=typeof chain.next_round_json==='string'?JSON.parse(chain.next_round_json):chain.next_round_json;
assert.equal(nextRound.status,'EXECUTED');
assert.equal(nextRound.stagingSha,'ec7570411958a2f6e0466eb5aa97678fa3a64ad7');
const knowledgeRefs=typeof chain.knowledge_refs_json==='string'?JSON.parse(chain.knowledge_refs_json):chain.knowledge_refs_json;
const backlogRefs=typeof chain.backlog_refs_json==='string'?JSON.parse(chain.backlog_refs_json):chain.backlog_refs_json;
assert.ok(knowledgeRefs.length>=3);
assert.ok(backlogRefs.includes(workItem.id));

const [[gates]]=await db.execute(
  `SELECT
    (SELECT COUNT(*) FROM m29_data_detection_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-DATA-DETECTION' AND status='PASS') data_gate_pass,
    (SELECT COUNT(*) FROM m29_self_loop_gate_evaluations
      WHERE project_id=? AND gate_key='G-M29-SELF-LOOP' AND status='PASS') loop_gate_pass,
    (SELECT COUNT(*) FROM m29_real_loop_attestations
      WHERE project_id=? AND decision='APPROVED') real_attestations`,
  [project.id,project.id,project.id]
);
assert.ok(Number(gates.data_gate_pass)>=1);
assert.ok(Number(gates.loop_gate_pass)>=1);
assert.equal(Number(gates.real_attestations),0,'migration must never auto-create HUMAN attestation');

await db.end();
console.log('C19_P2_REAL_PRODUCT_SELF_LOOP_CHAIN_MATERIALIZED_HUMAN_ATTESTATION_PENDING');
