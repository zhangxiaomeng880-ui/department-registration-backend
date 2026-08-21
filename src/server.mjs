import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 3000);

const data = {
  cities: [{ id: 'city-hz', name: '杭州', code: '330100' }],
  hospitals: [{ id: 'hospital-1', cityId: 'city-hz', name: '示例医院' }],
  campuses: [{ id: 'campus-1', hospitalId: 'hospital-1', name: '本部院区' }],
  departments: [
    { id: 'dept-1', campusId: 'campus-1', name: '内科', enabled: true, sort: 1 },
    { id: 'dept-2', campusId: 'campus-1', name: '外科', enabled: true, sort: 2 }
  ],
  doctors: [
    { id: 'doctor-1', departmentId: 'dept-1', name: '张医生', enabled: true, sort: 1 },
    { id: 'doctor-2', departmentId: 'dept-2', name: '李医生', enabled: true, sort: 1 }
  ],
  slots: [
    { id: 'slot-1', doctorId: 'doctor-1', date: '2099-01-01', time: '09:00', available: true },
    { id: 'slot-2', doctorId: 'doctor-2', date: '2099-01-01', time: '10:00', available: true }
  ],
  registrations: []
};

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
};

const route = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok', service: 'department-registration-backend' });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'cities') {
    return json(res, 200, { data: data.cities });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'hospitals') {
    const cityId = url.searchParams.get('cityId');
    return json(res, 200, { data: data.hospitals.filter(x => !cityId || x.cityId === cityId) });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'campuses') {
    const hospitalId = url.searchParams.get('hospitalId');
    return json(res, 200, { data: data.campuses.filter(x => !hospitalId || x.hospitalId === hospitalId) });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'departments') {
    const campusId = url.searchParams.get('campusId');
    return json(res, 200, { data: data.departments.filter(x => x.enabled && (!campusId || x.campusId === campusId)).sort((a,b) => a.sort-b.sort) });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'doctors') {
    const departmentId = url.searchParams.get('departmentId');
    return json(res, 200, { data: data.doctors.filter(x => x.enabled && (!departmentId || x.departmentId === departmentId)).sort((a,b) => a.sort-b.sort) });
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'slots') {
    const doctorId = url.searchParams.get('doctorId');
    return json(res, 200, { data: data.slots.filter(x => x.available && (!doctorId || x.doctorId === doctorId)) });
  }

  if (req.method === 'POST' && url.pathname === '/api/registrations') {
    const body = await readBody(req);
    const slot = data.slots.find(x => x.id === body.slotId && x.available);
    if (!slot) return json(res, 409, { error: 'SLOT_UNAVAILABLE' });
    const doctor = data.doctors.find(x => x.id === slot.doctorId);
    if (!doctor || doctor.id !== body.doctorId) return json(res, 400, { error: 'DOCTOR_MISMATCH' });
    const registration = { id: `registration-${data.registrations.length + 1}`, doctorId: body.doctorId, slotId: body.slotId, status: 'CREATED' };
    slot.available = false;
    data.registrations.push(registration);
    return json(res, 201, { data: registration });
  }

  return json(res, 404, { error: 'NOT_FOUND' });
};

export const server = http.createServer((req, res) => {
  route(req, res).catch(error => json(res, 400, { error: error.message }));
});

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  server.listen(port, '0.0.0.0', () => console.log(`department-registration-backend listening on ${port}`));
}
