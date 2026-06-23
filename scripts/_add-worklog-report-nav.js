/**
 * Bulk-add "📈 สรุปบันทึกงาน" link to the topbar nav, right after the
 * "👥 บันทึกงานทีม" link. Idempotent. (Page shows a "for supervisors" message
 * to anyone without permission, so it's safe everywhere.)
 */
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'public');
const LINK = '<a href="/worklog-report">📈 สรุปบันทึกงาน</a>';

const files = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
for (const filename of files) {
  const file = path.join(PUB, filename);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('>📈 สรุปบันทึกงาน<')) { console.log(`  - already has it: ${filename}`); continue; }
  const before = html;
  if (html.includes('>👥 บันทึกงานทีม<')) {
    html = html.replace(/(<a href="\/worklog-team">👥 บันทึกงานทีม<\/a>)/, `$1\n      ${LINK}`);
  }
  if (html === before) { console.log(`  - no team link, skipped: ${filename}`); continue; }
  fs.writeFileSync(file, html);
  console.log(`  ✓ ${filename}`);
}
console.log('\nDone.');
