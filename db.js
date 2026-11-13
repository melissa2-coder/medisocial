const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new DatabaseSync(path.join(DATA_DIR, 'medisocial.db'));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'patient',
  specialty TEXT,
  city TEXT,
  bio TEXT,
  color TEXT NOT NULL DEFAULT '#4267B2',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  patient_id INTEGER NOT NULL REFERENCES users(id),
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

const COLORS = ['#4267B2', '#E4406F', '#0084FF', '#42B72A', '#8E44AD', '#E67E22', '#16A085', '#C0392B'];

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, specialty, city, bio, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const people = [
    ['Dr. Sophie Martin', 'sophie@medisocial.fr', 'doctor', 'Cardiologie', 'Paris', 'Cardiologue au CHU de Paris, 12 ans d\u2019exp\u00e9rience. Consultations du lundi au vendredi.'],
    ['Dr. Karim Benali', 'karim@medisocial.fr', 'doctor', 'Dermatologie', 'Lyon', 'Dermatologue, sp\u00e9cialis\u00e9 en acn\u00e9 et d\u00e9pistage des grains de beaut\u00e9.'],
    ['Dr. Claire Dubois', 'claire@medisocial.fr', 'doctor', 'P\u00e9diatrie', 'Bordeaux', 'P\u00e9diatre, suivi des enfants de 0 \u00e0 16 ans.'],
    ['Dr. Thomas Lefevre', 'thomas@medisocial.fr', 'doctor', 'M\u00e9decine g\u00e9n\u00e9rale', 'Paris', 'M\u00e9decin g\u00e9n\u00e9raliste, consultations sur rendez-vous et t\u00e9l\u00e9consultation.'],
    ['Dr. Am\u00e9lie Rousseau', 'amelie@medisocial.fr', 'doctor', 'Ophtalmologie', 'Marseille', 'Ophtalmologue, bilan visuel et lentilles.'],
    ['Julie Bernard', 'julie@medisocial.fr', 'patient', null, 'Paris', ''],
    ['Marc Petit', 'marc@medisocial.fr', 'patient', null, 'Lyon', ''],
    ['L\u00e9a Moreau', 'lea@medisocial.fr', 'patient', null, 'Bordeaux', ''],
  ];

  let i = 0;
  for (const [name, email, role, specialty, city, bio] of people) {
    insertUser.run(name, email, hashPassword('password123'), role, specialty, city, bio, COLORS[i % COLORS.length]);
    i++;
  }

  const insertPost = db.prepare('INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, datetime(\'now\', ?))');
  insertPost.run(6, 'Bonjour \u00e0 tous ! Inscription faite, content de rejoindre la communaut\u00e9 \uD83D\uDC4B', '-3 days');
  insertPost.run(1, 'Petit rappel : pensez \u00e0 boire suffisamment d\u2019eau et \u00e0 marcher 30 minutes par jour. Votre c\u0153ur vous dira merci \u2764\uFE0F', '-2 days');
  insertPost.run(2, 'N\u2019oubliez pas le sunscreen m\u00eame en hiver ! Le SPF est votre meilleur ami \uD83E\uDDD4', '-1 day');
  insertPost.run(3, 'Semaine de vaccination ouverte \u00e0 Bordeaux, prenez rendez-vous directement depuis mon profil.', '-5 hours');
  insertPost.run(7, 'Quelqu\u2019un conna\u00eet un bon p\u00e9diatre sur Lyon ? Merci d\u2019avance \uD83D\uDE4F', '-2 hours');

  db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(2, 6);
  db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(2, 7);
  db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(4, 6);
  db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, datetime(\'now\', ?))')
    .run(3, 8, 'Super initiative, je r\u00e9serve pour ma fille !', '-3 hours');

  const insertSlot = db.prepare('INSERT INTO slots (doctor_id, starts_at) VALUES (?, ?)');
  const days = [1, 2, 3, 4, 5];
  const hours = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  for (let doctorId = 1; doctorId <= 5; doctorId++) {
    for (let d = 1; d <= 10; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      if (!days.includes(date.getDay())) continue;
      for (const h of hours) {
        const iso = `${date.toISOString().slice(0, 10)}T${h}:00`;
        insertSlot.run(doctorId, iso);
      }
    }
  }
}

seed();

module.exports = { db, hashPassword, verifyPassword };
