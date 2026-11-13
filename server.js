const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { db, hashPassword, verifyPassword } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.specialty, u.city, u.bio, u.color
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token) || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const publicUser = (u) => u && ({
  id: u.id, name: u.name, role: u.role, specialty: u.specialty,
  city: u.city, bio: u.bio, color: u.color,
});

const routes = [];
function route(method, pattern, handler, { auth = true } = {}) {
  const names = [];
  const regex = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => {
    names.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method, regex, names, handler, auth });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 16);
}

async function handleApi(req, res, pathname) {
  const user = currentUser(req);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = pathname.match(r.regex);
    if (!match) continue;
    if (r.auth && !user) return send(res, 401, { error: 'Connexion requise' });
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(match[i + 1]); });
    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ req, res, user, params, body, query: new URL(req.url, 'http://x').searchParams });
      if (!res.writableEnded) send(res, 200, result ?? { ok: true });
    } catch (err) {
      send(res, err.status || 500, { error: err.message || 'Erreur serveur' });
    }
    return;
  }
  send(res, 404, { error: 'Route inconnue' });
}

function bad(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

route('POST', '/api/register', async ({ res, body }) => {
  const { name, email, password, role, specialty, city } = body;
  if (!name || !email || !password) throw bad('Nom, email et mot de passe requis');
  if (password.length < 6) throw bad('Le mot de passe doit contenir au moins 6 caract\u00e8res');
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) throw bad('Cet email est d\u00e9j\u00e0 utilis\u00e9');
  const color = ['#4267B2', '#E4406F', '#0084FF', '#42B72A', '#8E44AD', '#E67E22', '#16A085', '#C0392B'][Math.floor(Math.random() * 8)];
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, specialty, city, bio, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, email.toLowerCase(), hashPassword(password), role === 'doctor' ? 'doctor' : 'patient',
    specialty || null, city || null, '', color);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, info.lastInsertRowid);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
  return { user: { id: Number(info.lastInsertRowid), name, role: role === 'doctor' ? 'doctor' : 'patient', color } };
}, { auth: false });

route('POST', '/api/login', async ({ res, body }) => {
  const { email, password } = body;
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!row || !verifyPassword(password || '', row.password_hash)) throw bad('Email ou mot de passe incorrect');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, row.id);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
  return { user: publicUser(row) };
}, { auth: false });

