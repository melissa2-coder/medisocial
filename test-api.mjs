const BASE = 'http://127.0.0.1:3456';
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json();
  return { status: res.status, data };
}
const assert = (cond, label) => { if (!cond) { console.error('FAIL:', label); process.exitCode = 1; } else console.log('OK:', label); };

let r = await api('POST', '/api/login', { email: 'julie@medisocial.fr', password: 'password123' });
assert(r.status === 200 && r.data.user.name === 'Julie Bernard', 'login patient');

r = await api('GET', '/api/me');
assert(r.data.user.role === 'patient', 'session /api/me');

r = await api('GET', '/api/doctors?specialty=Cardiologie');
assert(r.data.doctors.length === 1 && r.data.doctors[0].name.includes('Sophie'), 'recherche médecins par spécialité');

r = await api('GET', '/api/posts');
assert(r.data.posts.length >= 5 && r.data.posts.some(p => p.comments.length >= 1), 'fil avec posts + commentaires');

r = await api('POST', '/api/posts', { content: 'Test publication' });
assert(r.status === 200, 'création post');

r = await api('POST', '/api/posts/1/like');
assert(r.status === 200, 'like post');

r = await api('GET', '/api/doctors/1/slots');
const slot = r.data.slots[0];
assert(r.data.slots.length > 0 && slot.status === 'free', 'créneaux libres du médecin');

r = await api('POST', '/api/appointments', { slot_id: slot.id, reason: 'Test RDV' });
const apptId = r.data.appointment_id;
assert(r.status === 200 && apptId > 0, 'prise de RDV');

r = await api('POST', '/api/appointments', { slot_id: slot.id });
assert(r.status === 400, 'double réservation refusée');

cookie = '';
r = await api('POST', '/api/login', { email: 'sophie@medisocial.fr', password: 'password123' });
r = await api('GET', '/api/appointments');
const mine = r.data.appointments.find(a => a.id === apptId);
assert(mine && mine.status === 'pending' && mine.patient_name === 'Julie Bernard', 'RDV visible côté médecin');
r = await api('POST', `/api/appointments/${apptId}/status`, { status: 'confirmed' });
assert(r.status === 200, 'confirmation par le médecin');

r = await api('POST', `/api/appointments/${apptId}/status`, { status: 'cancelled' });
r = await api('GET', '/api/doctors/1/slots');
assert(r.data.slots.some(s => s.id === slot.id && s.status === 'free'), 'annulation libère le créneau');

cookie = '';
await api('POST', '/api/login', { email: 'julie@medisocial.fr', password: 'password123' });
r = await api('POST', '/api/conversations', { with_user_id: 1 });
const convId = r.data.conversation_id;
r = await api('POST', `/api/conversations/${convId}/messages`, { content: 'Bonjour Docteur' });
assert(r.status === 200, 'envoi de message');
r = await api('GET', '/api/conversations');
assert(r.data.conversations.some(c => c.id === convId && c.last_message === 'Bonjour Docteur'), 'liste conversations');
r = await api('GET', `/api/conversations/${convId}/messages`);
assert(r.data.messages.length === 1, 'lecture messages');

r = await api('GET', '/api/conversations/999/messages');
assert(r.status === 400, 'accès conversation interdit refusé');
cookie = '';
r = await api('GET', '/api/posts');
assert(r.status === 401, 'API protégée sans session');

r = await api('POST', '/api/register', { name: 'Test User', email: 'test@ex.fr', password: '123456', role: 'patient' });
assert(r.status === 200, 'inscription');

const home = await fetch(BASE + '/');
const html = await home.text();
assert(home.status === 200 && html.includes('MediSocial'), "page d'accueil servie");
console.log('\nTerminé.');
