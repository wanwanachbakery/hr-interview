/**
 * server.js - HR-WWN
 * Node + Express, JSON files for storage. Runs at http://localhost:3000
 *
 * Phase 1+2: Per-user accounts, 5-tier RBAC, full org tree
 *   Company -> Divisions (ฝ่าย) -> Sections (แผนก) -> Positions (ตำแหน่ง)
 *   Roles: admin, executive, manager, division_head, section_head, officer
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ai = require('./scripts/mock-ai');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const INTERVIEW_DIR = path.join(DATA_DIR, 'interviews');
const OUTPUT_DIR = path.join(ROOT, 'outputs');

const F = {
  employees: path.join(DATA_DIR, 'employees.json'),
  divisions: path.join(DATA_DIR, 'divisions.json'),
  sections:  path.join(DATA_DIR, 'sections.json'),
  positions: path.join(DATA_DIR, 'positions.json'),
  users:     path.join(DATA_DIR, 'users.json'),
  company:   path.join(DATA_DIR, 'company.json'),
  auth:      path.join(DATA_DIR, 'auth.json'),
  secret:    path.join(DATA_DIR, '.secret'),
};

for (const d of [DATA_DIR, INTERVIEW_DIR, OUTPUT_DIR, path.join(OUTPUT_DIR, '_company')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
const ensure = (p, def) => { if (!fs.existsSync(p)) fs.writeFileSync(p, def); };
ensure(F.employees, '[]');
ensure(F.divisions, '[]');
ensure(F.sections, '[]');
ensure(F.positions, '[]');
ensure(F.users, '[]');
ensure(F.company, JSON.stringify({ name: 'บริษัทตัวอย่าง จำกัด', name_en: 'Sample Company Ltd.' }, null, 2));
ensure(F.auth, JSON.stringify({ master: 'JC2026!Init' }, null, 2));

// Production hardening flag — when behind HTTPS proxy (Cloudflare Tunnel),
// set SECURE_COOKIES=true so the auth cookie carries the Secure flag.
const SECURE_COOKIES = String(process.env.SECURE_COOKIES || '').toLowerCase() === 'true';
const cookieSuffix = SECURE_COOKIES ? '; Secure' : '';

let SECRET;
if (fs.existsSync(F.secret)) {
  SECRET = fs.readFileSync(F.secret, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(F.secret, SECRET);
}

// Migrate legacy plain-text master password to a salted scrypt hash so
// data/auth.json stops leaking the password if shared/backed-up.
(function migrateAuth() {
  const raw = (() => { try { return JSON.parse(fs.readFileSync(F.auth, 'utf8')); } catch { return null; } })();
  if (!raw || typeof raw.master !== 'string') return;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(raw.master), salt, 64).toString('hex');
  fs.writeFileSync(F.auth, JSON.stringify({
    master_salt: salt, master_hash: hash,
    migrated_at: new Date().toISOString(),
  }, null, 2));
  console.log('[migration] master password hashed (was plain text)');
})();

// ---------- JSON helpers ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
const load = {
  employees: () => readJson(F.employees, []),
  divisions: () => readJson(F.divisions, []),
  sections:  () => readJson(F.sections, []),
  positions: () => readJson(F.positions, []),
  users:     () => readJson(F.users, []),
  company:   () => readJson(F.company, { name: '', name_en: '' }),
  auth:      () => readJson(F.auth, { master: '' }),
};
const save = {
  employees: (l) => writeJson(F.employees, l),
  divisions: (l) => writeJson(F.divisions, l),
  sections:  (l) => writeJson(F.sections, l),
  positions: (l) => writeJson(F.positions, l),
  users:     (l) => writeJson(F.users, l),
  company:   (o) => writeJson(F.company, o),
};
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- password ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

// ---------- token / cookies ----------
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function parseCookie(req, name) {
  const raw = req.headers.cookie || '';
  const re = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)');
  const m = raw.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- middleware ----------
const PUBLIC_PATHS = new Set([
  '/login', '/api/login', '/api/logout', '/api/lang',
  '/styles.css', '/favicon.ico', '/i18n.js', '/logo.png'
]);
function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  const token = parseCookie(req, 'auth');
  const session = verifyToken(token);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login');
  }
  req.session = session;
  next();
}
function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'admin only' });
    return res.redirect('/');
  }
  next();
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session?.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'forbidden' });
      return res.redirect('/');
    }
    next();
  };
}

// ---------- User schedule helpers ----------
// Convert "HH:MM" string to integer hour (floor). Returns null if invalid.
function timeToHour(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) : null;
}
// Build interview hours from a user's work_start/work_end/break_start/break_end.
// Returns { start, end, lunchStart, lunchEnd, hours[] } or null when invalid.
function calcUserHours(user) {
  if (!user) return null;
  const start = timeToHour(user.work_start);
  const end = timeToHour(user.work_end);
  if (start == null || end == null || end <= start) return null;
  const lunchStart = timeToHour(user.break_start);
  const lunchEnd = timeToHour(user.break_end);
  const hours = [];
  for (let h = start; h < end; h++) {
    if (lunchStart != null && lunchEnd != null && h >= lunchStart && h < lunchEnd) continue;
    hours.push(h);
  }
  return { start, end, lunchStart, lunchEnd, hours };
}

// ---------- Position-anchored employee helpers ----------
// snapshotEmployeeFromUser: build a fresh emp record from a user's current scope.
// All names/IDs are frozen at this moment so archived records stay accurate over time.
function snapshotEmployeeFromUser(user) {
  const pos = load.positions().find(p => p.id === user.position_id);
  const sec = load.sections().find(s => s.id === user.section_id);
  const div = load.divisions().find(d => d.id === user.division_id);
  return {
    id: 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    position_id: user.position_id,
    user_id: user.id,
    name: user.name,
    role: pos?.name || '',
    division_id: user.division_id,
    division_name: div?.name || '',
    section_id: user.section_id,
    section_name: sec?.name || '',
    department: '',
    primary_duty: '',
    email: '',
    owner_user_id: user.id,
    archived: false,
    vacated_at: null,
    vacated_reason: null,
    createdAt: new Date().toISOString(),
    interviewStatus: 'not_started',
  };
}

// Auto-create active emp for user (idempotent).
function autoCreateEmployeeForUser(user) {
  if (!user.position_id) return null;  // can't anchor without a position
  const emps = load.employees();
  const existing = emps.find(e => e.user_id === user.id && !e.archived);
  if (existing) return existing;
  const emp = snapshotEmployeeFromUser(user);
  emps.push(emp);
  save.employees(emps);
  return emp;
}

// Archive active emp for user. Returns the archived record or null.
function archiveEmployeeForUser(userId, reason) {
  const emps = load.employees();
  let archived = null;
  for (const e of emps) {
    if (e.user_id === userId && !e.archived) {
      e.archived = true;
      e.vacated_at = new Date().toISOString();
      e.vacated_reason = reason || 'unspecified';
      e.user_id = null;
      archived = e;
    }
  }
  if (archived) save.employees(emps);
  return archived;
}

// ---------- RBAC scope check ----------
// target = { division_id, section_id, position_id }
// canEdit = same as canView for section_head and above; officer cannot rename anything.
function canEdit(session, target) {
  if (!session) return false;
  const r = session.role;
  if (r === 'admin' || r === 'executive') return true;
  if (r === 'officer') return false;
  return canView(session, target);
}
function canView(session, target) {
  if (!session) return false;
  const r = session.role;
  if (r === 'admin' || r === 'executive') return true;

  const myDiv = session.division_id;
  const mySec = session.section_id;
  const myPos = session.position_id;
  const ov = session.scope_override || { divisions: [], sections: [], positions: [] };

  if (r === 'manager') {
    if (target.division_id && target.division_id === myDiv) return true;
    if (target.division_id && (ov.divisions || []).includes(target.division_id)) return true;
    if (target.section_id && (ov.sections || []).includes(target.section_id)) return true;
    if (target.position_id && (ov.positions || []).includes(target.position_id)) return true;
    return false;
  }
  if (r === 'division_head') {
    return !!target.division_id && target.division_id === myDiv;
  }
  if (r === 'section_head') {
    return !!target.section_id && target.section_id === mySec;
  }
  if (r === 'officer') {
    return !!target.position_id && target.position_id === myPos;
  }
  return false;
}

// ---------- app ----------
const app = express();
// Trust the first proxy (Cloudflare Tunnel / similar) so req.ip and req.secure
// reflect the real client, not 127.0.0.1.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(authMiddleware);
app.use(express.static(path.join(ROOT, 'public')));

// ---------- Login rate limit (in-memory; resets on restart) ----------
// 5 failed attempts in 5 minutes → block that IP for 15 minutes.
const RL_WINDOW = 5 * 60 * 1000;
const RL_MAX = 5;
const RL_BLOCK = 15 * 60 * 1000;
const rlMap = new Map();
function rlCheck(ip) {
  const now = Date.now();
  const r = rlMap.get(ip);
  if (!r) return { allowed: true };
  if (r.blockedUntil && r.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((r.blockedUntil - now) / 1000) };
  }
  if (r.firstAttempt < now - RL_WINDOW) {
    rlMap.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}
function rlFail(ip) {
  const now = Date.now();
  let r = rlMap.get(ip);
  if (!r || r.firstAttempt < now - RL_WINDOW) {
    r = { count: 0, firstAttempt: now };
    rlMap.set(ip, r);
  }
  r.count++;
  if (r.count >= RL_MAX) r.blockedUntil = now + RL_BLOCK;
}
function rlOk(ip) { rlMap.delete(ip); }

// ---------- login ----------
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const gate = rlCheck(ip);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error: `เข้าสู่ระบบล้มเหลวบ่อยเกินไป — ลองใหม่อีก ${gate.retryAfter} วินาที` });
  }

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'กรอก username และ password' });

  // master admin
  if (username === 'admin') {
    const auth = load.auth();
    let ok = false;
    if (auth.master_hash && auth.master_salt) {
      ok = verifyPassword(password, auth.master_salt, auth.master_hash);
    } else if (auth.master) {
      ok = password === auth.master;  // legacy fallback (should be migrated on startup)
    }
    if (!ok) {
      rlFail(ip);
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    rlOk(ip);
    const token = signToken({ role: 'admin', username: 'admin', exp: Date.now() + 7*24*3600*1000 });
    res.setHeader('Set-Cookie', `auth=${token}; Path=/; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=${7*24*3600}`);
    return res.json({ ok: true, role: 'admin', name: 'ผู้ดูแลระบบ' });
  }

  // named user
  const users = load.users();
  const u = users.find(x => x.username === username);
  if (!u || !verifyPassword(password, u.password_salt, u.password_hash)) {
    rlFail(ip);
    return res.status(401).json({ error: 'username หรือรหัสผ่านไม่ถูกต้อง' });
  }
  rlOk(ip);
  const payload = {
    user_id: u.id, username: u.username, name: u.name, role: u.role,
    division_id: u.division_id || null,
    section_id:  u.section_id  || null,
    position_id: u.position_id || null,
    scope_override: u.scope_override || null,
    exp: Date.now() + 7*24*3600*1000,
  };
  const token = signToken(payload);
  res.setHeader('Set-Cookie', `auth=${token}; Path=/; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=${7*24*3600}`);
  res.json({ ok: true, role: u.role, name: u.name });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `auth=; Path=/; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = req.session;
  if (s.role === 'admin') {
    return res.json({ role: 'admin', username: 'admin', name: 'ผู้ดูแลระบบ' });
  }
  const div = load.divisions().find(d => d.id === s.division_id);
  const sec = load.sections().find(x => x.id === s.section_id);
  const pos = load.positions().find(p => p.id === s.position_id);
  res.json({
    role: s.role, user_id: s.user_id, username: s.username, name: s.name,
    division_id: s.division_id, division_name: div?.name || null,
    section_id: s.section_id,  section_name:  sec?.name || null,
    position_id: s.position_id, position_name: pos?.name || null,
    scope_override: s.scope_override || null,
  });
});

// ---------- Company ----------
app.get('/api/company', (req, res) => res.json(load.company()));
app.put('/api/company', requireAdmin, (req, res) => {
  const { name, name_en } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'กรอกชื่อบริษัท' });
  const obj = {
    name: String(name).trim(),
    name_en: String(name_en || '').trim(),
    updated_at: new Date().toISOString(),
  };
  save.company(obj);
  res.json(obj);
});

// ---------- Divisions ----------
app.get('/api/divisions', (req, res) => {
  const divs = load.divisions();
  const s = req.session;
  if (s.role === 'admin' || s.role === 'executive') return res.json(divs);
  res.json(divs.filter(d => canView(s, { division_id: d.id })));
});
app.post('/api/divisions', requireAdmin, (req, res) => {
  const { name, name_en, icon, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'ต้องใส่ชื่อฝ่าย' });
  const list = load.divisions();
  if (list.some(d => d.name === String(name).trim())) return res.status(400).json({ error: 'มีฝ่ายชื่อนี้แล้ว' });
  const div = {
    id: genId('div'),
    name: String(name).trim(),
    name_en: String(name_en || '').trim(),
    icon: icon || '🏢',
    color: color || '#3b82f6',
    created_at: new Date().toISOString(),
  };
  list.push(div);
  save.divisions(list);
  res.json(div);
});
app.put('/api/divisions/:id', (req, res) => {
  const list = load.divisions();
  const d = list.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  if (!canEdit(req.session, { division_id: d.id })) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ฝ่ายนี้' });
  }
  const { name, name_en, icon, color } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'ชื่อฝ่ายห้ามว่าง' });
    d.name = String(name).trim();
  }
  if (name_en !== undefined) d.name_en = String(name_en).trim();
  if (icon !== undefined) d.icon = icon;
  if (color !== undefined) d.color = color;
  d.updated_at = new Date().toISOString();
  save.divisions(list);
  res.json(d);
});
app.delete('/api/divisions/:id', requireAdmin, (req, res) => {
  const list = load.divisions();
  const idx = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const id = req.params.id;
  if (load.sections().some(s => s.division_id === id)) return res.status(400).json({ error: 'ลบไม่ได้: มีแผนกในฝ่ายนี้อยู่' });
  if (load.users().some(u => u.division_id === id)) return res.status(400).json({ error: 'ลบไม่ได้: มี user ในฝ่ายนี้อยู่' });
  list.splice(idx, 1);
  save.divisions(list);
  res.json({ ok: true });
});

// ---------- Sections ----------
app.get('/api/sections', (req, res) => {
  let list = load.sections();
  const { division_id } = req.query;
  if (division_id) list = list.filter(s => s.division_id === division_id);
  const s = req.session;
  if (s.role !== 'admin' && s.role !== 'executive') {
    list = list.filter(x => canView(s, { division_id: x.division_id, section_id: x.id }));
  }
  res.json(list);
});
app.post('/api/sections', requireAdmin, (req, res) => {
  const { name, name_en, division_id } = req.body || {};
  if (!name || !division_id) return res.status(400).json({ error: 'ต้องใส่ชื่อแผนกและเลือกฝ่าย' });
  if (!load.divisions().some(d => d.id === division_id)) return res.status(400).json({ error: 'ไม่พบฝ่าย' });
  const list = load.sections();
  if (list.some(s => s.division_id === division_id && s.name === String(name).trim())) {
    return res.status(400).json({ error: 'มีแผนกชื่อนี้ในฝ่ายนี้แล้ว' });
  }
  const sec = {
    id: genId('sec'),
    division_id,
    name: String(name).trim(),
    name_en: String(name_en || '').trim(),
    created_at: new Date().toISOString(),
  };
  list.push(sec);
  save.sections(list);
  res.json(sec);
});
app.put('/api/sections/:id', (req, res) => {
  const list = load.sections();
  const sec = list.find(x => x.id === req.params.id);
  if (!sec) return res.status(404).json({ error: 'not found' });
  if (!canEdit(req.session, { division_id: sec.division_id, section_id: sec.id })) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้แผนกนี้' });
  }
  // Non-admin cannot move a section to a different division
  if (req.body && req.body.division_id !== undefined && req.body.division_id !== sec.division_id && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'admin เท่านั้นที่ย้ายแผนกระหว่างฝ่ายได้' });
  }
  const { name, name_en, division_id } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'ชื่อแผนกห้ามว่าง' });
    sec.name = String(name).trim();
  }
  if (name_en !== undefined) sec.name_en = String(name_en).trim();
  if (division_id !== undefined) {
    if (!load.divisions().some(d => d.id === division_id)) return res.status(400).json({ error: 'ไม่พบฝ่าย' });
    sec.division_id = division_id;
  }
  sec.updated_at = new Date().toISOString();
  save.sections(list);
  res.json(sec);
});
app.delete('/api/sections/:id', requireAdmin, (req, res) => {
  const list = load.sections();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const id = req.params.id;
  if (load.positions().some(p => p.section_id === id)) return res.status(400).json({ error: 'ลบไม่ได้: มีตำแหน่งในแผนกนี้อยู่' });
  if (load.users().some(u => u.section_id === id)) return res.status(400).json({ error: 'ลบไม่ได้: มี user ในแผนกนี้อยู่' });
  list.splice(idx, 1);
  save.sections(list);
  res.json({ ok: true });
});

// ---------- Positions ----------
app.get('/api/positions', (req, res) => {
  let list = load.positions();
  const { section_id, division_id } = req.query;
  if (section_id) list = list.filter(p => p.section_id === section_id);
  if (division_id) {
    const secIds = new Set(load.sections().filter(s => s.division_id === division_id).map(s => s.id));
    list = list.filter(p => secIds.has(p.section_id));
  }
  const s = req.session;
  if (s.role !== 'admin' && s.role !== 'executive') {
    const secMap = Object.fromEntries(load.sections().map(x => [x.id, x]));
    list = list.filter(p => {
      const sec = secMap[p.section_id];
      return canView(s, { division_id: sec?.division_id, section_id: p.section_id, position_id: p.id });
    });
  }
  res.json(list);
});
app.post('/api/positions', requireAdmin, (req, res) => {
  const { name, name_en, section_id } = req.body || {};
  if (!name || !section_id) return res.status(400).json({ error: 'ต้องใส่ชื่อตำแหน่งและเลือกแผนก' });
  if (!load.sections().some(s => s.id === section_id)) return res.status(400).json({ error: 'ไม่พบแผนก' });
  const list = load.positions();
  if (list.some(p => p.section_id === section_id && p.name === String(name).trim())) {
    return res.status(400).json({ error: 'มีตำแหน่งชื่อนี้ในแผนกนี้แล้ว' });
  }
  const pos = {
    id: genId('pos'),
    section_id,
    name: String(name).trim(),
    name_en: String(name_en || '').trim(),
    created_at: new Date().toISOString(),
  };
  list.push(pos);
  save.positions(list);
  res.json(pos);
});
app.put('/api/positions/:id', (req, res) => {
  const list = load.positions();
  const p = list.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const parentSec = load.sections().find(s => s.id === p.section_id);
  if (!canEdit(req.session, { division_id: parentSec?.division_id, section_id: p.section_id, position_id: p.id })) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ตำแหน่งนี้' });
  }
  if (req.body && req.body.section_id !== undefined && req.body.section_id !== p.section_id && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'admin เท่านั้นที่ย้ายตำแหน่งระหว่างแผนกได้' });
  }
  const { name, name_en, section_id } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'ชื่อตำแหน่งห้ามว่าง' });
    p.name = String(name).trim();
  }
  if (name_en !== undefined) p.name_en = String(name_en).trim();
  if (section_id !== undefined) {
    if (!load.sections().some(s => s.id === section_id)) return res.status(400).json({ error: 'ไม่พบแผนก' });
    p.section_id = section_id;
  }
  p.updated_at = new Date().toISOString();
  save.positions(list);
  res.json(p);
});
app.delete('/api/positions/:id', requireAdmin, (req, res) => {
  const list = load.positions();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  if (load.users().some(u => u.position_id === req.params.id)) {
    return res.status(400).json({ error: 'ลบไม่ได้: มี user ในตำแหน่งนี้อยู่' });
  }
  // Position-anchored model: also block delete if ANY emp record (active OR archived)
  // still references this position — they hold the interview history.
  if (load.employees().some(e => e.position_id === req.params.id)) {
    return res.status(400).json({ error: 'ลบไม่ได้: ตำแหน่งนี้มีประวัติ interview ค้างอยู่ (active หรือ archived)' });
  }
  list.splice(idx, 1);
  save.positions(list);
  res.json({ ok: true });
});

// History view per position — all emp records (active + archived) for this position.
app.get('/api/positions/:id/history', (req, res) => {
  const pos = load.positions().find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ error: 'not found' });
  const sec = load.sections().find(s => s.id === pos.section_id);
  // Anyone who can view emp records at this scope can see history.
  if (!canViewEmployee(req.session, { division_id: sec?.division_id, section_id: pos.section_id, position_id: pos.id })) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูประวัติตำแหน่งนี้' });
  }
  const emps = load.employees()
    .filter(e => e.position_id === req.params.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ position: pos, history: emps });
});

// ---------- Users ----------
const ROLES = ['executive', 'manager', 'division_head', 'section_head', 'officer'];
const stripSecret = ({ password_hash, password_salt, ...rest }) => rest;

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(load.users().map(stripSecret));
});

function validateScope(role, { division_id, section_id, position_id }, divs, secs, poss) {
  if (division_id && !divs.find(d => d.id === division_id)) return 'ไม่พบฝ่าย';
  if (section_id && !secs.find(s => s.id === section_id)) return 'ไม่พบแผนก';
  if (position_id && !poss.find(p => p.id === position_id)) return 'ไม่พบตำแหน่ง';
  if (section_id && division_id) {
    const sec = secs.find(s => s.id === section_id);
    if (sec && sec.division_id !== division_id) return 'แผนกที่เลือกไม่อยู่ในฝ่ายนี้';
  }
  if (position_id && section_id) {
    const pos = poss.find(p => p.id === position_id);
    if (pos && pos.section_id !== section_id) return 'ตำแหน่งที่เลือกไม่อยู่ในแผนกนี้';
  }
  // Position-anchored model: every non-admin user must have all 3 scope fields,
  // because their interview record is anchored to a specific position.
  if (!division_id || !section_id || !position_id) {
    return 'ต้องระบุฝ่าย / แผนก / ตำแหน่ง ครบทั้ง 3 ฟิลด์ (ตามโมเดล Position-anchored)';
  }
  return null;
}

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, name, role,
          division_id, section_id, position_id,
          work_start, work_end, break_start, break_end,
          scope_override } = req.body || {};
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'ต้องใส่ username, password, ชื่อ, role' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  if (username === 'admin') return res.status(400).json({ error: 'ห้ามใช้ username "admin"' });
  const list = load.users();
  if (list.some(u => u.username === username)) return res.status(400).json({ error: 'มี username นี้แล้ว' });

  const err = validateScope(role,
    { division_id, section_id, position_id },
    load.divisions(), load.sections(), load.positions());
  if (err) return res.status(400).json({ error: err });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const user = {
    id: genId('usr'),
    username: String(username).trim(),
    name: String(name).trim(),
    password_salt: salt,
    password_hash: hash,
    role,
    division_id: division_id || null,
    section_id:  section_id  || null,
    position_id: position_id || null,
    work_start: work_start || '09:00',
    work_end:   work_end   || '18:00',
    break_start: break_start || '12:00',
    break_end:   break_end   || '13:00',
    scope_override: role === 'manager' ? (scope_override || null) : null,
    created_at: new Date().toISOString(),
  };
  list.push(user);
  save.users(list);
  // Auto-create the user's anchor employee record (position-anchored model).
  autoCreateEmployeeForUser(user);
  res.json(stripSecret(user));
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const list = load.users();
  const u = list.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });

  const prevPositionId = u.position_id;
  const body = req.body || {};
  const next = {
    role: body.role ?? u.role,
    division_id: body.division_id !== undefined ? (body.division_id || null) : u.division_id,
    section_id:  body.section_id  !== undefined ? (body.section_id  || null) : u.section_id,
    position_id: body.position_id !== undefined ? (body.position_id || null) : u.position_id,
  };
  if (!ROLES.includes(next.role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  const err = validateScope(next.role, next, load.divisions(), load.sections(), load.positions());
  if (err) return res.status(400).json({ error: err });

  if (body.username !== undefined) {
    if (body.username === 'admin') return res.status(400).json({ error: 'ห้ามใช้ username "admin"' });
    if (list.some(x => x.username === body.username && x.id !== u.id)) return res.status(400).json({ error: 'มี username นี้แล้ว' });
    u.username = String(body.username).trim();
  }
  if (body.password) {
    const salt = crypto.randomBytes(16).toString('hex');
    u.password_salt = salt;
    u.password_hash = hashPassword(body.password, salt);
  }
  if (body.name !== undefined) u.name = String(body.name).trim();
  u.role = next.role;
  u.division_id = next.division_id;
  u.section_id  = next.section_id;
  u.position_id = next.position_id;
  if (body.work_start !== undefined) u.work_start = body.work_start;
  if (body.work_end   !== undefined) u.work_end   = body.work_end;
  if (body.break_start !== undefined) u.break_start = body.break_start;
  if (body.break_end   !== undefined) u.break_end   = body.break_end;
  if (body.scope_override !== undefined) {
    u.scope_override = u.role === 'manager' ? (body.scope_override || null) : null;
  } else if (u.role !== 'manager') {
    u.scope_override = null;
  }
  u.updated_at = new Date().toISOString();
  save.users(list);
  // If the user's position changed, archive the old anchor emp + create a fresh one.
  // (Name change alone doesn't trigger reset — only position move does.)
  if (prevPositionId !== u.position_id) {
    archiveEmployeeForUser(u.id, 'position_change');
    autoCreateEmployeeForUser(u);
  }
  res.json(stripSecret(u));
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const list = load.users();
  const idx = list.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const removed = list[idx];
  list.splice(idx, 1);
  save.users(list);
  // Archive the user's emp record (keep interview answers as position history).
  archiveEmployeeForUser(removed.id, 'user_deleted');
  res.json({ ok: true });
});

// Self profile
app.get('/api/me/profile', (req, res) => {
  if (req.session.role === 'admin') return res.json(null);
  const u = load.users().find(x => x.id === req.session.user_id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json(stripSecret(u));
});

// Self profile update — user edits own work times + own password.
// Cannot change role / scope / division / section / position (admin only).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
app.put('/api/me/profile', (req, res) => {
  if (req.session.role === 'admin') return res.status(400).json({ error: 'admin ไม่มีโปรไฟล์ส่วนตัว' });
  const list = load.users();
  const u = list.find(x => x.id === req.session.user_id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const { work_start, work_end, break_start, break_end, password, name } = req.body || {};
  for (const [k, v] of Object.entries({ work_start, work_end, break_start, break_end })) {
    if (v !== undefined && v !== null && v !== '' && !TIME_RE.test(v)) {
      return res.status(400).json({ error: `รูปแบบเวลาผิด (${k}) ต้องเป็น HH:MM` });
    }
  }
  if (work_start !== undefined) u.work_start = work_start;
  if (work_end !== undefined) u.work_end = work_end;
  if (break_start !== undefined) u.break_start = break_start;
  if (break_end !== undefined) u.break_end = break_end;
  if (name !== undefined) u.name = String(name).trim();
  if (password) {
    const salt = crypto.randomBytes(16).toString('hex');
    u.password_salt = salt;
    u.password_hash = hashPassword(password, salt);
  }
  u.updated_at = new Date().toISOString();
  save.users(list);
  res.json(stripSecret(u));
});

// ---------- Reports ----------
function userVisibleTo(session, user) {
  return canView(session, {
    division_id: user.division_id,
    section_id: user.section_id,
    position_id: user.position_id,
  });
}

// Users visible to the current session (officer = self only; head/manager/exec/admin per scope).
// Returns users WITHOUT password fields.
app.get('/api/reports/users', (req, res) => {
  const s = req.session;
  const all = load.users().map(stripSecret);
  let visible;
  if (s.role === 'admin' || s.role === 'executive') {
    visible = all;
  } else if (s.role === 'officer') {
    visible = all.filter(u => u.id === s.user_id);
  } else {
    visible = all.filter(u => userVisibleTo(s, u));
  }
  // Enrich with org names for convenience
  const divMap = Object.fromEntries(load.divisions().map(d => [d.id, d.name]));
  const secMap = Object.fromEntries(load.sections().map(x => [x.id, x.name]));
  const posMap = Object.fromEntries(load.positions().map(p => [p.id, p.name]));
  res.json(visible.map(u => ({
    ...u,
    division_name: divMap[u.division_id] || null,
    section_name:  secMap[u.section_id]  || null,
    position_name: posMap[u.position_id] || null,
  })));
});

// Summary counts (users by role, by division), scope-filtered
app.get('/api/reports/summary', (req, res) => {
  const s = req.session;
  let users = load.users();
  if (s.role === 'officer') {
    users = users.filter(u => u.id === s.user_id);
  } else if (s.role !== 'admin' && s.role !== 'executive') {
    users = users.filter(u => userVisibleTo(s, u));
  }
  const byRole = {};
  for (const u of users) byRole[u.role] = (byRole[u.role] || 0) + 1;

  const divs = load.divisions();
  const visibleDivIds = new Set();
  if (s.role === 'admin' || s.role === 'executive') {
    divs.forEach(d => visibleDivIds.add(d.id));
  } else {
    divs.forEach(d => { if (canView(s, { division_id: d.id })) visibleDivIds.add(d.id); });
  }
  const byDivision = [...visibleDivIds].map(id => {
    const d = divs.find(x => x.id === id);
    return { id, name: d?.name, count: users.filter(u => u.division_id === id).length };
  });
  res.json({
    total_users: users.length,
    by_role: byRole,
    by_division: byDivision,
  });
});

// ---------- Master password (status check + change) ----------
// Hash is never returned — only confirm whether one is set.
app.get('/api/admin/auth', requireAdmin, (req, res) => {
  const a = load.auth();
  res.json({ master_set: !!(a.master_hash || a.master), updated_at: a.migrated_at || a.updated_at || null });
});
app.put('/api/admin/auth', requireAdmin, (req, res) => {
  const { master } = req.body || {};
  if (!master || String(master).length < 6) return res.status(400).json({ error: 'master ต้องยาวอย่างน้อย 6 ตัวอักษร' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(master), salt, 64).toString('hex');
  writeJson(F.auth, { master_salt: salt, master_hash: hash, updated_at: new Date().toISOString() });
  res.json({ ok: true });
});

// ---------- Language preference ----------
app.post('/api/lang', (req, res) => {
  const lang = String((req.body && req.body.lang) || '').toLowerCase();
  if (!['th', 'en', 'cn'].includes(lang)) return res.status(400).json({ error: 'invalid lang' });
  res.setHeader('Set-Cookie', `lang=${lang}; Path=/; SameSite=Lax; Max-Age=${180*24*3600}`);
  res.json({ ok: true, lang });
});

// ---------- Interview workflow (employee interviews -> JD/KPI/Optimization docs) ----------
function interviewPath(id) { return path.join(INTERVIEW_DIR, `${id}.json`); }
function loadInterview(id) { return readJson(interviewPath(id), null); }
function saveInterview(iv) { writeJson(interviewPath(iv.id), iv); }
function genEmpId() { return 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Read access — hierarchy can view subordinates' records within scope.
function canViewEmployee(session, emp) {
  if (!emp) return false;
  if (session.role === 'admin' || session.role === 'executive') return true;
  if (session.role === 'officer') return emp.user_id === session.user_id;
  return canView(session, {
    division_id: emp.division_id,
    section_id:  emp.section_id || null,
    position_id: emp.position_id || null,
  });
}
// Write access (start/answer/finish interview) — owner only (admin allowed for data fix).
// Archived records are immutable.
function canInterviewEmployee(session, emp) {
  if (!emp || emp.archived) return false;
  if (session.role === 'admin') return true;
  return emp.user_id === session.user_id;
}

// List employees visible to the current session.
// Default: active only (archived=false). Pass ?include_archived=true to also see history.
app.get('/api/employees', (req, res) => {
  const { division_id, include_archived } = req.query;
  const s = req.session;
  let list = load.employees();
  if (!include_archived) list = list.filter(e => !e.archived);
  if (s.role === 'admin' || s.role === 'executive') {
    // see all
  } else if (s.role === 'officer') {
    list = list.filter(e => e.user_id === s.user_id || e.owner_user_id === s.user_id);
  } else {
    list = list.filter(e => canView(s, {
      division_id: e.division_id, section_id: e.section_id || null, position_id: e.position_id || null,
    }));
  }
  if (division_id) list = list.filter(e => e.division_id === division_id);
  res.json(list);
});

// "My active employee record" — for the user's own interview entry point.
app.get('/api/me/employee', (req, res) => {
  if (req.session.role === 'admin') return res.json(null);
  const emp = load.employees().find(e => e.user_id === req.session.user_id && !e.archived);
  res.json(emp || null);
});

// Manual create — admin-only escape hatch for data fix.
// Normal flow: emp records are auto-created when admin creates a user (position-anchored model).
app.post('/api/employees', requireAdmin, (req, res) => {
  const body = req.body || {};
  const { name, role, division_id, section_id, position_id, primary_duty, email, user_id } = body;
  if (!name || !position_id) return res.status(400).json({ error: 'ต้องใส่ชื่อและ position_id (admin manual create)' });
  const pos = load.positions().find(p => p.id === position_id);
  if (!pos) return res.status(400).json({ error: 'ไม่พบตำแหน่ง' });
  const sec = load.sections().find(s => s.id === pos.section_id);
  const div = sec ? load.divisions().find(d => d.id === sec.division_id) : null;

  const list = load.employees();
  const emp = {
    id: genEmpId(),
    position_id,
    user_id: user_id || null,
    name: String(name).trim(),
    role: role || pos.name,
    division_id: div?.id || division_id || null,
    division_name: div?.name || '',
    section_id: sec?.id || section_id || null,
    section_name: sec?.name || '',
    department: '',
    primary_duty: String(primary_duty || '').trim(),
    email: String(email || '').trim(),
    owner_user_id: user_id || null,
    archived: false,
    vacated_at: null,
    vacated_reason: null,
    createdAt: new Date().toISOString(),
    interviewStatus: 'not_started',
  };
  list.push(emp);
  save.employees(list);
  res.json(emp);
});

// Schedules (for interview UI — anyone logged in can read)
app.get('/api/schedules', (req, res) => {
  const lang = String(req.query.lang || parseCookie(req, 'lang') || 'th');
  res.json(ai.listSchedules(lang));
});

// Backdate helper — kept identical to legacy behaviour.
function backdateIso(input, hour) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const todayBkk = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  if (input > todayBkk) return null;
  const hh = String(hour).padStart(2, '0');
  const t = new Date(`${input}T${hh}:00:00+07:00`);
  if (isNaN(t.getTime())) return null;
  return t.toISOString();
}

// Start interview / fetch next question
app.post('/api/interview/:id/start', (req, res) => {
  const emp = load.employees().find(e => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  if (!canInterviewEmployee(req.session, emp)) return res.status(403).json({ error: 'ไม่มีสิทธิ์สัมภาษณ์ของคนอื่น / หรือ record นี้ archived แล้ว' });

  const bodyLang = String((req.body && req.body.lang) || '').toLowerCase();
  const bodySchedule = String((req.body && req.body.schedule) || '');
  const bodyDate = (req.body && req.body.interviewDate) || '';
  const backdatedStart = backdateIso(bodyDate, 9);
  const cookieLang = parseCookie(req, 'lang');

  let iv = loadInterview(emp.id);
  if (!iv) {
    // Pull the user's work schedule from their profile (position-anchored model).
    // This drives which hour blocks the interview asks about — no preset picker needed.
    const user = load.users().find(u => u.id === emp.user_id);
    const uh = calcUserHours(user);

    iv = {
      id: emp.id,
      employee: emp,
      answers: [],
      lang: ['th','en','cn'].includes(bodyLang) ? bodyLang
          : (['th','en','cn'].includes(cookieLang) ? cookieLang : 'th'),
      // Custom hours (preferred) — and a legacy schedule string for backwards compat.
      hours: uh ? uh.hours : null,
      workHours: uh || null,
      schedule: ai.SCHEDULES && ai.SCHEDULES[bodySchedule] ? bodySchedule : '09-18',
      startedAt: backdatedStart || new Date().toISOString(),
    };
    if (backdatedStart) iv.interviewDate = bodyDate;
    saveInterview(iv);
    // mark employee as in_progress
    const list = load.employees();
    const e = list.find(x => x.id === emp.id);
    if (e && e.interviewStatus === 'not_started') { e.interviewStatus = 'in_progress'; save.employees(list); }
  } else {
    let dirty = false;
    if (!iv.answers.length) {
      if (['th','en','cn'].includes(bodyLang) && bodyLang !== iv.lang) { iv.lang = bodyLang; dirty = true; }
      if (ai.SCHEDULES && ai.SCHEDULES[bodySchedule] && bodySchedule !== iv.schedule) { iv.schedule = bodySchedule; dirty = true; }
      if (backdatedStart && backdatedStart !== iv.startedAt) {
        iv.startedAt = backdatedStart;
        iv.interviewDate = bodyDate;
        dirty = true;
      }
    }
    if (dirty) saveInterview(iv);
  }
  const q = ai.getNextQuestion(iv);
  res.json({ interview: iv, question: q });
});

// Submit answer
app.post('/api/interview/:id/message', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'interview not started' });
  const liveEmp = load.employees().find(e => e.id === req.params.id);
  if (!canInterviewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ตอบ interview ของคนอื่น' });

  const { key, value, skipProbe } = req.body || {};
  if (!key || typeof value !== 'string') return res.status(400).json({ error: 'require {key, value}' });

  const probe = skipProbe ? null : ai.shouldProbe(value, iv.lang || 'th');
  if (probe) return res.json({ probe });

  const i = iv.answers.findIndex(a => a.key === key);
  const entry = { key, value, at: new Date().toISOString() };
  if (i >= 0) iv.answers[i] = entry; else iv.answers.push(entry);
  saveInterview(iv);

  const q = ai.getNextQuestion(iv);
  res.json({ question: q });
});

// Finish -> generate JD/KPI/Optimization docs
app.post('/api/interview/:id/finish', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  const liveEmp = load.employees().find(e => e.id === req.params.id);
  if (!canInterviewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ปิด interview ของคนอื่น' });

  iv.finishedAt = iv.interviewDate
    ? (backdateIso(iv.interviewDate, 10) || new Date().toISOString())
    : new Date().toISOString();
  saveInterview(iv);

  const outDir = path.join(OUTPUT_DIR, iv.id);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const docs = ai.generateDocuments(iv);
  const files = [];
  for (const [name, content] of Object.entries(docs)) {
    fs.writeFileSync(path.join(outDir, name), content);
    files.push(name);
  }

  const list = load.employees();
  const e = list.find(x => x.id === iv.id);
  if (e) { e.interviewStatus = 'completed'; e.completedAt = iv.finishedAt; save.employees(list); }

  res.json({ ok: true, files });
});

// Interview JSON — read access via canViewEmployee so hierarchy can inspect subordinates'
// answers (including archived/historical records).
app.get('/api/interview/:id', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  const liveEmp = load.employees().find(e => e.id === req.params.id) || iv.employee;
  if (!canViewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'forbidden' });
  res.json(iv);
});

// Delete employee + interview + outputs — ADMIN ONLY
app.delete('/api/interview/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const ivFile = interviewPath(id);
  const outDir = path.join(OUTPUT_DIR, id);
  if (fs.existsSync(ivFile)) fs.unlinkSync(ivFile);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });

  const list = load.employees();
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'employee not found' });
  list.splice(idx, 1);
  save.employees(list);
  res.json({ ok: true });
});

// History for calendar — scope-filtered
app.get('/api/interviews/history', (req, res) => {
  const s = req.session;
  const requested = String(req.query.scope || '').trim();
  let emps = load.employees();

  if (s.role === 'admin' || s.role === 'executive') {
    if (requested && requested !== 'all') emps = emps.filter(e => e.division_id === requested);
  } else if (s.role === 'officer') {
    emps = emps.filter(e => e.owner_user_id === s.user_id);
  } else {
    emps = emps.filter(e => canView(s, {
      division_id: e.division_id, section_id: e.section_id || null, position_id: e.position_id || null,
    }));
    if (requested && requested !== 'all') emps = emps.filter(e => e.division_id === requested);
  }

  const divs = load.divisions();
  const divMap = Object.fromEntries(divs.map(d => [d.id, d]));
  const records = emps.map(e => {
    const iv = loadInterview(e.id);
    const d = divMap[e.division_id] || {};
    return {
      id: e.id, name: e.name, role: e.role,
      division_id: e.division_id,
      division_name: e.division_name || d.name || '',
      division_icon: d.icon || '🏢',
      division_color: d.color || '#3b82f6',
      startedAt: iv?.startedAt || null,
      finishedAt: iv?.finishedAt || null,
      status: e.interviewStatus,
    };
  });
  res.json(records);
});

// Company-wide analysis — admin + executive + manager
app.post('/api/company/analyze', requireRoles('admin', 'executive', 'manager'), (req, res) => {
  const list = load.employees();
  const interviews = list
    .map(e => loadInterview(e.id))
    .filter(iv => iv && iv.finishedAt);
  const md = ai.analyzeCompany(interviews);
  const outDir = path.join(OUTPUT_DIR, '_company');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'optimization-report.md'), md);
  res.json({ ok: true, count: interviews.length, file: 'optimization-report.md' });
});

// Download company-wide report — admin + executive + manager
app.get('/api/outputs/_company/:file', requireRoles('admin', 'executive', 'manager'), (req, res) => {
  const file = req.params.file;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad filename');
  const p = path.join(OUTPUT_DIR, '_company', file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// Download generated per-employee file — scope check (read access).
app.get('/api/outputs/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad filename');
  const emp = load.employees().find(e => e.id === id);
  if (!canViewEmployee(req.session, emp)) return res.status(403).send('forbidden');
  const safeId = id.replace(/[^a-zA-Z0-9_]/g, '');
  const p = path.join(OUTPUT_DIR, safeId, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// ---------- Static page routes ----------
app.get('/',         (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/login',    (req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
app.get('/admin',    requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/admin/users', requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin-users.html')));
app.get('/admin/org',   requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin-org.html')));
app.get('/profile',  (req, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
app.get('/reports',  (req, res) => res.sendFile(path.join(ROOT, 'public', 'reports.html')));
app.get('/division', (req, res) => res.sendFile(path.join(ROOT, 'public', 'division.html')));
app.get('/interview',(req, res) => res.sendFile(path.join(ROOT, 'public', 'interview.html')));
app.get('/review',   (req, res) => res.sendFile(path.join(ROOT, 'public', 'review.html')));
app.get('/examples', (req, res) => res.sendFile(path.join(ROOT, 'public', 'examples.html')));
app.get('/dashboard',(req, res) => res.sendFile(path.join(ROOT, 'public', 'dashboard.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 HR-WWN running at http://localhost:${PORT}\n`);
  console.log(`   master admin login → username: admin / password: (see data/auth.json)\n`);

  // Optional: open the default browser to the app on startup.
  // Set AUTO_OPEN_BROWSER=true (2-START.bat does this). More reliable than
  // doing it from cmd because Node can exec the OS-native command directly.
  if (process.env.AUTO_OPEN_BROWSER === 'true') {
    setTimeout(() => {
      const url = `http://localhost:${PORT}`;
      const cmd = process.platform === 'win32' ? `start "" "${url}"`
                : process.platform === 'darwin' ? `open "${url}"`
                : `xdg-open "${url}"`;
      require('child_process').exec(cmd, () => { /* swallow errors */ });
    }, 1200);
  }
});
