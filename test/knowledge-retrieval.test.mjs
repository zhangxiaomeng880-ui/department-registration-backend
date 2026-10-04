import assert from 'node:assert/strict';

const baseUrl = process.env.RUNTIME_API_BASE_URL || 'http://127.0.0.1:3100';
const suffix = Date.now().toString(36);
const sourceKey = `chatgpt-library-retrieval-ci-${suffix}`;

const request = async (method, path, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

let r = await request('POST','/api/runtime/knowledge/sources',{
  sourceKey,
  provider:'chatgpt_library',
  sourceType:'LIBRARY',
  transportMode:'CHATGPT_TOOL',
  rootScope:'/你好那年夏天'
});
assert.equal(r.status,201);

r = await request('POST','/api/runtime/knowledge/sync-metadata',{
  sourceKey,
  provider:'chatgpt_library',
  documents:[
    {
      file_id:'file_master_script',
      library_file_id:'lib_master_script',
      version_id:'166',
      library_path:'/你好那年夏天/剧本/你好那年夏天_完整连续母剧本_V1.0_CURRENT.md',
      name:'你好那年夏天_完整连续母剧本_V1.0_CURRENT.md',
      mime_type:'text/markdown',
      file_provider:'native',
      source_status:'CURRENT',
      default_retrieval:true
    },
    {
      file_id:'file_story_facts',
      library_file_id:'lib_story_facts',
      version_id:'53',
      library_path:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      name:'你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      mime_type:'text/markdown',
      file_provider:'native',
      source_status:'CURRENT',
      default_retrieval:true
    }
  ]
});
assert.equal(r.status,200);

r = await request('POST','/api/runtime/knowledge/retrievals',{
  sourceKey,
  query:'检查SC042-SC050连续性，只使用CURRENT事实与剧本',
  retrievalMode:'LIBRARY_SEARCH_READ',
  contextHash:'ctx-hash-ci-001',
  policy:{
    precedence:['AUTHOR_LATEST','STORY_FACTS','MASTER_SCRIPT','TIMELINE','SPECIAL_CURRENT'],
    defaultRetrievalOnly:true
  },
  items:[
    {
      externalFileId:'file_master_script',
      libraryFileId:'lib_master_script',
      versionId:'166',
      sourcePath:'/你好那年夏天/剧本/你好那年夏天_完整连续母剧本_V1.0_CURRENT.md',
      rankNo:1,
      selected:true,
      lineStart:18317,
      lineEnd:18332,
      contentHash:'hash-sc042'
    },
    {
      externalFileId:'file_story_facts',
      libraryFileId:'lib_story_facts',
      versionId:'53',
      sourcePath:'/你好那年夏天/02_故事资产/你好那年夏天_剧情事实与创作基线_V1.6_CURRENT.md',
      rankNo:2,
      selected:true,
      lineStart:359,
      lineEnd:375,
      contentHash:'hash-055-facts'
    }
  ]
});
assert.equal(r.status,201);
assert.equal(r.body.data.selectedCount,2);
const retrievalId = r.body.data.id;

r = await request('GET',`/api/runtime/knowledge/retrievals/${retrievalId}`);
assert.equal(r.status,200);
assert.equal(r.body.data.items.length,2);
assert.equal(r.body.data.items[0].versionId,'166');
assert.equal(Object.hasOwn(r.body.data.items[0],'content'),false);
assert.equal(Object.hasOwn(r.body.data.items[0],'snippet'),false);

r = await request('POST','/api/runtime/knowledge/retrievals',{
  sourceKey,
  query:'should reject copied source body',
  items:[
    {
      externalFileId:'file_master_script',
      versionId:'166',
      sourcePath:'/你好那年夏天/剧本/你好那年夏天_完整连续母剧本_V1.0_CURRENT.md',
      content:'THIS MUST NOT BE STORED'
    }
  ]
});
assert.equal(r.status,400);
assert.equal(r.body.error,'SOURCE_BODY_NOT_ALLOWED');

console.log('KNOWLEDGE_RETRIEVAL_PROVENANCE_PASS');
