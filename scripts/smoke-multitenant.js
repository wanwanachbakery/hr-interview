/**
 * Smoke test multi-tenant flow:
 * 1. Super-admin login
 * 2. Create 2 tenants (companyA, companyB)
 * 3. As admin of companyA: login, create a division
 * 4. As admin of companyB: login, verify it can't see companyA's division (isolation)
 * 5. Super-admin reset companyA admin password
 */
const BASE = 'http://localhost:3000';

let superCookie = '';
let aCookie = '';
let bCookie = '';

function pickAuthCookie(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const parts = setCookieHeader.split(/,\s*(?=[a-zA-Z]+=)/);
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
  let data;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, setCookie };
}

(async () => {
  console.log('1) Super-admin login');
  const sLogin = await call('POST', '/api/super/login', { password: 'super!2026' });
  if (!sLogin.ok) throw new Error('super login failed: ' + JSON.stringify(sLogin.data));
  superCookie = pickAuthCookie(sLogin.setCookie, 'super_auth');
  console.log('   ✓');

  console.log('\n2) Create tenant companyA');
  const ca = await call('POST', '/api/super/tenants',
    { id: 'companya', name: 'Company A', admin_password: 'compa-init' }, superCookie);
  if (!ca.ok) throw new Error('create A failed: ' + JSON.stringify(ca.data));
  console.log('   ✓ id=' + ca.data.id + ', url=' + ca.data.url_path);

  console.log('\n3) Create tenant companyB');
  const cb = await call('POST', '/api/super/tenants',
    { id: 'companyb', name: 'Company B', admin_password: 'compb-init' }, superCookie);
  if (!cb.ok) throw new Error('create B failed: ' + JSON.stringify(cb.data));
  console.log('   ✓ id=' + cb.data.id);

  console.log('\n4) Login as companyA admin');
  const aLogin = await call('POST', '/t/companya/api/login',
    { username: 'admin', password: 'compa-init' });
  if (!aLogin.ok) throw new Error('A login failed: ' + JSON.stringify(aLogin.data));
  aCookie = pickAuthCookie(aLogin.setCookie, 'auth');
  console.log('   ✓ session as admin of companyA');

  console.log('\n5) As A admin: create a division');
  const aDiv = await call('POST', '/t/companya/api/divisions',
    { name: 'ฝ่าย A-1', icon: '🅰️' }, aCookie);
  if (!aDiv.ok) throw new Error('A div create failed: ' + JSON.stringify(aDiv.data));
  console.log('   ✓ created: ' + aDiv.data.id + ' (' + aDiv.data.name + ')');

  console.log('\n6) Login as companyB admin');
  const bLogin = await call('POST', '/t/companyb/api/login',
    { username: 'admin', password: 'compb-init' });
  if (!bLogin.ok) throw new Error('B login failed: ' + JSON.stringify(bLogin.data));
  bCookie = pickAuthCookie(bLogin.setCookie, 'auth');
  console.log('   ✓');

  console.log('\n7) As B admin: list divisions (should NOT see A\'s division — tenant isolation)');
  const bDivs = await call('GET', '/t/companyb/api/divisions', null, bCookie);
  if (!bDivs.ok) throw new Error('B list failed');
  console.log('   B sees ' + bDivs.data.length + ' divisions (expected 0)');
  if (bDivs.data.length !== 0) throw new Error('ISOLATION BROKEN: B can see A\'s data');
  console.log('   ✓ isolation verified');

  console.log('\n8) Cross-cookie test: B\'s cookie sent to A\'s URL — should reject');
  const xCross = await call('GET', '/t/companya/api/divisions', null, bCookie);
  console.log('   status:', xCross.status, '(expected 401 since B cookie has Path=/t/companyb)');
  // Note: browsers won't even send the cookie because Path mismatch. Server gets no cookie → 401.

  console.log('\n9) Super-admin: reset companyA admin password');
  const reset = await call('POST', '/t/companya/api/login',
    { username: 'admin', password: 'compa-init' });
  // First verify current works
  if (!reset.ok) throw new Error('A login pre-reset failed');

  const r = await call('POST', '/api/super/tenants/companya/reset-admin-password',
    { password: 'new-pw-12345' }, superCookie);
  if (!r.ok) throw new Error('reset failed: ' + JSON.stringify(r.data));
  console.log('   ✓ password reset');

  // Verify old password rejected
  const oldLogin = await call('POST', '/t/companya/api/login',
    { username: 'admin', password: 'compa-init' });
  console.log('   old password: status=' + oldLogin.status + ' (expected 401)');
  if (oldLogin.ok) throw new Error('old password should be rejected');

  // Verify new password works
  const newLogin = await call('POST', '/t/companya/api/login',
    { username: 'admin', password: 'new-pw-12345' });
  console.log('   new password: status=' + newLogin.status + ' (expected 200)');
  if (!newLogin.ok) throw new Error('new password should work');

  console.log('\n10) Super-admin: list tenants');
  const list = await call('GET', '/api/super/tenants', null, superCookie);
  console.log('   tenants: ' + list.data.length);
  for (const t of list.data) console.log('     - ' + t.id + ': ' + t.name + ' (' + t.user_count + ' users)');

  console.log('\n✅ ALL MULTI-TENANT SMOKE TESTS PASSED');
})().catch(err => { console.error('\n❌ FAIL:', err.message); process.exit(1); });
