const state = {
  user: null,
  view: 'feed',
  posts: [],
  doctors: [],
  doctorFilters: { q: '', specialty: '', city: '' },
  openDoctorId: null,
  conversations: [],
  activeConvId: null,
  messages: [],
  appointments: [],
  appointmentsRole: 'patient',
  profile: null,
  search: '',
};

const root = document.getElementById('root');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function avatarHtml(user, cls = '') {
  return `<div class="avatar ${cls}" style="background:${esc(user.color)}">${esc(initials(user.name))}</div>`;
}

function relative(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'à l\u2019instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/* ---------------- Auth ---------------- */

function renderAuth(mode = 'login') {
  const isRegister = mode === 'register';
  root.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-hero">
      <h1>Medi<span>Social</span></h1>
      <p>Le réseau qui connecte les patients et les médecins : actualités, messagerie et rendez-vous en un seul endroit.</p>
      <ul>
        <li>📰 Fil d'actualité santé</li>
        <li>💬 Messagerie privée</li>
        <li>🩺 Annuaire de médecins &amp; prise de RDV en ligne</li>
      </ul>
    </div>
    <div class="auth-card">
      <h2>${isRegister ? 'Créer un compte' : 'Connexion'}</h2>
      <div id="auth-error"></div>
      <form id="auth-form">
        ${isRegister ? `
        <div class="field">
          <label>Je suis…</label>
          <select name="role" id="role-select">
            <option value="patient">Patient</option>
            <option value="doctor">Médecin</option>
          </select>
        </div>
        <div class="field"><label>Nom complet</label><input name="name" required placeholder="Dr. Jean Dupont"></div>
        <div class="field" id="specialty-field" style="display:none"><label>Spécialité</label><input name="specialty" placeholder="Cardiologie"></div>
        <div class="field"><label>Ville</label><input name="city" placeholder="Paris"></div>` : ''}
        <div class="field"><label>Email</label><input name="email" type="email" required placeholder="vous@exemple.fr"></div>
        <div class="field"><label>Mot de passe</label><input name="password" type="password" required minlength="6"></div>
        <button class="btn ${isRegister ? 'green' : ''}" type="submit">${isRegister ? 'S\u2019inscrire' : 'Se connecter'}</button>
      </form>
      <button class="link-btn" id="toggle-auth">${isRegister ? 'Déjà un compte ? Se connecter' : 'Pas encore de compte ? S\u2019inscrire'}</button>
      ${!isRegister ? `
      <div class="demo-hint">
        <strong>Comptes de démo</strong> (mot de passe : password123)<br>
        Patient : julie@medisocial.fr<br>
        Médecin : sophie@medisocial.fr
      </div>` : ''}
    </div>
  </div>`;

  const roleSelect = document.getElementById('role-select');
  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      document.getElementById('specialty-field').style.display = roleSelect.value === 'doctor' ? '' : 'none';
    });
  }

  document.getElementById('toggle-auth').addEventListener('click', () => renderAuth(isRegister ? 'login' : 'register'));

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const data = await api('POST', isRegister ? '/api/register' : '/api/login', payload);
      state.user = data.user;
      state.view = 'feed';
      await loadApp();
      render();
    } catch (err) {
      document.getElementById('auth-error').innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  });
}

/* ---------------- Shell ---------------- */

function renderShell(content) {
  const unread = state.conversations.reduce((n, c) => n + (c.unseen > 0 ? 1 : 0), 0);
  const tabs = [
    ['feed', '📰 Fil'],
    ['doctors', '🩺 Médecins'],
    ['messages', '💬 Messages'],
    ['appointments', '📅 Mes RDV'],
    ['profile', '👤 Profil'],
  ];
  root.innerHTML = `
  <header class="topbar"><div class="topbar-inner">
    <div class="logo">Medi<span>Social</span></div>
    <nav class="nav-tabs">
      ${tabs.map(([id, label]) => `
        <button class="nav-tab ${state.view === id ? 'active' : ''}" data-view="${id}">
          ${label}${id === 'messages' && unread ? '<span class="dot"></span>' : ''}
        </button>`).join('')}
    </nav>
    <div class="user-chip">
      ${avatarHtml(state.user, 'sm')}
      <span>${esc(state.user.name.split(' ')[0])}</span>
      <button class="logout-btn" id="logout">Déconnexion</button>
    </div>
  </div></header>
  <div class="layout"><div class="col-main" id="main">${content}</div></div>`;

  root.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => { state.view = btn.dataset.view; render(); });
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await api('POST', '/api/logout');
    state.user = null;
    renderAuth();
  });
}

/* ---------------- Feed ---------------- */

async function renderFeed() {
  let feedHtml;
  if (state.search) {
    const data = await api('GET', `/api/doctors?q=${encodeURIComponent(state.search)}`);
    feedHtml = `<div class="card"><h3>🩺 Résultats pour « ${esc(state.search)} »</h3>
      ${data.doctors.length ? data.doctors.map(doctorCardHtml).join('') : '<div class="empty">Aucun médecin trouvé</div>'}
    </div>`;
  } else {
    const data = await api('GET', '/api/posts');
    state.posts = data.posts;
    feedHtml = `
      <div class="card composer-card">
        <div class="composer">
          ${avatarHtml(state.user)}
          <textarea id="post-input" placeholder="Quoi de neuf, ${esc(state.user.name.split(' ')[0])} ?"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button class="btn secondary" style="background:var(--blue);color:#fff" id="post-btn">Publier</button>
        </div>
      </div>
      ${state.posts.map(postHtml).join('')}
      ${state.posts.length ? '' : '<div class="card empty">Aucune publication pour le moment. Lancez la conversation !</div>'}`;
  }

  const side = `
  <div class="col-side">
    <div class="card">
      <h3>🔍 Rechercher un médecin</h3>
      <div class="field"><input id="side-search" placeholder="Nom ou spécialité…"></div>
      <button class="btn green" id="side-search-btn">Rechercher</button>
    </div>
    <div class="card">
      <h3>🩺 Médecins disponibles</h3>
      ${state.doctors.slice(0, 5).map((d) => `
        <div class="doctor-card" style="margin-bottom:10px">
          ${avatarHtml(d, 'sm')}
          <div class="info">
            <div class="name" style="font-size:14px">${esc(d.name)}</div>
            <div class="spec" style="font-size:12px">${esc(d.specialty || '')}</div>
          </div>
          <button class="btn secondary" data-book="${d.id}">RDV</button>
        </div>`).join('') || '<div class="empty">Chargement…</div>'}
    </div>
  </div>`;

  renderShell(feedHtml);
  document.querySelector('.layout').insertAdjacentHTML('beforeend', side);

  const postBtn = document.getElementById('post-btn');
  if (postBtn) {
    postBtn.addEventListener('click', async () => {
      const input = document.getElementById('post-input');
      if (!input.value.trim()) return;
      await api('POST', '/api/posts', { content: input.value });
      input.value = '';
      render();
    });
  }

  const doSearch = () => {
    state.search = document.getElementById('side-search').value.trim();
    render();
  };
  document.getElementById('side-search-btn').addEventListener('click', doSearch);
  document.getElementById('side-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  root.querySelectorAll('[data-like]').forEach((b) => b.addEventListener('click', async () => {
    await api('POST', `/api/posts/${b.dataset.like}/like`);
    render();
  }));
  root.querySelectorAll('[data-comment-toggle]').forEach((b) => b.addEventListener('click', () => {
    const form = document.getElementById(`comment-form-${b.dataset.commentToggle}`);
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    if (form.style.display === 'flex') form.querySelector('input').focus();
  }));
  root.querySelectorAll('[data-comment-post]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    await api('POST', `/api/posts/${form.dataset.commentPost}/comments`, { content: input.value });
    render();
  }));
  root.querySelectorAll('[data-book]').forEach((b) => b.addEventListener('click', () => {
    state.view = 'doctors';
    state.openDoctorId = Number(b.dataset.book);
    state.search = '';
    render();
  }));
  root.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', async () => {
    const data = await api('POST', '/api/conversations', { with_user_id: Number(b.dataset.msg) });
    state.view = 'messages';
    state.activeConvId = data.conversation_id;
    render();
  }));
  root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    state.view = 'doctors';
    state.openDoctorId = Number(b.dataset.doc);
    state.search = '';
    render();
  }));
}

function postHtml(p) {
  return `
  <div class="card post">
    <div class="post-header">
      ${avatarHtml({ name: p.name, color: p.color })}
      <div>
        <div class="who">${esc(p.name)} ${p.role === 'doctor' ? '<span class="badge doctor">Médecin</span>' : ''}</div>
        <div class="when">${relative(p.created_at)}${p.specialty ? ' · ' + esc(p.specialty) : ''}</div>
      </div>
    </div>
    <div class="post-content">${esc(p.content)}</div>
    <div class="post-actions">
      <button class="action-btn ${p.liked_by_me ? 'liked' : ''}" data-like="${p.id}">👍 J'aime · ${p.like_count}</button>
      <button class="action-btn" data-comment-toggle="${p.id}">💬 Commenter · ${p.comment_count}</button>
      ${p.user_id !== state.user.id ? `<button class="action-btn" data-msg="${p.user_id}">✉️ Message</button>` : ''}
    </div>
    ${p.comments.length ? `<div class="comments">${p.comments.map((c) => `
      <div class="comment">
        ${avatarHtml({ name: c.name, color: c.color }, 'sm')}
        <div class="comment-bubble">
          <div class="who">${esc(c.name)}</div>
          <div class="txt">${esc(c.content)}</div>
        </div>
      </div>`).join('')}</div>` : ''}
    <form class="comment-form" id="comment-form-${p.id}" data-comment-post="${p.id}" style="display:none">
      ${avatarHtml(state.user, 'sm')}
      <input placeholder="Écrire un commentaire…">
      <button class="send-btn" type="submit">➤</button>
    </form>
  </div>`;
}

function doctorCardHtml(d) {
  return `
  <div class="card doctor-card">
    ${avatarHtml(d, 'lg')}
    <div class="info">
      <div class="name">${esc(d.name)}</div>
      <div class="spec">${esc(d.specialty || 'Médecin')}</div>
      <div class="meta">📍 ${esc(d.city || 'Ville non précisée')} · ${d.free_slots} créneau(x) disponible(s)</div>
      ${d.bio ? `<div class="meta" style="margin-top:6px">${esc(d.bio)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn secondary" style="background:var(--green);color:#fff" data-doc="${d.id}">Voir les créneaux</button>
        <button class="btn secondary" data-msg="${d.id}">✉️ Contacter</button>
      </div>
    </div>
  </div>`;
}

/* ---------------- Doctors ---------------- */

async function renderDoctors() {
  const f = state.doctorFilters;
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.specialty) params.set('specialty', f.specialty);
  if (f.city) params.set('city', f.city);
  const data = await api('GET', `/api/doctors?${params}`);
  state.doctors = data.doctors;

  let slotsHtml = '';
  if (state.openDoctorId) {
    const doc = state.doctors.find((d) => d.id === state.openDoctorId);
    if (doc) {
      const slotData = await api('GET', `/api/doctors/${doc.id}/slots`);
      slotsHtml = `
      <div class="card">
        <h3>📅 Créneaux — ${esc(doc.name)} ${state.user.role === 'patient' ? '' : '<span style="font-size:13px;color:var(--muted)">(vue médecin)</span>'}</h3>
        ${slotData.slots.length ? `<div class="slot-grid">
          ${slotData.slots.map((s) => s.status === 'free'
            ? `<button class="slot-btn" data-slot="${s.id}" ${state.user.role !== 'patient' ? 'disabled' : ''}>${esc(s.label)}</button>`
            : `<span class="slot-btn" style="border-color:var(--border);background:var(--bg);color:var(--muted);cursor:default">${esc(s.label)} — réservé</span>`).join('')}
        </div>` : '<div class="empty">Aucun créneau disponible</div>'}
      </div>`;
    }
  }

  const specialties = [...new Set(state.doctors.map((d) => d.specialty).filter(Boolean))].sort();
  renderShell(`
    <div class="card">
      <h3>🩺 Annuaire des médecins</h3>
      <div class="search-bar">
        <input id="doc-q" placeholder="Nom ou spécialité…" value="${esc(f.q)}">
        <select id="doc-spec">
          <option value="">Toutes spécialités</option>
          ${specialties.map((s) => `<option ${f.specialty === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <input id="doc-city" placeholder="Ville…" value="${esc(f.city)}" style="max-width:140px">
        <button class="btn green" id="doc-search" style="width:auto;padding:10px 20px">Filtrer</button>
      </div>
    </div>
    ${state.openDoctorId ? slotsHtml : ''}
    ${data.doctors.map(doctorCardHtml).join('') || '<div class="card empty">Aucun médecin ne correspond à votre recherche</div>'}
  `);

  document.getElementById('doc-search').addEventListener('click', () => {
    state.doctorFilters = {
      q: document.getElementById('doc-q').value.trim(),
      specialty: document.getElementById('doc-spec').value,
      city: document.getElementById('doc-city').value.trim(),
    };
    render();
  });

  root.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('Motif de la consultation (optionnel) :') ?? '';
    try {
      await api('POST', '/api/appointments', { slot_id: Number(b.dataset.slot), reason });
      toast('✅ Demande de rendez-vous envoyée !');
      render();
    } catch (err) {
      toast(err.message);
    }
  }));
  root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    state.openDoctorId = Number(b.dataset.doc);
    render();
  }));
  root.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', async () => {
    const data = await api('POST', '/api/conversations', { with_user_id: Number(b.dataset.msg) });
    state.view = 'messages';
    state.activeConvId = data.conversation_id;
    render();
  }));
}

/* ---------------- Messages ---------------- */

let pollTimer = null;

async function renderMessages() {
  const data = await api('GET', '/api/conversations');
  state.conversations = data.conversations;

  if (state.activeConvId && !state.conversations.some((c) => c.id === state.activeConvId)) {
    state.activeConvId = state.conversations[0]?.id || null;
  }
  if (!state.activeConvId && state.conversations.length) state.activeConvId = state.conversations[0].id;

  const active = state.conversations.find((c) => c.id === state.activeConvId);
  const other = active?.participants[0];

  let threadHtml;
  if (active && other) {
    const msgData = await api('GET', `/api/conversations/${active.id}/messages`);
    state.messages = msgData.messages;
    threadHtml = `
    <div class="msg-thread">
      <div class="msg-thread-head">
        ${avatarHtml(other, 'sm')}
        <div>
          <div style="font-weight:700">${esc(other.name)}</div>
          <div style="font-size:12px;color:var(--muted)">${other.role === 'doctor' ? esc(other.specialty || 'Médecin') : 'Patient'}</div>
        </div>
      </div>
      <div class="msg-body" id="msg-body">
        ${state.messages.map((m) => `
          <div class="bubble ${m.sender_id === state.user.id ? 'mine' : 'theirs'}">
            ${esc(m.content)}
            <span class="time">${relative(m.created_at)}</span>
          </div>`).join('') || '<div class="empty">Envoyez le premier message 👋</div>'}
      </div>
      <form class="msg-input" id="msg-form">
        <input id="msg-text" placeholder="Écrivez un message…" autocomplete="off">
        <button class="send-btn" type="submit">➤</button>
      </form>
    </div>`;
  } else {
    threadHtml = '<div class="card msg-thread"><div class="msg-placeholder">Sélectionnez une conversation ou contactez un médecin depuis l\u2019annuaire</div></div>';
  }

  renderShell(`
    <div class="msg-layout">
      <div class="msg-list"><div class="card">
        <h3 style="padding:8px">💬 Conversations</h3>
        ${state.conversations.map((c) => {
          const p = c.participants[0];
          return `
          <button class="convo-item ${c.id === state.activeConvId ? 'active' : ''}" data-conv="${c.id}">
            ${avatarHtml(p, 'sm')}
            <div style="flex:1;min-width:0">
              <div class="name">${esc(p.name)}</div>
              <div class="preview">${esc(c.last_message || 'Nouvelle conversation')}</div>
            </div>
            ${c.unseen > 0 ? `<span class="status pending" style="padding:2px 8px">${c.unseen}</span>` : ''}
          </button>`;
        }).join('') || '<div class="empty">Aucune conversation.<br>Rendez-vous dans l\u2019onglet Médecins pour en démarrer une.</div>'}
      </div></div>
      ${threadHtml}
    </div>
  `);

  root.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => {
    state.activeConvId = Number(b.dataset.conv);
    render();
  }));

  const form = document.getElementById('msg-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('msg-text');
      if (!input.value.trim()) return;
      await api('POST', `/api/conversations/${state.activeConvId}/messages`, { content: input.value });
      input.value = '';
      render();
    });
    const body = document.getElementById('msg-body');
    if (body) body.scrollTop = body.scrollHeight;
    document.getElementById('msg-text').focus();
  }

  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (state.view !== 'messages' || !state.activeConvId) return;
    try {
      const [convData, msgData] = await Promise.all([
        api('GET', '/api/conversations'),
        api('GET', `/api/conversations/${state.activeConvId}/messages`),
      ]);
      const newCount = msgData.messages.length;
      if (newCount !== state.messages.length || JSON.stringify(convData.conversations) !== JSON.stringify(state.conversations)) {
        state.conversations = convData.conversations;
        state.messages = msgData.messages;
        render();
      }
    } catch { /* session expirée */ }
  }, 3000);
}

/* ---------------- Appointments ---------------- */

async function renderAppointments() {
  const data = await api('GET', '/api/appointments');
  state.appointments = data.appointments;
  state.appointmentsRole = data.role;

  const isDoctor = data.role === 'doctor';
  renderShell(`
    <div class="card">
      <h3>📅 ${isDoctor ? 'Rendez-vous reçus' : 'Mes rendez-vous'}</h3>
      ${data.appointments.length ? data.appointments.map((a) => {
        const who = isDoctor
          ? { name: a.patient_name, color: a.patient_color }
          : { name: a.doctor_name, color: a.doctor_color };
        return `
        <div class="appt-row">
          <div class="when">🗓️ ${esc(a.label)}</div>
          <div class="who">
            <div style="font-weight:600">${avatarHtmlInline(who)} ${esc(who.name)} ${isDoctor ? '(patient)' : esc(a.specialty ? '· ' + a.specialty : '')}</div>
            ${a.reason ? `<div class="reason">Motif : ${esc(a.reason)}</div>` : ''}
          </div>
          <span class="status ${a.status}">${a.status === 'pending' ? 'En attente' : a.status === 'confirmed' ? 'Confirmé' : 'Annulé'}</span>
          <div class="appt-actions">
            ${isDoctor && a.status === 'pending' ? `<button class="btn secondary" style="background:var(--green);color:#fff" data-confirm="${a.id}">Confirmer</button>` : ''}
            ${a.status !== 'cancelled' ? `<button class="btn danger" data-cancel="${a.id}">Annuler</button>` : ''}
          </div>
        </div>`;
      }).join('') : `<div class="empty">${isDoctor
        ? 'Aucune demande de rendez-vous pour le moment.'
        : 'Aucun rendez-vous. Trouvez un médecin dans l\u2019onglet 🩺 Médecins.'}</div>`}
    </div>
    ${isDoctor ? `
    <div class="card">
      <h3>➕ Ouvrir de nouveaux créneaux</h3>
      <div class="search-bar">
        <input type="datetime-local" id="slot-date">
        <button class="btn green" id="slot-add" style="width:auto;padding:10px 20px">Ajouter le créneau</button>
      </div>
    </div>` : ''}
  `);

  root.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
    await api('POST', `/api/appointments/${b.dataset.confirm}/status`, { status: 'confirmed' });
    toast('✅ Rendez-vous confirmé');
    render();
  }));
  root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    await api('POST', `/api/appointments/${b.dataset.cancel}/status`, { status: 'cancelled' });
    toast('Rendez-vous annulé');
    render();
  }));

  const slotAdd = document.getElementById('slot-add');
  if (slotAdd) {
    slotAdd.addEventListener('click', async () => {
      const value = document.getElementById('slot-date').value;
      if (!value) return toast('Choisissez une date et une heure');
      await api('POST', '/api/slots', { starts_at: value + ':00' });
      toast('✅ Créneau ajouté');
      render();
    });
  }
}

function avatarHtmlInline(user) {
  return `<span class="avatar" style="display:inline-flex;width:22px;height:22px;font-size:10px;vertical-align:middle;background:${esc(user.color)}">${esc(initials(user.name))}</span>`;
}

/* ---------------- Profile ---------------- */

async function renderProfile() {
  const data = await api('GET', `/api/users/${state.user.id}`);
  state.profile = data;
  const u = data.user;
  renderShell(`
    <div class="card">
      <div class="profile-head">
        ${avatarHtml(u, 'lg')}
        <div>
          <h2>${esc(u.name)} ${u.role === 'doctor' ? '<span class="badge doctor">Médecin</span>' : '<span class="badge patient">Patient</span>'}</h2>
          <div class="meta">${u.specialty ? esc(u.specialty) + ' · ' : ''}${esc(u.city || '')} · Membre depuis ${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</div>
        </div>
      </div>
    </div>
    <div class="card profile-form">
      <h3>✏️ Modifier mon profil</h3>
      <form id="profile-form">
        <div class="field"><label>Nom</label><input name="name" value="${esc(u.name)}" required></div>
        <div class="field"><label>Ville</label><input name="city" value="${esc(u.city || '')}"></div>
        ${u.role === 'doctor' ? `<div class="field"><label>Spécialité</label><input name="specialty" value="${esc(u.specialty || '')}"></div>` : ''}
        <div class="field"><label>Bio</label><textarea name="bio">${esc(u.bio || '')}</textarea></div>
        <button class="btn" type="submit" style="width:auto;padding:10px 24px">Enregistrer</button>
      </form>
    </div>
    <div class="card">
      <h3>📝 Mes publications</h3>
      ${data.posts.length ? data.posts.map((p) => `
        <div class="appt-row">
          <div class="who"><div class="post-content">${esc(p.content)}</div>
          <div class="reason">${relative(p.created_at)} · 👍 ${p.like_count}</div></div>
        </div>`).join('') : '<div class="empty">Aucune publication</div>'}
    </div>
  `);

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api('PUT', '/api/me', payload);
    const me = await api('GET', '/api/me');
    state.user = me.user;
    toast('✅ Profil mis à jour');
    render();
  });
}

/* ---------------- Router ---------------- */

async function render() {
  clearInterval(pollTimer);
  try {
    if (state.view === 'feed') await renderFeed();
    else if (state.view === 'doctors') await renderDoctors();
    else if (state.view === 'messages') await renderMessages();
    else if (state.view === 'appointments') await renderAppointments();
    else if (state.view === 'profile') await renderProfile();
  } catch (err) {
    if (err.message === 'Connexion requise') { state.user = null; renderAuth(); return; }
    renderShell(`<div class="card empty">⚠️ ${esc(err.message)}</div>`);
  }
}

async function loadApp() {
  const data = await api('GET', '/api/conversations');
  state.conversations = data.conversations;
  const docs = await api('GET', '/api/doctors');
  state.doctors = docs.doctors;
}

(async function init() {
  try {
    const me = await api('GET', '/api/me');
    if (me.user) {
      state.user = me.user;
      await loadApp();
      render();
      return;
    }
  } catch { /* non connecté */ }
  renderAuth();
})();
