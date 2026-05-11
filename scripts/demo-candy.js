/**
 * Demo seed: simulate a candy company filling out HR-WWN.
 * Uses native fetch (Node 18+).
 */
const BASE = 'http://localhost:3000';
let cookie = '';

function setCookieFromRes(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/auth=([^;]+)/);
  if (m) cookie = 'auth=' + m[1];
}

async function api(method, path, body, asUser) {
  const headers = { 'content-type': 'application/json' };
  if (asUser !== undefined ? asUser : true) headers['cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  setCookieFromRes(res);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function loginAs(username, password) {
  cookie = '';
  const r = await api('POST', '/api/login', { username, password }, false);
  return r;
}

function line(title) { console.log('\n=== ' + title + ' ==='); }

(async () => {
  line('Login as admin');
  console.log(await loginAs('admin', 'JC2026!Init'));

  line('Set company name');
  console.log(await api('PUT', '/api/company', {
    name: 'บริษัทขนมสยาม จำกัด',
    name_en: 'Siam Snacks Co., Ltd.',
  }));

  line('Create ฝ่ายขาย (Sales Division)');
  const divSales = await api('POST', '/api/divisions', {
    name: 'ฝ่ายขาย',
    name_en: 'Sales',
    icon: '🍬',
    color: '#ec4899',
  });
  console.log(divSales);

  line('Create 3 sections under ฝ่ายขาย');
  const secWholesale = await api('POST', '/api/sections', { name: 'แผนกขายส่ง',     name_en: 'Wholesale', division_id: divSales.id });
  const secRetail    = await api('POST', '/api/sections', { name: 'แผนกขายปลีก',    name_en: 'Retail',    division_id: divSales.id });
  const secOnline    = await api('POST', '/api/sections', { name: 'แผนกขายออนไลน์', name_en: 'Online',    division_id: divSales.id });
  console.log([secWholesale, secRetail, secOnline].map(s => `${s.name} (${s.id})`));

  line('Create positions under each section');
  const positions = {};
  positions.wsLead   = await api('POST', '/api/positions', { name: 'หัวหน้าทีมขายส่ง',    name_en: 'Wholesale Lead',     section_id: secWholesale.id });
  positions.wsRep    = await api('POST', '/api/positions', { name: 'พนักงานขายส่ง',       name_en: 'Wholesale Rep',      section_id: secWholesale.id });
  positions.rtLead   = await api('POST', '/api/positions', { name: 'หัวหน้าทีมขายปลีก',   name_en: 'Retail Lead',        section_id: secRetail.id });
  positions.rtCash   = await api('POST', '/api/positions', { name: 'แคชเชียร์',           name_en: 'Cashier',            section_id: secRetail.id });
  positions.onMgr    = await api('POST', '/api/positions', { name: 'แอดมินเพจขายออนไลน์', name_en: 'Online Page Admin',  section_id: secOnline.id });
  positions.onPack   = await api('POST', '/api/positions', { name: 'แพ็คของส่งลูกค้า',    name_en: 'Packer',             section_id: secOnline.id });
  for (const [k, v] of Object.entries(positions)) console.log(`  ${k}: ${v.name} (${v.id})`);

  line('Create 5 users — one per role + officers');

  // 1) Executive — sees everything
  const userExec = await api('POST', '/api/users', {
    username: 'kunying', password: 'exec1234', name: 'คุณหญิง ขนมหวาน',
    role: 'executive',
  });
  console.log('Executive:', userExec.username, '-', userExec.name);

  // 2) Manager — Sales division, with override to see no extra
  const userMgr = await api('POST', '/api/users', {
    username: 'somsak', password: 'mgr1234', name: 'สมศักดิ์ ผู้จัดการ',
    role: 'manager', division_id: divSales.id,
  });
  console.log('Manager:', userMgr.username, '-', userMgr.name);

  // 3) Division head — Sales division
  const userDivHead = await api('POST', '/api/users', {
    username: 'pim', password: 'div1234', name: 'พิม หัวหน้าฝ่าย',
    role: 'division_head', division_id: divSales.id,
  });
  console.log('Division head:', userDivHead.username, '-', userDivHead.name);

  // 4) Section head — Online section
  const userSecHead = await api('POST', '/api/users', {
    username: 'noi', password: 'sec1234', name: 'น้อย หัวหน้าออนไลน์',
    role: 'section_head', division_id: divSales.id, section_id: secOnline.id,
  });
  console.log('Section head (Online):', userSecHead.username, '-', userSecHead.name);

  // 5) Officer — Online packer
  const userOfficer = await api('POST', '/api/users', {
    username: 'mali', password: 'off1234', name: 'มะลิ แพ็คของ',
    role: 'officer',
    division_id: divSales.id, section_id: secOnline.id, position_id: positions.onPack.id,
    work_start: '08:00', work_end: '17:00', break_start: '12:00', break_end: '13:00',
  });
  console.log('Officer:', userOfficer.username, '-', userOfficer.name);

  line('As Section head (Online) — add employee in own section and start interview');
  await loginAs('noi', 'sec1234');
  const emp1 = await api('POST', '/api/employees', {
    name: 'นภา ใจดี',
    role: 'แอดมินเพจขายออนไลน์',
    division_id: divSales.id,
    section_id: secOnline.id,
    position_id: positions.onMgr.id,
    primary_duty: 'ตอบแชทลูกค้าใน Facebook / Line OA · รับออเดอร์ · อัปเดตสต็อก',
    email: 'napha@siam-snacks.co',
  });
  console.log('Created employee:', emp1.id, '-', emp1.name);

  line('Start interview for นภา + answer 3 questions');
  const start = await api('POST', `/api/interview/${emp1.id}/start`, { lang: 'th', schedule: '09-18', interviewDate: '2026-05-11' });
  console.log('First question key=', start.question.key, 'text=', start.question.text);

  const answers = [
    { key: start.question.key, value: 'ตื่นมาเช็คแชท Facebook + Line OA ตอบลูกค้าก่อนทำอย่างอื่น' },
  ];
  let currentQ = start.question;
  for (let i = 0; i < 2 && !currentQ.done; i++) {
    const r = await api('POST', `/api/interview/${emp1.id}/message`, { key: currentQ.key, value: answers[answers.length-1].value, skipProbe: true });
    if (r.probe) { console.log('  (probed, retry)'); continue; }
    currentQ = r.question;
    answers.push({ key: currentQ.key, value: 'ตอบทดสอบ ' + (i+2) });
  }
  // Submit second + third answers
  for (let i = 1; i < answers.length && !currentQ.done; i++) {
    const r = await api('POST', `/api/interview/${emp1.id}/message`, { key: answers[i].key, value: answers[i].value, skipProbe: true });
    if (!r.probe) currentQ = r.question;
  }
  console.log('Answered', answers.length, 'questions. Next question key=', currentQ.key);

  line('As Officer มะลิ — interview self (auto-fill scope)');
  await loginAs('mali', 'off1234');
  const empSelf = await api('POST', '/api/employees', {
    name: 'มะลิ แพ็คของ',
    role: 'แพ็คของส่งลูกค้า',
    primary_duty: 'แพ็คขนมตามออเดอร์ · เช็คคุณภาพก่อนปิดกล่อง · ติดสติกเกอร์ที่อยู่',
    email: 'mali@siam-snacks.co',
  });
  console.log('Officer self-employee:', empSelf.id, '— scope auto-filled:', {
    division_id: empSelf.division_id, section_id: empSelf.section_id, position_id: empSelf.position_id,
    owner_user_id: empSelf.owner_user_id,
  });

  line('Done seeding. Logging out.');
  await api('POST', '/api/logout', {});
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
