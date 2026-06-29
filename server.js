/**
 * server.js - HR-Interview
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
const { AsyncLocalStorage } = require('async_hooks');
const xlsx = require('xlsx');
const ai = require('./scripts/mock-ai');
// Real-Claude layer (Sonnet 4.6) for JD/KPI/Optimization + company report.
// Safe to require even without the SDK/key — it lazily inits and falls back to
// mock-ai on any problem. Only generateDocuments + analyzeCompany use Claude;
// interview questions/probes stay on mock-ai (cheaper, deterministic).
const claude = require('./scripts/claude-ai');

// Use Claude when a key is configured on the server AND this tenant has the
// switch turned on (admin console); otherwise mock. Both wrappers are async and
// never throw. When Claude runs, token usage + estimated cost are recorded per
// tenant in claude-usage.json so admins can see what each analysis cost.
function claudeOnForTenant(db) {
  if (!claude.isEnabled()) return false;                       // no ANTHROPIC_API_KEY on server
  try { return db.claudeSettings().enabled !== false; }        // default ON once a key exists
  catch { return false; }
}
function recordClaudeUsage(db, rec) {
  try {
    const u = normalizeClaudeUsage(db.claudeUsage());
    const t = u.totals;
    t.runs += 1;
    t.input += rec.input || 0;
    t.output += rec.output || 0;
    t.cache_write += rec.cache_write || 0;
    t.cache_read += rec.cache_read || 0;
    t.cost_usd += rec.cost_usd || 0;
    t.cost_thb += rec.cost_thb || 0;
    u.runs.unshift({
      at: new Date().toISOString(),
      kind: rec.kind || '', label: rec.label || '', model: rec.model || '',
      input: rec.input || 0, output: rec.output || 0,
      cache_write: rec.cache_write || 0, cache_read: rec.cache_read || 0,
      cost_usd: rec.cost_usd || 0, cost_thb: rec.cost_thb || 0,
    });
    if (u.runs.length > 200) u.runs.length = 200;               // keep the file bounded
    db.saveClaudeUsage(u);
  } catch (e) { console.error('[claude-usage] record failed:', e.message); }
}
async function generateDocuments(interview, db) {
  if (db && claudeOnForTenant(db)) {
    try {
      return await claude.generateDocuments(interview, {
        onUsage: (rec) => recordClaudeUsage(db, { kind: 'documents', label: (interview.employee && interview.employee.name) || '', ...rec }),
      });
    } catch (e) { console.error('[ai] generateDocuments fell back to mock:', e.message); }
  }
  return ai.generateDocuments(interview);
}
async function analyzeCompany(interviews, db) {
  if (db && claudeOnForTenant(db)) {
    try {
      return await claude.analyzeCompany(interviews, {
        onUsage: (rec) => recordClaudeUsage(db, { kind: 'company', label: `รายงานภาพรวม (${(interviews || []).length} คน)`, ...rec }),
      });
    } catch (e) { console.error('[ai] analyzeCompany fell back to mock:', e.message); }
  }
  return ai.analyzeCompany(interviews);
}
console.log('[ai] document engine:', claude.isEnabled() ? ('Claude available (' + claude.MODEL + ') — per-tenant toggle') : 'mock-ai (set ANTHROPIC_API_KEY to enable Claude)');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// DATA_DIR / OUTPUT_DIR can be overridden via env so a persistent volume
// (e.g. Fly.io) can mount outside the source tree without breaking dev defaults.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const TENANT_DATA_DIR = path.join(DATA_DIR, 'tenants');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(ROOT, 'outputs');
const TENANT_OUTPUT_DIR = path.join(OUTPUT_DIR, 'tenants');
const TENANTS_FILE = path.join(DATA_DIR, '_tenants.json');
const SUPER_AUTH_FILE = path.join(DATA_DIR, '_super_auth.json');
const SECRET_FILE = path.join(DATA_DIR, '_secret');

for (const d of [DATA_DIR, TENANT_DATA_DIR, OUTPUT_DIR, TENANT_OUTPUT_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
const ensure = (p, def) => { if (!fs.existsSync(p)) fs.writeFileSync(p, def); };
ensure(TENANTS_FILE, '[]');
ensure(SUPER_AUTH_FILE, JSON.stringify({ master: 'super!2026' }, null, 2));

// Production hardening flag — when behind HTTPS proxy (Fly.io / Cloudflare),
// set SECURE_COOKIES=true so cookies carry the Secure flag.
const SECURE_COOKIES = String(process.env.SECURE_COOKIES || '').toLowerCase() === 'true';
const cookieSuffix = SECURE_COOKIES ? '; Secure' : '';

let SECRET;
if (fs.existsSync(SECRET_FILE)) {
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET);
}

// ---------- JSON helpers ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Claude usage ledger: ensure the {totals,runs} shape exists (handles old/empty files).
function emptyClaudeUsage() {
  return { totals: { runs: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, cost_usd: 0, cost_thb: 0 }, runs: [] };
}
function normalizeClaudeUsage(u) {
  const base = emptyClaudeUsage();
  if (!u || typeof u !== 'object') return base;
  u.totals = Object.assign(base.totals, u.totals || {});
  if (!Array.isArray(u.runs)) u.runs = [];
  return u;
}

// Migrate super-admin password from plain to hashed (idempotent — runs once).
(function migrateSuperAuth() {
  const raw = readJson(SUPER_AUTH_FILE, null);
  if (!raw || typeof raw.master !== 'string') return;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(raw.master), salt, 64).toString('hex');
  writeJson(SUPER_AUTH_FILE, { master_salt: salt, master_hash: hash, migrated_at: new Date().toISOString() });
  console.log('[migration] super-admin password hashed');
})();

// ============================================================
// Multi-tenant: per-tenant data layer
// ============================================================
// All tenant data lives in data/tenants/<id>/ and outputs/tenants/<id>/.
// AsyncLocalStorage gives every async request its own tenant db so existing
// `load.users()` / `save.users(...)` call sites don't need a signature change.
const ALS = new AsyncLocalStorage();

function tenantDb(tenantId) {
  const dir = path.join(TENANT_DATA_DIR, tenantId);
  const intDir = path.join(dir, 'interviews');
  const outDir = path.join(TENANT_OUTPUT_DIR, tenantId);
  const cmpOutDir = path.join(outDir, '_company');
  const F = {
    employees: path.join(dir, 'employees.json'),
    divisions: path.join(dir, 'divisions.json'),
    sections:  path.join(dir, 'sections.json'),
    positions: path.join(dir, 'positions.json'),
    users:     path.join(dir, 'users.json'),
    company:   path.join(dir, 'company.json'),
    categories: path.join(dir, 'categories.json'),
    auth:      path.join(dir, 'auth.json'),
    claudeSettings: path.join(dir, 'claude.json'),
    claudeUsage:    path.join(dir, 'claude-usage.json'),
  };
  return {
    id: tenantId,
    dir, intDir, outDir, cmpOutDir,
    files: F,
    employees:    () => readJson(F.employees, []),
    divisions:    () => readJson(F.divisions, []),
    sections:     () => readJson(F.sections, []),
    positions:    () => readJson(F.positions, []),
    users:        () => readJson(F.users, []),
    company:      () => readJson(F.company, { name: '', name_en: '' }),
    categories:   () => readJson(F.categories, []),
    auth:         () => readJson(F.auth, { master: '' }),
    claudeSettings: () => readJson(F.claudeSettings, { enabled: true }),
    claudeUsage:    () => readJson(F.claudeUsage, { totals: { runs: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, cost_usd: 0, cost_thb: 0 }, runs: [] }),
    saveEmployees: (l) => writeJson(F.employees, l),
    saveDivisions: (l) => writeJson(F.divisions, l),
    saveSections:  (l) => writeJson(F.sections, l),
    savePositions: (l) => writeJson(F.positions, l),
    saveUsers:     (l) => writeJson(F.users, l),
    saveCompany:   (o) => writeJson(F.company, o),
    saveCategories:(l) => writeJson(F.categories, l),
    saveAuth:      (o) => writeJson(F.auth, o),
    saveClaudeSettings: (o) => writeJson(F.claudeSettings, o),
    saveClaudeUsage:    (o) => writeJson(F.claudeUsage, o),
    interviewPath: (id) => path.join(intDir, `${id}.json`),
    loadInterview: (id) => readJson(path.join(intDir, `${id}.json`), null),
    saveInterview: (iv) => writeJson(path.join(intDir, `${iv.id}.json`), iv),
    // Daily hourly work log — one file per user per date: worklogs/<userId>/<YYYY-MM-DD>.json
    loadWorklog: (uid, date) => readJson(path.join(dir, 'worklogs', uid, `${date}.json`), null),
    saveWorklog: (uid, date, obj) => {
      const wd = path.join(dir, 'worklogs', uid);
      if (!fs.existsSync(wd)) fs.mkdirSync(wd, { recursive: true });
      writeJson(path.join(wd, `${date}.json`), obj);
    },
  };
}

// Default work-log categories seeded for each new tenant (admin's starter set;
// employees can add their own via the daily-log dropdown).
const DEFAULT_WORKLOG_CATEGORIES = ['บริการลูกค้า', 'ขาย', 'คีย์ข้อมูล/เอกสาร', 'จัดของ/สต็อก', 'ประชุม/ประสานงาน', 'รายงาน', 'อื่นๆ'];

function initTenantFolder(tenantId, initialAdminPassword, companyName) {
  const db = tenantDb(tenantId);
  for (const d of [db.dir, db.intDir, db.outDir, db.cmpOutDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  ensure(db.files.employees, '[]');
  ensure(db.files.divisions, '[]');
  ensure(db.files.sections, '[]');
  ensure(db.files.positions, '[]');
  ensure(db.files.users, '[]');
  // Seed the company display name from the name entered at tenant creation
  // (falls back to the placeholder only if none was provided).
  ensure(db.files.company, JSON.stringify({ name: (companyName && String(companyName).trim()) || 'บริษัทตัวอย่าง จำกัด', name_en: 'Sample Company Ltd.' }, null, 2));
  ensure(db.files.categories, JSON.stringify(DEFAULT_WORKLOG_CATEGORIES, null, 2));
  if (!fs.existsSync(db.files.auth)) {
    const pw = initialAdminPassword || 'WWN2026!Init';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    writeJson(db.files.auth, { master_salt: salt, master_hash: hash, created_at: new Date().toISOString() });
  }
  ensure(path.join(db.intDir, '.gitkeep'), '');
  return db;
}

function loadTenants() { return readJson(TENANTS_FILE, []); }
function saveTenants(list) { writeJson(TENANTS_FILE, list); }
function findTenant(id) { return loadTenants().find(t => t.id === id); }

// Tenant-context proxies — read by all existing helpers/routes.
// Will throw if called outside a tenant request (should never happen in practice).
function ctxDb() {
  const s = ALS.getStore();
  if (!s || !s.db) throw new Error('tenant context required');
  return s.db;
}
const load = {
  employees: () => ctxDb().employees(),
  divisions: () => ctxDb().divisions(),
  sections:  () => ctxDb().sections(),
  positions: () => ctxDb().positions(),
  users:     () => ctxDb().users(),
  company:   () => ctxDb().company(),
  auth:      () => ctxDb().auth(),
};
const save = {
  employees: (l) => ctxDb().saveEmployees(l),
  divisions: (l) => ctxDb().saveDivisions(l),
  sections:  (l) => ctxDb().saveSections(l),
  positions: (l) => ctxDb().savePositions(l),
  users:     (l) => ctxDb().saveUsers(l),
  company:   (o) => ctxDb().saveCompany(o),
};

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

// ---------- tenant-scoped middleware (used inside tenantRouter) ----------
const PUBLIC_PATHS = new Set([
  '/login', '/api/login', '/api/logout', '/api/lang',
]);
// GET /api/company is public so the login page can show the tenant's company
// name before authentication. Other methods (PUT) still require admin.
function isPublicRequest(req) {
  if (PUBLIC_PATHS.has(req.path)) return true;
  if (req.method === 'GET' && req.path === '/api/company') return true;
  return false;
}
function authMiddleware(req, res, next) {
  if (isPublicRequest(req)) return next();
  const token = parseCookie(req, 'auth');
  const session = verifyToken(token);
  // Server-side tenant isolation: a token carries its tenant_id and we reject
  // it if it doesn't match the URL's tenant. Belt-and-braces with cookie Path.
  if (!session || session.tenant_id !== req.tenant.id) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect(req.tbase + '/login');
  }
  req.session = session;
  next();
}
function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'admin only' });
    return res.redirect(req.tbase || '/');
  }
  next();
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session?.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'forbidden' });
      return res.redirect(req.tbase || '/');
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
//
// canView is LENIENT — section_head/officer can also "see" their parent division
// (and officer their parent section) so the dashboard tree has a root to render.
// canEdit is STRICT — section_head only edits own section, never the parent division.
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
    // Own section (and anything carrying our section_id — positions/emps in it)
    if (target.section_id && target.section_id === mySec) return true;
    // Parent division — only when target is "about" a division (no section_id specified).
    // Lets the dashboard render the parent ฝ่าย so the tree has a root.
    if (target.division_id && target.division_id === myDiv && !target.section_id && !target.position_id) return true;
    return false;
  }
  if (r === 'officer') {
    // Own position (and anything carrying our position_id)
    if (target.position_id && target.position_id === myPos) return true;
    // Parent section — only when target is about a section (no position_id)
    if (target.section_id && target.section_id === mySec && !target.position_id) return true;
    // Parent division — only when target is about a division
    if (target.division_id && target.division_id === myDiv && !target.section_id && !target.position_id) return true;
    return false;
  }
  return false;
}

function canEdit(session, target) {
  if (!session) return false;
  const r = session.role;
  if (r === 'admin' || r === 'executive') return true;
  if (r === 'officer') return false;
  if (r === 'manager') {
    if (target.division_id && target.division_id === session.division_id) return true;
    const ov = session.scope_override || {};
    if (target.division_id && (ov.divisions || []).includes(target.division_id)) return true;
    if (target.section_id && (ov.sections || []).includes(target.section_id)) return true;
    if (target.position_id && (ov.positions || []).includes(target.position_id)) return true;
    return false;
  }
  if (r === 'division_head') {
    return !!(target.division_id && target.division_id === session.division_id);
  }
  if (r === 'section_head') {
    // Own section + positions in it (positions are passed with section_id). Never the parent division.
    return !!(target.section_id && target.section_id === session.section_id);
  }
  return false;
}

// ---------- app ----------
const app = express();
// Trust the first proxy (Fly.io / Cloudflare / similar) so req.ip and req.secure
// reflect the real client, not 127.0.0.1.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));  // bumped for base64-encoded Excel uploads
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders: (res, fp) => {
    // Force revalidation of text assets so updated pages/scripts/styles show
    // right after a deploy (avoids stale cached HTML/JS/CSS/Markdown).
    if (/\.(html|js|css|md)$/i.test(fp)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ============================================================
// Tenant subrouter — every request that touches per-tenant data goes here.
// Mounted at /t/:tenantId later, after all routes are declared on it.
// ============================================================
const tenantRouter = express.Router({ mergeParams: true });

// Resolve the tenant from the URL param and stash db + tbase on req.
// Also run the rest of the request inside an AsyncLocalStorage so existing
// load/save helpers can pick up the current tenant's db without explicit args.
tenantRouter.use((req, res, next) => {
  const t = findTenant(req.params.tenantId);
  if (!t) {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'tenant not found' });
    return res.status(404).send(`Tenant "${req.params.tenantId}" not found`);
  }
  req.tenant = t;
  req.db = tenantDb(t.id);
  req.tbase = '/t/' + t.id;
  ALS.run({ db: req.db, tenant: t }, () => next());
});
tenantRouter.use(authMiddleware);

// ---------- Login rate limit (in-memory; resets on restart) ----------
// 10 failed attempts in 5 minutes → block that IP for 2 minutes.
// (Kept lenient on purpose: legit users mistype; the block is short so a real
// person isn't stuck. Still stops automated brute-force.)
const RL_WINDOW = 5 * 60 * 1000;
const RL_MAX = 10;
const RL_BLOCK = 2 * 60 * 1000;
const rlMap = new Map();
// Skip rate-limiting for loopback addresses: on a local/demo machine every user
// shares 127.0.0.1, so per-IP limiting would wrongly lock everyone out together.
// Real deployments behind a proxy see distinct client IPs, so protection still applies there.
function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function rlCheck(ip) {
  if (isLoopback(ip)) return { allowed: true };
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
  if (isLoopback(ip)) return;
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
tenantRouter.post('/api/login', (req, res) => {
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
    const token = signToken({ role: 'admin', username: 'admin', tenant_id: req.tenant.id, exp: Date.now() + 7*24*3600*1000 });
    res.setHeader('Set-Cookie', `auth=${token}; Path=${req.tbase}; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=${7*24*3600}`);
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
    tenant_id: req.tenant.id,  // bind session to this tenant — auth middleware verifies match
    division_id: u.division_id || null,
    section_id:  u.section_id  || null,
    position_id: u.position_id || null,
    scope_override: u.scope_override || null,
    exp: Date.now() + 7*24*3600*1000,
  };
  const token = signToken(payload);
  res.setHeader('Set-Cookie', `auth=${token}; Path=${req.tbase}; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=${7*24*3600}`);
  res.json({ ok: true, role: u.role, name: u.name });
});

tenantRouter.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `auth=; Path=${req.tbase}; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=0`);
  res.json({ ok: true });
});

tenantRouter.get('/api/me', (req, res) => {
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
tenantRouter.get('/api/company', (req, res) => res.json(load.company()));
tenantRouter.put('/api/company', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/divisions', (req, res) => {
  const divs = load.divisions();
  const s = req.session;
  if (s.role === 'admin' || s.role === 'executive') return res.json(divs);
  res.json(divs.filter(d => canView(s, { division_id: d.id })));
});
tenantRouter.post('/api/divisions', requireAdmin, (req, res) => {
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
tenantRouter.put('/api/divisions/:id', (req, res) => {
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
tenantRouter.delete('/api/divisions/:id', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/sections', (req, res) => {
  let list = load.sections();
  const { division_id } = req.query;
  if (division_id) list = list.filter(s => s.division_id === division_id);
  const s = req.session;
  if (s.role !== 'admin' && s.role !== 'executive') {
    list = list.filter(x => canView(s, { division_id: x.division_id, section_id: x.id }));
  }
  res.json(list);
});
tenantRouter.post('/api/sections', requireAdmin, (req, res) => {
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
tenantRouter.put('/api/sections/:id', (req, res) => {
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
tenantRouter.delete('/api/sections/:id', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/positions', (req, res) => {
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
tenantRouter.post('/api/positions', requireAdmin, (req, res) => {
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
tenantRouter.put('/api/positions/:id', (req, res) => {
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
tenantRouter.delete('/api/positions/:id', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/positions/:id/history', (req, res) => {
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

tenantRouter.get('/api/users', requireAdmin, (req, res) => {
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

tenantRouter.post('/api/users', requireAdmin, (req, res) => {
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

tenantRouter.put('/api/users/:id', requireAdmin, (req, res) => {
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

tenantRouter.delete('/api/users/:id', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/me/profile', (req, res) => {
  if (req.session.role === 'admin') return res.json(null);
  const u = load.users().find(x => x.id === req.session.user_id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json(stripSecret(u));
});

// Self profile update — user edits own work times + own password.
// Cannot change role / scope / division / section / position (admin only).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
tenantRouter.put('/api/me/profile', (req, res) => {
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
tenantRouter.get('/api/reports/users', (req, res) => {
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
tenantRouter.get('/api/reports/summary', (req, res) => {
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
tenantRouter.get('/api/admin/auth', requireAdmin, (req, res) => {
  const a = load.auth();
  res.json({ master_set: !!(a.master_hash || a.master), updated_at: a.migrated_at || a.updated_at || null });
});
tenantRouter.put('/api/admin/auth', requireAdmin, (req, res) => {
  const { master } = req.body || {};
  if (!master || String(master).length < 6) return res.status(400).json({ error: 'master ต้องยาวอย่างน้อย 6 ตัวอักษร' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(master), salt, 64).toString('hex');
  ctxDb().saveAuth({ master_salt: salt, master_hash: hash, updated_at: new Date().toISOString() });
  res.json({ ok: true });
});

// ---------- Claude AI settings + usage (admin) ----------
// Per-tenant on/off switch for Claude document generation, plus a token/cost
// ledger. The API key itself stays a server env var (never stored per tenant).

// Verify the tenant's master (Admin) password — reused to confirm sensitive
// admin actions like flipping the Claude switch.
function masterPasswordOk(auth, password) {
  if (!password) return false;
  if (auth.master_hash && auth.master_salt) return verifyPassword(password, auth.master_salt, auth.master_hash);
  if (auth.master) return password === auth.master;   // legacy plaintext fallback
  return false;
}

tenantRouter.get('/api/admin/claude', requireAdmin, (req, res) => {
  const db = ctxDb();
  const usage = normalizeClaudeUsage(db.claudeUsage());
  const enabled = db.claudeSettings().enabled !== false;
  const keyConfigured = claude.isEnabled();
  res.json({
    keyConfigured,                       // is ANTHROPIC_API_KEY set on the server?
    enabled,                             // tenant toggle
    active: keyConfigured && enabled,    // effectively using Claude right now?
    model: claude.MODEL,
    price: claude.priceFor(claude.MODEL),  // USD per 1M tokens
    usd_to_thb: claude.USD_TO_THB,
    usage,
  });
});
tenantRouter.put('/api/admin/claude', requireAdmin, (req, res) => {
  const body = req.body || {};
  // Require the master Admin password to confirm before changing the switch.
  if (!masterPasswordOk(load.auth(), body.password)) {
    return res.status(401).json({ error: 'รหัส Admin ไม่ถูกต้อง' });
  }
  const enabled = !!body.enabled;
  const cur = ctxDb().claudeSettings();
  ctxDb().saveClaudeSettings(Object.assign({}, cur, { enabled, updated_at: new Date().toISOString() }));
  res.json({ ok: true, enabled, active: claude.isEnabled() && enabled });
});
tenantRouter.post('/api/admin/claude/usage/reset', requireAdmin, (req, res) => {
  ctxDb().saveClaudeUsage(emptyClaudeUsage());
  res.json({ ok: true });
});

// ---------- Language preference ----------
tenantRouter.post('/api/lang', (req, res) => {
  const lang = String((req.body && req.body.lang) || '').toLowerCase();
  if (!['th', 'en', 'cn'].includes(lang)) return res.status(400).json({ error: 'invalid lang' });
  res.setHeader('Set-Cookie', `lang=${lang}; Path=/; SameSite=Lax; Max-Age=${180*24*3600}`);
  res.json({ ok: true, lang });
});

// ---------- Interview workflow (employee interviews -> JD/KPI/Optimization docs) ----------
function interviewPath(id) { return ctxDb().interviewPath(id); }
function loadInterview(id) { return ctxDb().loadInterview(id); }
function saveInterview(iv) { ctxDb().saveInterview(iv); }
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
tenantRouter.get('/api/employees', (req, res) => {
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
tenantRouter.get('/api/me/employee', (req, res) => {
  if (req.session.role === 'admin') return res.json(null);
  let emp = load.employees().find(e => e.user_id === req.session.user_id && !e.archived);
  // Self-heal: if the record is missing (e.g. was reset/removed) but the user has a
  // complete position, recreate it as 'not_started' so they can interview again.
  if (!emp) {
    const user = load.users().find(u => u.id === req.session.user_id);
    if (user && user.position_id) emp = autoCreateEmployeeForUser(user);
  }
  res.json(emp || null);
});

// Manual create — admin-only escape hatch for data fix.
// Normal flow: emp records are auto-created when admin creates a user (position-anchored model).
tenantRouter.post('/api/employees', requireAdmin, (req, res) => {
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
tenantRouter.get('/api/schedules', (req, res) => {
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
tenantRouter.post('/api/interview/:id/start', (req, res) => {
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
tenantRouter.post('/api/interview/:id/message', (req, res) => {
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

// Summarise a user's recent daily worklog into a short Thai block for the AI
// (top recurring tasks, category mix, recurring %) over the chosen window.
function summarizeUserWorklog(db, userId, endDate, days) {
  if (!userId || !days) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const [yy, mm, dd] = String(endDate).split('-').map(Number);
  if (!yy) return null;
  const base = new Date(yy, mm - 1, dd);
  const catHours = {}, taskDays = {};
  let totalFilled = 0, daysLogged = 0, recurringFilled = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(base); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const wl = db.loadWorklog(userId, ds);
    if (!wl || !Array.isArray(wl.entries)) continue;
    const f = wl.entries.filter(e => e.task && String(e.task).trim());
    if (!f.length) continue;
    daysLogged++;
    const seen = new Set();
    for (const e of f) {
      totalFilled++;
      const cat = e.category && String(e.category).trim() ? e.category : 'ไม่ระบุ';
      catHours[cat] = (catHours[cat] || 0) + 1;
      if (e.recurring) recurringFilled++;
      const key = String(e.task).trim().toLowerCase().slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        taskDays[key] = taskDays[key] || { label: String(e.task).trim().slice(0, 80), days: 0, recurring: false };
        taskDays[key].days++;
        if (e.recurring) taskDays[key].recurring = true;
      }
    }
  }
  if (!daysLogged) return null;
  const cats = Object.entries(catHours).sort((a, b) => b[1] - a[1])
    .map(([c, h]) => `${c} ${Math.round((h / totalFilled) * 100)}%`);
  const topTasks = Object.values(taskDays).sort((a, b) => b.days - a.days).slice(0, 8);
  const lines = [
    `สรุปบันทึกงานจริงของพนักงาน (ย้อนหลัง ${days} วัน · มีบันทึก ${daysLogged} วัน · รวม ${totalFilled} รายการงาน):`,
    `- เวลาแยกตามหมวดหมู่: ${cats.join(', ')}`,
    `- งานซ้ำ ${Math.round((recurringFilled / totalFilled) * 100)}% ของเวลาทั้งหมด`,
    `- งานที่ทำบ่อย: ${topTasks.map(t => `${t.label} (${t.days} วัน${t.recurring ? ', งานประจำ' : ''})`).join('; ')}`,
  ];
  return { text: lines.join('\n'), daysLogged, totalFilled };
}

// Finish -> generate JD/KPI/Optimization docs.
// Generation can be slow (real Claude ~90s) — longer than the Cloudflare/browser
// request limit. So we mark the employee "processing", respond immediately, then
// generate in the BACKGROUND. The client polls /finish-status and shows a popup.
tenantRouter.post('/api/interview/:id/finish', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  const liveEmp = load.employees().find(e => e.id === req.params.id);
  if (!canInterviewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ปิด interview ของคนอื่น' });
  // How many days of the employee's daily worklog to feed the AI (chosen in the UI).
  const worklogDays = [30, 60, 90].includes(Number((req.body || {}).worklogDays)) ? Number(req.body.worklogDays) : 0;

  iv.finishedAt = iv.interviewDate
    ? (backdateIso(iv.interviewDate, 10) || new Date().toISOString())
    : new Date().toISOString();
  saveInterview(iv);

  // Mark processing + respond now (still inside the request → ALS proxies are safe).
  const list = load.employees();
  const e = list.find(x => x.id === iv.id);
  if (e) { e.docStatus = 'processing'; save.employees(list); }
  res.json({ ok: true, status: 'processing' });

  // Background generation. Capture the concrete tenant db NOW — after the response
  // returns the AsyncLocalStorage context is gone, so we must not use the
  // load/save/ctxDb proxies inside the async block below.
  const db = ctxDb();
  (async () => {
    try {
      // Enrich with the employee's recent daily worklog (window chosen in the UI).
      if (worklogDays && liveEmp && liveEmp.user_id) {
        const s = summarizeUserWorklog(db, liveEmp.user_id, String(iv.finishedAt || new Date().toISOString()).slice(0, 10), worklogDays);
        if (s) iv.worklogSummary = s.text;
      }
      const outDir = path.join(db.outDir, iv.id);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const docs = await generateDocuments(iv, db);
      for (const [name, content] of Object.entries(docs)) {
        fs.writeFileSync(path.join(outDir, name), content);
      }
      const l2 = db.employees();
      const e2 = l2.find(x => x.id === iv.id);
      if (e2) { e2.interviewStatus = 'completed'; e2.completedAt = iv.finishedAt; e2.docStatus = 'done'; db.saveEmployees(l2); }
    } catch (err) {
      console.error('[finish] doc generation failed for', iv.id, '-', err.message);
      const l2 = db.employees();
      const e2 = l2.find(x => x.id === iv.id);
      if (e2) { e2.docStatus = 'error'; db.saveEmployees(l2); }
    }
  })();
});

// Poll generation status for the popup. Returns processing | done | error.
tenantRouter.get('/api/interview/:id/finish-status', (req, res) => {
  const liveEmp = load.employees().find(e => e.id === req.params.id);
  if (!liveEmp) return res.status(404).json({ error: 'not found' });
  if (!canViewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'forbidden' });
  res.json({ status: liveEmp.docStatus || 'done' });
});

// ============================================================
// Daily hourly work log (บันทึกงานประจำวัน) — self-service per user
// ============================================================
const WORKLOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

// Build the full hour grid for a user on a date, overlaying any saved entries.
function buildWorklogForUser(db, user, date) {
  const uh = calcUserHours(user);
  const hours = (uh && uh.hours.length) ? uh.hours : [9, 10, 11, 13, 14, 15, 16, 17];
  const saved = db.loadWorklog(user.id, date);
  const byHour = {};
  if (saved && Array.isArray(saved.entries)) {
    for (const e of saved.entries) {
      if (!e || e.hour == null) continue;
      if (!(e.task && String(e.task).trim())) continue;            // skip blanks
      (byHour[e.hour] = byHour[e.hour] || []).push({ task: e.task || '', tools: e.tools || '', category: e.category || '', recurring: !!e.recurring });
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  // One row per scheduled hour, each holding 0..n task items (multiple tasks per hour).
  const entries = hours.map(h => ({ hour: h, label: `${pad(h)}:00–${pad(h + 1)}:00`, items: byHour[h] || [] }));
  const filled = entries.filter(e => e.items.length > 0).length;   // hours with at least one task
  return { date, total: entries.length, filled, entries, updated_at: saved ? saved.updated_at : null };
}

// Read current user's log for a date (default today)
tenantRouter.get('/api/worklog', (req, res) => {
  if (req.session.role === 'admin') return res.json({ applicable: false, error: 'admin ไม่มีบันทึกงานส่วนตัว', entries: [], total: 0, filled: 0 });
  const user = load.users().find(u => u.id === req.session.user_id);
  if (!user) return res.status(404).json({ error: 'not found' });
  let date = String(req.query.date || '').trim();
  const today = todayLocal();
  if (!WORKLOG_DATE_RE.test(date)) date = today;
  if (date > today) date = today; // never the future
  res.json({ applicable: true, ...buildWorklogForUser(ctxDb(), user, date) });
});

// Save current user's log for a date
tenantRouter.put('/api/worklog', (req, res) => {
  if (req.session.role === 'admin') return res.status(400).json({ error: 'admin ไม่มีบันทึกงานส่วนตัว' });
  const user = load.users().find(u => u.id === req.session.user_id);
  if (!user) return res.status(404).json({ error: 'not found' });
  const { date, entries } = req.body || {};
  const today = todayLocal();
  if (!WORKLOG_DATE_RE.test(String(date || ''))) return res.status(400).json({ error: 'รูปแบบวันที่ผิด (YYYY-MM-DD)' });
  if (String(date) > today) return res.status(400).json({ error: 'บันทึกงานวันในอนาคตไม่ได้' });
  // Flat list — multiple entries may share the same hour. Blank tasks are dropped.
  const clean = Array.isArray(entries) ? entries.map(e => ({
    hour: Number(e.hour),
    task: String(e.task || '').slice(0, 1000),
    tools: String(e.tools || '').slice(0, 300),
    category: String(e.category || '').slice(0, 80),
    recurring: !!e.recurring,
  })).filter(e => Number.isInteger(e.hour) && e.task && e.task.trim()) : [];
  ctxDb().saveWorklog(user.id, date, { user_id: user.id, date, entries: clean, updated_at: new Date().toISOString() });
  res.json({ ok: true });
});

// Lightweight status for the in-app reminder banner (today only)
tenantRouter.get('/api/worklog/status', (req, res) => {
  if (req.session.role === 'admin') return res.json({ applicable: false });
  const user = load.users().find(u => u.id === req.session.user_id);
  if (!user || !calcUserHours(user)) return res.json({ applicable: false });
  const wl = buildWorklogForUser(ctxDb(), user, todayLocal());
  res.json({ applicable: true, date: wl.date, total: wl.total, filled: wl.filled, complete: wl.total > 0 && wl.filled >= wl.total });
});

// ---- Work categories (admin seeds a starter set; any user can add new) ----
tenantRouter.get('/api/worklog/categories', (req, res) => {
  const list = ctxDb().categories();
  res.json({ categories: list.length ? list : DEFAULT_WORKLOG_CATEGORIES });
});
tenantRouter.post('/api/worklog/categories', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'ต้องใส่ชื่อหมวดหมู่' });
  if (name.length > 80) return res.status(400).json({ error: 'ชื่อหมวดหมู่ยาวเกินไป' });
  const db = ctxDb();
  let list = db.categories();
  if (!list.length) list = DEFAULT_WORKLOG_CATEGORIES.slice(); // first add also persists the defaults
  if (!list.some(c => c.toLowerCase() === name.toLowerCase())) { list.push(name); db.saveCategories(list); }
  res.json({ ok: true, categories: db.categories() });
});

// Copy "งานประจำ" (recurring) entries from the most recent prior day with any
tenantRouter.get('/api/worklog/copy-recurring', (req, res) => {
  if (req.session.role === 'admin') return res.json({ from: null, entries: [] });
  const user = load.users().find(u => u.id === req.session.user_id);
  if (!user) return res.status(404).json({ error: 'not found' });
  let date = String(req.query.date || '').trim();
  const today = todayLocal();
  if (!WORKLOG_DATE_RE.test(date)) date = today;
  if (date > today) date = today;
  const db = ctxDb();
  const pad = (n) => String(n).padStart(2, '0');
  const [yy, mm, dd] = date.split('-').map(Number);
  const base = new Date(yy, mm - 1, dd);
  for (let i = 1; i <= 30; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const wl = db.loadWorklog(user.id, ds);
    if (wl && Array.isArray(wl.entries)) {
      const rec = wl.entries.filter(e => e.recurring && e.task && String(e.task).trim());
      if (rec.length) {
        return res.json({ from: ds, entries: rec.map(e => ({ hour: e.hour, task: e.task, tools: e.tools || '', category: e.category || '', recurring: true })) });
      }
    }
  }
  res.json({ from: null, entries: [] });
});

// ---- Team view: supervisors/admin can read subordinates' logs (read-only) ----
// Whose worklog may this session view? Reuses the existing canView scope; officers
// see only their own (handled by the self endpoints), so they get no team here.
function canViewUserWorklog(session, u) {
  if (!u) return false;
  if (session.role === 'officer') return false;
  if (session.role === 'admin' || session.role === 'executive') return true;
  return canView(session, { division_id: u.division_id, section_id: u.section_id || null, position_id: u.position_id || null });
}

// Team roster + each member's status for a date (powers the searchable dropdown + filters)
tenantRouter.get('/api/worklog/team', (req, res) => {
  if (req.session.role === 'officer') return res.json({ applicable: false, members: [] });
  let date = String(req.query.date || '').trim();
  const today = todayLocal();
  if (!WORKLOG_DATE_RE.test(date)) date = today;
  if (date > today) date = today;
  const db = ctxDb();
  const divMap = Object.fromEntries(load.divisions().map(d => [d.id, d.name]));
  const secMap = Object.fromEntries(load.sections().map(s => [s.id, s.name]));
  const posMap = Object.fromEntries(load.positions().map(p => [p.id, p.name]));
  const members = load.users()
    .filter(u => u.id !== req.session.user_id && canViewUserWorklog(req.session, u))
    .map(u => {
      const wl = buildWorklogForUser(db, u, date);
      return {
        user_id: u.id, name: u.name, username: u.username,
        division_id: u.division_id || null, division_name: divMap[u.division_id] || '',
        section_id: u.section_id || null, section_name: secMap[u.section_id] || '',
        position_name: posMap[u.position_id] || '',
        total: wl.total, filled: wl.filled,
        status: wl.filled === 0 ? 'none' : (wl.filled >= wl.total ? 'complete' : 'partial'),
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
  res.json({ applicable: true, date, members });
});

// One member's worklog for a date — read-only, permission-checked
tenantRouter.get('/api/worklog/view/:userId', (req, res) => {
  const target = load.users().find(u => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (!canViewUserWorklog(req.session, target)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูบันทึกของผู้ใช้นี้' });
  let date = String(req.query.date || '').trim();
  const today = todayLocal();
  if (!WORKLOG_DATE_RE.test(date)) date = today;
  if (date > today) date = today;
  const db = ctxDb();
  const divMap = Object.fromEntries(load.divisions().map(d => [d.id, d.name]));
  const secMap = Object.fromEntries(load.sections().map(s => [s.id, s.name]));
  const posMap = Object.fromEntries(load.positions().map(p => [p.id, p.name]));
  res.json({
    ...buildWorklogForUser(db, target, date),
    member: {
      name: target.name, position_name: posMap[target.position_id] || '',
      division_name: divMap[target.division_id] || '', section_name: secMap[target.section_id] || '',
    },
  });
});

// Inclusive list of YYYY-MM-DD strings from..to (guarded)
function worklogDateRange(from, to) {
  const pad = (n) => String(n).padStart(2, '0');
  const out = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let d = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  let guard = 0;
  while (d <= end && guard < 400) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1); guard++;
  }
  return out;
}

// Aggregated worklog report over a date range for the viewer's team
tenantRouter.get('/api/worklog/report', (req, res) => {
  if (req.session.role === 'officer') return res.json({ applicable: false });
  const today = todayLocal();
  let to = String(req.query.to || '').trim();
  let from = String(req.query.from || '').trim();
  if (!WORKLOG_DATE_RE.test(to) || to > today) to = today;
  if (!WORKLOG_DATE_RE.test(from)) from = today.slice(0, 8) + '01'; // default: 1st of this month
  if (from > to) from = to;
  let dates = worklogDateRange(from, to);
  if (dates.length > 92) dates = dates.slice(-92); // cap ~3 months of file reads

  const fDiv = String(req.query.division_id || '').trim();
  const fSec = String(req.query.section_id || '').trim();
  const db = ctxDb();
  const divMap = Object.fromEntries(load.divisions().map(d => [d.id, d.name]));
  const secMap = Object.fromEntries(load.sections().map(s => [s.id, s.name]));
  const posMap = Object.fromEntries(load.positions().map(p => [p.id, p.name]));

  const users = load.users().filter(u =>
    u.id !== req.session.user_id && canViewUserWorklog(req.session, u) &&
    (!fDiv || u.division_id === fDiv) && (!fSec || u.section_id === fSec));

  const byCategory = {};
  let totFilledHours = 0, totRecurringTasks = 0, totTasks = 0, peopleLogged = 0, sumAvg = 0;

  const members = users.map(u => {
    const uh = calcUserHours(u);
    const perDay = (uh && uh.hours.length) ? uh.hours.length : 8;
    let filledHours = 0, daysLogged = 0, sumComplete = 0;
    for (const ds of dates) {
      const wl = db.loadWorklog(u.id, ds);
      if (!wl || !Array.isArray(wl.entries)) continue;
      const f = wl.entries.filter(e => e.task && String(e.task).trim());
      if (!f.length) continue;
      daysLogged++;
      const hrs = new Set(f.map(e => e.hour));         // distinct hours worked that day
      filledHours += hrs.size;
      sumComplete += Math.min(1, hrs.size / perDay);
      for (const e of f) {                              // category/recurring counted per task
        totTasks++;
        const cat = e.category && String(e.category).trim() ? e.category : 'ไม่ระบุ';
        byCategory[cat] = (byCategory[cat] || 0) + 1;
        if (e.recurring) totRecurringTasks++;
      }
    }
    const avg = daysLogged ? Math.round((sumComplete / daysLogged) * 100) : 0;
    totFilledHours += filledHours;
    if (daysLogged) { peopleLogged++; sumAvg += avg; }
    return {
      user_id: u.id, name: u.name,
      position_name: posMap[u.position_id] || '', division_name: divMap[u.division_id] || '', section_name: secMap[u.section_id] || '',
      filledHours, daysLogged, avgCompleteness: avg,
      status: daysLogged === 0 ? 'none' : (avg >= 90 ? 'good' : (avg >= 60 ? 'ok' : 'low')),
    };
  }).sort((a, b) => b.filledHours - a.filledHours);

  const byCat = Object.entries(byCategory)
    .map(([category, count]) => ({ category, count, pct: totTasks ? Math.round((count / totTasks) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  res.json({
    applicable: true, from, to, dayCount: dates.length,
    totals: {
      filledHours: totFilledHours,
      recurringPct: totTasks ? Math.round((totRecurringTasks / totTasks) * 100) : 0,
      peopleLogged, peopleTotal: members.length,
      avgCompleteness: peopleLogged ? Math.round(sumAvg / peopleLogged) : 0,
    },
    byCategory: byCat,
    members,
  });
});

// Interview JSON — read access via canViewEmployee so hierarchy can inspect subordinates'
// answers (including archived/historical records).
tenantRouter.get('/api/interview/:id', (req, res) => {
  const iv = loadInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: 'not found' });
  const liveEmp = load.employees().find(e => e.id === req.params.id) || iv.employee;
  if (!canViewEmployee(req.session, liveEmp)) return res.status(403).json({ error: 'forbidden' });
  res.json(iv);
});

// Reset interview — clears the answers + generated documents and sets status back
// to "not_started". KEEPS the employee record so they can interview again.
// (To remove a person entirely, delete their user account instead.) ADMIN ONLY.
tenantRouter.delete('/api/interview/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const ivFile = interviewPath(id);
  const outDir = path.join(ctxDb().outDir, id);
  if (fs.existsSync(ivFile)) fs.unlinkSync(ivFile);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });

  const list = load.employees();
  const e = list.find(x => x.id === id);
  if (!e) return res.status(404).json({ error: 'employee not found' });
  e.interviewStatus = 'not_started';
  delete e.completedAt;
  delete e.docStatus;
  save.employees(list);
  res.json({ ok: true, reset: true });
});

// History for calendar — scope-filtered
tenantRouter.get('/api/interviews/history', (req, res) => {
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
tenantRouter.post('/api/company/analyze', requireRoles('admin', 'executive', 'manager'), async (req, res) => {
  const list = load.employees();
  const interviews = list
    .map(e => loadInterview(e.id))
    .filter(iv => iv && iv.finishedAt);
  const md = await analyzeCompany(interviews, ctxDb());
  const outDir = ctxDb().cmpOutDir;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'optimization-report.md'), md);
  res.json({ ok: true, count: interviews.length, file: 'optimization-report.md' });
});

// Download company-wide report — admin + executive + manager
tenantRouter.get('/api/outputs/_company/:file', requireRoles('admin', 'executive', 'manager'), (req, res) => {
  const file = req.params.file;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad filename');
  const p = path.join(ctxDb().cmpOutDir, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// Download generated per-employee file — scope check (read access).
tenantRouter.get('/api/outputs/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad filename');
  const emp = load.employees().find(e => e.id === id);
  if (!canViewEmployee(req.session, emp)) return res.status(403).send('forbidden');
  const safeId = id.replace(/[^a-zA-Z0-9_]/g, '');
  const p = path.join(ctxDb().outDir, safeId, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

// ---------- Static page routes ----------
tenantRouter.get('/',         (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
tenantRouter.get('/login',    (req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
tenantRouter.get('/admin',    requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
tenantRouter.get('/admin/users', requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin-users.html')));
tenantRouter.get('/admin/org',   requireAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin-org.html')));
tenantRouter.get('/profile',  (req, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
tenantRouter.get('/reports',  (req, res) => res.sendFile(path.join(ROOT, 'public', 'reports.html')));
tenantRouter.get('/manual',   (req, res) => res.sendFile(path.join(ROOT, 'public', 'manual.html')));
tenantRouter.get('/division', (req, res) => res.sendFile(path.join(ROOT, 'public', 'division.html')));
tenantRouter.get('/interview',(req, res) => res.sendFile(path.join(ROOT, 'public', 'interview.html')));
tenantRouter.get('/review',   (req, res) => res.sendFile(path.join(ROOT, 'public', 'review.html')));
tenantRouter.get('/examples', (req, res) => res.sendFile(path.join(ROOT, 'public', 'examples.html')));
tenantRouter.get('/dashboard',(req, res) => res.sendFile(path.join(ROOT, 'public', 'dashboard.html')));
tenantRouter.get('/worklog',  (req, res) => res.sendFile(path.join(ROOT, 'public', 'worklog.html')));
tenantRouter.get('/worklog-team', (req, res) => res.sendFile(path.join(ROOT, 'public', 'worklog-team.html')));
tenantRouter.get('/worklog-report', (req, res) => res.sendFile(path.join(ROOT, 'public', 'worklog-report.html')));

// ============================================================
// Excel Import / Template Generation (admin only)
// ============================================================
function sendWorkbook(res, filename, wb) {
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

// Build a "ค่าที่ใช้ได้" reference sheet listing current org values so admins
// can copy-paste exact names instead of guessing/typing them.
function buildReferenceSheet({ includeRoles }) {
  const divs = load.divisions();
  const secs = load.sections();
  const poss = load.positions();
  const rows = [
    ['📋 ค่าที่ใช้ได้ในระบบ — Reference'],
    ['ใช้ค่าจากตารางนี้ในชีทหลัก เพื่อป้องกันการพิมพ์ผิด — ระบบจะตรวจชื่อให้ตรงกันแบบเป๊ะๆ'],
    [''],
  ];
  if (includeRoles) {
    rows.push(['Role ที่ใช้ได้ (ใส่ภาษาไทยหรืออังกฤษก็ได้):']);
    rows.push(['ภาษาอังกฤษ', 'ภาษาไทย']);
    rows.push(['executive', 'ผู้บริหาร']);
    rows.push(['manager', 'ผู้จัดการ']);
    rows.push(['division_head', 'หัวหน้าฝ่าย']);
    rows.push(['section_head', 'หัวหน้าแผนก']);
    rows.push(['officer', 'เจ้าหน้าที่']);
    rows.push(['']);
  }
  rows.push([`ฝ่าย (${divs.length} ฝ่าย):`]);
  if (divs.length === 0) rows.push(['(ยังไม่มีฝ่ายในระบบ — สร้างก่อนใน /admin/org)']);
  else divs.forEach(d => rows.push([d.name]));
  rows.push(['']);

  rows.push([`แผนก (${secs.length} แผนก):`]);
  rows.push(['ฝ่าย', 'แผนก']);
  if (secs.length === 0) rows.push(['(ยังไม่มีแผนก)']);
  else {
    secs.forEach(s => {
      const div = divs.find(d => d.id === s.division_id);
      rows.push([div?.name || '?', s.name]);
    });
  }
  rows.push(['']);

  rows.push([`ตำแหน่ง (${poss.length} ตำแหน่ง):`]);
  rows.push(['ฝ่าย', 'แผนก', 'ตำแหน่ง']);
  if (poss.length === 0) rows.push(['(ยังไม่มีตำแหน่ง)']);
  else {
    poss.forEach(p => {
      const sec = secs.find(x => x.id === p.section_id);
      const div = sec ? divs.find(d => d.id === sec.division_id) : null;
      rows.push([div?.name || '?', sec?.name || '?', p.name]);
    });
  }
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }];
  return sheet;
}

// Template downloads — main sheet first, reference sheet second
tenantRouter.get('/api/admin/import/template/org', requireAdmin, (req, res) => {
  const wb = xlsx.utils.book_new();
  const main = xlsx.utils.aoa_to_sheet([
    ['ฝ่าย', 'แผนก', 'ตำแหน่ง', 'EN (optional)'],
    ['ฝ่ายขาย', 'แผนกขายส่ง', 'หัวหน้าทีมขายส่ง', 'Wholesale Lead'],
    ['ฝ่ายขาย', 'แผนกขายส่ง', 'พนักงานขายส่ง', 'Wholesale Rep'],
    ['ฝ่ายขาย', 'แผนกขายปลีก', 'แคชเชียร์', 'Cashier'],
    ['ฝ่ายไอที', 'แผนก Support', 'Help Desk', ''],
  ]);
  main['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 24 }, { wch: 20 }];
  xlsx.utils.book_append_sheet(wb, main, 'Organization');
  xlsx.utils.book_append_sheet(wb, buildReferenceSheet({ includeRoles: false }), 'ค่าที่ใช้ได้');
  sendWorkbook(res, 'template-org.xlsx', wb);
});

tenantRouter.get('/api/admin/import/template/users', requireAdmin, (req, res) => {
  const wb = xlsx.utils.book_new();
  const main = xlsx.utils.aoa_to_sheet([
    ['Username', 'ชื่อ-นามสกุล', 'Password', 'Role', 'ฝ่าย', 'แผนก', 'ตำแหน่ง', 'เข้างาน', 'ออกงาน', 'เริ่มพัก', 'เลิกพัก'],
    ['somchai', 'สมชาย ใจดี', 'pw1234', 'officer', 'ฝ่ายขาย', 'แผนกขายส่ง', 'พนักงานขายส่ง', '09:00', '18:00', '12:00', '13:00'],
    ['somsri', 'สมศรี ขายดี', 'pw1234', 'หัวหน้าแผนก', 'ฝ่ายขาย', 'แผนกขายปลีก', 'แคชเชียร์', '08:30', '17:30', '12:00', '13:00'],
  ]);
  main['!cols'] = [
    { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 16 },
    { wch: 18 }, { wch: 22 }, { wch: 24 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
  ];
  xlsx.utils.book_append_sheet(wb, main, 'Users');
  xlsx.utils.book_append_sheet(wb, buildReferenceSheet({ includeRoles: true }), 'ค่าที่ใช้ได้');
  sendWorkbook(res, 'template-users.xlsx', wb);
});

// Parse uploaded Excel: base64 in req.body.file → array of row objects (uses first sheet)
function parseUploadedXlsx(req) {
  const b64 = (req.body || {}).file;
  if (!b64) throw new Error('ไม่พบไฟล์');
  const buf = Buffer.from(b64, 'base64');
  const wb = xlsx.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: '' });
}

// Import org structure (Add only — skip duplicates by name within parent)
tenantRouter.post('/api/admin/import/org', requireAdmin, (req, res) => {
  let rows;
  try { rows = parseUploadedXlsx(req); }
  catch (err) { return res.status(400).json({ error: 'อ่านไฟล์ไม่สำเร็จ: ' + err.message }); }

  const divs = load.divisions();
  const secs = load.sections();
  const poss = load.positions();
  let addedDiv = 0, addedSec = 0, addedPos = 0, skipped = 0;
  const errors = [];

  rows.forEach((row, idx) => {
    const r = idx + 2;  // Excel row number (1 = header)
    const divName = String(row['ฝ่าย'] || row.division || '').trim();
    const secName = String(row['แผนก'] || row.section || '').trim();
    const posName = String(row['ตำแหน่ง'] || row.position || '').trim();
    const enName = String(row['EN (optional)'] || row['EN'] || row.name_en || '').trim();

    if (!divName || !secName || !posName) {
      errors.push({ row: r, error: 'ต้องมี ฝ่าย/แผนก/ตำแหน่ง ครบ 3 คอลัมน์' });
      return;
    }

    let div = divs.find(d => d.name === divName);
    if (!div) {
      div = { id: genId('div'), name: divName, name_en: '', icon: '🏢', color: '#3b82f6', created_at: new Date().toISOString() };
      divs.push(div);
      addedDiv++;
    }
    let sec = secs.find(s => s.name === secName && s.division_id === div.id);
    if (!sec) {
      sec = { id: genId('sec'), division_id: div.id, name: secName, name_en: '', created_at: new Date().toISOString() };
      secs.push(sec);
      addedSec++;
    }
    let pos = poss.find(p => p.name === posName && p.section_id === sec.id);
    if (!pos) {
      poss.push({ id: genId('pos'), section_id: sec.id, name: posName, name_en: enName, created_at: new Date().toISOString() });
      addedPos++;
    } else {
      skipped++;
    }
  });

  save.divisions(divs);
  save.sections(secs);
  save.positions(poss);
  res.json({ ok: true, addedDiv, addedSec, addedPos, skipped, errorCount: errors.length, errors: errors.slice(0, 20) });
});

// Import users (Add only — skip duplicate usernames; auto-create emp records)
const ROLE_ALIASES = {
  'executive': 'executive',     'ผู้บริหาร': 'executive',
  'manager': 'manager',         'ผู้จัดการ': 'manager',
  'division_head': 'division_head', 'หัวหน้าฝ่าย': 'division_head',
  'section_head': 'section_head',   'หัวหน้าแผนก': 'section_head',
  'officer': 'officer',         'เจ้าหน้าที่': 'officer',
};
tenantRouter.post('/api/admin/import/users', requireAdmin, (req, res) => {
  let rows;
  try { rows = parseUploadedXlsx(req); }
  catch (err) { return res.status(400).json({ error: 'อ่านไฟล์ไม่สำเร็จ: ' + err.message }); }

  const users = load.users();
  const divs = load.divisions();
  const secs = load.sections();
  const poss = load.positions();
  let added = 0, skipped = 0;
  const errors = [];
  const newUsers = [];

  rows.forEach((row, idx) => {
    const r = idx + 2;
    const username = String(row['Username'] || row.username || '').trim();
    const name = String(row['ชื่อ-นามสกุล'] || row['ชื่อ'] || row.name || '').trim();
    const password = String(row['Password'] || row.password || '').trim();
    const roleRaw = String(row['Role'] || row.role || '').trim();
    const divName = String(row['ฝ่าย'] || row.division || '').trim();
    const secName = String(row['แผนก'] || row.section || '').trim();
    const posName = String(row['ตำแหน่ง'] || row.position || '').trim();
    const ws = String(row['เข้างาน'] || row.work_start || '09:00').trim();
    const we = String(row['ออกงาน'] || row.work_end || '18:00').trim();
    const bs = String(row['เริ่มพัก'] || row.break_start || '12:00').trim();
    const be = String(row['เลิกพัก'] || row.break_end || '13:00').trim();

    if (!username || !name || !password || !roleRaw) {
      errors.push({ row: r, error: 'ต้องใส่ username, ชื่อ, password, role' });
      return;
    }
    if (username === 'admin') {
      errors.push({ row: r, error: 'ห้ามใช้ username "admin"' });
      return;
    }
    if (users.some(u => u.username === username)) {
      skipped++;
      return;
    }
    const role = ROLE_ALIASES[roleRaw.toLowerCase()] || ROLE_ALIASES[roleRaw];
    if (!role) {
      errors.push({ row: r, error: `role ไม่ถูกต้อง: "${roleRaw}"` });
      return;
    }
    const div = divs.find(d => d.name === divName);
    if (!div) { errors.push({ row: r, error: `ไม่พบฝ่าย "${divName}"` }); return; }
    const sec = secs.find(s => s.name === secName && s.division_id === div.id);
    if (!sec) { errors.push({ row: r, error: `ไม่พบแผนก "${secName}" ในฝ่าย "${divName}"` }); return; }
    const pos = poss.find(p => p.name === posName && p.section_id === sec.id);
    if (!pos) { errors.push({ row: r, error: `ไม่พบตำแหน่ง "${posName}" ในแผนก "${secName}"` }); return; }

    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: genId('usr'),
      username, name,
      password_salt: salt,
      password_hash: hashPassword(password, salt),
      role,
      division_id: div.id, section_id: sec.id, position_id: pos.id,
      work_start: ws, work_end: we, break_start: bs, break_end: be,
      scope_override: null,
      created_at: new Date().toISOString(),
    };
    users.push(user);
    newUsers.push(user);
    added++;
  });

  save.users(users);
  // Auto-create anchor emp records for newly added users
  for (const u of newUsers) autoCreateEmployeeForUser(u);

  res.json({ ok: true, added, skipped, errorCount: errors.length, errors: errors.slice(0, 20) });
});

// ============================================================
// Danger Zone — wipe actions (admin only, requires confirm: "DELETE")
// ============================================================
function requireConfirmDelete(req, res, next) {
  if ((req.body || {}).confirm !== 'DELETE') {
    return res.status(400).json({ error: 'ต้องส่ง body { "confirm": "DELETE" } เพื่อยืนยัน' });
  }
  next();
}
function wipeInterviewsFolder() {
  const dir = ctxDb().intDir;
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f === '.gitkeep') continue;
    fs.unlinkSync(path.join(dir, f));
  }
}
function wipeOutputsFolder() {
  const dir = ctxDb().outDir;
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f === '_company') continue;
    fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
}

// 1) Wipe all users (archive their emp records — keep org tree + interview history)
tenantRouter.post('/api/admin/wipe/users', requireAdmin, requireConfirmDelete, (req, res) => {
  save.users([]);
  const emps = load.employees();
  for (const e of emps) {
    if (!e.archived) {
      e.archived = true;
      e.vacated_at = new Date().toISOString();
      e.vacated_reason = 'mass_user_delete';
      e.user_id = null;
    }
  }
  save.employees(emps);
  res.json({ ok: true, message: 'ลบ user ทั้งหมด · emp records ถูก archive ไว้เป็นประวัติ' });
});

// 2) Wipe org tree (cascade users + emp + interviews)
tenantRouter.post('/api/admin/wipe/org', requireAdmin, requireConfirmDelete, (req, res) => {
  save.divisions([]);
  save.sections([]);
  save.positions([]);
  save.users([]);
  save.employees([]);
  wipeInterviewsFolder();
  wipeOutputsFolder();
  res.json({ ok: true, message: 'ลบโครงสร้างองค์กร + users + emp + interviews · เก็บ admin + ชื่อบริษัท' });
});

// 3) Wipe interview answers + generated docs (keep users + org + emp records)
tenantRouter.post('/api/admin/wipe/interviews', requireAdmin, requireConfirmDelete, (req, res) => {
  wipeInterviewsFolder();
  wipeOutputsFolder();
  const emps = load.employees();
  for (const e of emps) {
    if (!e.archived) {
      e.interviewStatus = 'not_started';
      delete e.completedAt;
    }
  }
  save.employees(emps);
  res.json({ ok: true, message: 'ลบคำตอบ interview + เอกสาร JD/KPI · reset สถานะเป็น not_started' });
});

// 4) Wipe everything (factory reset — keep admin password + .secret)
tenantRouter.post('/api/admin/wipe/all', requireAdmin, requireConfirmDelete, (req, res) => {
  save.divisions([]);
  save.sections([]);
  save.positions([]);
  save.users([]);
  save.employees([]);
  wipeInterviewsFolder();
  wipeOutputsFolder();
  // Preserve the company name across a factory reset (don't revert to placeholder).
  const keepCompany = load.company();
  save.company({ name: keepCompany.name || 'บริษัทตัวอย่าง จำกัด', name_en: keepCompany.name_en || 'Sample Company Ltd.', updated_at: new Date().toISOString() });
  res.json({ ok: true, message: 'Factory reset เรียบร้อย · เก็บแค่ admin password' });
});

// ============================================================
// Mount tenant subrouter — all /t/:tenantId/* requests now flow through it
// ============================================================
app.use('/t/:tenantId', tenantRouter);

// ============================================================
// Super-admin layer (root-level, NOT scoped to a tenant)
// ============================================================
function readSuperAuth() { return readJson(SUPER_AUTH_FILE, { master: '' }); }
function writeSuperAuth(o) { writeJson(SUPER_AUTH_FILE, o); }

function parseSuperSession(req) {
  const token = parseCookie(req, 'super_auth');
  const s = verifyToken(token);
  return s?.role === 'super' ? s : null;
}
function requireSuperAdmin(req, res, next) {
  const s = parseSuperSession(req);
  if (!s) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'super admin only' });
    return res.redirect('/super/login');
  }
  req.superSession = s;
  next();
}

app.post('/api/super/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const gate = rlCheck(ip);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error: `เข้าสู่ระบบล้มเหลวบ่อยเกินไป — ลองใหม่อีก ${gate.retryAfter} วินาที` });
  }
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'กรอกรหัสผ่าน' });
  const auth = readSuperAuth();
  let ok = false;
  if (auth.master_hash && auth.master_salt) {
    ok = verifyPassword(password, auth.master_salt, auth.master_hash);
  } else if (auth.master) {
    ok = password === auth.master;
  }
  if (!ok) { rlFail(ip); return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' }); }
  rlOk(ip);
  const token = signToken({ role: 'super', exp: Date.now() + 7*24*3600*1000 });
  res.setHeader('Set-Cookie', `super_auth=${token}; Path=/; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=${7*24*3600}`);
  res.json({ ok: true });
});

app.post('/api/super/logout', (req, res) => {
  res.setHeader('Set-Cookie', `super_auth=; Path=/; HttpOnly; SameSite=Lax${cookieSuffix}; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/super/me', requireSuperAdmin, (req, res) => res.json({ role: 'super' }));

// List tenants — enriched with user count
app.get('/api/super/tenants', requireSuperAdmin, (req, res) => {
  const tenants = loadTenants();
  const enriched = tenants.map(t => {
    let userCount = 0;
    try { userCount = tenantDb(t.id).users().length; } catch {}
    return { ...t, user_count: userCount };
  });
  res.json(enriched);
});

// Create tenant
app.post('/api/super/tenants', requireSuperAdmin, (req, res) => {
  const { id, name, admin_password } = req.body || {};
  const cleanId = String(id || '').trim().toLowerCase();
  if (!cleanId || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(cleanId)) {
    return res.status(400).json({ error: 'tenant id ต้องเป็น a-z, 0-9, ขีดกลาง 1-32 ตัวอักษร เริ่มด้วยตัวอักษร/ตัวเลข' });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'ต้องใส่ชื่อบริษัท' });
  const tenants = loadTenants();
  if (tenants.some(t => t.id === cleanId)) return res.status(400).json({ error: 'มี tenant id นี้แล้ว' });
  const newTenant = { id: cleanId, name: String(name).trim(), created_at: new Date().toISOString() };
  tenants.push(newTenant);
  saveTenants(tenants);
  initTenantFolder(cleanId, admin_password || 'WWN2026!Init', newTenant.name);
  res.json({ ...newTenant, url_path: '/t/' + cleanId });
});

// Rename tenant
app.put('/api/super/tenants/:id', requireSuperAdmin, (req, res) => {
  const tenants = loadTenants();
  const t = tenants.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (req.body.name !== undefined) {
    t.name = String(req.body.name).trim();
    // Keep the tenant's own company.json display name in sync with the super-admin label,
    // so renaming here also fixes the name shown inside the tenant (incl. existing tenants).
    try {
      const cdb = tenantDb(t.id);
      const c = cdb.company();
      c.name = t.name;
      c.updated_at = new Date().toISOString();
      cdb.saveCompany(c);
    } catch (e) { console.error('[rename] company.json sync failed:', e.message); }
  }
  t.updated_at = new Date().toISOString();
  saveTenants(tenants);
  res.json(t);
});

// Delete tenant + all its data (irreversible)
app.delete('/api/super/tenants/:id', requireSuperAdmin, (req, res) => {
  if ((req.body || {}).confirm !== 'DELETE') {
    return res.status(400).json({ error: 'ต้องส่ง confirm: "DELETE"' });
  }
  const tenants = loadTenants();
  const idx = tenants.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  tenants.splice(idx, 1);
  saveTenants(tenants);
  const dir = path.join(TENANT_DATA_DIR, req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const out = path.join(TENANT_OUTPUT_DIR, req.params.id);
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  res.json({ ok: true });
});

// Rename tenant URL ID (the slug, e.g. companya → wanwanach)
// Moves data/tenants/<old>/ → data/tenants/<new>/ and outputs likewise.
app.post('/api/super/tenants/:id/rename-id', requireSuperAdmin, (req, res) => {
  const oldId = req.params.id;
  const cleanNew = String((req.body || {}).new_id || '').trim().toLowerCase();
  if (!cleanNew || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(cleanNew)) {
    return res.status(400).json({ error: 'URL ID ต้องเป็น a-z, 0-9, ขีดกลาง 1-32 ตัวอักษร เริ่มด้วยตัวอักษร/ตัวเลข' });
  }
  if (cleanNew === oldId) return res.status(400).json({ error: 'URL ID ใหม่เหมือนเดิม' });
  const tenants = loadTenants();
  if (tenants.some(t => t.id === cleanNew)) return res.status(400).json({ error: 'มี URL ID นี้แล้ว' });
  const t = tenants.find(x => x.id === oldId);
  if (!t) return res.status(404).json({ error: 'not found' });

  const oldDir = path.join(TENANT_DATA_DIR, oldId);
  const newDir = path.join(TENANT_DATA_DIR, cleanNew);
  const oldOut = path.join(TENANT_OUTPUT_DIR, oldId);
  const newOut = path.join(TENANT_OUTPUT_DIR, cleanNew);
  try {
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
    if (fs.existsSync(oldOut)) fs.renameSync(oldOut, newOut);
  } catch (err) {
    return res.status(500).json({ error: 'ย้ายโฟลเดอร์ไม่สำเร็จ: ' + err.message });
  }
  t.id = cleanNew;
  t.previous_id = oldId;
  t.renamed_at = new Date().toISOString();
  saveTenants(tenants);
  // All existing tenant cookies become invalid (Path mismatch + tenant_id mismatch
  // in the signed payload) — users will be sent back to login on the new URL.
  res.json({ ok: true, old_id: oldId, new_id: cleanNew, new_url: '/t/' + cleanNew });
});

// Reset tenant admin password
app.post('/api/super/tenants/:id/reset-admin-password', requireSuperAdmin, (req, res) => {
  const t = findTenant(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'รหัสใหม่ต้องยาวอย่างน้อย 6 ตัว' });
  const db = tenantDb(req.params.id);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.saveAuth({ master_salt: salt, master_hash: hash, updated_at: new Date().toISOString() });
  res.json({ ok: true });
});

// Change super-admin password
app.put('/api/super/password', requireSuperAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'รหัสใหม่ต้องยาวอย่างน้อย 6 ตัว' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  writeSuperAuth({ master_salt: salt, master_hash: hash, updated_at: new Date().toISOString() });
  res.json({ ok: true });
});

// Super-admin pages
app.get('/super/login',   (req, res) => res.sendFile(path.join(ROOT, 'public', 'super-login.html')));
app.get('/super',         requireSuperAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'super-tenants.html')));
app.get('/super/tenants', requireSuperAdmin, (req, res) => res.sendFile(path.join(ROOT, 'public', 'super-tenants.html')));

// Root → super-admin
app.get('/', (req, res) => {
  if (parseSuperSession(req)) return res.redirect('/super');
  return res.redirect('/super/login');
});

app.listen(PORT, () => {
  console.log(`\n🚀 HR-Interview (multi-tenant) running at http://localhost:${PORT}\n`);
  console.log(`   super-admin login → http://localhost:${PORT}/super/login`);
  console.log(`   default password   → super!2026 (change after first login)\n`);

  // Optional: open the default browser to the super-admin login on startup.
  if (process.env.AUTO_OPEN_BROWSER === 'true') {
    setTimeout(() => {
      const url = `http://localhost:${PORT}/super/login`;
      const cmd = process.platform === 'win32' ? `start "" "${url}"`
                : process.platform === 'darwin' ? `open "${url}"`
                : `xdg-open "${url}"`;
      require('child_process').exec(cmd, () => { /* swallow errors */ });
    }, 1200);
  }
});
