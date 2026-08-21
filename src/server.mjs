import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 3000);
const data = {
  cities: [{ id: 'city-hz', name: '杭州市', code: '330100' }],
  hospitals: [{ id: 'hospital-1', cityId: 'city-hz', name: '浙江大学医学院附属第一医院' }],
  campuses: [{ id: 'campus-1', hospitalId: 'hospital-1', name: '本部院区' }],
  departments: [{ id: 'dept-1', campusId: 'campus-1', name: '内科', enabled: true, sort: 1 }, { id: 'dept-2', campusId: 'campus-1', name: '儿科', enabled: true, sort: 2 }],
  doctors: [{ id: 'doctor-1', departmentId: 'dept-1', name: '沈医生', title: '主任医师', specialty: '消化内科', hospital: '浙江大学医学院附属第一医院', enabled: true, sort: 1 }],
  slots: [{ id: 'slot-1', doctorId: 'doctor-1', date: '2099-01-01', time: '09:00', available: true }],
  registrations: []
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
const readBody = async req => { let body = ''; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {}; };
const route = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok', service: 'department-registration-backend' });
  if (req.method === 'GET' && url.pathname === '/api/cities') return json(res, 200, { data: data.cities });
  if (req.method === 'GET' && url.pathname === '/api/hospitals') { const cityId = url.searchParams.get('cityId'); return json(res, 200, { data: data.hospitals.filter(x => !cityId || x.cityId === cityId) }); }
  if (req.method === 'GET' && url.pathname === '/api/campuses') { const hospitalId = url.searchParams.get('hospitalId'); return json(res, 200, { data: data.campuses.filter(x => !hospitalId || x.hospitalId === hospitalId) }); }
  if (req.method === 'GET' && url.pathname === '/api/departments') { const campusId = url.searchParams.get('campusId'); return json(res, 200, { data: data.departments.filter(x => x.enabled && (!campusId || x.campusId === campusId)).sort((a,b) => a.sort-b.sort) }); }
  if (req.method === 'GET' && url.pathname === '/api/doctors') { const departmentId = url.searchParams.get('departmentId'); return json(res, 200, { data: data.doctors.filter(x => x.enabled && (!departmentId || x.departmentId === departmentId)).sort((a,b) => a.sort-b.sort) }); }
  if (req.method === 'POST' && url.pathname === '/api/doctors') {
    const body = await readBody(req); const department = data.departments.find(x => x.id === body.departmentId && x.enabled);
    if (!body.name || !body.title || !body.specialty || !department) return json(res, 400, { error: 'INVALID_DOCTOR' });
    const doctor = { id: `doctor-${data.doctors.length + 1}`, departmentId: body.departmentId, name: body.name, title: body.title, specialty: body.specialty, hospital: '浙江大学医学院附属第一医院', enabled: true, sort: data.doctors.filter(x => x.departmentId === body.departmentId).length + 1 };
    data.doctors.push(doctor); return json(res, 201, { data: doctor });
  }
  if (req.method === 'GET' && url.pathname === '/api/slots') { const doctorId = url.searchParams.get('doctorId'); return json(res, 200, { data: data.slots.filter(x => x.available && (!doctorId || x.doctorId === doctorId)) }); }
  if (req.method === 'POST' && url.pathname === '/api/registrations') {
    const body = await readBody(req); const slot = data.slots.find(x => x.id === body.slotId && x.available); if (!slot) return json(res, 409, { error: 'SLOT_UNAVAILABLE' });
    const doctor = data.doctors.find(x => x.id === slot.doctorId); if (!doctor || doctor.id !== body.doctorId) return json(res, 400, { error: 'DOCTOR_MISMATCH' });
    const registration = { id: `registration-${data.registrations.length + 1}`, doctorId: body.doctorId, slotId: body.slotId, status: 'CREATED' }; slot.available = false; data.registrations.push(registration); return json(res, 201, { data: registration });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
};
export const server = http.createServer((req, res) => route(req, res).catch(error => json(res, 400, { error: error.message })));
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) server.listen(port, '0.0.0.0', () => console.log(`department-registration-backend listening on ${port}`));
