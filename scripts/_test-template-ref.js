/**
 * Verify that the user-import template now includes a reference sheet listing
 * all current divisions/sections/positions in the tenant.
 */
const BASE = 'http://localhost:3000';
const TENANT = 'demo-itsolutions';
const xlsx = require('xlsx');

function pick(setCookie, name) {
  if (!setCookie) return null;
  for (const p of setCookie.split(/,\s*(?=[a-zA-Z_]+=)/)) {
    const m = p.match(new RegExp('^' + name + '=([^;]+)'));
    if (m) return name + '=' + m[1];
  }
  return null;
}

(async () => {
  const login = await fetch(BASE + `/t/${TENANT}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'init' }),
  });
  if (!login.ok) throw new Error('login failed');
  const cookie = pick(login.headers.get('set-cookie'), 'auth');

  // Download the users template
  const res = await fetch(BASE + `/t/${TENANT}/api/admin/import/template/users`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${buf.length} bytes`);

  const wb = xlsx.read(buf, { type: 'buffer' });
  console.log('Sheets:', wb.SheetNames);

  // Check main sheet
  const main = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  console.log('\n--- Sheet 1 (Users) — first 3 rows ---');
  main.slice(0, 3).forEach((r, i) => console.log(`  row ${i}: ${JSON.stringify(r)}`));

  // Check reference sheet
  const ref = xlsx.utils.sheet_to_json(wb.Sheets['ค่าที่ใช้ได้'], { header: 1 });
  console.log(`\n--- Sheet 2 (ค่าที่ใช้ได้) — ${ref.length} rows ---`);
  ref.forEach((r, i) => {
    if (r.some(v => v !== '' && v !== undefined)) {
      console.log(`  row ${i}: ${JSON.stringify(r)}`);
    }
  });
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
