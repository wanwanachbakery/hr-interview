/**
 * Write Cloudflare tunnel config.yml in ~/.cloudflared/
 *
 * Usage: node scripts/_write-tunnel-config.js <tunnel-name> <hostname>
 *
 * Looks for the tunnel's credentials JSON in ~/.cloudflared/<UUID>.json
 * (created by `cloudflared tunnel create`), then writes config.yml that
 * points the given hostname to http://localhost:3000.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tunnelName = process.argv[2];
const hostname = process.argv[3];
const port = process.argv[4] || '3000';

if (!tunnelName || !hostname) {
  console.error('FAIL: usage: node _write-tunnel-config.js <tunnel-name> <hostname> [port]');
  process.exit(1);
}

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

const config =
  'tunnel: ' + tunnelName + '\n' +
  'credentials-file: ' + path.join(cfDir, credFile) + '\n' +
  '\n' +
  'ingress:\n' +
  '  - hostname: ' + hostname + '\n' +
  '    service: http://localhost:' + port + '\n' +
  '  - service: http_status:404\n';

const configPath = path.join(cfDir, 'config.yml');
fs.writeFileSync(configPath, config);
console.log('[OK] Wrote ' + configPath);
console.log('     tunnel:   ' + tunnelName);
console.log('     hostname: ' + hostname);
console.log('     service:  http://localhost:' + port);
