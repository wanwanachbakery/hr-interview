/**
 * Bulk-add "📝 บันทึกงาน" link to the topbar nav across all tenant HTML pages.
 * Idempotent — skips files that already contain the link.
 *
 * Anchor strategy (robust, no hardcoded file lists):
 *   - If the page has the "📋 Dashboard" link → insert AFTER it.
 *   - Else if it has a logout link → insert BEFORE it.
 *   - Else skip (login / super pages have no app nav).
 */
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'public');
const LINK = '<a href="/worklog">📝 บันทึกงาน</a>';

const files = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
for (const filename of files) {
  const file = path.join(PUB, filename);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('>📝 บันทึกงาน<')) { console.log(`  - already has it: ${filename}`); continue; }
  const before = html;

  if (html.includes('>📋 Dashboard<')) {
    html = html.replace(/(<a href="\/dashboard"[^>]*>📋 Dashboard<\/a>)/, `$1\n      ${LINK}`);
  } else if (/<a href="#"[^>]*onclick="[^"]*logout/.test(html)) {
    html = html.replace(/(<a href="#"[^>]*onclick="[^"]*logout)/, `${LINK}\n      $1`);
  }

  if (html === before) { console.log(`  - no nav anchor, skipped: ${filename}`); continue; }
  fs.writeFileSync(file, html);
  console.log(`  ✓ ${filename}`);
}
console.log('\nDone.');
