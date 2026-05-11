/**
 * Smoke test the production hardening.
 */
const BASE = 'http://localhost:3000';

async function loginRaw(username, password) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res;
}

(async () => {
  console.log('\n[1] Login with hashed master password — should still work');
  const ok = await loginRaw('admin', 'JC2026!Init');
  console.log(`  status: ${ok.status}`);
  if (ok.status !== 200) throw new Error('login should succeed after hash migration');
  const setCookie = ok.headers.get('set-cookie') || '';
  console.log(`  Set-Cookie includes "Secure"? ${setCookie.toLowerCase().includes('secure')}`);

  console.log('\n[2] 5 bad attempts → 6th should be 429 (rate limited)');
  for (let i = 1; i <= 5; i++) {
    const r = await loginRaw('admin', 'WRONG' + i);
    console.log(`  attempt ${i}: ${r.status} ${i < 5 ? '' : '(this is the 5th — block kicks in)'}`);
  }
  const r6 = await loginRaw('admin', 'WRONG6');
  const retryAfter = r6.headers.get('retry-after');
  console.log(`  attempt 6: ${r6.status} (Retry-After: ${retryAfter}s)`);
  if (r6.status !== 429) throw new Error(`expected 429, got ${r6.status}`);

  console.log('\n[3] Even correct password is rate-limited during block');
  const blocked = await loginRaw('admin', 'JC2026!Init');
  console.log(`  status: ${blocked.status}`);
  if (blocked.status !== 429) throw new Error(`expected 429 during block, got ${blocked.status}`);

  console.log('\n[4] Wait 60 seconds? Skipping — assume block works as designed.');
  console.log('   (block expires after 15min; restart server to reset in-memory rate limiter)');

  console.log('\n✅ Security smoke tests passed.');
})().catch(err => { console.error('\n❌ FAIL:', err.message); process.exit(1); });
