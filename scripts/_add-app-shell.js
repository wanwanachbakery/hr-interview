/**
 * Add <script src="/app-shell.js"> before </head> on tenant app pages.
 * Skips login / super pages (app-shell self-guards anyway, but keep them clean).
 * Idempotent.
 */
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'public');
const SKIP = new Set(['login.html', 'super-login.html', 'super-tenants.html']);
const TAG = '  <script src="/app-shell.js"></script>\n';

for (const f of fs.readdirSync(PUB).filter(x => x.endsWith('.html'))) {
  if (SKIP.has(f)) { console.log(`  - skip: ${f}`); continue; }
  const file = path.join(PUB, f);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('/app-shell.js')) { console.log(`  - already has it: ${f}`); continue; }
  if (!html.includes('</head>')) { console.log(`  - no </head>, skip: ${f}`); continue; }
  html = html.replace('</head>', TAG + '</head>');
  fs.writeFileSync(file, html);
  console.log(`  ✓ ${f}`);
}
console.log('\nDone.');
