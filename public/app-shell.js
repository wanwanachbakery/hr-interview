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
      '/worklog-report': 'สรุปบันทึกงาน', '/dashboard': 'Dashboard Job', '/reports': 'รายงาน',
      '/profile': 'โปรไฟล์', '/interview': 'อินเทอร์วิว', '/review': 'เอกสาร', '/examples': 'ตัวอย่าง',
      '/manual': 'คู่มือการใช้งาน',
      '/admin': 'จัดการระบบ', '/admin/users': 'จัดการผู้ใช้', '/admin/org': 'จัดการองค์กร',
    };
    const title = TITLES[path] || (path.indexOf('/admin') === 0 ? 'จัดการระบบ' : '');

    // {href, label, ic, supervisor?: hide from officers, hideAdmin?: hide from admin}
    const NAV = [
      { href: '/', label: 'หน้าแรก', ic: '🏠' },
      { href: '/worklog', label: 'บันทึกงาน', ic: '📝', hideAdmin: true },
      { href: '/worklog-team', label: 'บันทึกงานทีม', ic: '👥', supervisor: true },
      { href: '/worklog-report', label: 'สรุปบันทึกงาน', ic: '📈', supervisor: true },
      { href: '/dashboard', label: 'Dashboard Job', ic: '📋' },
      { href: '/reports', label: 'รายงาน', ic: '📊' },
      { href: '/manual', label: 'คู่มือ', ic: '📖' },
    ];

    // Short "how to use this page" guidance shown at the top of each page.
    const HELP = {
      '/': 'หน้ารวมภาพรวมและทางลัดของคุณ — เลือกเมนูทางซ้ายเพื่อเข้าใช้งานแต่ละส่วน',
      '/worklog': 'บันทึกสิ่งที่ทำในแต่ละชั่วโมง: พิมพ์งาน เลือกหมวดหมู่ · กด “+ เพิ่มงานในชั่วโมงนี้” ถ้ามีหลายงานในชั่วโมงเดียว · ติ๊ก “งานประจำ” สำหรับงานที่ทำซ้ำทุกวัน · เสร็จแล้วกด “บันทึกงานวันนี้”',
      '/worklog-team': 'ดูบันทึกงานของลูกน้อง: เลือกชื่อพนักงานจากดรอปดาวน์ (พิมพ์เพื่อค้นหา) คัดกรองตามฝ่าย/แผนก และเลือกวันที่ที่ต้องการดู (ดูอย่างเดียว แก้ไม่ได้)',
      '/worklog-report': 'สรุปบันทึกงานของทีม: เลือกช่วงเวลา แล้วดูสัดส่วนเวลาที่ใช้แยกตามหมวดหมู่งาน และดูว่าใครบันทึกครบ/ไม่ครบ',
      '/dashboard': 'ดูสถานะการสัมภาษณ์ของแต่ละตำแหน่ง · ผู้ครองที่ “เสร็จ” แล้วกด “ดูเอกสาร” ได้ · กด “วิเคราะห์ภาพรวมบริษัท” เพื่อสร้างรายงานรวม · ปุ่ม “รีเซ็ต” (เฉพาะแอดมิน) ล้างคำตอบกลับเป็น “ยังไม่ตอบ” โดยไม่ลบพนักงาน',
      '/reports': 'สรุปจำนวนผู้ใช้และฝ่าย พร้อมรายชื่อทั้งหมด — ค้นหาด้วยชื่อ/username และคัดกรองตามบทบาท/ฝ่าย/แผนกได้',
      '/manual': 'คู่มือการใช้งานทั้งหมด — สลับแท็บ “ฉบับเต็ม / ตามบทบาท” ใช้สารบัญด้านข้างกระโดดไปแต่ละหัวข้อ หรือกด “ดาวน์โหลด PDF” เพื่อบันทึก/ส่งต่อ',
      '/profile': 'ดูข้อมูลส่วนตัวของคุณ และเปลี่ยนรหัสผ่านได้ที่หน้านี้',
      '/interview': 'ตอบคำถามการทำงานประจำวันตามช่วงเวลา · เมื่อตอบครบกด “เสร็จสิ้น” ระบบจะสร้างเอกสารให้ (เลือกดึงบันทึกงานย้อนหลัง 1/2/3 เดือนมาช่วยวิเคราะห์ได้)',
      '/review': 'เอกสาร 6 ฉบับที่ระบบสร้างจากการสัมภาษณ์ — กดแถบสารบัญด้านบนเพื่อข้ามไปแต่ละฉบับ หรือกด “เปิดไฟล์” เพื่อดาวน์โหลด',
      '/admin': 'ศูนย์จัดการระบบ — โครงสร้างองค์กร · ผู้ใช้ · รหัสแอดมิน · ตั้งค่า Claude AI · ลบข้อมูล (Danger Zone) · ข้อมูลโดยสรุป',
      '/admin/users': 'เพิ่ม/แก้ไข/ลบผู้ใช้ และกำหนดบทบาท + ฝ่าย/แผนก/ตำแหน่ง · นำเข้าจำนวนมากด้วยไฟล์ Excel ได้',
      '/admin/org': 'สร้างโครงสร้างองค์กรจากบนลงล่าง: ฝ่าย → แผนก → ตำแหน่ง',
    };
    function helpFor(p) {
      if (HELP[p]) return HELP[p];
      if (p.indexOf('/admin') === 0) return HELP['/admin'];
      return '';
    }

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

    // Contextual help: a collapsible "วิธีใช้หน้านี้" box at the top of the page.
    (function mountHelp() {
      const txt = helpFor(path);
      if (!txt) return;
      if (!document.getElementById('appHelpStyle')) {
        const st = document.createElement('style');
        st.id = 'appHelpStyle';
        st.textContent =
          '.app-help{background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin-bottom:16px;overflow:hidden}' +
          '.app-help-head{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;color:#0c4a6e;font-weight:600;font-size:14px;padding:11px 14px;cursor:pointer;text-align:left}' +
          '.app-help-head:hover{background:#e0f2fe}' +
          '.app-help-head .chev{margin-left:auto;transition:transform .2s;font-size:12px}' +
          '.app-help.collapsed .chev{transform:rotate(-90deg)}' +
          '.app-help-body{padding:2px 16px 14px 40px;color:#334155;font-size:13.5px;line-height:1.65}' +
          '.app-help.collapsed .app-help-body{display:none}';
        document.head.appendChild(st);
      }
      const collapsed = localStorage.getItem('wwnHelpCollapsed') === '1';
      const box = document.createElement('div');
      box.className = 'app-help' + (collapsed ? ' collapsed' : '');
      box.innerHTML =
        '<button class="app-help-head" type="button">' +
          '<span>💡</span><span>วิธีใช้หน้านี้</span><span class="chev">▾</span>' +
        '</button>' +
        '<div class="app-help-body">' + esc(txt) + '</div>';
      container.insertBefore(box, container.firstChild);     // top of the centered content
      box.querySelector('.app-help-head').addEventListener('click', () => {
        box.classList.toggle('collapsed');
        localStorage.setItem('wwnHelpCollapsed', box.classList.contains('collapsed') ? '1' : '0');
      });
    })();

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
