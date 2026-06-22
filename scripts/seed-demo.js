/**
 * seed-demo.js — Build a polished, presentation-ready demo tenant.
 *
 * Company: วรรณวนัช เบเกอรี่ จำกัด (เดโม) — a full bakery business with 7 divisions,
 * users at every role level, and a realistic mix of completed / in-progress /
 * not-started interviews so Dashboard + reports + JD/KPI all show live content.
 *
 * Run with the server up:  node scripts/seed-demo.js
 * Re-runnable: it deletes and recreates the `demo` tenant each time.
 */
const BASE = process.env.BASE || 'http://localhost:3000';
const SUPER_PW = process.env.SUPER_PW || 'super!2026';
const TENANT = 'demo';
const ADMIN_PW = 'demo1234';

let superCookie = '', adminCookie = '';
function pick(setCookie, name) {
  if (!setCookie) return null;
  for (const p of setCookie.split(/,\s*(?=[a-zA-Z_]+=)/)) {
    const m = p.match(new RegExp('^' + name + '=([^;]+)'));
    if (m) return name + '=' + m[1];
  }
  return null;
}
async function call(method, path, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, setCookie };
}
function must(r, label) { if (!r.ok) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; }
const T = (p) => `/t/${TENANT}${p}`;

// ============================================================
// Org blueprint — 7 divisions, realistic bakery business
// Each position lists the users that hold it (with role + work hours + whether
// they have completed an interview).
// ============================================================
const ORG = [
  { div: 'สำนักบริหาร', icon: '👔', color: '#6366f1', sections: [
    { sec: 'ผู้บริหารระดับสูง', positions: [
      { pos: 'กรรมการผู้จัดการ', users: [
        { u: 'somsak', name: 'สมศักดิ์ วรรณวนัช', role: 'executive', hrs: ['08:00','18:00'], interview: 'done' },
      ]},
      { pos: 'ผู้จัดการทั่วไป', users: [
        { u: 'wipa', name: 'วิภา จัดการดี', role: 'manager', hrs: ['08:30','17:30'], interview: 'done' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายขาย', icon: '🛒', color: '#ec4899', sections: [
    { sec: 'แผนกขายหน้าร้าน', positions: [
      { pos: 'หัวหน้าร้าน', users: [
        { u: 'nuch', name: 'นุช ขายเก่ง', role: 'section_head', hrs: ['08:00','17:00'], interview: 'done' },
      ]},
      { pos: 'พนักงานขายหน้าร้าน', users: [
        { u: 'fon', name: 'ฝน หน้าร้าน', role: 'officer', hrs: ['09:00','18:00'], interview: 'done' },
        { u: 'mint', name: 'มิ้นต์ บริการ', role: 'officer', hrs: ['09:00','18:00'], interview: 'progress' },
      ]},
      { pos: 'แคชเชียร์', users: [
        { u: 'bow', name: 'โบว์ คิดเงิน', role: 'officer', hrs: ['09:00','18:00'], interview: 'none' },
      ]},
    ]},
    { sec: 'แผนกขายออนไลน์', positions: [
      { pos: 'หัวหน้าขายออนไลน์', users: [
        { u: 'tan', name: 'ตั้น ออนไลน์', role: 'section_head', hrs: ['09:00','18:00'], interview: 'done' },
      ]},
      { pos: 'แอดมินเพจ', users: [
        { u: 'napha', name: 'นภา ตอบแชท', role: 'officer', hrs: ['09:00','18:00'], interview: 'done' },
      ]},
      { pos: 'แพ็คของส่งลูกค้า', users: [
        { u: 'mali', name: 'มะลิ แพ็คของ', role: 'officer', hrs: ['08:00','17:00'], interview: 'done' },
      ]},
    ]},
    { sec: 'แผนกขายส่ง', positions: [
      { pos: 'เซลล์ขายส่ง', users: [
        { u: 'chai', name: 'ชัย ขายส่ง', role: 'officer', hrs: ['08:00','17:00'], interview: 'none' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายผลิต', icon: '🏭', color: '#f59e0b', sections: [
    { sec: 'แผนกเบเกอรี่', positions: [
      { pos: 'หัวหน้าเชฟ', users: [
        { u: 'aof', name: 'เอ้ก หัวหน้าเชฟ', role: 'section_head', hrs: ['06:00','15:00'], interview: 'done' },
      ]},
      { pos: 'ผู้ช่วยเชฟ', users: [
        { u: 'gift', name: 'กิ๊ฟท์ ผู้ช่วยเชฟ', role: 'officer', hrs: ['06:00','15:00'], interview: 'progress' },
      ]},
      { pos: 'คนอบขนม', users: [
        { u: 'oat', name: 'โอ๊ต คนอบ', role: 'officer', hrs: ['05:00','14:00'], interview: 'done' },
      ]},
    ]},
    { sec: 'แผนกควบคุมคุณภาพ', positions: [
      { pos: 'เจ้าหน้าที่ QC', users: [
        { u: 'ploy', name: 'พลอย ตรวจคุณภาพ', role: 'officer', hrs: ['08:00','17:00'], interview: 'done' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายบัญชีและการเงิน', icon: '💰', color: '#10b981', sections: [
    { sec: 'แผนกบัญชี', positions: [
      { pos: 'หัวหน้าบัญชี', users: [
        { u: 'orn', name: 'อร หัวหน้าบัญชี', role: 'section_head', hrs: ['08:30','17:30'], interview: 'done' },
      ]},
      { pos: 'เจ้าหน้าที่บัญชี', users: [
        { u: 'kade', name: 'เก๋ บัญชีลูกหนี้', role: 'officer', hrs: ['08:30','17:30'], interview: 'done' },
      ]},
    ]},
    { sec: 'แผนกการเงิน', positions: [
      { pos: 'เจ้าหน้าที่การเงิน', users: [
        { u: 'June', name: 'จูน การเงิน', role: 'officer', hrs: ['08:30','17:30'], interview: 'none' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายการตลาด', icon: '📣', color: '#8b5cf6', sections: [
    { sec: 'แผนกการตลาดดิจิทัล', positions: [
      { pos: 'หัวหน้าการตลาด', users: [
        { u: 'beam', name: 'บีม หัวหน้าการตลาด', role: 'division_head', hrs: ['09:00','18:00'], interview: 'done' },
      ]},
      { pos: 'กราฟิกดีไซเนอร์', users: [
        { u: 'art', name: 'อาร์ต ดีไซเนอร์', role: 'officer', hrs: ['10:00','19:00'], interview: 'done' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายทรัพยากรบุคคล', icon: '👥', color: '#0ea5e9', sections: [
    { sec: 'แผนกสรรหาและฝึกอบรม', positions: [
      { pos: 'เจ้าหน้าที่ HR', users: [
        { u: 'tukta', name: 'ตุ๊กตา ฝ่ายบุคคล', role: 'division_head', hrs: ['08:30','17:30'], interview: 'done' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายไอที', icon: '💻', color: '#3b82f6', sections: [
    { sec: 'แผนก Support', positions: [
      { pos: 'Help Desk', users: [
        { u: 'wit', name: 'วิทยา ไอทีซัพพอร์ต', role: 'officer', hrs: ['08:00','17:00'], interview: 'done' },
      ]},
    ]},
  ]},

  { div: 'ฝ่ายจัดซื้อและคลังสินค้า', icon: '📦', color: '#64748b', sections: [
    { sec: 'แผนกจัดซื้อ', positions: [
      { pos: 'เจ้าหน้าที่จัดซื้อ', users: [
        { u: 'tum', name: 'ตุ้ม จัดซื้อ', role: 'section_head', hrs: ['08:00','17:00'], interview: 'done' },
      ]},
    ]},
    { sec: 'แผนกคลังสินค้า', positions: [
      { pos: 'พนักงานคลัง', users: [
        { u: 'kong', name: 'ก้อง คลังสินค้า', role: 'officer', hrs: ['07:00','16:00'], interview: 'none' },
      ]},
    ]},
  ]},
];

// Realistic answer text per position keyword — includes keywords that trigger the
// AI optimization findings (สรุป/รายงาน/กรอก/ตอบลูกค้า/ตรวจ/นัด) so output looks rich.
function answerFor(posName, key) {
  const p = posName;
  const generic = {
    warmup: `ดูแลงานในตำแหน่ง ${p} เป็นหลัก ทำงานประจำทุกวันตามรอบเวลาที่กำหนด`,
    weekly_tasks: 'มีประชุมทีมทุกเช้าวันจันทร์ และสรุปยอด/รายงานประจำสัปดาห์ทุกศุกร์',
    pain_points: 'งานที่เสียเวลาที่สุดคือการกรอกข้อมูลซ้ำ ๆ ลงหลายระบบ และทำรายงานด้วยมือ',
    bottlenecks: 'บางครั้งต้องรออนุมัติจากหัวหน้า หรือรอข้อมูลจากแผนกอื่นก่อนทำงานต่อ',
    own_kpi: 'วัดจากงานที่เสร็จตรงเวลา ความถูกต้อง และความพึงพอใจของผู้ที่เกี่ยวข้อง',
    ai_wishlist: 'อยากให้ AI ช่วยสรุปรายงานอัตโนมัติ และช่วยตอบคำถามซ้ำ ๆ',
  };
  if (generic[key]) return generic[key];
  // hourly questions: hour_X
  if (/^hour_/.test(key)) {
    const h = key.replace('hour_', '');
    const byPos = {
      'แอดมินเพจ': `${h}:00 ตอบแชทลูกค้าใน Facebook/Line OA รับออเดอร์ และอัปเดตสต็อก`,
      'แพ็คของส่งลูกค้า': `${h}:00 แพ็คขนมตามออเดอร์ ตรวจคุณภาพก่อนปิดกล่อง ปริ้นใบจ่าหน้า`,
      'คนอบขนม': `${h}:00 อบขนมตามแผน ตรวจอุณหภูมิเตา จัดเรียงใส่ตู้หน้าร้าน`,
      'เจ้าหน้าที่บัญชี': `${h}:00 บันทึกบัญชี ออกใบกำกับภาษี กระทบยอด และทำรายงาน`,
      'Help Desk': `${h}:00 รับแจ้งปัญหาคอมพิวเตอร์/ปริ้นเตอร์ แก้ไข และบันทึก ticket`,
      'กราฟิกดีไซเนอร์': `${h}:00 ออกแบบสื่อโปรโมชัน ทำคอนเทนต์ลงเพจ ตามที่การตลาดกำหนด`,
      'เจ้าหน้าที่ QC': `${h}:00 สุ่มตรวจคุณภาพขนม บันทึกผล และรายงานของเสีย`,
    };
    return byPos[p] || `${h}:00 ทำงานตามหน้าที่ของ ${p} จัดการเอกสารและประสานงานที่เกี่ยวข้อง`;
  }
  return `รายละเอียดงานของ ${p} สำหรับคำถาม ${key}`;
}

(async () => {
  console.log('━━━ Seeding demo tenant ━━━\n');

  // 1) super-admin login
  const sl = must(await call('POST', '/api/super/login', { password: SUPER_PW }), 'super login');
  superCookie = pick((await call('POST', '/api/super/login', { password: SUPER_PW })).setCookie, 'super_auth');
  console.log('✓ super-admin logged in');

  // 2) recreate tenant
  await call('DELETE', `/api/super/tenants/${TENANT}`, { confirm: 'DELETE' }, superCookie);
  must(await call('POST', '/api/super/tenants', {
    id: TENANT, name: 'วรรณวนัช เบเกอรี่ จำกัด (เดโม)', admin_password: ADMIN_PW,
  }, superCookie), 'create tenant');
  console.log('✓ tenant created: /t/demo');

  // 3) admin login
  adminCookie = pick((await call('POST', T('/api/login'), { username: 'admin', password: ADMIN_PW })).setCookie, 'auth');
  must(await call('PUT', T('/api/company'), {
    name: 'วรรณวนัช เบเกอรี่ จำกัด (เดโม)', name_en: 'Wanwanach Bakery Co., Ltd. (Demo)',
  }, adminCookie), 'set company');
  console.log('✓ admin logged in + company set');

  // 4) build org + users
  const allUsers = [];   // { username, pw, posName, interview, hrs }
  let divCount = 0, secCount = 0, posCount = 0, userCount = 0;

  for (const d of ORG) {
    const div = must(await call('POST', T('/api/divisions'),
      { name: d.div, icon: d.icon, color: d.color }, adminCookie), `div ${d.div}`);
    divCount++;
    for (const s of d.sections) {
      const sec = must(await call('POST', T('/api/sections'),
        { name: s.sec, division_id: div.id }, adminCookie), `sec ${s.sec}`);
      secCount++;
      for (const pdef of s.positions) {
        const pos = must(await call('POST', T('/api/positions'),
          { name: pdef.pos, section_id: sec.id }, adminCookie), `pos ${pdef.pos}`);
        posCount++;
        for (const ud of pdef.users) {
          must(await call('POST', T('/api/users'), {
            username: ud.u, password: 'demo1234', name: ud.name, role: ud.role,
            division_id: div.id, section_id: sec.id, position_id: pos.id,
            work_start: ud.hrs[0], work_end: ud.hrs[1], break_start: '12:00', break_end: '13:00',
          }, adminCookie), `user ${ud.u}`);
          userCount++;
          allUsers.push({ username: ud.u, posName: pdef.pos, interview: ud.interview, role: ud.role });
        }
      }
    }
    console.log(`  ✓ ${d.icon} ${d.div}`);
  }
  console.log(`✓ org built: ${divCount} ฝ่าย · ${secCount} แผนก · ${posCount} ตำแหน่ง · ${userCount} users\n`);

  // 5) run interviews
  let done = 0, prog = 0;
  for (const u of allUsers) {
    if (u.interview === 'none') continue;
    const uc = pick((await call('POST', T('/api/login'), { username: u.username, password: 'demo1234' })).setCookie, 'auth');
    const emp = must(await call('GET', T('/api/me/employee'), null, uc), `me/emp ${u.username}`);
    const start = must(await call('POST', T(`/api/interview/${emp.id}/start`),
      { lang: 'th', interviewDate: '2026-05-14' }, uc), `start ${u.username}`);

    let q = start.question;
    let answered = 0;
    // For 'progress', answer only ~half then stop (leaves status in_progress)
    const limit = u.interview === 'progress' ? 5 : 30;
    while (!q.done && answered < limit) {
      const v = answerFor(u.posName, q.key);
      const r = await call('POST', T(`/api/interview/${emp.id}/message`),
        { key: q.key, value: v, skipProbe: true }, uc);
      if (!r.ok) break;
      if (r.data.probe) continue;
      q = r.data.question; answered++;
    }
    if (u.interview === 'done' && q.done) {
      must(await call('POST', T(`/api/interview/${emp.id}/finish`), {}, uc), `finish ${u.username}`);
      done++;
      console.log(`  ✓ interview DONE: ${u.username} (${u.posName})`);
    } else {
      prog++;
      console.log(`  ◐ interview IN-PROGRESS: ${u.username} (${u.posName}) — ${answered} ข้อ`);
    }
  }
  console.log(`\n✓ interviews: ${done} เสร็จ · ${prog} กำลังทำ · ${allUsers.filter(u=>u.interview==='none').length} ยังไม่เริ่ม`);

  // 6) company analysis (admin)
  const an = must(await call('POST', T('/api/company/analyze'), {}, adminCookie), 'analyze');
  console.log(`✓ company analysis generated (${an.count} interviews)\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ DEMO READY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  URL:    ${BASE}/t/${TENANT}/login`);
  console.log('  Admin:  admin / demo1234');
  console.log('  ผู้บริหาร: somsak / demo1234   (เห็นทั้งบริษัท + Dashboard ครบ)');
  console.log('  พนักงานทุกคน: <username> / demo1234');
  console.log('\n  ตัวอย่าง login ดูเอกสาร JD/KPI ที่สร้างแล้ว:');
  console.log('    mali (แพ็คของ) · oat (คนอบ) · napha (แอดมินเพจ) · kade (บัญชี) · wit (ไอที)');
})().catch(err => { console.error('\n❌ FAIL:', err.message); console.error(err.stack); process.exit(1); });