route('POST', '/api/logout', async ({ req, res }) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', async ({ user }) => ({ user }), { auth: false });

route('GET', '/api/doctors', async ({ query }) => {
  const specialty = (query.get('specialty') || '').trim();
  const city = (query.get('city') || '').trim();
  const search = (query.get('q') || '').trim();
  let sql = `SELECT u.*, (SELECT COUNT(*) FROM slots s WHERE s.doctor_id = u.id AND s.status = 'free' AND s.starts_at >= datetime('now')) AS free_slots
             FROM users u WHERE u.role = 'doctor'`;
  const args = [];
  if (specialty) { sql += ' AND u.specialty = ?'; args.push(specialty); }
  if (city) { sql += ' AND u.city LIKE ?'; args.push(`%${city}%`); }
  if (search) { sql += ' AND (u.name LIKE ? OR u.specialty LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY u.name';
  return { doctors: db.prepare(sql).all(...args).map(publicUser) };
});

route('GET', '/api/doctors/:id', async ({ params }) => {
  const doc = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'doctor'").get(params.id);
  if (!doc) throw bad('M\u00e9decin introuvable');
  return { doctor: publicUser(doc) };
});

route('GET', '/api/doctors/:id/slots', async ({ params }) => {
  const slots = db.prepare(
    "SELECT id, starts_at, status FROM slots WHERE doctor_id = ? AND starts_at >= datetime('now') ORDER BY starts_at LIMIT 60"
  ).all(params.id);
  return { slots: slots.map((s) => ({ ...s, label: fmtDateTime(s.starts_at) })) };
});

route('POST', '/api/slots', async ({ user, body }) => {
  if (user.role !== 'doctor') throw bad('R\u00e9serv\u00e9 aux m\u00e9decins');
  const { starts_at } = body;
  if (!starts_at) throw bad('Date du cr\u00e9neau requise');
  db.prepare("INSERT INTO slots (doctor_id, starts_at) VALUES (?, ?)").run(user.id, starts_at);
  return { ok: true };
});

route('POST', '/api/appointments', async ({ user, body }) => {
  const { slot_id, reason } = body;
  const slot = db.prepare("SELECT * FROM slots WHERE id = ? AND status = 'free'").get(slot_id);
  if (!slot) throw bad('Ce cr\u00e9neau n\u2019est plus disponible');
  if (slot.doctor_id === user.id) throw bad('Vous ne pouvez pas vous prendre en rendez-vous');
  db.prepare("UPDATE slots SET status = 'booked' WHERE id = ?").run(slot.id);
  const info = db.prepare(
    "INSERT INTO appointments (doctor_id, patient_id, slot_id, reason, status) VALUES (?, ?, ?, ?, 'pending')"
  ).run(slot.doctor_id, user.id, slot.id, (reason || '').slice(0, 500));
  return { appointment_id: Number(info.lastInsertRowid) };
});

route('GET', '/api/appointments', async ({ user }) => {
  const base = `
    SELECT a.id, a.reason, a.status, a.created_at, s.starts_at,
           d.id AS doctor_id, d.name AS doctor_name, d.specialty, d.color AS doctor_color,
           p.id AS patient_id, p.name AS patient_name, p.color AS patient_color
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    JOIN users d ON d.id = a.doctor_id
    JOIN users p ON p.id = a.patient_id`;
  const rows = user.role === 'doctor'
    ? db.prepare(base + ' WHERE a.doctor_id = ? ORDER BY s.starts_at').all(user.id)
    : db.prepare(base + ' WHERE a.patient_id = ? ORDER BY s.starts_at').all(user.id);
  return {
    role: user.role,
    appointments: rows.map((r) => ({ ...r, label: fmtDateTime(r.starts_at) })),
  };
});

route('POST', '/api/appointments/:id/status', async ({ user, params, body }) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(params.id);
  if (!appt) throw bad('Rendez-vous introuvable');
  const isDoctor = appt.doctor_id === user.id;
  const isPatient = appt.patient_id === user.id;
  if (!isDoctor && !isPatient) throw bad('Non autoris\u00e9');
  const status = body.status;
  if (!['confirmed', 'cancelled'].includes(status)) throw bad('Statut invalide');
  if (status === 'confirmed' && !isDoctor) throw bad('Seul le m\u00e9decin peut confirmer');
  if (status === 'cancelled') {
    db.prepare("UPDATE slots SET status = 'free' WHERE id = ? AND status = 'booked'").run(appt.slot_id);
  }
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, appt.id);
  return { ok: true };
});

route('GET', '/api/posts', async ({ user }) => {
  const posts = db.prepare(
    `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.name, u.role, u.specialty, u.color,
       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
       EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC, p.id DESC LIMIT 50`
  ).all(user.id);
  const comments = db.prepare(
    `SELECT c.id, c.post_id, c.content, c.created_at, u.id AS user_id, u.name, u.color
     FROM comments c JOIN users u ON u.id = c.user_id ORDER BY c.created_at ASC, c.id ASC`
  ).all();
  const byPost = {};
  for (const c of comments) (byPost[c.post_id] ||= []).push(c);
  return { posts: posts.map((p) => ({ ...p, comments: byPost[p.id] || [] })) };
});

route('POST', '/api/posts', async ({ user, body }) => {
  if (!body.content || !body.content.trim()) throw bad('Le message ne peut pas \u00eatre vide');
  const info = db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)').run(user.id, body.content.trim().slice(0, 2000));
  return { post_id: Number(info.lastInsertRowid) };
});

