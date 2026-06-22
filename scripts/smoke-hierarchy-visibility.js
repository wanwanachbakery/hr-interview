/**
 * Smoke test the visibility model for section_head / division_head / officer.
 *
 *   ฝ่ายไอที
 *   ├── แผนก Support
 *   │   ├── Help Desk        ← officer (arnon)
 *   │   └── System Admin     ← section_head (thida)
 *   └── แผนกพัฒนา
 *       └── Developer        ← (another officer, in different section)
 *
 *   ฝ่ายขาย
 *   └── แผนกขาย
 *       └── Sales            ← (in different division — section_head must NOT see)
 */
const BASE = 'http://localhost:3000';
const TENANT = 'demo-itsolutions';  // re-use existing tenant
let su = '';

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
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, setCookie: res.headers.get('set-cookie') };
}
function must(r, label) { if (!r.ok) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; }

(async () => {
  console.log('1) super-admin: reset tenant');
  must(await call('POST', '/api/super/login', { password: 'super!2026' }), 'super login');
  su = pick((await call('POST', '/api/super/login', { password: 'super!2026' })).setCookie, 'super_auth');

  // Wipe + recreate tenant
  await call('DELETE', `/api/super/tenants/${TENANT}`, { confirm: 'DELETE' }, su);
  must(await call('POST', '/api/super/tenants',
    { id: TENANT, name: 'IT Solutions (vis test)', admin_password: 'init' }, su), 'create tenant');

  // Login as tenant admin and build org
  const aLogin = await call('POST', `/t/${TENANT}/api/login`, { username: 'admin', password: 'init' });
  must(aLogin, 'A login');
  const admin = pick(aLogin.setCookie, 'auth');

  console.log('2) admin builds org tree');
  const divIT = must(await call('POST', `/t/${TENANT}/api/divisions`,
    { name: 'ฝ่ายไอที' }, admin), 'div IT');
  const divSales = must(await call('POST', `/t/${TENANT}/api/divisions`,
    { name: 'ฝ่ายขาย' }, admin), 'div Sales');

  const secSupport = must(await call('POST', `/t/${TENANT}/api/sections`,
    { name: 'แผนก Support', division_id: divIT.id }, admin), 'sec Support');
  const secDev = must(await call('POST', `/t/${TENANT}/api/sections`,
    { name: 'แผนกพัฒนา', division_id: divIT.id }, admin), 'sec Dev');
  const secSales = must(await call('POST', `/t/${TENANT}/api/sections`,
    { name: 'แผนกขาย', division_id: divSales.id }, admin), 'sec Sales');

  const posHelp = must(await call('POST', `/t/${TENANT}/api/positions`,
    { name: 'Help Desk', section_id: secSupport.id }, admin), 'pos Help');
  const posSysAdmin = must(await call('POST', `/t/${TENANT}/api/positions`,
    { name: 'System Admin', section_id: secSupport.id }, admin), 'pos SysAdmin');
  const posDev = must(await call('POST', `/t/${TENANT}/api/positions`,
    { name: 'Developer', section_id: secDev.id }, admin), 'pos Dev');
  const posSales = must(await call('POST', `/t/${TENANT}/api/positions`,
    { name: 'Sales', section_id: secSales.id }, admin), 'pos Sales');

  console.log('3) admin creates users at every level');
  // section_head over Support
  must(await call('POST', `/t/${TENANT}/api/users`, {
    username: 'thida', password: 'pw', name: 'ธิดา หัวหน้าซัพพอร์ต', role: 'section_head',
    division_id: divIT.id, section_id: secSupport.id, position_id: posSysAdmin.id,
  }, admin), 'user thida');
  // division_head over IT
  must(await call('POST', `/t/${TENANT}/api/users`, {
    username: 'somsak', password: 'pw', name: 'สมศักดิ์ หัวหน้าฝ่าย', role: 'division_head',
    division_id: divIT.id, section_id: secSupport.id, position_id: posHelp.id,
  }, admin), 'user somsak');
  // officer in Support/Help Desk
  must(await call('POST', `/t/${TENANT}/api/users`, {
    username: 'arnon', password: 'pw', name: 'อานนท์ Help Desk', role: 'officer',
    division_id: divIT.id, section_id: secSupport.id, position_id: posHelp.id,
  }, admin), 'user arnon');
  // officer in Dev section (different section, same division)
  must(await call('POST', `/t/${TENANT}/api/users`, {
    username: 'piti', password: 'pw', name: 'ปิติ Dev', role: 'officer',
    division_id: divIT.id, section_id: secDev.id, position_id: posDev.id,
  }, admin), 'user piti');
  // officer in Sales (different division entirely)
  must(await call('POST', `/t/${TENANT}/api/users`, {
    username: 'kanya', password: 'pw', name: 'กัญญา Sales', role: 'officer',
    division_id: divSales.id, section_id: secSales.id, position_id: posSales.id,
  }, admin), 'user kanya');

  // ---- Test section_head visibility ----
  console.log('\n4) section_head (thida, แผนก Support) — what does she see?');
  const tLogin = await call('POST', `/t/${TENANT}/api/login`, { username: 'thida', password: 'pw' });
  must(tLogin, 'thida login');
  const thida = pick(tLogin.setCookie, 'auth');

  const tDivs = must(await call('GET', `/t/${TENANT}/api/divisions`, null, thida), 't divs');
  console.log(`   divisions: ${tDivs.length} — ${tDivs.map(d => d.name).join(', ')}`);
  if (tDivs.length !== 1 || tDivs[0].id !== divIT.id) throw new Error('thida should see only ฝ่ายไอที (parent of her section)');

  const tSecs = must(await call('GET', `/t/${TENANT}/api/sections`, null, thida), 't secs');
  console.log(`   sections: ${tSecs.length} — ${tSecs.map(s => s.name).join(', ')}`);
  if (tSecs.length !== 1 || tSecs[0].id !== secSupport.id) throw new Error('thida should see only own section');

  const tPos = must(await call('GET', `/t/${TENANT}/api/positions`, null, thida), 't pos');
  console.log(`   positions: ${tPos.length} — ${tPos.map(p => p.name).join(', ')}`);
  if (tPos.length !== 2) throw new Error(`thida should see 2 positions in Support, got ${tPos.length}`);

  const tEmps = must(await call('GET', `/t/${TENANT}/api/employees`, null, thida), 't emps');
  console.log(`   employees: ${tEmps.length} — ${tEmps.map(e => e.name).join(', ')}`);
  if (tEmps.length !== 3) throw new Error(`thida should see 3 emps in Support (thida + somsak + arnon), got ${tEmps.length}`);
  // Should NOT see piti (different section) or kanya (different division)
  if (tEmps.some(e => e.name.includes('ปิติ') || e.name.includes('กัญญา'))) {
    throw new Error('thida sees emps outside Support!');
  }
  console.log('   ✓ section_head sees: parent ฝ่าย, own แผนก, positions in own แผนก, emps in own แผนก');

  // section_head cannot EDIT parent division
  const editDiv = await call('PUT', `/t/${TENANT}/api/divisions/${divIT.id}`,
    { name: 'hacked' }, thida);
  if (editDiv.ok) throw new Error('section_head should NOT edit parent division!');
  console.log(`   ✓ section_head cannot edit parent division (status ${editDiv.status})`);

  // section_head CAN edit own section
  const editSec = await call('PUT', `/t/${TENANT}/api/sections/${secSupport.id}`,
    { name: 'แผนก Support (renamed)' }, thida);
  must(editSec, 't edit own section');
  console.log('   ✓ section_head can edit own section name');
  // rename back
  await call('PUT', `/t/${TENANT}/api/sections/${secSupport.id}`, { name: 'แผนก Support' }, thida);

  // ---- Test division_head visibility ----
  console.log('\n5) division_head (somsak, ฝ่ายไอที) — what does he see?');
  const sLogin = await call('POST', `/t/${TENANT}/api/login`, { username: 'somsak', password: 'pw' });
  must(sLogin, 'somsak login');
  const somsak = pick(sLogin.setCookie, 'auth');

  const sDivs = must(await call('GET', `/t/${TENANT}/api/divisions`, null, somsak), 's divs');
  console.log(`   divisions: ${sDivs.length} — ${sDivs.map(d => d.name).join(', ')}`);
  if (sDivs.length !== 1 || sDivs[0].id !== divIT.id) throw new Error('somsak should see only own division');

  const sSecs = must(await call('GET', `/t/${TENANT}/api/sections`, null, somsak), 's secs');
  console.log(`   sections: ${sSecs.length} — ${sSecs.map(x => x.name).join(', ')}`);
  if (sSecs.length !== 2) throw new Error(`somsak should see 2 sections in IT, got ${sSecs.length}`);

  const sPos = must(await call('GET', `/t/${TENANT}/api/positions`, null, somsak), 's pos');
  console.log(`   positions: ${sPos.length} — ${sPos.map(p => p.name).join(', ')}`);
  if (sPos.length !== 3) throw new Error(`somsak should see 3 positions in IT divs, got ${sPos.length}`);

  const sEmps = must(await call('GET', `/t/${TENANT}/api/employees`, null, somsak), 's emps');
  console.log(`   employees: ${sEmps.length} — ${sEmps.map(e => e.name).join(', ')}`);
  if (sEmps.length !== 4) throw new Error(`somsak should see 4 IT emps, got ${sEmps.length}`);
  if (sEmps.some(e => e.name.includes('กัญญา'))) throw new Error('somsak should NOT see Sales emp!');
  console.log('   ✓ division_head sees: own ฝ่าย + ทุก แผนก/ตำแหน่ง/emp ในฝ่าย (ไม่เห็นฝ่ายอื่น)');

  // division_head CAN edit any section in own division
  const editSec2 = await call('PUT', `/t/${TENANT}/api/sections/${secDev.id}`,
    { name: 'แผนกพัฒนา (renamed)' }, somsak);
  must(editSec2, 'somsak edit Dev section');
  console.log('   ✓ division_head can edit ANY section in own division');
  await call('PUT', `/t/${TENANT}/api/sections/${secDev.id}`, { name: 'แผนกพัฒนา' }, somsak);

  // ---- Test officer visibility ----
  console.log('\n6) officer (arnon, Help Desk) — what does he see?');
  const arLogin = await call('POST', `/t/${TENANT}/api/login`, { username: 'arnon', password: 'pw' });
  must(arLogin, 'arnon login');
  const arnon = pick(arLogin.setCookie, 'auth');

  const arDivs = must(await call('GET', `/t/${TENANT}/api/divisions`, null, arnon), 'ar divs');
  console.log(`   divisions: ${arDivs.length}`);
  if (arDivs.length !== 1) throw new Error('arnon should see parent ฝ่าย for tree context');

  const arSecs = must(await call('GET', `/t/${TENANT}/api/sections`, null, arnon), 'ar secs');
  console.log(`   sections: ${arSecs.length}`);
  if (arSecs.length !== 1) throw new Error('arnon should see own section only');

  const arPos = must(await call('GET', `/t/${TENANT}/api/positions`, null, arnon), 'ar pos');
  console.log(`   positions: ${arPos.length} — ${arPos.map(p => p.name).join(', ')}`);
  if (arPos.length !== 1 || arPos[0].id !== posHelp.id) throw new Error('arnon should see only own position');

  const arEmps = must(await call('GET', `/t/${TENANT}/api/employees`, null, arnon), 'ar emps');
  console.log(`   employees: ${arEmps.length}`);
  if (arEmps.length !== 1) throw new Error('arnon should see only own emp');
  console.log('   ✓ officer sees: parent ฝ่าย, parent แผนก, own ตำแหน่ง + own emp only');

  // officer cannot edit anything
  const arEdit = await call('PUT', `/t/${TENANT}/api/sections/${secSupport.id}`, { name: 'X' }, arnon);
  if (arEdit.ok) throw new Error('officer should not edit!');
  console.log(`   ✓ officer cannot edit section (status ${arEdit.status})`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ Hierarchy visibility working correctly');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nDemo tenant: /t/demo-itsolutions');
  console.log('  Login admin / init  → admin');
  console.log('  Login thida / pw    → section_head (Support)');
  console.log('  Login somsak / pw   → division_head (IT)');
  console.log('  Login arnon / pw    → officer (Help Desk)');
  console.log('  Login piti / pw     → officer (Dev section)');
  console.log('  Login kanya / pw    → officer (Sales — separate division)');
})().catch(err => { console.error('\n❌ FAIL:', err.message); console.error(err.stack); process.exit(1); });
