/**
 * Smoke test: when a user starts their interview, iv.hours is set from
 * their work_start/work_end/break_start/break_end, NOT from a preset schedule.
 */
const BASE = 'http://localhost:3000';
let cookie = '';
function setCookieFromRes(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/auth=([^;]+)/);
  if (m) cookie = 'auth=' + m[1];
}
async function api(method, p, body) {
  const headers = { 'content-type': 'application/json', cookie };
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  setCookieFromRes(res);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

(async () => {
  // Login as pim — set custom hours first, then start interview
  console.log('1) Login as admin, set pim hours to 08:30-17:00, break 12-13');
  cookie = '';
  await api('POST', '/api/login', { username: 'admin', password: 'JC2026!Init' });
  const users = await api('GET', '/api/users');
  const pim = users.find(u => u.username === 'pim');
  if (!pim) throw new Error('pim not found');
  await api('PUT', '/api/users/' + pim.id, {
    work_start: '08:30', work_end: '17:00',
    break_start: '12:00', break_end: '13:00',
  });
  console.log('   ✓ updated pim profile');

  console.log('\n2) Login as pim, check profile');
  cookie = '';
  await api('POST', '/api/login', { username: 'pim', password: 'pw1234' });
  const prof = await api('GET', '/api/me/profile');
  console.log('   work:', prof.work_start + '-' + prof.work_end, 'break:', prof.break_start + '-' + prof.break_end);

  console.log('\n3) Start fresh interview — should populate iv.hours from profile');
  // First wipe pim's interview file if exists (so we test fresh start)
  const myEmp = await api('GET', '/api/me/employee');
  console.log('   my emp:', myEmp.id, '(status:', myEmp.interviewStatus + ')');

  // Start interview without sending schedule
  const start = await api('POST', `/api/interview/${myEmp.id}/start`, { lang: 'th', interviewDate: '2026-05-11' });
  console.log('   iv.lang:', start.interview.lang);
  console.log('   iv.hours:', JSON.stringify(start.interview.hours));
  console.log('   iv.workHours:', JSON.stringify(start.interview.workHours));
  console.log('   first question key:', start.question.key);

  // pim's work 08:30-17:00 break 12:00-13:00 → hours = [8, 9, 10, 11, 13, 14, 15, 16]
  const expected = [8, 9, 10, 11, 13, 14, 15, 16];
  const actual = start.interview.hours;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected hours ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log('\n✅ iv.hours computed correctly from user profile');
})().catch(err => { console.error('\n❌ FAIL:', err.message); process.exit(1); });
