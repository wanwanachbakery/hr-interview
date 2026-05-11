/**
 * Migrate emp records to the position-anchored model.
 * - Wipes existing employees.json + every file in data/interviews/
 * - Re-creates one active emp record per user (where user has a position_id)
 * - Logs users that can't be migrated (missing position_id)
 *
 * Safe to re-run: it always starts from a clean slate.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const INTERVIEWS = path.join(DATA, 'interviews');

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));

const users = readJson(path.join(DATA, 'users.json'), []);
const positions = readJson(path.join(DATA, 'positions.json'), []);
const sections = readJson(path.join(DATA, 'sections.json'), []);
const divisions = readJson(path.join(DATA, 'divisions.json'), []);

console.log(`Found ${users.length} users.`);

// Wipe employees + interviews
console.log('Wiping employees.json + data/interviews/*');
writeJson(path.join(DATA, 'employees.json'), []);
if (fs.existsSync(INTERVIEWS)) {
  for (const f of fs.readdirSync(INTERVIEWS)) {
    if (f === '.gitkeep') continue;
    fs.unlinkSync(path.join(INTERVIEWS, f));
  }
}

// Also wipe outputs/ (except _company/.gitkeep) since they reference old emp ids.
const OUTPUTS = path.join(ROOT, 'outputs');
if (fs.existsSync(OUTPUTS)) {
  for (const f of fs.readdirSync(OUTPUTS)) {
    if (f === '_company') continue;
    fs.rmSync(path.join(OUTPUTS, f), { recursive: true, force: true });
  }
}

const newEmps = [];
const warnings = [];

function newEmpId() {
  return 'emp_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

for (const u of users) {
  if (!u.position_id) {
    warnings.push(`  ⚠️  ${u.username} (${u.name}) — no position_id, skipped`);
    continue;
  }
  const pos = positions.find(p => p.id === u.position_id);
  if (!pos) {
    warnings.push(`  ⚠️  ${u.username} — position ${u.position_id} not found`);
    continue;
  }
  const sec = sections.find(s => s.id === u.section_id);
  const div = divisions.find(d => d.id === u.division_id);

  newEmps.push({
    id: newEmpId(),
    position_id: u.position_id,
    user_id: u.id,
    name: u.name,
    role: pos.name,
    division_id: u.division_id,
    division_name: div?.name || '',
    section_id: u.section_id,
    section_name: sec?.name || '',
    department: '',
    primary_duty: '',
    email: '',
    owner_user_id: u.id,
    archived: false,
    vacated_at: null,
    vacated_reason: null,
    createdAt: new Date().toISOString(),
    interviewStatus: 'not_started',
  });
  console.log(`  ✓  ${u.username.padEnd(12)} → ${pos.name} (${u.role})`);
  // Avoid id collision when looping fast
  // (genId uses Date.now().toString(36) which has ~1ms granularity)
}

writeJson(path.join(DATA, 'employees.json'), newEmps);

console.log(`\nCreated ${newEmps.length} emp records.`);
if (warnings.length) {
  console.log('\nWarnings:');
  warnings.forEach(w => console.log(w));
  console.log('\n  → admin should fix these users via /admin/users (assign all 3 scope fields).');
}
