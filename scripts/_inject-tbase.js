/**
 * Inject the multi-tenant TBASE helper into every tenant HTML file and rewrite
 * fetch / location.href URLs so they include /t/{tenantId} automatically.
 *
 * Run from project root:  node scripts/_inject-tbase.js
 */
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'public');
const FILES = [
  'login.html', 'index.html', 'admin.html', 'admin-org.html', 'admin-users.html',
  'profile.html', 'reports.html', 'dashboard.html', 'division.html',
  'interview.html', 'review.html', 'examples.html',
];

const SNIPPET = `<script>
  // Multi-tenant: derive /t/{tenantId} prefix from URL and apply to <a href="/...">
  window.TENANT_ID = (location.pathname.match(/^\\/t\\/([^/]+)/) || [])[1] || '';
  window.TBASE = window.TENANT_ID ? '/t/' + window.TENANT_ID : '';
  // Date helpers — Christian Era (ค.ศ.), DD/MM/YYYY, 24-hour HH:MM
  window.formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  };
  window.formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  };
  window.formatDateTime = (iso) => {
    if (!iso) return '';
    const d = window.formatDate(iso), t = window.formatTime(iso);
    return d && t ? d + ' ' + t : (d || t);
  };
  function shouldPrefix(href) {
    return href && href.startsWith('/')
      && !href.startsWith('/t/') && !href.startsWith('/super')
      && !href.startsWith('/styles') && !href.startsWith('/logo')
      && !href.startsWith('/i18n') && !href.startsWith('/favicon');
  }
  function rewriteLinks(root) {
    if (!window.TBASE || !root) return;
    // Self — handles addedNodes that ARE the <a> (e.g. innerHTML="<a>...</a>").
    // Only Element nodes have tagName; Document (nodeType 9) doesn't but still has querySelectorAll.
    if (root.nodeType === 1 && root.tagName === 'A' && shouldPrefix(root.getAttribute('href'))) {
      root.setAttribute('href', window.TBASE + root.getAttribute('href'));
    }
    // Descendants — both Document and Element expose querySelectorAll
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('a[href^="/"]').forEach(a => {
        const h = a.getAttribute('href');
        if (shouldPrefix(h)) a.setAttribute('href', window.TBASE + h);
      });
    }
  }
  window.rewriteLinks = rewriteLinks;
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.TBASE) return;
    rewriteLinks(document);
    // Catch links inserted later via innerHTML/appendChild
    new MutationObserver(muts => {
      for (const m of muts) {
        // m.target is the element whose children changed — re-scan its subtree
        rewriteLinks(m.target);
        // m.addedNodes are the new direct children — also scan each (handles self-A case)
        for (const node of m.addedNodes) rewriteLinks(node);
      }
    }).observe(document.body, { childList: true, subtree: true });
    // Show tenant company name in topbar (next to the HR-Interview brand)
    const logo = document.querySelector('.topbar .logo');
    if (logo && !document.getElementById('tenant-company-name')) {
      const span = document.createElement('span');
      span.id = 'tenant-company-name';
      span.style.cssText = 'color:#0369a1; font-size:14px; font-weight:600; margin-left:12px; padding-left:12px; border-left:1px solid #cbd5e1;';
      span.textContent = '...';
      logo.appendChild(span);
      fetch(window.TBASE + '/api/company').then(r => r.ok ? r.json() : null).then(c => {
        span.textContent = c && c.name ? c.name : '';
        if (!c || !c.name) span.style.display = 'none';
      }).catch(() => { span.style.display = 'none'; });
    }
  });
</script>`;

let totalChanged = 0;
for (const fname of FILES) {
  const file = path.join(PUB, fname);
  if (!fs.existsSync(file)) { console.log('  - SKIP (not found): ' + fname); continue; }
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  // 1) Remove any previously-injected TBASE snippet, then inject fresh one
  html = html.replace(/<script>\s*\/\/ Multi-tenant: derive[\s\S]*?<\/script>\s*/i, '');
  html = html.replace(/<\/head>/i, SNIPPET + '\n</head>');

  // 2) Rewrite fetch URLs
  //    fetch('/api/...')   → fetch(TBASE + '/api/...')
  //    fetch("/api/...")   → fetch(TBASE + "/api/...")
  //    fetch(`/api/...`)   → fetch(`${TBASE}/api/...`)
  html = html.replace(/\bfetch\(\s*'(\/api\/[^']*)'/g,  "fetch(TBASE + '$1'");
  html = html.replace(/\bfetch\(\s*"(\/api\/[^"]*)"/g,  'fetch(TBASE + "$1"');
  html = html.replace(/\bfetch\(\s*`(\/api\/[^`]*)`/g,  'fetch(`${TBASE}$1`');

  // 3) Rewrite location.href / location.replace targeting tenant pages
  //    Catches: '/login', '/admin', '/', '/interview?id=' + ..., etc.
  html = html.replace(/location\.href\s*=\s*'\/(?!t\/|super|api\/|styles|logo|i18n|favicon)([^']*)'/g,
                       "location.href = TBASE + '/$1'");
  html = html.replace(/location\.href\s*=\s*"\/(?!t\/|super|api\/|styles|logo|i18n|favicon)([^"]*)"/g,
                       'location.href = TBASE + "/$1"');
  // Template literals: location.href = `/review?id=${id}` → `${TBASE}/review?id=${id}`
  html = html.replace(/location\.href\s*=\s*`\/(?!t\/|super|api\/|styles|logo|i18n|favicon)([^`]*)`/g,
                       'location.href = `${TBASE}/$1`');

  if (html !== before) {
    fs.writeFileSync(file, html);
    totalChanged++;
    console.log('  ✓ ' + fname);
  } else {
    console.log('  - no changes: ' + fname);
  }
}

console.log(`\nDone. ${totalChanged}/${FILES.length} files updated.`);
