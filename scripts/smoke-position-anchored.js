/**
 * Smoke test the position-anchored model.
 */
const BASE = 'http://localhost:3000';
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
  return { ok: res.ok, status: res.status, data };
}
async function expectOk(method, path, body, label) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`${label}: expected OK, got ${r.status} ${JSON.stringify(r.data)}`);
  console.log(`  ✓ ${label}`);
  return r.data;
}
async function expectFail(method, path, body, label, expectStatus) {
  const r = await api(method, path, body);
  if (r.ok) throw new Error(`${label}: expected ${expectStatus}, got OK`);
  if (expectStatus && r.status !== expectStatus) throw new Error(`${label}: expected ${expectStatus}, got ${r.status}`);
  console.log(`  ✓ ${label} (got ${r.status})`);
  return r.data;
}

(async () => {
  console.log('\n[1] Admin login');
  await expectOk('POST', '/api/login', { username: 'admin', password: 'JC2026!Init' }, 'login admin');

  console.log('\n[2] Verify migrated emp records');
  const emps = await expectOk('GET', '/api/employees', null, 'list employees');
  console.log(`    Got ${emps.length} active emp records:`);
  emps.forEach(e => console.log(`      - ${e.name} → ${e.role} (status: ${e.interviewStatus}, user_id: ${e.user_id})`));

  console.log('\n[3] Try POST /api/users WITHOUT position_id (should 400)');
  await expectFail('POST', '/api/users', {
    username: 'testfail', password: 'x', name: 'Test', role: 'officer',
    division_id: 'div_mp0xq7somuc8',
  }, 'create user without position', 400);

  console.log('\n[4] Create new officer user WITH all 3 fields (should auto-create emp)');
  const divs = await expectOk('GET', '/api/divisions', null, 'list divs');
  const candyDiv = divs.find(d => d.name === 'ฝ่ายขาย');
  const secs = await expectOk('GET', '/api/sections', null, 'list secs');
  const candySec = secs.find(s => s.division_id === candyDiv.id);
  const poss = await expectOk('GET', '/api/positions', null, 'list pos');
  const candyPos = poss.find(p => p.section_id === candySec.id);
  const newUser = await expectOk('POST', '/api/users', {
    username: 'testuser1', password: 'pw1234', name: 'ทดสอบ Auto Emp',
    role: 'officer',
    division_id: candyDiv.id, section_id: candySec.id, position_id: candyPos.id,
  }, 'create user with all 3 fields');
  console.log(`    User created: ${newUser.id}`);
  const empsAfter = await expectOk('GET', '/api/employees', null, 'list emps after create');
  const newEmp = empsAfter.find(e => e.user_id === newUser.id);
  if (!newEmp) throw new Error('auto-emp not created!');
  console.log(`    Auto-created emp: ${newEmp.id} for position "${newEmp.role}"`);

  console.log('\n[5] Login as that new user → check /api/me/employee');
  await expectOk('POST', '/api/login', { username: 'testuser1', password: 'pw1234' }, 'login testuser1');
  const myEmp = await expectOk('GET', '/api/me/employee', null, 'get my employee');
  if (myEmp.id !== newEmp.id) throw new Error('mismatch!');
  console.log(`    /api/me/employee returned my anchor record: ${myEmp.role}`);

  console.log('\n[6] Try to interview someone ELSE (mali) — should 403');
  const empsForMe = await expectOk('GET', '/api/employees', null, 'list emps as testuser1 (officer)');
  console.log(`    As officer, I see ${empsForMe.length} emp records (should be just mine)`);
  // Find another emp by listing as admin (separate session)
  let othersCookie = cookie;
  cookie = '';
  await expectOk('POST', '/api/login', { username: 'admin', password: 'JC2026!Init' }, 'login admin');
  const allEmps = await expectOk('GET', '/api/employees', null, 'admin list emps');
  const maliEmp = allEmps.find(e => e.name.includes('มะลิ'));
  cookie = othersCookie;  // back to testuser1
  if (maliEmp) {
    await expectFail('POST', `/api/interview/${maliEmp.id}/start`, {}, 'officer cant start someone else interview', 403);
  } else {
    console.log('    (mali emp not found, skip)');
  }

  console.log('\n[7] Admin moves testuser1 to a different position → archive + new emp');
  cookie = '';
  await expectOk('POST', '/api/login', { username: 'admin', password: 'JC2026!Init' }, 'login admin');
  const otherPos = poss.find(p => p.section_id === candySec.id && p.id !== candyPos.id);
  if (otherPos) {
    await expectOk('PUT', `/api/users/${newUser.id}`, {
      role: 'officer',
      division_id: candyDiv.id, section_id: candySec.id, position_id: otherPos.id,
    }, `move testuser1 to ${otherPos.name}`);
    // Should have 2 emps now: 1 archived + 1 active
    const allHistEmps = await expectOk('GET', '/api/employees?include_archived=true', null, 'list with archived');
    const myEmps = allHistEmps.filter(e => e.user_id === newUser.id || e.owner_user_id === newUser.id);
    console.log(`    User now has ${myEmps.length} emp records:`);
    myEmps.forEach(e => console.log(`      - ${e.role} (archived: ${e.archived}, reason: ${e.vacated_reason})`));
  }

  console.log('\n[8] Delete testuser1 → emp archived');
  await expectOk('DELETE', `/api/users/${newUser.id}`, null, 'delete user');
  const allAfterDelete = await expectOk('GET', '/api/employees?include_archived=true', null, 'list all after delete');
  const userEmps = allAfterDelete.filter(e => e.owner_user_id === newUser.id);
  console.log(`    User now has ${userEmps.length} emp records (all archived):`);
  userEmps.forEach(e => console.log(`      - ${e.role} (archived: ${e.archived}, reason: ${e.vacated_reason})`));

  console.log('\n[9] Try delete position with archived emp → should 400');
  if (otherPos) {
    await expectFail('DELETE', `/api/positions/${otherPos.id}`, null, 'cant delete position with archived emp', 400);
  }

  console.log('\n[10] Position history for that position');
  const hist = await expectOk('GET', `/api/positions/${candyPos.id}/history`, null, 'position history');
  console.log(`    Position "${hist.position.name}" has ${hist.history.length} historical record(s):`);
  hist.history.forEach(e => console.log(`      - ${e.name} (archived: ${e.archived})`));

  console.log('\n✅ ALL SMOKE TESTS PASSED');
})().catch(err => {
  console.error('\n❌ FAIL:', err.message);
  process.exit(1);
});
