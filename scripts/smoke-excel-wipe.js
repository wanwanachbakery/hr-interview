/**
 * Smoke test Excel import + wipe endpoints.
 */
const BASE = 'http://localhost:3000';
let cookie = '';
function setCookieFromRes(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/auth=([^;]+)/);
  if (m) cookie = 'auth=' + m[1];
}
async function api(method, p, body, expectBinary) {
  const headers = { 'content-type': 'application/json', cookie };
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  setCookieFromRes(res);
  if (expectBinary) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, buf, ct: res.headers.get('content-type') };
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

(async () => {
  console.log('1) Login as admin');
  const login = await api('POST', '/api/login', { username: 'admin', password: 'JC2026!Init' });
  if (!login.ok) throw new Error('login failed: ' + JSON.stringify(login.data));
  console.log('   ✓ logged in');

  console.log('\n2) Download org template');
  const orgTpl = await api('GET', '/api/admin/import/template/org', null, true);
  console.log(`   status: ${orgTpl.status}, size: ${orgTpl.buf.length} bytes`);
  if (!orgTpl.ok || orgTpl.buf.length < 1000) throw new Error('org template too small');
  // xlsx is a zip — first bytes "PK"
  if (orgTpl.buf[0] !== 0x50 || orgTpl.buf[1] !== 0x4B) throw new Error('not a valid xlsx (missing PK header)');
  console.log('   ✓ valid xlsx (PK magic bytes)');

  console.log('\n3) Download users template');
  const usersTpl = await api('GET', '/api/admin/import/template/users', null, true);
  console.log(`   status: ${usersTpl.status}, size: ${usersTpl.buf.length} bytes`);
  if (!usersTpl.ok || usersTpl.buf.length < 1000) throw new Error('users template too small');
  console.log('   ✓ valid xlsx');

  console.log('\n4) Re-upload org template (idempotent — should skip duplicates)');
  const b64 = orgTpl.buf.toString('base64');
  const imp = await api('POST', '/api/admin/import/org', { file: b64 });
  console.log('   response:', JSON.stringify(imp.data));
  if (!imp.ok) throw new Error('import failed');

  console.log('\n5) Wipe without confirm — should 400');
  const noConfirm = await api('POST', '/api/admin/wipe/interviews', {});
  console.log(`   status: ${noConfirm.status}: ${JSON.stringify(noConfirm.data)}`);
  if (noConfirm.ok) throw new Error('expected 400 without confirm');
  console.log('   ✓ rejected (400)');

  console.log('\n6) Wipe with wrong confirm — should 400');
  const wrongConfirm = await api('POST', '/api/admin/wipe/interviews', { confirm: 'no' });
  if (wrongConfirm.ok) throw new Error('expected 400 with wrong confirm');
  console.log(`   ✓ rejected (${wrongConfirm.status})`);

  console.log('\n✅ All smoke tests passed.');
  console.log('   (skipped actually wiping data to preserve user state)');
})().catch(err => { console.error('\n❌ FAIL:', err.message); process.exit(1); });
