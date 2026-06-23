/* app-shell.js — wraps every tenant page in a left-sidebar + slim-topbar layout.
 * Self-guarding: only runs on tenant pages (TBASE set) that have a <div.container>
 * with a <div.topbar>. The old topbar is HIDDEN (not removed) so page scripts that
 * reference its elements keep working. Nav items are role-gated.
 */
(function () {
  document.addEventListener('DOMContentLoaded', () => { try { build(); } catch (e) { /* leave page as-is */ } });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function build() {
    const TB = window.TBASE;
    if (!TB) return;                                   // not a tenant page (super/login at root)
    const container = document.querySelector('body > .container');
    if (!container) return;
    const oldTopbar = container.querySelector(':scope > .topbar');
    if (!oldTopbar) return;                             // e.g. login page — skip

    const path = (location.pathname.replace(TB, '') || '/') || '/';

    const TITLES = {
      '/': 'หน้าแรก', '/worklog': 'บันทึกงานประจำวัน', '/worklog-team': 'บันทึกงานของทีม',
      '/worklog-report': 'สรุปบันทึกงาน', '/dashboard': 'Dashboard', '/reports': 'รายงาน',
      '/profile': 'โปรไฟล์', '/interview': 'อินเทอร์วิว', '/review': 'เอกสาร', '/examples': 'ตัวอย่าง',
      '/admin': 'จัดการระบบ', '/admin/users': 'จัดการผู้ใช้', '/admin/org': 'จัดการองค์กร',
    };
    const title = TITLES[path] || (path.indexOf('/admin') === 0 ? 'จัดการระบบ' : '');

    // {href, label, ic, supervisor?: hide from officers, hideAdmin?: hide from admin}
    const NAV = [
      { href: '/', label: 'หน้าแรก', ic: '🏠' },
      { href: '/worklog', label: 'บันทึกงาน', ic: '📝', hideAdmin: true },
      { href: '/worklog-team', label: 'บันทึกงานทีม', ic: '👥', supervisor: true },
      { href: '/worklog-report', label: 'สรุปบันทึกงาน', ic: '📈', supervisor: true },
      { href: '/dashboard', label: 'Dashboard', ic: '📋' },
      { href: '/reports', label: 'รายงาน', ic: '📊' },
    ];

    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.innerHTML =
      '<aside class="app-sidebar" id="appSidebar">' +
        '<div class="app-brand">HR-Interview<span class="app-co" id="appCo">&nbsp;</span></div>' +
        '<nav class="app-nav" id="appNav"></nav>' +
        '<div class="app-nav-foot" id="appFoot"></div>' +
      '</aside>' +
      '<div class="app-backdrop" id="appBackdrop"></div>' +
      '<div class="app-main">' +
        '<header class="app-topbar">' +
          '<button class="app-burger" id="appBurger" aria-label="เมนู">☰</button>' +
          '<span class="app-title">' + esc(title) + '</span>' +
          '<div class="app-topbar-right" id="appTopRight">' +
            '<a class="app-top-link" id="appProfile" href="' + TB + '/profile">👤 โปรไฟล์</a>' +
            '<a class="app-top-link danger" id="appLogout" href="#">ออกจากระบบ</a>' +
          '</div>' +
        '</header>' +
        '<div class="app-content" id="appContent"></div>' +
      '</div>';

    document.body.insertBefore(shell, container);
    oldTopbar.style.display = 'none';                   // keep in DOM (page JS may reference it)
    document.getElementById('appContent').appendChild(container);

    // Preserve the language switcher (if a page mounted one in the old topbar)
    const ls = document.getElementById('lang-switcher');
    if (ls) {
      document.getElementById('appTopRight').insertBefore(ls, document.getElementById('appProfile'));
      if (window.I18N && typeof window.I18N.mountSwitcher === 'function') { try { window.I18N.mountSwitcher(); } catch (_) {} }
    }

    function renderNav(role) {
      const isSup = role && role !== 'officer';
      const items = NAV.filter(it => !(it.hideAdmin && role === 'admin') && !(it.supervisor && !isSup));
      document.getElementById('appNav').innerHTML = items.map(it => {
        const active = (it.href === '/' ? path === '/' : path === it.href) ? ' active' : '';
        return '<a class="app-nav-item' + active + '" href="' + TB + it.href + '"><span class="ic">' + it.ic + '</span>' + esc(it.label) + '</a>';
      }).join('');
      document.getElementById('appFoot').innerHTML = (role === 'admin')
        ? '<a class="app-nav-item' + (path.indexOf('/admin') === 0 ? ' active' : '') + '" href="' + TB + '/admin"><span class="ic">🔐</span>Admin</a>'
        : '';
      const prof = document.getElementById('appProfile');
      if (prof) prof.style.display = (role === 'admin') ? 'none' : '';
    }
    renderNav(null);                                    // optimistic; refine once role is known
    fetch(TB + '/api/me').then(r => r.json()).then(me => renderNav(me && me.role)).catch(() => {});
    fetch(TB + '/api/company').then(r => r.ok ? r.json() : null).then(c => {
      const el = document.getElementById('appCo'); if (el) el.textContent = (c && c.name) || '';
    }).catch(() => {});

    document.getElementById('appLogout').addEventListener('click', async (e) => {
      e.preventDefault();
      try { await fetch(TB + '/api/logout', { method: 'POST' }); } catch (_) {}
      location.href = TB + '/login';
    });

    const aside = document.getElementById('appSidebar');
    const backdrop = document.getElementById('appBackdrop');
    document.getElementById('appBurger').addEventListener('click', () => { aside.classList.toggle('open'); backdrop.classList.toggle('show'); });
    backdrop.addEventListener('click', () => { aside.classList.remove('open'); backdrop.classList.remove('show'); });
  }
})();
