import http from 'node:http';

const port = Number(process.env.MOCK_OPENAI_PORT || 4010);

const readBody = req => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    try { resolve(data ? JSON.parse(data) : {}); }
    catch (error) { reject(error); }
  });
  req.on('error', reject);
});

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type':'application/json',
    'content-length':Buffer.byteLength(payload),
  });
  res.end(payload);
};

const server = http.createServer(async (req,res) => {
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    json(res,404,{error:{message:'not found',code:'not_found'}});
    return;
  }
  if (req.headers.authorization !== 'Bearer test-openai-key') {
    json(res,401,{error:{message:'bad auth',code:'bad_auth'}});
    return;
  }

  const body = await readBody(req);
  if (body.model !== 'test-model') {
    json(res,400,{error:{message:'unexpected model',code:'bad_model'}});
    return;
  }
  if (body.store !== false) {
    json(res,400,{error:{message:'store must be false',code:'store_required_false'}});
    return;
  }
  if (body?.text?.format?.type !== 'json_schema' || body?.text?.format?.strict !== true) {
    json(res,400,{error:{message:'structured output required',code:'schema_required'}});
    return;
  }
  if (!String(body.input || '').includes('SC049') || !String(body.input || '').includes('LIBRARY_SENTINEL_SOURCE_TEXT')) {
    json(res,400,{error:{message:'transient context missing',code:'context_missing'}});
    return;
  }

  const output = {
    scope:'SC042-SC050',
    findingCount:1,
    findings:[{
      code:'SC049_MOTHER_CALL_SEQUENCE_OMITTED',
      severity:'P1_CONTINUITY',
      scene:'SC049',
      summary:'SC049 omits the locked mother-call-before-Lin-call action.',
      evidence:[
        {sourceFileId:'fact-file',sourceVersion:'53',lineStart:331,lineEnd:343},
        {sourceFileId:'movie-file',sourceVersion:null,lineStart:7528,lineEnd:7556}
      ]
    }],
    noOtherHardConflicts:true
  };

  json(res,200,{
    id:'resp_mock_autonomous_001',
    object:'response',
    status:'completed',
    model:'test-model',
    output:[{
      type:'message',
      role:'assistant',
      content:[{type:'output_text',text:JSON.stringify(output)}]
    }],
    usage:{input_tokens:321,output_tokens:87,total_tokens:408}
  });
});

server.listen(port,'127.0.0.1',()=>{
  console.log(`MOCK_OPENAI_READY:${port}`);
});
