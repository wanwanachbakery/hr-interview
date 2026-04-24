/**
 * i18n.js — shared UI translation + language switcher for all pages.
 *
 * Usage in HTML:
 *   <script src="/i18n.js"></script>
 *   ...in markup, add data-i18n="key" on any element whose textContent should be translated.
 *   Placeholder text: data-i18n-placeholder="key"
 *   Attribute (title etc): data-i18n-attr="attr:key"
 *
 * The switcher auto-mounts into any element with id="lang-switcher".
 * Call I18N.apply() after dynamically adding new data-i18n elements.
 *
 * Output documents are always Thai (per product decision); this file only
 * translates the UI + questions.
 */
(function () {
  const DICT = {
    th: {
      nav_home: 'หน้าแรก',
      nav_examples: '📘 ตัวอย่าง',
      nav_dashboard: 'Dashboard',
      nav_admin: '🔐 Admin',
      nav_logout: 'ออกจากระบบ',
      nav_logout_short: 'ออก',
      brand: '🤖 AI Interviewer',

      // login
      login_heading: '🔐 เข้าสู่ระบบ',
      login_sub: 'ใช้รหัสของฝ่ายคุณเอง หรือรหัส admin เพื่อเข้าดูทุกอย่าง',
      login_password: 'รหัสผ่าน',
      login_submit: 'เข้าสู่ระบบ →',
      login_hint: 'ถ้าไม่รู้รหัสของฝ่าย ติดต่อ admin หรือผู้จัดการแผนก',
      login_err: 'รหัสไม่ถูกต้อง',
      login_app_sub: 'ระบบอินเทอร์วิวพนักงาน — JIANCHA',

      // index (divisions)
      index_h1: 'เลือกฝ่ายที่ต้องการอินเทอร์วิว',
      index_sub: 'คลิกที่ฝ่ายเพื่อเข้าไปดู/เพิ่มพนักงานในฝ่ายนั้น — แต่ละฝ่ายมีแผนกย่อยและตำแหน่งต่าง ๆ ได้',
      index_examples_title: '📘 ยังไม่เคยใช้? ดูตัวอย่างก่อน',
      index_examples_sub: 'ตัวอย่างการตอบคำถาม + checklist ที่ควรเตรียม — ช่วยให้พนักงานตอบได้ชัดเจน ไม่กรอกข้อมูลผิด',
      index_examples_btn: 'ดูตัวอย่าง →',
      index_add_div_h2: '➕ เพิ่มฝ่ายใหม่',
      index_add_div_sub: 'ถ้าฝ่ายในองค์กรของคุณไม่ตรงกับตัวอย่างด้านบน เพิ่มเองได้',
      label_div_name_th: 'ชื่อฝ่าย (ไทย) *',
      label_div_name_en: 'ชื่อฝ่าย (อังกฤษ)',
      label_div_icon: 'Icon (emoji)',
      label_div_color: 'สี (hex)',
      btn_add_div: 'เพิ่มฝ่าย',

      // interview
      iv_start_title: 'ก่อนเริ่ม — เลือกเวลาทำงานของคุณ',
      iv_start_sub: 'เวลาที่คุณเลือกจะใช้กำหนดคำถามรายชั่วโมง (ข้ามพักเที่ยงอัตโนมัติ)',
      iv_start_btn: 'เริ่มอินเทอร์วิว →',
      iv_progress_tpl: '{answered} / {total} คำถาม',
      iv_hint: 'กด Enter เพื่อส่ง / Shift+Enter เพื่อขึ้นบรรทัดใหม่',
      iv_skip: 'ข้าม →',
      iv_submit: 'ส่งคำตอบ',
      iv_done_h2: '🎉 อินเทอร์วิวเสร็จสิ้น',
      iv_done_sub: 'กดปุ่มด้านล่างเพื่อสร้างเอกสาร 6 ชุด (Workflow / Table / Diagram / JD / KPI / Optimization)',
      iv_done_btn: 'สร้างเอกสาร →',
      iv_done_generating: 'กำลังสร้าง...',
      iv_placeholder: 'พิมพ์คำตอบที่นี่...',
      iv_done_msg: 'ขอบคุณครับ! อินเทอร์วิวเสร็จแล้ว กดปุ่มด้านล่างเพื่อสร้างเอกสาร',
      iv_error: 'เกิดข้อผิดพลาด',

      // review
      rv_heading_tpl: 'ผลอินเทอร์วิว — {name}',
      rv_files_h2: 'เอกสารที่สร้างจากอินเทอร์วิว',
      rv_files_sub: 'ดาวน์โหลดหรือเปิดดูได้เลย (ไฟล์เก็บใน outputs/<id>/)',
      rv_col_file: 'ไฟล์',
      rv_col_desc: 'คำอธิบาย',
      rv_open: 'เปิด',
      rv_answers_h2: 'สรุปคำตอบทั้งหมด',
      rv_back: '← กลับหน้าแรก',
      rv_to_dashboard: 'ไป Dashboard →',

      // dashboard
      dash_h1: 'Dashboard ภาพรวมบริษัท',
      dash_sub: 'พนักงานทุกคน จัดตามฝ่าย · ใช้วิเคราะห์ภาพรวมและหาจุดปรับปรุง',
      dash_summary_divs: 'ฝ่าย',
      dash_summary_emps: 'พนักงาน',
      dash_summary_done: 'อินเทอร์วิวเสร็จ',
      dash_analyze: '🔍 วิเคราะห์ภาพรวมบริษัท',
      dash_analyzing: 'กำลังวิเคราะห์...',
      dash_open_report: '📄 เปิดรายงาน (.md)',
      dash_report_h2: 'รายงาน Optimization ล่าสุด',
      dash_no_report: 'ยังไม่มีรายงาน — กดปุ่ม "วิเคราะห์ภาพรวมบริษัท" ข้างบน',

      // division page
      div_back: '← กลับทุกฝ่าย',
      div_emps_h2: 'พนักงานในฝ่ายนี้',
      div_add_emp_h2: '➕ เพิ่มพนักงานในฝ่ายนี้',
      label_emp_name: 'ชื่อ-นามสกุล *',
      label_emp_email: 'อีเมล (ไม่บังคับ)',
      label_emp_role: 'ตำแหน่ง *',
      label_emp_subdept: 'แผนกย่อย (ถ้ามี)',
      label_emp_duty: 'หน้าที่หลัก',
      btn_add_emp_start: 'เพิ่ม + เริ่มอินเทอร์วิวเลย →',

      // common
      status_done: 'เสร็จแล้ว',
      status_in_progress: 'กำลังทำ',
      status_not_started: 'ยังไม่เริ่ม',
      loading: 'กำลังโหลด...',
      empty_no_data: 'ไม่มีข้อมูล',

      // calendar
      cal_title: 'ปฏิทินการสัมภาษณ์',
      cal_sub: 'วันที่มีดอท = มีพนักงานสัมภาษณ์เสร็จในวันนั้น · คลิกเพื่อดูชื่อ',
      cal_today: 'วันนี้',
      cal_prev: '‹ เดือนก่อน',
      cal_next: 'เดือนถัดไป ›',
      cal_scope_mine: 'เฉพาะฝ่ายนี้',
      cal_scope_all: 'ทุกฝ่าย',
      cal_count_unit: '{n} คน',
      cal_no_day: 'ยังไม่เริ่มสัมภาษณ์ในวันนี้',
      cal_selected_header: 'วันที่ {date}',
      cal_legend_done: 'เสร็จ',
      cal_legend_started: 'เริ่มแล้ว (ยังไม่เสร็จ)',
      cal_view_result: 'ดูผล',
    },
    en: {
      nav_home: 'Home',
      nav_examples: '📘 Examples',
      nav_dashboard: 'Dashboard',
      nav_admin: '🔐 Admin',
      nav_logout: 'Log out',
      nav_logout_short: 'Logout',
      brand: '🤖 AI Interviewer',

      login_heading: '🔐 Sign in',
      login_sub: 'Use your division password, or the admin password to see everything.',
      login_password: 'Password',
      login_submit: 'Sign in →',
      login_hint: 'If you do not know your division password, contact admin or your manager.',
      login_err: 'Invalid password',
      login_app_sub: 'Employee interview system — JIANCHA',

      index_h1: 'Pick a division to interview',
      index_sub: 'Click a division to view/add employees. Each division can have sub-departments and different roles.',
      index_examples_title: '📘 First time? See examples',
      index_examples_sub: 'Example answers + checklist — helps employees answer clearly without mistakes.',
      index_examples_btn: 'See examples →',
      index_add_div_h2: '➕ Add a new division',
      index_add_div_sub: 'If your division is not listed above, add it here.',
      label_div_name_th: 'Division name (TH) *',
      label_div_name_en: 'Division name (EN)',
      label_div_icon: 'Icon (emoji)',
      label_div_color: 'Color (hex)',
      btn_add_div: 'Add division',

      iv_start_title: 'Before we start — pick your work schedule',
      iv_start_sub: 'This sets the hourly questions (lunch is skipped automatically).',
      iv_start_btn: 'Start interview →',
      iv_progress_tpl: '{answered} / {total} questions',
      iv_hint: 'Press Enter to send / Shift+Enter for a new line',
      iv_skip: 'Skip →',
      iv_submit: 'Send',
      iv_done_h2: '🎉 Interview complete',
      iv_done_sub: 'Click below to generate 6 documents (Workflow / Table / Diagram / JD / KPI / Optimization)',
      iv_done_btn: 'Generate documents →',
      iv_done_generating: 'Generating...',
      iv_placeholder: 'Type your answer here...',
      iv_done_msg: 'Thank you! The interview is complete. Click below to generate documents.',
      iv_error: 'Error',

      rv_heading_tpl: 'Interview result — {name}',
      rv_files_h2: 'Generated documents',
      rv_files_sub: 'Download or view (saved in outputs/<id>/). Note: output files are in Thai.',
      rv_col_file: 'File',
      rv_col_desc: 'Description',
      rv_open: 'Open',
      rv_answers_h2: 'All answers',
      rv_back: '← Back to home',
      rv_to_dashboard: 'Go to Dashboard →',

      dash_h1: 'Company-wide dashboard',
      dash_sub: 'All employees grouped by division — for company-wide optimization analysis.',
      dash_summary_divs: 'divisions',
      dash_summary_emps: 'employees',
      dash_summary_done: 'interviewed',
      dash_analyze: '🔍 Analyze company-wide',
      dash_analyzing: 'Analyzing...',
      dash_open_report: '📄 Open report (.md)',
      dash_report_h2: 'Latest optimization report',
      dash_no_report: 'No report yet — click "Analyze company-wide" above',

      div_back: '← Back to all divisions',
      div_emps_h2: 'Employees in this division',
      div_add_emp_h2: '➕ Add employee to this division',
      label_emp_name: 'Full name *',
      label_emp_email: 'Email (optional)',
      label_emp_role: 'Role *',
      label_emp_subdept: 'Sub-department (if any)',
      label_emp_duty: 'Primary duty',
      btn_add_emp_start: 'Add + start interview →',

      status_done: 'Done',
      status_in_progress: 'In progress',
      status_not_started: 'Not started',
      loading: 'Loading...',
      empty_no_data: 'No data',

      cal_title: 'Interview calendar',
      cal_sub: 'A dot on a date = someone completed an interview that day · click to see names',
      cal_today: 'Today',
      cal_prev: '‹ Prev',
      cal_next: 'Next ›',
      cal_scope_mine: 'This division only',
      cal_scope_all: 'All divisions',
      cal_count_unit: '{n}',
      cal_no_day: 'No interviews on this day',
      cal_selected_header: '{date}',
      cal_legend_done: 'Completed',
      cal_legend_started: 'Started (not finished)',
      cal_view_result: 'View result',
    },
    cn: {
      nav_home: '首页',
      nav_examples: '📘 示例',
      nav_dashboard: '仪表盘',
      nav_admin: '🔐 管理',
      nav_logout: '退出登录',
      nav_logout_short: '退出',
      brand: '🤖 AI 访谈',

      login_heading: '🔐 登录',
      login_sub: '使用您部门的密码，或管理员密码查看全部内容。',
      login_password: '密码',
      login_submit: '登录 →',
      login_hint: '如不知道部门密码，请联系管理员或您的主管。',
      login_err: '密码错误',
      login_app_sub: '员工访谈系统 — JIANCHA',

      index_h1: '选择要访谈的部门',
      index_sub: '点击部门可查看或添加员工。每个部门可包含子部门和不同的职位。',
      index_examples_title: '📘 第一次使用？先看示例',
      index_examples_sub: '示例答案和准备清单 — 帮助员工清晰作答，避免出错。',
      index_examples_btn: '查看示例 →',
      index_add_div_h2: '➕ 添加新部门',
      index_add_div_sub: '如果您的部门不在上方列表中，可以在此添加。',
      label_div_name_th: '部门名称（泰语）*',
      label_div_name_en: '部门名称（英文）',
      label_div_icon: '图标（emoji）',
      label_div_color: '颜色 (hex)',
      btn_add_div: '添加部门',

      iv_start_title: '开始之前 — 请选择您的工作时间',
      iv_start_sub: '该设置决定每小时的访谈问题（自动跳过午休时段）。',
      iv_start_btn: '开始访谈 →',
      iv_progress_tpl: '{answered} / {total} 题',
      iv_hint: '按 Enter 发送 / Shift+Enter 换行',
      iv_skip: '跳过 →',
      iv_submit: '发送',
      iv_done_h2: '🎉 访谈完成',
      iv_done_sub: '点击下方按钮生成6份文档（工作流/表格/流程图/JD/KPI/优化建议）',
      iv_done_btn: '生成文档 →',
      iv_done_generating: '生成中...',
      iv_placeholder: '在此输入您的答案...',
      iv_done_msg: '谢谢！访谈已完成。点击下方按钮生成文档。',
      iv_error: '出错了',

      rv_heading_tpl: '访谈结果 — {name}',
      rv_files_h2: '生成的文档',
      rv_files_sub: '可下载或在线查看（保存于 outputs/<id>/）。注：输出文件为泰语。',
      rv_col_file: '文件',
      rv_col_desc: '说明',
      rv_open: '打开',
      rv_answers_h2: '所有答案',
      rv_back: '← 返回首页',
      rv_to_dashboard: '进入仪表盘 →',

      dash_h1: '公司整体仪表盘',
      dash_sub: '按部门查看所有员工 — 用于整体优化分析。',
      dash_summary_divs: '部门',
      dash_summary_emps: '员工',
      dash_summary_done: '已完成访谈',
      dash_analyze: '🔍 公司整体分析',
      dash_analyzing: '分析中...',
      dash_open_report: '📄 打开报告 (.md)',
      dash_report_h2: '最新优化报告',
      dash_no_report: '尚无报告 — 请点击上方"公司整体分析"按钮',

      div_back: '← 返回所有部门',
      div_emps_h2: '本部门员工',
      div_add_emp_h2: '➕ 向本部门添加员工',
      label_emp_name: '姓名 *',
      label_emp_email: '邮箱（选填）',
      label_emp_role: '职位 *',
      label_emp_subdept: '子部门（如有）',
      label_emp_duty: '主要职责',
      btn_add_emp_start: '添加并开始访谈 →',

      status_done: '已完成',
      status_in_progress: '进行中',
      status_not_started: '未开始',
      loading: '加载中...',
      empty_no_data: '暂无数据',

      cal_title: '访谈日历',
      cal_sub: '带圆点的日期 = 当日有员工完成访谈 · 点击查看姓名',
      cal_today: '今天',
      cal_prev: '‹ 上月',
      cal_next: '下月 ›',
      cal_scope_mine: '仅本部门',
      cal_scope_all: '所有部门',
      cal_count_unit: '{n} 人',
      cal_no_day: '今日暂无访谈',
      cal_selected_header: '{date}',
      cal_legend_done: '已完成',
      cal_legend_started: '进行中',
      cal_view_result: '查看结果',
    },
  };

  function readCookie(name) {
    const raw = document.cookie || '';
    const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getLang() {
    const stored = localStorage.getItem('lang') || readCookie('lang');
    return ['th', 'en', 'cn'].includes(stored) ? stored : 'th';
  }

  function setLang(lang) {
    if (!['th', 'en', 'cn'].includes(lang)) return;
    localStorage.setItem('lang', lang);
    document.cookie = `lang=${lang}; Path=/; SameSite=Lax; Max-Age=${180*24*3600}`;
    fetch('/api/lang', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).catch(() => {});
    apply();
    document.documentElement.lang = lang === 'cn' ? 'zh' : lang;
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function t(key, vars) {
    const lang = getLang();
    let s = (DICT[lang] && DICT[lang][key]) || DICT.th[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      }
    }
    return s;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const spec = el.getAttribute('data-i18n-attr');
      const [attr, key] = spec.split(':');
      if (attr && key) el.setAttribute(attr, t(key));
    });
  }

  function mountSwitcher() {
    const holder = document.getElementById('lang-switcher');
    if (!holder) return;
    const cur = getLang();
    holder.innerHTML = '';
    holder.className = 'lang-switcher';
    const opts = [
      { v: 'th', t: 'TH' },
      { v: 'en', t: 'EN' },
      { v: 'cn', t: '中' },
    ];
    for (const o of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.t;
      b.className = 'lang-btn' + (cur === o.v ? ' active' : '');
      b.addEventListener('click', () => setLang(o.v));
      holder.appendChild(b);
    }
  }

  function init() {
    document.documentElement.lang = getLang() === 'cn' ? 'zh' : getLang();
    apply();
    mountSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.I18N = { t, apply, setLang, getLang, mountSwitcher };
})();
