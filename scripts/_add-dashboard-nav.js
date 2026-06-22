/**
 * Bulk-add "📋 Dashboard" link to topbar nav across all tenant HTML pages.
 * Idempotent — skips files that already contain the link.
 *
 * Placement rules:
 *   - Files with <a href="/reports">…</a> in nav  → insert AFTER that link
 *   - Files without /reports in nav               → insert BEFORE the logout link
 *   - Legacy files with id="nav-dashboard" hidden → unhide + relabel to "📋 Dashboard"
 */
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'public');
const DASH = '<a href="/dashboard">📋 Dashboard</a>';

const HAS_REPORTS = ['admin.html', 'index.html', 'profile.html', 'reports.html'];
const NO_REPORTS  = ['admin-org.html', 'admin-users.html', 'examples.html', 'interview.html', 'review.html'];
const LEGACY      = ['division.html'];

function update(filename, fn) {
  const file = path.join(PUB, filename);
  if (!fs.existsSync(file)) { console.log(`  - SKIP (not found): ${filename}`); return; }
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  html = fn(html);
  if (html === before) { console.log(`  - no change: ${filename}`); return; }
  fs.writeFileSync(file, html);
  console.log(`  ✓ ${filename}`);
}

// 1) After /reports link
for (const f of HAS_REPORTS) {
  update(f, h => {
    if (h.includes('>📋 Dashboard<')) return h;
    return h.replace(
      /(<a href="\/reports"[^>]*>📊 รายงาน<\/a>)/,
      `$1\n      ${DASH}`
    );
  });
}

// 2) Before logout link
for (const f of NO_REPORTS) {
  update(f, h => {
    if (h.includes('>📋 Dashboard<')) return h;
    return h.replace(
      /(<a href="#" onclick="[^"]*logout)/,
      `${DASH}\n      $1`
    );
  });
}

// 3) Legacy: unhide existing nav-dashboard + change label
for (const f of LEGACY) {
  update(f, h => {
    return h.replace(
      /<a href="\/dashboard" id="nav-dashboard"[^>]*>[^<]*<\/a>/,
      '<a href="/dashboard" id="nav-dashboard" data-i18n="nav_dashboard">📋 Dashboard</a>'
    );
  });
}

// 4) admin.html: rename card from "🎤 อินเทอร์วิว + JD/KPI" → "📋 Dashboard"
update('admin.html', h => h.replace(
  /<a href="\/dashboard" class="div-card" style="border-top-color:#ec4899;">[\s\S]*?<div class="icon">🎤<\/div>[\s\S]*?<div class="name">อินเทอร์วิว \+ JD\/KPI<\/div>[\s\S]*?<div class="meta">เพิ่มพนักงาน · สัมภาษณ์ · วิเคราะห์รวมบริษัท<\/div>/,
  `<a href="/dashboard" class="div-card" style="border-top-color:#ec4899;">
      <div class="icon">📋</div>
      <div class="name">Dashboard</div>
      <div class="meta">ดูสถานะ interview · จัดการพนักงาน</div>`
));

// 5) index.html: standardise the existing Dashboard card text
update('index.html', h => h.replace(
  /(<a href="\/dashboard" class="div-card"[^>]*>\s*<div class="icon">📋<\/div>\s*<div class="name">)ดูสถานะของทีม(<\/div>\s*<div class="meta">)[^<]*(<\/div>)/,
  '$1Dashboard$2ดูสถานะ interview · จัดการพนักงาน$3'
));

console.log('\nDone.');
