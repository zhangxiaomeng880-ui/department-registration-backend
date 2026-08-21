import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../src/server.mjs';

const request = (method, path, body) => new Promise((resolve, reject) => {
  const req = http.request(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json' } }, res => {
    let text = '';
    res.on('data', chunk => text += chunk);
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
  });
  req.on('error', reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

server.listen(0, '127.0.0.1', async () => {
  try {
    let result = await request('GET', '/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'ok');

    result = await request('GET', '/api/hospitals?cityId=city-hz');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);

    result = await request('GET', '/api/departments?campusId=campus-1');
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].name, '内科');

    result = await request('GET', '/api/doctors?departmentId=dept-1');
    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].id, 'doctor-1');

    result = await request('GET', '/api/slots?doctorId=doctor-1');
    assert.equal(result.status, 200);
    const slotId = result.body.data[0].id;

    result = await request('POST', '/api/registrations', { doctorId: 'doctor-1', slotId });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.status, 'CREATED');

    result = await request('POST', '/api/registrations', { doctorId: 'doctor-1', slotId });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'SLOT_UNAVAILABLE');

    console.log('BACKEND_INTEGRATION_TEST_PASS');
  } finally {
    server.close();
  }
});