route('POST', '/api/posts/:id/like', async ({ user, params }) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(params.id);
  if (!post) throw bad('Publication introuvable');
  const existing = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(params.id, user.id);
  if (existing) db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(params.id, user.id);
  else db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(params.id, user.id);
  return { liked: !existing };
});

route('POST', '/api/posts/:id/comments', async ({ user, params, body }) => {
  if (!body.content || !body.content.trim()) throw bad('Le commentaire ne peut pas \u00eatre vide');
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(params.id, user.id, body.content.trim().slice(0, 500));
  return { ok: true };
});

route('GET', '/api/conversations', async ({ user }) => {
  const convos = db.prepare(
    `SELECT c.id, c.created_at,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_at,
       (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.created_at > COALESCE(
          (SELECT MAX(r.seen_at) FROM (SELECT datetime('now') AS seen_at) r), '1970-01-01')) AS unseen
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?`
  ).all(user.id, user.id);
  const others = db.prepare(
    `SELECT cm.conversation_id, u.id, u.name, u.role, u.specialty, u.color
     FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.user_id != ?`
  ).all(user.id);
  const byConv = {};
  for (const o of others) (byConv[o.conversation_id] ||= []).push(o);
  return {
    conversations: convos
      .filter((c) => byConv[c.id])
      .map((c) => ({ ...c, participants: byConv[c.id] })),
  };
});

route('POST', '/api/conversations', async ({ user, body }) => {
  const otherId = Number(body.with_user_id);
  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
  if (!other) throw bad('Utilisateur introuvable');
  if (otherId === user.id) throw bad('Impossible de discuter avec soi-m\u00eame');
  const existing = db.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
     JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
     WHERE (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2`
  ).get(user.id, otherId);
  if (existing) return { conversation_id: existing.id };
  const info = db.prepare('INSERT INTO conversations DEFAULT VALUES').run();
  const convId = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)');
  ins.run(convId, user.id);
  ins.run(convId, otherId);
  return { conversation_id: Number(convId) };
});

route('GET', '/api/conversations/:id/messages', async ({ user, params }) => {
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(params.id, user.id);
  if (!member) throw bad('Non autoris\u00e9');
  const messages = db.prepare(
    `SELECT m.id, m.content, m.created_at, m.sender_id, u.name, u.color
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC`
  ).all(params.id);
  return { messages };
});

route('POST', '/api/conversations/:id/messages', async ({ user, params, body }) => {
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(params.id, user.id);
  if (!member) throw bad('Non autoris\u00e9');
  if (!body.content || !body.content.trim()) throw bad('Message vide');
  const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)')
    .run(params.id, user.id, body.content.trim().slice(0, 2000));
  return { message_id: Number(info.lastInsertRowid) };
});

route('GET', '/api/users/:id', async ({ params }) => {
  const u = db.prepare('SELECT id, name, role, specialty, city, bio, color, created_at FROM users WHERE id = ?').get(params.id);
  if (!u) throw bad('Utilisateur introuvable');
  const posts = db.prepare(
    `SELECT p.id, p.content, p.created_at,
       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
     FROM posts p WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 20`
  ).all(params.id);
  return { user: u, posts };
});

route('PUT', '/api/me', async ({ user, body }) => {
  const name = (body.name || user.name).trim().slice(0, 80);
  const city = (body.city ?? user.city ?? '').trim().slice(0, 80) || null;
  const bio = (body.bio ?? user.bio ?? '').trim().slice(0, 500);
  const specialty = user.role === 'doctor' ? (body.specialty ?? user.specialty ?? '').trim().slice(0, 80) || null : user.specialty;
  db.prepare('UPDATE users SET name = ?, city = ?, bio = ?, specialty = ? WHERE id = ?')
    .run(name, city, bio, specialty, user.id);
  return { ok: true };
});

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(resolved, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
      if (e2) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
    });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MediSocial démarré sur http://127.0.0.1:${PORT}`);
});
