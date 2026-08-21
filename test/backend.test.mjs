import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../src/server.mjs';
const request = (method, path, body) => new Promise((resolve, reject) => {
  const req = http.request(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json' } }, res => { let text=''; res.on('data', c=>text+=c); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)})); });
  req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
});
server.listen(0, '127.0.0.1', async () => {
  try {
    let r=await request('GET','/health'); assert.equal(r.status,200); assert.equal(r.body.status,'ok');
    r=await request('GET','/api/cities'); assert.equal(r.status,200); assert.equal(r.body.data[0].name,'杭州市');
    r=await request('GET','/api/hospitals?cityId=city-hz'); assert.equal(r.status,200); assert.equal(r.body.data.length,1);
    r=await request('GET','/api/departments?campusId=campus-1'); assert.equal(r.status,200); assert.equal(r.body.data[0].name,'内科');
    r=await request('GET','/api/doctors?departmentId=dept-1'); assert.equal(r.status,200); assert.equal(r.body.data[0].id,'doctor-1');
    r=await request('POST','/api/doctors',{name:'测试医生',title:'主治医师',specialty:'测试专业',departmentId:'dept-1'}); assert.equal(r.status,201); assert.equal(r.body.data.name,'测试医生');
    r=await request('GET','/api/slots?doctorId=doctor-1'); assert.equal(r.status,200); const slotId=r.body.data[0].id;
    r=await request('POST','/api/registrations',{doctorId:'doctor-1',slotId}); assert.equal(r.status,201); assert.equal(r.body.data.status,'CREATED');
    r=await request('POST','/api/registrations',{doctorId:'doctor-1',slotId}); assert.equal(r.status,409); assert.equal(r.body.error,'SLOT_UNAVAILABLE');
    console.log('BACKEND_INTEGRATION_TEST_PASS');
  } finally { server.close(); }
});
