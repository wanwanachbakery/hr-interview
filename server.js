/**
 * server.js - Employee Interview App
 * Node + Express, JSON files for storage.
 * Runs at http://localhost:3000
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
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const DIVISIONS_FILE = path.join(DATA_DIR, 'divisions.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');

// Ensure dirs
for (const d of [DATA_DIR, INTERVIEW_DIR, OUTPUT_DIR, path.join(OUTPUT_DIR, '_company')]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
if (!fs.existsSync(EMPLOYEES_FILE)) fs.writeFileSync(EMPLOYEES_FILE, '[]');
if (!fs.existsSync(DIVISIONS_FILE)) fs.writeFileSync(DIVISIONS_FILE, '[]');
if (!fs.existsSync(AUTH_FILE)) fs.writeFileSync(AUTH_FILE, JSON.stringify({ master: 'ADMIN-2026', divisions: {} }, null, 2));

// Cookie signing secret — generated once, stored locally
let SECRET;
if (fs.existsSync(SECRET_FILE)) {
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET);
}

// ---------- auth helpers ----------
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
function loadAuth() { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return { master:'', divisions:{} }; } }

const PUBLIC_PATHS = new Set(['/login', '/api/login', '/api/logout', '/api/lang', '/api/schedules', '/interview', '/styles.css', '/favicon.ico', '/i18n.js', '/logo.png']);
// Interview-taking endpoints are open to anyone with the employee id —
// /api/interview/<id>/start | /message | /finish (read-only /api/interview/<id> stays protected).
function isPublicInterviewApi(p) {
  return /^\/api\/interview\/[^/]+\/(start|message|finish)$/.test(p);
}
function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.has(req.path) || isPublicInterviewApi(req.path)) return next();
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

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(authMiddleware);
app.use(express.static(path.join(ROOT, 'public')));

// ---------- helpers ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function loadEmployees() { return readJson(EMPLOYEES_FILE, []); }
function saveEmployees(list) { writeJson(EMPLOYEES_FILE, list); }
function loadDivisions() { return readJson(DIVISIONS_FILE, []); }
function saveDivisions(list) { writeJson(DIVISIONS_FILE, list); }
function interviewPath(id) { return path.join(INTERVIEW_DIR, `${id}.json`); }
function loadInterview(id) { return readJson(interviewPath(id), null); }
function saveInterview(iv) { writeJson(interviewPath(iv.id), iv); }
function genId() { return 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- auth routes ----------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'กรอกรหัส' });
  const auth = loadAuth();
  if (password === auth.master) {
    const token = signToken({ role: 'admin', exp: Date.now() + 7*24*3600*1000 });
    res.setHeader('Set-Cookie', `auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*3600}`);
    return res.json({ role: 'admin' });
  }
  for (const [divId, pw] of Object.entries(auth.divisions || {})) {
    if (password === pw) {
      const token = signToken({ role: 'division', div_id: divId, exp: Date.now() + 7*24*3600*1000 });
      res.setHeader('Set-Cookie', `auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*3600}`);
      return res.json({ role: 'division', division_id: divId });
    }
  }
  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// "Who am I" — frontend uses this to show role badge + filter UI
app.get('/api/me', (req, res) => {
  const divs = loadDivisions();
  const myDiv = req.session.role === 'division' ? divs.find(d => d.id === req.session.div_id) : null;
  res.json({
    role: req.session.role,
    division_id: req.session.div_id || null,
    division_name: myDiv?.name || null,
  });
});

// Admin-only: view passwords list
app.get('/api/admin/passwords', requireAdmin, (req, res) => {
  res.json(loadAuth());
});

// ---------- data routes ----------

// List divisions — division users only see their own
app.get('/api/divisions', (req, res) => {
  let divs = loadDivisions();
  if (req.session.role === 'division') {
    divs = divs.filter(d => d.id === req.session.div_id);
  }
  const emps = loadEmployees();
  const withCount = divs.map(d => {
    const list = emps.filter(e => e.division_id === d.id);
    const done = list.filter(e => e.interviewStatus === 'completed').length;
    return { ...d, employeeCount: list.length, completedCount: done };
  });
  res.json(withCount);
});

// Add a new division (admin only)
app.post('/api/divisions', requireAdmin, (req, res) => {
  const { name, name_en, icon, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'ต้องใส่ชื่อฝ่าย' });
  const list = loadDivisions();
  const id = String(name).toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36).slice(-4);
  const div = {
    id, name: String(name).trim(),
    name_en: String(name_en || '').trim(),
    icon: icon || '🏢',
    color: color || '#3b82f6',
  };
  list.push(div);
  saveDivisions(list);
  res.json(div);
});

// List employees — division users only see their own division
app.get('/api/employees', (req, res) => {
  const { division_id } = req.query;
  let list = loadEmployees();
  if (req.session.role === 'division') {
    list = list.filter(e => e.division_id === req.session.div_id);
  } else if (division_id) {
    list = list.filter(e => e.division_id === division_id);
  }
  res.json(list);
});

// Add employee — division users can only add to their own division
app.post('/api/employees', (req, res) => {
  const { name, role, department, primary_duty, email, division_id } = req.body || {};
  if (!name || !role || !division_id) {
    return res.status(400).json({ error: 'ต้องใส่ชื่อ, ตำแหน่ง, และฝ่าย' });
  }
  if (req.session.role === 'division' && division_id !== req.session.div_id) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์เพิ่มพนักงานในฝ่ายอื่น' });
  }
  const divs = loadDivisions();
  const div = divs.find(d => d.id === division_id);
  if (!div) return res.status(400).json({ error: 'ไม่พบฝ่ายที่เลือก' });

  const list = loadEmployees();
  const id = genId();
  const emp = {
    id,
    name: String(name).trim(),
    role: String(role).trim(),
    division_id,
    division_name: div.name,
    department: String(department || '').trim(),
    primary_duty: String(primary_duty || '').trim(),
    email: String(email || '').trim(),
    createdAt: new Date().toISOString(),
    interviewStatus: 'not_started',
  };
  list.push(emp);
  saveEmployees(list);
  res.json(emp);
});

// Helper: check if session can access this employee
function canAccessEmployee(session, emp) {
  if (!emp) return false;
  if (session.role === 'admin') return true;
  return emp.division_id === session.div_id;
}

// List available schedules (for UI) — lang-aware labels
app.get('/api/schedules', (req, res) => {
  const lang = String(req.query.lang || parseCookie(req, 'lang') || 'th');
  res.json(ai.listSchedules(lang));
});

// Set language preference (cookie-based, 180 days)
app.post('/api/lang', (req, res) => {
  const lang = String((req.body && req.body.lang) || '').toLowerCase();
  if (!['th', 'en', 'cn'].includes(lang)) return res.status(400).json({ error: 'invalid lang' });
  res.setHeader('Set-Cookie', `lang=${lang}; Path=/; SameSite=Lax; Max-Age=${180*24*3600}`);
  res.json({ ok: true, lang });
});

// Start interview. Optional body: { lang, schedule }. First call freezes these on the interview.
// Public endpoint: anyone with the employee id can answer (emp ids are long/random).
app.post('/api/interview/:id/start', (req, res) => {
  const emp = loadEmployees().find(e => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });

  const bodyLang = String((req.body && req.body.lang) || '').toLowerCase();
  const bodySchedule = String((req.body && req.body.schedule) || '');
  const cookieLang = parseCookie(req, 'lang');

  let iv = loadInterview(emp.id);
  if (!iv) {
    iv = {
      id: emp.id,
      employee: emp,
      answers: [],
      lang: ['th','en','cn'].includes(bodyLang) ? bodyLang
          : (['th','en','cn'].includes(cookieLang) ? cookieLang : 'th'),
      schedule: ai.SCHEDULES[bodySchedule] ? bodySchedule : '09-18',
      startedAt: new Date().toISOString(),
    };
    saveInterview(iv);
  } else {
    // Allow caller to update lang/schedule ONLY if nothing has been answered yet.
    let dirty = false;
    if (!iv.answers.length) {
      if (['th','en','cn'].includes(bodyLang) && bodyLang !== iv.lang) { iv.lang = bodyLang; dirty = true; }
      if (ai.SCHEDULES[bodySchedule] && bodySchedule !== iv.schedule) { iv.schedule = bodySchedule; dirty = true; }
    }
    // Legacy interviews (no lang/schedule) keep their original behaviour via mock-ai's legacy branch.
    if (dirty) saveInterview(iv);
  }
  const q = ai.getNextQuestion(iv);
  res.json({ interview: iv, question: q });
});

// Submit answer -> get next question (or probe)
app.post('/api/interview/:id/message', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'interview not started' });

  const { key, value, skipProbe } = req.body || {};
  if (!key || typeof value !== 'string') {
    return res.status(400).json({ error: 'require {key, value}' });
  }

  const probe = skipProbe ? null : ai.shouldProbe(value, iv.lang || 'th');
  if (probe) {
    // Probe BEFORE accepting -> ask user to elaborate
    return res.json({ probe });
  }

  // Store or overwrite answer for this key
  const i = iv.answers.findIndex(a => a.key === key);
  const entry = { key, value, at: new Date().toISOString() };
  if (i >= 0) iv.answers[i] = entry;
  else iv.answers.push(entry);

  saveInterview(iv);
  const q = ai.getNextQuestion(iv);
  res.json({ question: q });
});

// Finish -> generate all docs
app.post('/api/interview/:id/finish', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  iv.finishedAt = new Date().toISOString();
  saveInterview(iv);

  const outDir = path.join(OUTPUT_DIR, iv.id);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const docs = ai.generateDocuments(iv);
  const files = [];
  for (const [name, content] of Object.entries(docs)) {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, content);
    files.push(name);
  }

  // update employee status
  const list = loadEmployees();
  const e = list.find(x => x.id === iv.id);
  if (e) { e.interviewStatus = 'completed'; e.completedAt = iv.finishedAt; saveEmployees(list); }

  res.json({ ok: true, files });
});

// Interview history for calendar — compact records of started/finished dates.
// scope: omitted/"mine" = current division (for admin on a page), "all" = whole company (admin only),
//        a specific division_id = filter to that division (admin only).
// Division users always see only their own division regardless of scope.
app.get('/api/interviews/history', (req, res) => {
  const session = req.session;
  const requested = String(req.query.scope || '').trim();
  const emps = loadEmployees();

  let filtered = emps;
  if (session.role === 'division') {
    filtered = filtered.filter(e => e.division_id === session.div_id);
  } else if (session.role === 'admin' && requested && requested !== 'all') {
    filtered = filtered.filter(e => e.division_id === requested);
  }

  const divs = loadDivisions();
  const divMap = Object.fromEntries(divs.map(d => [d.id, d]));

  const records = filtered.map(e => {
    const iv = loadInterview(e.id);
    const d = divMap[e.division_id] || {};
    return {
      id: e.id,
      name: e.name,
      role: e.role,
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

// Get interview JSON
app.get('/api/interview/:id', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  if (!canAccessEmployee(req.session, iv.employee)) return res.status(403).json({ error: 'forbidden' });
  res.json(iv);
});

// Company analysis — admin only
app.post('/api/company/analyze', requireAdmin, (req, res) => {
  const list = loadEmployees();
  const interviews = list
    .map(e => loadInterview(e.id))
    .filter(iv => iv && iv.finishedAt);
  const md = ai.analyzeCompany(interviews);
  const outDir = path.join(OUTPUT_DIR, '_company');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'optimization-report.md'), md);
  res.json({ ok: true, count: interviews.length, file: 'optimization-report.md' });
});

// Download company-wide report — admin only.
// Registered BEFORE the generic :id/:file route so "_company" doesn't get matched as an employee id.
app.get('/api/outputs/_company/:file', requireAdmin, (req, res) => {
  const file = req.params.file;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) {
    return res.status(400).send('bad filename');
  }
  const p = path.join(OUTPUT_DIR, '_company', file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// Download a generated file — per-employee, division-scoped
app.get('/api/outputs/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) {
    return res.status(400).send('bad filename');
  }
  const emp = loadEmployees().find(e => e.id === id);
  if (!canAccessEmployee(req.session, emp)) return res.status(403).send('forbidden');
  const safeId = id.replace(/[^a-zA-Z0-9_]/g, '');
  const p = path.join(OUTPUT_DIR, safeId, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// Default page routes (static)
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/division', (req, res) => res.sendFile(path.join(ROOT, 'public', 'division.html')));
app.get('/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'dashboard.html')));
app.get('/interview', (req, res) => res.sendFile(path.join(ROOT, 'public', 'interview.html')));
app.get('/review', (req, res) => res.sendFile(path.join(ROOT, 'public', 'review.html')));
app.get('/examples', (req, res) => res.sendFile(path.join(ROOT, 'public', 'examples.html')));
app.get('/login', (req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 Employee Interview App running at http://localhost:${PORT}\n`);
});
