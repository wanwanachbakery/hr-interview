/**
 * Write Cloudflare tunnel config.yml in ~/.cloudflared/
 *
 * รองรับหลาย hostname (หลายโปรแกรมบนโดเมนเดียว แยกด้วย subdomain)
 *
 * Usage:
 *   node scripts/_write-tunnel-config.js <tunnel-name> <hostname[=port]> [hostname[=port]] ...
 *
 * ตัวอย่าง (โปรแกรมเดียว):
 *   node scripts/_write-tunnel-config.js hrwwn wanwanachapp.com
 *
 * ตัวอย่าง (หลายโปรแกรม — HR ที่ทั้ง root และ subdomain + ร้านค้าอีกพอร์ต):
 *   node scripts/_write-tunnel-config.js hrwwn \
 *        wanwanachapp.com=3000 hr-interview.wanwanachapp.com=3000 shop.wanwanachapp.com=3001
 *
 * เพิ่มโปรแกรมใหม่ในอนาคต = เพิ่มอีก 1 อาร์กิวเมนต์ (hostname=port ของแอปใหม่) แล้วรันซ้ำ
 * (port เว้นไว้ = 3000). จากนั้นผูก DNS: cloudflared tunnel route dns <tunnel> <hostname>
 * แล้ว restart tunnel.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tunnelName = process.argv[2];
const hostArgs = process.argv.slice(3);

if (!tunnelName || !hostArgs.length) {
  console.error('FAIL: usage: node _write-tunnel-config.js <tunnel-name> <hostname[=port]> [hostname[=port]] ...');
  process.exit(1);
}

// แต่ละอาร์กิวเมนต์: "hostname" หรือ "hostname=port" (port เว้น = 3000)
const rules = hostArgs.map((a) => {
  const [hostname, port] = String(a).split('=');
  if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) {
    console.error('FAIL: invalid hostname "' + a + '" (คาดหวังรูปแบบ hostname หรือ hostname=port)');
    process.exit(1);
  }
  return { hostname, port: (port && /^\d+$/.test(port)) ? port : '3000' };
});

const cfDir = path.join(os.homedir(), '.cloudflared');
if (!fs.existsSync(cfDir)) {
  console.error('FAIL: ~/.cloudflared not found — run `cloudflared tunnel login` first');
  process.exit(1);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const credFile = fs.readdirSync(cfDir).find(f => uuidPattern.test(f));
if (!credFile) {
  console.error('FAIL: no tunnel credentials JSON found in ' + cfDir);
  console.error('      run `cloudflared tunnel create ' + tunnelName + '` first');
  process.exit(1);
}

const ingressLines = rules
  .map(r => '  - hostname: ' + r.hostname + '\n    service: http://localhost:' + r.port + '\n')
  .join('');

const config =
  'tunnel: ' + tunnelName + '\n' +
  'credentials-file: ' + path.join(cfDir, credFile) + '\n' +
  '\n' +
  'ingress:\n' +
  ingressLines +
  '  - service: http_status:404\n';

const configPath = path.join(cfDir, 'config.yml');
fs.writeFileSync(configPath, config);
console.log('[OK] Wrote ' + configPath);
console.log('     tunnel: ' + tunnelName);
for (const r of rules) console.log('     hostname: ' + r.hostname + '  →  http://localhost:' + r.port);
console.log('');
console.log('ต่อไป: ผูก DNS ให้แต่ละ hostname (ครั้งเดียวต่อ hostname):');
for (const r of rules) console.log('     cloudflared tunnel route dns ' + tunnelName + ' ' + r.hostname);
console.log('แล้ว restart tunnel: cloudflared tunnel run ' + tunnelName + '  (หรือ restart service)');
