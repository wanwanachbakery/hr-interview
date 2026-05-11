/**
 * Demo: ฝ่ายขาย + ฝ่ายไอที + ฝ่ายผลิต — full org seed + interview flow.
 *
 * 1) Wipe existing org/user/emp/interview data (keep auth.json so admin still logs in)
 * 2) Seed 3 divisions, 6 sections, 12 positions
 * 3) Seed 6 users (3 managers + 3 officers)  → 6 auto-emps created
 * 4) Have 1 officer complete an interview end-to-end
 * 5) Have 1 officer answer partially (in_progress)
 * 6) Print the final state
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const BASE = 'http://localhost:3000';

const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));

let cookie = '';
function setCookieFromRes(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/auth=([^;]+)/);
  if (m) cookie = 'auth=' + m[1];
}
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json', cookie };
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  setCookieFromRes(res);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
async function login(u, p) { cookie = ''; return api('POST', '/api/login', { username: u, password: p }); }
const line = (t) => console.log('\n=== ' + t + ' ===');

// ---------- Step 1: wipe (bypass server) ----------
function wipeData() {
  writeJson(path.join(DATA, 'company.json'), { name: '', name_en: '' });
  writeJson(path.join(DATA, 'divisions.json'), []);
  writeJson(path.join(DATA, 'sections.json'), []);
  writeJson(path.join(DATA, 'positions.json'), []);
  writeJson(path.join(DATA, 'users.json'), []);
  writeJson(path.join(DATA, 'employees.json'), []);
  const iv = path.join(DATA, 'interviews');
  if (fs.existsSync(iv)) {
    for (const f of fs.readdirSync(iv)) if (f !== '.gitkeep') fs.unlinkSync(path.join(iv, f));
  }
  const out = path.join(ROOT, 'outputs');
  if (fs.existsSync(out)) {
    for (const f of fs.readdirSync(out)) {
      if (f === '_company') continue;
      fs.rmSync(path.join(out, f), { recursive: true, force: true });
    }
  }
}

// ---------- Step 2: seed config ----------
const ORG = {
  company: { name: 'บริษัท ตัวอย่างครบวงจร จำกัด', name_en: 'Sample Co., Ltd.' },
  divisions: [
    {
      name: 'ฝ่ายขาย', name_en: 'Sales', icon: '💰', color: '#ec4899',
      sections: [
        { name: 'แผนกขายหน้าร้าน', name_en: 'Storefront', positions: ['หัวหน้าทีมขายหน้าร้าน', 'พนักงานขายหน้าร้าน'] },
        { name: 'แผนกขายออนไลน์', name_en: 'Online',     positions: ['หัวหน้าทีมขายออนไลน์', 'แอดมินเพจขายออนไลน์'] },
      ],
    },
    {
      name: 'ฝ่ายไอที', name_en: 'IT', icon: '💻', color: '#3b82f6',
      sections: [
        { name: 'แผนกพัฒนาระบบ', name_en: 'Development', positions: ['Senior Developer', 'Junior Developer'] },
        { name: 'แผนกสนับสนุนผู้ใช้', name_en: 'IT Support', positions: ['หัวหน้าทีมซัพพอร์ต', 'IT Support'] },
      ],
    },
    {
      name: 'ฝ่ายผลิต', name_en: 'Production', icon: '🏭', color: '#f59e0b',
      sections: [
        { name: 'แผนกควบคุมคุณภาพ', name_en: 'QC', positions: ['หัวหน้า QC', 'พนักงาน QC'] },
        { name: 'แผนกบรรจุภัณฑ์', name_en: 'Packaging', positions: ['หัวหน้าทีมบรรจุ', 'พนักงานบรรจุ'] },
      ],
    },
  ],
};

// Users — 3 managers (lead positions) + 3 officers (front-line)
// Each entry: { username, password, name, role, div_idx, sec_idx, pos_idx }
const USERS = [
  { username: 'somsak', password: 'pw1234', name: 'สมศักดิ์ ผู้จัดการขาย',  role: 'manager',  div: 0, sec: 0, pos: 0 },
  { username: 'thida',  password: 'pw1234', name: 'ธิดา พนักงานออนไลน์',     role: 'officer',  div: 0, sec: 1, pos: 1 },
  { username: 'arnon',  password: 'pw1234', name: 'อานนท์ ผู้จัดการไอที',    role: 'manager',  div: 1, sec: 0, pos: 0 },
  { username: 'pim',    password: 'pw1234', name: 'พิม IT Support',            role: 'officer',  div: 1, sec: 1, pos: 1 },
  { username: 'wichai', password: 'pw1234', name: 'วิชัย ผู้จัดการผลิต',     role: 'manager',  div: 2, sec: 0, pos: 0 },
  { username: 'noi',    password: 'pw1234', name: 'น้อย พนักงานบรรจุ',        role: 'officer',  div: 2, sec: 1, pos: 1 },
];

(async () => {
  line('Step 1: wipe data files');
  wipeData();
  console.log('  ✓ company / divisions / sections / positions / users / employees / interviews / outputs cleared');

  line('Step 2: login admin');
  await login('admin', 'JC2026!Init');

  line('Step 3: set company');
  await api('PUT', '/api/company', ORG.company);
  console.log(`  ✓ ${ORG.company.name}`);

  line('Step 4: create divisions / sections / positions');
  const created = { divs: [], secs: [], poss: [] };
  for (const d of ORG.divisions) {
    const div = await api('POST', '/api/divisions', { name: d.name, name_en: d.name_en, icon: d.icon, color: d.color });
    console.log(`  ✓ ฝ่าย: ${div.icon} ${div.name}`);
    const divEntry = { ...div, sections: [] };
    for (const s of d.sections) {
      const sec = await api('POST', '/api/sections', { name: s.name, name_en: s.name_en, division_id: div.id });
      console.log(`    └─ แผนก: ${sec.name}`);
      const secEntry = { ...sec, positions: [] };
      for (const posName of s.positions) {
        const pos = await api('POST', '/api/positions', { name: posName, section_id: sec.id });
        console.log(`        └─ ตำแหน่ง: ${pos.name}`);
        secEntry.positions.push(pos);
      }
      divEntry.sections.push(secEntry);
    }
    created.divs.push(divEntry);
  }

  line('Step 5: create 6 users (auto-emp triggers)');
  const userObjs = [];
  for (const u of USERS) {
    const div = created.divs[u.div];
    const sec = div.sections[u.sec];
    const pos = sec.positions[u.pos];
    const user = await api('POST', '/api/users', {
      username: u.username,
      password: u.password,
      name: u.name,
      role: u.role,
      division_id: div.id,
      section_id: sec.id,
      position_id: pos.id,
    });
    userObjs.push({ ...u, id: user.id, division_id: div.id, section_id: sec.id, position_id: pos.id });
    console.log(`  ✓ ${u.username.padEnd(8)} → ${pos.name} [${u.role}]`);
  }

  line('Step 6: verify auto-emp');
  const allEmps = await api('GET', '/api/employees');
  console.log(`  ✓ ${allEmps.length} active emp records created`);
  for (const e of allEmps) console.log(`     - ${e.name.padEnd(28)} → ${e.role}`);

  line('Step 7: user thida (officer) completes her interview end-to-end');
  await login('thida', 'pw1234');
  const myEmp = await api('GET', '/api/me/employee');
  console.log(`  thida's anchor emp: ${myEmp.role} (status: ${myEmp.interviewStatus})`);
  let start = await api('POST', `/api/interview/${myEmp.id}/start`, { lang: 'th', schedule: '09-18' });
  let q = start.question;
  let n = 0;
  const thidaAnswers = {
    warmup: 'เป็นแอดมินเพจขายขนมออนไลน์ ดูแลแชท ตอบลูกค้า รับออเดอร์ ส่งให้ทีมแพ็ค',
    hour_9: 'เปิดคอม เช็คข้อความใน Facebook + Line OA ที่ค้างจากเมื่อคืน',
    hour_10: 'ตอบลูกค้าคนสำคัญที่สั่งจำนวนเยอะ + ติดตามออเดอร์ที่ส่งไปแล้ว',
    hour_11: 'ลงโพสต์โปรโมชั่นใหม่ของวัน + ตอบคอมเมนต์',
    hour_13: 'หลังพักกลับมาตอบแชทที่เข้ามาช่วงเที่ยง',
    hour_14: 'ทำสรุปออเดอร์รายวันส่งให้ทีมแพ็ค',
    hour_15: 'คุยกับซัพพลายเออร์เรื่องสต็อกขนมที่ใกล้หมด',
    hour_16: 'อัปเดตราคาในระบบ + เตรียมเนื้อหาโพสต์พรุ่งนี้',
    hour_17: 'สรุปยอดขายของวัน ส่งรายงานให้หัวหน้า',
  };
  while (!q.done && n < 20) {
    const ans = thidaAnswers[q.key] || `ตอบ ${q.key} — รายละเอียดเฉพาะของตำแหน่งแอดมินเพจขายออนไลน์`;
    const r = await api('POST', `/api/interview/${myEmp.id}/message`, { key: q.key, value: ans, skipProbe: true });
    if (r.probe) continue;
    q = r.question;
    n++;
  }
  console.log(`  ✓ ตอบ ${n} คำถาม, done=${q.done}`);
  const fin = await api('POST', `/api/interview/${myEmp.id}/finish`);
  console.log(`  ✓ generated docs: ${fin.files.join(', ')}`);

  line('Step 8: user noi (officer) answers partially — 3 questions only');
  await login('noi', 'pw1234');
  const noiEmp = await api('GET', '/api/me/employee');
  start = await api('POST', `/api/interview/${noiEmp.id}/start`, { lang: 'th', schedule: '08-17' });
  q = start.question;
  let nn = 0;
  while (!q.done && nn < 3) {
    const r = await api('POST', `/api/interview/${noiEmp.id}/message`, {
      key: q.key, value: `noi ตอบคำถาม ${q.key}`, skipProbe: true
    });
    if (r.probe) continue;
    q = r.question;
    nn++;
  }
  console.log(`  ✓ noi ตอบ ${nn} คำถามแล้ว (in_progress)`);

  line('Step 9: final state (admin view)');
  await login('admin', 'JC2026!Init');
  const finalEmps = await api('GET', '/api/employees');
  console.log(`  Total active emp: ${finalEmps.length}`);
  for (const e of finalEmps) {
    const status = e.interviewStatus.padEnd(12);
    console.log(`    [${status}] ${e.name.padEnd(28)} → ${e.role}`);
  }

  line('Step 10: run company analyze (admin/exec/manager only)');
  const an = await api('POST', '/api/company/analyze', {});
  console.log(`  ✓ analyzed ${an.count} completed interviews → ${an.file}`);

  console.log('\n🎉 DEMO SETUP COMPLETE');
  console.log('\nLogins to try in the browser at http://localhost:3000:');
  console.log('  admin   / JC2026!Init   → /admin');
  console.log('  somsak  / pw1234        → manager ฝ่ายขาย');
  console.log('  thida   / pw1234        → officer (interview เสร็จแล้ว → ดูเอกสารได้)');
  console.log('  arnon   / pw1234        → manager ฝ่ายไอที');
  console.log('  pim     / pw1234        → officer ฝ่ายไอที (ยังไม่ตอบ)');
  console.log('  wichai  / pw1234        → manager ฝ่ายผลิต');
  console.log('  noi     / pw1234        → officer ฝ่ายผลิต (กำลังตอบ)');
})().catch(err => {
  console.error('\n❌ FAIL:', err.message);
  process.exit(1);
});
