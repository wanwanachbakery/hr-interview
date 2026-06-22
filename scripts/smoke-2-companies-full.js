/**
 * Full end-to-end smoke test simulating 2 real companies using HR-Interview.
 *
 *   Tenant A: "บริษัท สยามสวีท จำกัด"        — candy shop, 2 divisions, 3 users
 *   Tenant B: "บริษัท ไอทีโซลูชั่นส์ จำกัด"  — IT services, 1 division, 2 users
 *
 * Flow per tenant:
 *   1) super-admin creates tenant
 *   2) tenant admin logs in, sets company name
 *   3) admin builds org tree (ฝ่าย → แผนก → ตำแหน่ง)
 *   4) admin creates users at different roles
 *   5) an officer-level user logs in and runs through their own interview
 *   6) /api/reports/summary returns the expected breakdown for that tenant
 *
 * Then cross-tenant isolation is verified: a session for A is rejected by B,
 * and B's admin cannot see any of A's data.
 */
const BASE = 'http://localhost:3000';
const sessions = {};  // { super, siamsweet_admin, siamsweet_mali, itsol_admin, itsol_arnon }

function cookieJar() { return ''; }
function pickCookie(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const parts = setCookieHeader.split(/,\s*(?=[a-zA-Z_]+=)/);
  for (const p of parts) {
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
function must(r, label) {
  if (!r.ok) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const ok = (m) => console.log(`  ✓ ${m}`);
const head = (m) => console.log(`\n━━━ ${m} ━━━`);

(async () => {
  head('PHASE 0 — Super-admin login + tenant setup');
  const sLogin = await call('POST', '/api/super/login', { password: 'super!2026' });
  must(sLogin, 'super login');
  sessions.super = pickCookie(sLogin.setCookie, 'super_auth');
  ok('super-admin logged in');

  // Wipe existing demo tenants if present (idempotent test runs)
  const before = must(await call('GET', '/api/super/tenants', null, sessions.super), 'list');
  for (const t of before) {
    if (t.id.startsWith('demo-')) {
      await call('DELETE', `/api/super/tenants/${t.id}`, { confirm: 'DELETE' }, sessions.super);
      ok(`cleaned up old demo-tenant: ${t.id}`);
    }
  }

  // === Create tenant A
  const tenantA = must(await call('POST', '/api/super/tenants', {
    id: 'demo-siamsweet', name: 'บริษัท สยามสวีท จำกัด', admin_password: 'sweet-init',
  }, sessions.super), 'create A');
  ok(`tenant A created: ${tenantA.id} (${tenantA.name})`);

  // === Create tenant B
  const tenantB = must(await call('POST', '/api/super/tenants', {
    id: 'demo-itsolutions', name: 'บริษัท ไอทีโซลูชั่นส์ จำกัด', admin_password: 'it-init',
  }, sessions.super), 'create B');
  ok(`tenant B created: ${tenantB.id} (${tenantB.name})`);

  // ----------------------------------------------------------------------------
  head('PHASE 1 — Tenant A (สยามสวีท): admin builds org + creates users');

  const aLogin = await call('POST', '/t/demo-siamsweet/api/login', { username: 'admin', password: 'sweet-init' });
  must(aLogin, 'A admin login');
  sessions.siamsweet_admin = pickCookie(aLogin.setCookie, 'auth');
  ok('admin logged in');

  // Update company info
  must(await call('PUT', '/t/demo-siamsweet/api/company', {
    name: 'บริษัท สยามสวีท จำกัด', name_en: 'Siam Sweet Co., Ltd.',
  }, sessions.siamsweet_admin), 'update company');
  ok('company info updated');

  // Org tree: 2 divisions, 2 sections each, 4 positions total
  const divSales = must(await call('POST', '/t/demo-siamsweet/api/divisions', {
    name: 'ฝ่ายขาย', icon: '🍬', color: '#ec4899',
  }, sessions.siamsweet_admin), 'create ฝ่ายขาย');
  const divProd = must(await call('POST', '/t/demo-siamsweet/api/divisions', {
    name: 'ฝ่ายผลิต', icon: '🏭', color: '#f59e0b',
  }, sessions.siamsweet_admin), 'create ฝ่ายผลิต');
  ok(`2 divisions created (${divSales.id}, ${divProd.id})`);

  const secStore = must(await call('POST', '/t/demo-siamsweet/api/sections', {
    name: 'แผนกขายหน้าร้าน', division_id: divSales.id,
  }, sessions.siamsweet_admin), 'create แผนกขายหน้าร้าน');
  const secBake = must(await call('POST', '/t/demo-siamsweet/api/sections', {
    name: 'แผนกอบ', division_id: divProd.id,
  }, sessions.siamsweet_admin), 'create แผนกอบ');
  ok('2 sections created');

  const posLead = must(await call('POST', '/t/demo-siamsweet/api/positions', {
    name: 'หัวหน้าทีมขาย', section_id: secStore.id,
  }, sessions.siamsweet_admin), 'create หัวหน้าทีมขาย');
  const posCash = must(await call('POST', '/t/demo-siamsweet/api/positions', {
    name: 'แคชเชียร์', section_id: secStore.id,
  }, sessions.siamsweet_admin), 'create แคชเชียร์');
  const posChef = must(await call('POST', '/t/demo-siamsweet/api/positions', {
    name: 'หัวหน้าครัว', section_id: secBake.id,
  }, sessions.siamsweet_admin), 'create หัวหน้าครัว');
  const posBaker = must(await call('POST', '/t/demo-siamsweet/api/positions', {
    name: 'คนอบ', section_id: secBake.id,
  }, sessions.siamsweet_admin), 'create คนอบ');
  ok('4 positions created');

  // 3 users
  must(await call('POST', '/t/demo-siamsweet/api/users', {
    username: 'somchai', password: 'pw1234', name: 'สมชาย เจ้าของร้าน',
    role: 'executive',
    division_id: divSales.id, section_id: secStore.id, position_id: posLead.id,
    work_start: '08:00', work_end: '17:00', break_start: '12:00', break_end: '13:00',
  }, sessions.siamsweet_admin), 'create somchai');
  must(await call('POST', '/t/demo-siamsweet/api/users', {
    username: 'pim', password: 'pw1234', name: 'พิม แคชเชียร์',
    role: 'officer',
    division_id: divSales.id, section_id: secStore.id, position_id: posCash.id,
    work_start: '09:00', work_end: '18:00', break_start: '12:00', break_end: '13:00',
  }, sessions.siamsweet_admin), 'create pim');
  must(await call('POST', '/t/demo-siamsweet/api/users', {
    username: 'mali', password: 'pw1234', name: 'มะลิ คนอบขนม',
    role: 'officer',
    division_id: divProd.id, section_id: secBake.id, position_id: posBaker.id,
    work_start: '07:00', work_end: '16:00', break_start: '12:00', break_end: '13:00',
  }, sessions.siamsweet_admin), 'create mali');
  ok('3 users created (somchai/pim/mali)');

  // Verify auto-emp records exist
  const aEmps = must(await call('GET', '/t/demo-siamsweet/api/employees', null, sessions.siamsweet_admin), 'list emps A');
  if (aEmps.length !== 3) throw new Error(`expected 3 auto-created emp records, got ${aEmps.length}`);
  ok(`${aEmps.length} emp records auto-created (position-anchored)`);

  // ----------------------------------------------------------------------------
  head('PHASE 2 — Tenant A: mali (คนอบ) logs in and completes her own interview');

  const mLogin = await call('POST', '/t/demo-siamsweet/api/login', { username: 'mali', password: 'pw1234' });
  must(mLogin, 'mali login');
  sessions.siamsweet_mali = pickCookie(mLogin.setCookie, 'auth');
  ok('mali logged in');

  const mali = must(await call('GET', '/t/demo-siamsweet/api/me', null, sessions.siamsweet_mali), 'me');
  if (mali.role !== 'officer') throw new Error('mali should be officer');
  if (mali.position_name !== 'คนอบ') throw new Error('mali position mismatch: ' + mali.position_name);
  ok(`session: ${mali.name}, role=${mali.role}, pos=${mali.position_name}`);

  const maliEmp = must(await call('GET', '/t/demo-siamsweet/api/me/employee', null, sessions.siamsweet_mali), 'my-emp');
  if (!maliEmp || maliEmp.interviewStatus !== 'not_started') throw new Error('mali emp wrong state');
  ok(`anchor emp ready, status=${maliEmp.interviewStatus}`);

  // Start interview — hours should come from her profile (07:00-16:00 break 12-13)
  const ivStart = must(await call('POST', `/t/demo-siamsweet/api/interview/${maliEmp.id}/start`, {
    lang: 'th', interviewDate: '2026-05-12',
  }, sessions.siamsweet_mali), 'start interview');
  const expectedHours = [7,8,9,10,11,13,14,15];
  if (JSON.stringify(ivStart.interview.hours) !== JSON.stringify(expectedHours)) {
    throw new Error(`expected hours ${expectedHours}, got ${JSON.stringify(ivStart.interview.hours)}`);
  }
  ok(`hours from profile: ${JSON.stringify(ivStart.interview.hours)} (skipping 12 = lunch)`);

  // Answer the questions
  const answers = {
    warmup: 'อบขนมขายหน้าร้าน · ขนมปังปอนด์ · บราวนี่ · เค้กกล้วยหอม',
    hour_7:  '07:00 มาถึงร้าน เปิดเตา ตรวจวัตถุดิบที่เหลือจากเมื่อวาน',
    hour_8:  '08:00 ผสมแป้งล็อตแรก ขนมปังพันธุ์พิเศษของวัน',
    hour_9:  '09:00 อบล็อตแรก เริ่มผสมล็อตที่สอง พักห้องเย็น',
    hour_10: '10:00 อบต่อ ปั้นเค้กกล้วยหอม แต่งหน้าครีม',
    hour_11: '11:00 จัดเรียงในตู้หน้าร้าน คุยกับพิม (แคชเชียร์) เรื่อง stock',
    hour_13: '13:00 อบช่วงบ่าย ขนมเฉพาะออเดอร์ใหญ่ที่จองล่วงหน้า',
    hour_14: '14:00 ทำความสะอาดเตา เตรียมวัตถุดิบสำหรับพรุ่งนี้',
    hour_15: '15:00 บันทึก stock + ปิดเตา + คุยกับสมชายเรื่องเมนูใหม่',
  };
  let q = ivStart.question;
  let answered = 0;
  while (!q.done && answered < 25) {
    const v = answers[q.key] || `ตอบของ ${q.key} (รายละเอียดเฉพาะของคนอบ)`;
    const r = await call('POST', `/t/demo-siamsweet/api/interview/${maliEmp.id}/message`,
      { key: q.key, value: v, skipProbe: true }, sessions.siamsweet_mali);
    must(r, `answer ${q.key}`);
    if (r.data.probe) continue;
    q = r.data.question; answered++;
  }
  ok(`answered ${answered} questions, done=${q.done}`);

  const fin = must(await call('POST', `/t/demo-siamsweet/api/interview/${maliEmp.id}/finish`, {},
    sessions.siamsweet_mali), 'finish');
  ok(`generated ${fin.files.length} docs: ${fin.files.join(', ')}`);

  const afterEmps = must(await call('GET', '/t/demo-siamsweet/api/employees', null, sessions.siamsweet_admin), 'list emps');
  const maliAfter = afterEmps.find(e => e.user_id);
  const malisActuallyCompleted = afterEmps.find(e => e.name.includes('มะลิ'));
  if (malisActuallyCompleted.interviewStatus !== 'completed') throw new Error('mali should be completed');
  ok(`mali status now: ${malisActuallyCompleted.interviewStatus}`);

  // Tenant A admin can read mali's JD
  const jd = await fetch(BASE + `/t/demo-siamsweet/api/outputs/${maliEmp.id}/job-description.md`, {
    headers: { cookie: sessions.siamsweet_admin },
  });
  if (!jd.ok) throw new Error('admin should be able to read JD');
  const jdText = await jd.text();
  if (!jdText.includes('คนอบ')) throw new Error('JD should mention position');
  ok('admin can download mali\'s JD (mentions "คนอบ")');

  // ----------------------------------------------------------------------------
  head('PHASE 3 — Tenant B (ไอทีโซลูชั่นส์): build org + arnon does interview');

  const bLogin = await call('POST', '/t/demo-itsolutions/api/login', { username: 'admin', password: 'it-init' });
  must(bLogin, 'B admin login');
  sessions.itsol_admin = pickCookie(bLogin.setCookie, 'auth');
  ok('admin logged in');

  must(await call('PUT', '/t/demo-itsolutions/api/company', {
    name: 'บริษัท ไอทีโซลูชั่นส์ จำกัด', name_en: 'IT Solutions Co., Ltd.',
  }, sessions.itsol_admin), 'update company');

  const divIT = must(await call('POST', '/t/demo-itsolutions/api/divisions',
    { name: 'ฝ่ายไอที', icon: '💻', color: '#0ea5e9' }, sessions.itsol_admin), 'create ฝ่ายไอที');
  const secSupport = must(await call('POST', '/t/demo-itsolutions/api/sections',
    { name: 'แผนก Support', division_id: divIT.id }, sessions.itsol_admin), 'create Support');
  const posHelp = must(await call('POST', '/t/demo-itsolutions/api/positions',
    { name: 'Help Desk', section_id: secSupport.id }, sessions.itsol_admin), 'create Help Desk');
  const posSysadmin = must(await call('POST', '/t/demo-itsolutions/api/positions',
    { name: 'System Admin', section_id: secSupport.id }, sessions.itsol_admin), 'create System Admin');
  ok('org: ฝ่ายไอที / แผนก Support / 2 positions');

  must(await call('POST', '/t/demo-itsolutions/api/users', {
    username: 'thida', password: 'pw1234', name: 'ธิดา หัวหน้าซัพพอร์ต',
    role: 'section_head',
    division_id: divIT.id, section_id: secSupport.id, position_id: posHelp.id,
    work_start: '09:00', work_end: '18:00', break_start: '12:00', break_end: '13:00',
  }, sessions.itsol_admin), 'create thida');
  must(await call('POST', '/t/demo-itsolutions/api/users', {
    username: 'arnon', password: 'pw1234', name: 'อานนท์ ดูแลระบบ',
    role: 'officer',
    division_id: divIT.id, section_id: secSupport.id, position_id: posSysadmin.id,
    work_start: '08:30', work_end: '17:30', break_start: '12:00', break_end: '13:00',
  }, sessions.itsol_admin), 'create arnon');
  ok('2 users: thida (section_head) / arnon (officer)');

  // arnon's interview
  const aaLogin = await call('POST', '/t/demo-itsolutions/api/login', { username: 'arnon', password: 'pw1234' });
  must(aaLogin, 'arnon login');
  sessions.itsol_arnon = pickCookie(aaLogin.setCookie, 'auth');
  const arnonEmp = must(await call('GET', '/t/demo-itsolutions/api/me/employee', null, sessions.itsol_arnon), 'arnon-emp');

  const aStart = must(await call('POST', `/t/demo-itsolutions/api/interview/${arnonEmp.id}/start`,
    { lang: 'th', interviewDate: '2026-05-12' }, sessions.itsol_arnon), 'arnon start');
  let aq = aStart.question, aans = 0;
  while (!aq.done && aans < 25) {
    const r = await call('POST', `/t/demo-itsolutions/api/interview/${arnonEmp.id}/message`,
      { key: aq.key, value: 'ดูแลเซิร์ฟเวอร์ + เครือข่ายของบริษัท · ตอบงาน ticket จาก helpdesk', skipProbe: true },
      sessions.itsol_arnon);
    must(r, 'answer');
    if (r.data.probe) continue;
    aq = r.data.question; aans++;
  }
  must(await call('POST', `/t/demo-itsolutions/api/interview/${arnonEmp.id}/finish`, {},
    sessions.itsol_arnon), 'arnon finish');
  ok(`arnon: answered ${aans}, finished, docs generated`);

  // ----------------------------------------------------------------------------
  head('PHASE 4 — Cross-tenant isolation tests');

  // 4a. Mali's cookie sent to tenant B → 401 (tenant_id mismatch in token)
  const cross1 = await call('GET', '/t/demo-itsolutions/api/divisions', null, sessions.siamsweet_mali);
  if (cross1.ok) throw new Error('SECURITY: mali cookie accepted by tenant B!');
  ok(`mali cookie → tenant B: ${cross1.status} (rejected)`);

  // 4b. Tenant B admin lists divisions — should NOT see tenant A's
  const bDivs = must(await call('GET', '/t/demo-itsolutions/api/divisions', null, sessions.itsol_admin), 'B divs');
  if (bDivs.length !== 1) throw new Error(`B should see 1 division, saw ${bDivs.length}`);
  if (bDivs[0].name !== 'ฝ่ายไอที') throw new Error('B sees wrong division');
  ok(`B admin sees only own division: ${bDivs[0].name}`);

  // 4c. Tenant B admin lists users — should NOT see tenant A's users
  const bUsers = must(await call('GET', '/t/demo-itsolutions/api/users', null, sessions.itsol_admin), 'B users');
  if (bUsers.length !== 2) throw new Error(`B should see 2 users, saw ${bUsers.length}`);
  if (bUsers.some(u => u.name.includes('มะลิ') || u.name.includes('สมชาย'))) {
    throw new Error('B sees tenant A user!');
  }
  ok(`B sees only own users: ${bUsers.map(u => u.username).join(', ')}`);

  // 4d. Tenant A admin reports — only sees A
  const aSummary = must(await call('GET', '/t/demo-siamsweet/api/reports/summary', null, sessions.siamsweet_admin), 'A summary');
  if (aSummary.total_users !== 3) throw new Error(`A summary expected 3 users, got ${aSummary.total_users}`);
  ok(`tenant A summary: ${aSummary.total_users} users, ${aSummary.by_division.length} divs (${JSON.stringify(aSummary.by_role)})`);

  const bSummary = must(await call('GET', '/t/demo-itsolutions/api/reports/summary', null, sessions.itsol_admin), 'B summary');
  if (bSummary.total_users !== 2) throw new Error(`B summary expected 2, got ${bSummary.total_users}`);
  ok(`tenant B summary: ${bSummary.total_users} users, ${bSummary.by_division.length} divs (${JSON.stringify(bSummary.by_role)})`);

  // ----------------------------------------------------------------------------
  head('PHASE 5 — Company analyze + super-admin overview');

  // A admin runs company analyze
  const an = must(await call('POST', '/t/demo-siamsweet/api/company/analyze', {}, sessions.siamsweet_admin), 'analyze A');
  ok(`tenant A company analysis: ${an.count} interviews → ${an.file}`);

  // Super-admin sees both
  const allTenants = must(await call('GET', '/api/super/tenants', null, sessions.super), 'list tenants');
  const demoTenants = allTenants.filter(t => t.id.startsWith('demo-'));
  if (demoTenants.length !== 2) throw new Error(`expected 2 demo tenants in list, got ${demoTenants.length}`);
  ok(`super-admin sees ${allTenants.length} tenant(s) total:`);
  for (const t of allTenants) console.log(`     - ${t.id}: ${t.name} (${t.user_count || 0} users)`);

  // ----------------------------------------------------------------------------
  head('PHASE 6 — Super-admin reset tenant admin password');

  must(await call('POST', '/t/demo-siamsweet/api/login', { username: 'admin', password: 'sweet-init' }), 'A old pw still works');
  ok('A old admin pw works before reset');

  must(await call('POST', '/api/super/tenants/demo-siamsweet/reset-admin-password',
    { password: 'new-sweet-pw' }, sessions.super), 'reset A admin');
  ok('super-admin reset A\'s admin password');

  const oldFails = await call('POST', '/t/demo-siamsweet/api/login', { username: 'admin', password: 'sweet-init' });
  if (oldFails.ok) throw new Error('old A pw should be rejected after reset');
  ok(`old pw now rejected: ${oldFails.status}`);

  must(await call('POST', '/t/demo-siamsweet/api/login', { username: 'admin', password: 'new-sweet-pw' }), 'new A pw works');
  ok('new pw works');

  // ----------------------------------------------------------------------------
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ ALL TESTS PASSED — 2-company simulation complete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nDemo tenants left in place for inspection:');
  console.log('  · /t/demo-siamsweet     admin: admin / new-sweet-pw');
  console.log('  · /t/demo-itsolutions   admin: admin / it-init');
  console.log('\nDelete via /super or super-admin API when done.');
})().catch(err => {
  console.error('\n❌ FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
