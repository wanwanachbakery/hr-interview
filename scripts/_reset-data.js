/**
 * Reset data/ folder to factory defaults inside a target directory.
 * Used by BUILD-PACKAGE.bat to ship a clean distribution.
 *
 * Usage: node scripts/_reset-data.js <target_dir>
 */
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) {
  console.error('FAIL: missing target dir');
  process.exit(1);
}
const d = path.join(dir, 'data');
if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

fs.writeFileSync(
  path.join(d, 'company.json'),
  JSON.stringify({ name: 'บริษัทตัวอย่าง จำกัด', name_en: 'Sample Company Ltd.' }, null, 2) + '\n'
);
fs.writeFileSync(path.join(d, 'divisions.json'), '[]\n');
fs.writeFileSync(path.join(d, 'sections.json'), '[]\n');
fs.writeFileSync(path.join(d, 'positions.json'), '[]\n');
fs.writeFileSync(path.join(d, 'users.json'), '[]\n');
fs.writeFileSync(path.join(d, 'employees.json'), '[]\n');
fs.writeFileSync(
  path.join(d, 'auth.json'),
  JSON.stringify({ master: 'JC2026!Init' }, null, 2) + '\n'
);

const iv = path.join(d, 'interviews');
if (fs.existsSync(iv)) {
  for (const f of fs.readdirSync(iv)) {
    if (f === '.gitkeep') continue;
    fs.unlinkSync(path.join(iv, f));
  }
} else {
  fs.mkdirSync(iv, { recursive: true });
}
fs.writeFileSync(path.join(iv, '.gitkeep'), '');

const secret = path.join(d, '.secret');
if (fs.existsSync(secret)) fs.unlinkSync(secret);

// Outputs: keep only _company structure
const out = path.join(dir, 'outputs');
if (fs.existsSync(out)) {
  for (const f of fs.readdirSync(out)) {
    if (f === '_company') continue;
    fs.rmSync(path.join(out, f), { recursive: true, force: true });
  }
}
const empty = path.join(out, '_company');
if (!fs.existsSync(empty)) fs.mkdirSync(empty, { recursive: true });
fs.writeFileSync(path.join(empty, '.gitkeep'), '');

console.log('[OK] data reset to factory defaults at: ' + dir);
