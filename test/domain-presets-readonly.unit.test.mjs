// Isolated unit evidence only: real preset module, synthetic DB/registry seams.
// This does NOT replace observation on a writable isolated MySQL database.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
const source=await readFile(new URL('../src/domain-workflow-presets.mjs',import.meta.url),'utf8');
const apiSource=await readFile(new URL('../src/runtime-api.mjs',import.meta.url),'utf8');
const registryNames=['upsertCapability','upsertAgentProfile','grantAgentCapability','bindProjectTypeCapability','createWorkflowTemplate','addWorkflowMilestone','addWorkflowStage','addStageCapabilityRequirement','addStageKnowledgePolicy','freezeWorkflowTemplate'];
async function fixture({exists=true,candidates=[],dbError=null,persistSync=false}={}){
 const statements=[],registryWrites=[];
 const spec={stages:[{stageKey:'STORED_ONLY',displayName:'Stored stage',agentRole:'TEST',executionMode:'AUTO',capabilityRequirements:[{requirementKey:'MODEL',capabilityType:'MODEL',requirementMode:'REQUIRED',constraints:{}}]}]};
 const row={preset_key:'STORED_PRESET',project_type_key:'STORED_TYPE',version:'stored-version',display_name:'Stored',status:'ACTIVE',spec_json:JSON.stringify(spec),spec_sha256:'stored-hash',source_refs_json:'[]'};
 const stored=new Map(exists?[[row.preset_key,row]]:[]);
 const db={execute:async(sql,params=[])=>{statements.push({sql,params});if(dbError)throw dbError;
   if(/^\s*SELECT/i.test(sql)){
     if(/FROM capability_registry/.test(sql))return [candidates];
     if(/FROM domain_workflow_releases/.test(sql))return [[]];
     if(persistSync)return [/WHERE preset_key=/.test(sql)?(stored.has(params[0])?[stored.get(params[0])]:[]):[...stored.values()]];
     return [exists?[row]:[]];
   }
   if(persistSync&&/INSERT INTO domain_workflow_presets/.test(sql))stored.set(params[0],{preset_key:params[0],project_type_key:params[1],version:params[2],display_name:params[3],status:'ACTIVE',spec_json:params[4],spec_sha256:params[5],source_refs_json:params[6]});
   // A write is allowed to execute in the stub so the assertion catches attempts,
   // rather than mistaking a read-only DB rejection for absence of writes.
   return [{affectedRows:1}];
 }};
 const context=vm.createContext({});
 const make=entries=>new vm.SyntheticModule(Object.keys(entries),function(){for(const [k,v] of Object.entries(entries))this.setExport(k,v);},{context});
 const mod=new vm.SourceTextModule(source,{context});
 await mod.link(async name=>{
   if(name==='node:crypto')return make({createHash:crypto.createHash,randomUUID:crypto.randomUUID});
   if(name==='./runtime-db.mjs')return make({getRuntimePool:()=>db});
   if(name==='./core-meta-registry.mjs')return make(Object.fromEntries(registryNames.map(k=>[k,()=>{registryWrites.push(k);throw Error('Unexpected registry write '+k);}])));
   throw Error('Unexpected import '+name);
 });await mod.evaluate();
 return {api:mod.namespace,statements,registryWrites,row,stored};
}
function assertReadOnly(f){assert.ok(f.statements.length);assert.ok(f.statements.every(x=>/^\s*SELECT\b/i.test(x.sql)),JSON.stringify(f.statements));assert.deepEqual(f.registryWrites,[]);}
for(const filtered of [false,true])test('list only reads stored presets, filtered='+filtered,async()=>{const f=await fixture();const rows=await f.api.listDomainWorkflowPresets(filtered?{projectTypeKey:'STORED_TYPE'}:{});assert.equal(rows[0].version,'stored-version');assert.equal(rows.length,1);assertReadOnly(f);if(filtered)assert.equal(f.statements[0].params[0],'STORED_TYPE');});
test('empty list never initializes standard presets',async()=>{const f=await fixture({exists:false});assert.equal((await f.api.listDomainWorkflowPresets()).length,0);assertReadOnly(f);assert.equal(f.statements.length,1);});
test('get returns stored spec unchanged',async()=>{const f=await fixture();const item=await f.api.getDomainWorkflowPreset('STORED_PRESET');assert.equal(item.spec.stages[0].stageKey,'STORED_ONLY');assert.equal(item.specSha256,'stored-hash');assertReadOnly(f);});
for(const name of ['getDomainWorkflowPreset','getDomainPresetReadiness'])test(name+' missing stays 404 without seeding',async()=>{const f=await fixture({exists:false});await assert.rejects(f.api[name]('PRODUCT_DEVELOPMENT_STANDARD'),e=>e.code==='DOMAIN_PRESET_NOT_FOUND'&&e.statusCode===404);assertReadOnly(f);assert.equal(f.statements.length,1);});
for(const hasCandidate of [false,true])test('readiness uses stored data and reads candidates only, candidates='+hasCandidate,async()=>{const f=await fixture({candidates:hasCandidate?[{capability_key:'registered',capability_type:'MODEL',status:'ACTIVE',routable:1}]:[]});const r=await f.api.getDomainPresetReadiness('STORED_PRESET');assert.equal(r.ready,hasCandidate);assert.equal(r.version,'stored-version');assert.equal(r.stages[0].stageKey,'STORED_ONLY');assertReadOnly(f);assert.equal(f.statements.length,2);});
test('database failure is propagated rather than empty or seed fallback',async()=>{const err=Object.assign(Error('isolated failure'),{code:'TEST_DB_ERROR'});for(const name of ['listDomainWorkflowPresets','getDomainWorkflowPreset','getDomainPresetReadiness']){const f=await fixture({dbError:err});await assert.rejects(f.api[name](),e=>e===err);assertReadOnly(f);}});
test('explicit sync remains the existing two-preset write operation',async()=>{const f=await fixture({exists:false});const result=await f.api.syncStandardDomainPresets();assert.equal(result.length,2);assert.equal(f.statements.length,2);assert.ok(f.statements.every(x=>/^\s*INSERT INTO domain_workflow_presets/.test(x.sql)));});
// Exercise exact unchanged route blocks with synthetic request/auth/response seams.
// These are route-unit checks, not actual HTTP or database integration claims.
const start=apiSource.indexOf("  if (req.method === 'POST' && url.pathname === '/api/runtime/domain-presets/sync')");
const end=apiSource.indexOf('  const domainPresetCompileMatch=',start);
const routeBody=apiSource.slice(start,end);
const routeFactory=new Function('requirePlatformAdmin','json','match','listDomainWorkflowPresets','getDomainWorkflowPreset','getDomainPresetReadiness','syncStandardDomainPresets',`return async (req,url,principal,res)=>{${routeBody};return false;}`);
for(const path of ['/api/runtime/domain-presets','/api/runtime/domain-presets/STORED_PRESET','/api/runtime/domain-presets/STORED_PRESET/readiness']){
 for(const forbidden of [false,true])test(`route unit ${path} forbidden=${forbidden}`,async()=>{const f=await fixture();let result;const authError=Object.assign(Error('Forbidden'),{statusCode:403});const route=routeFactory(p=>{if(!p.admin)throw authError;},(_res,status,data)=>result={status,data},(p,r)=>p.match(r),f.api.listDomainWorkflowPresets,f.api.getDomainWorkflowPreset,f.api.getDomainPresetReadiness,f.api.syncStandardDomainPresets);
 if(forbidden){await assert.rejects(route({method:'GET'},new URL(path,'http://unit.invalid'),{admin:false},{}),e=>e===authError);assert.equal(f.statements.length,0);}else{assert.equal(await route({method:'GET'},new URL(path,'http://unit.invalid'),{admin:true},{}),true);assert.equal(result.status,200);assertReadOnly(f);}
 });
}
test('explicit compile retains standard initialization and stored refresh; reads remain pure',async()=>{
 const f=await fixture({exists:false,persistSync:true});
 assert.equal((await f.api.listDomainWorkflowPresets()).length,0);assertReadOnly(f);
 const result=await f.api.compileDomainWorkflowPreset('PRODUCT_DEVELOPMENT_STANDARD');
 assert.equal(result.status,'BLOCKED');assert.equal(result.workflowTemplateId,null);
 assert.ok(f.stored.has('PRODUCT_DEVELOPMENT_STANDARD'));
 assert.equal(f.statements.filter(x=>/INSERT INTO domain_workflow_presets/.test(x.sql)).length,2);
 assert.equal(f.stored.get('PRODUCT_DEVELOPMENT_STANDARD').version,f.api.STANDARD_DOMAIN_PRESETS[0].version);
 f.stored.get('PRODUCT_DEVELOPMENT_STANDARD').version='stale';
 const beforeRead=f.statements.length;
 assert.equal((await f.api.getDomainWorkflowPreset('PRODUCT_DEVELOPMENT_STANDARD')).version,'stale');
 assert.ok(f.statements.slice(beforeRead).every(x=>/^\s*SELECT/.test(x.sql)));
 await f.api.compileDomainWorkflowPreset('PRODUCT_DEVELOPMENT_STANDARD');
 assert.equal(f.stored.get('PRODUCT_DEVELOPMENT_STANDARD').version,f.api.STANDARD_DOMAIN_PRESETS[0].version);
 assert.equal(f.statements.filter(x=>/INSERT INTO domain_workflow_presets/.test(x.sql)).length,4);
});
test('explicit resolve uses compilation initialization without adding writes to get/readiness',async()=>{
 const f=await fixture({exists:false,persistSync:true});
 await assert.rejects(f.api.resolveDomainPresetWorkflow({presetKey:'AIGC_CONTENT_STANDARD',projectTypeKey:'AIGC_CONTENT'}),e=>e.code==='DOMAIN_PRESET_NOT_READY');
 assert.ok(f.stored.has('AIGC_CONTENT_STANDARD'));
 assert.equal(f.statements.filter(x=>/INSERT INTO domain_workflow_presets/.test(x.sql)).length,2);
});
