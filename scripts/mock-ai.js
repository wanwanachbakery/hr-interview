/**
 * mock-ai.js
 *
 * Simulates an AI interviewer + document generator.
 * Later this module can be swapped for real Claude API calls without
 * changing the server or frontend.
 *
 * Exports:
 *   getNextQuestion(interview)   -> { key, text, done }
 *   shouldProbe(answer, lang)    -> string | null
 *   generateDocuments(interview) -> { [filename]: content }   (output: Thai only)
 *   analyzeCompany(interviews)   -> markdown string           (output: Thai only)
 *   listSchedules(lang)          -> [{id, label}]  // for UI
 */

const pad = (n) => String(n).padStart(2, '0');

// Format a date as DD/MM/YYYY HH:MM in Christian Era (ค.ศ.), not Buddhist Era.
// Used in generated document headers so dates match the rest of the app.
function fmtDateTime(input) {
  const d = input ? new Date(input) : new Date();
  if (isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// 0) Schedules
// ============================================================
// Each schedule: workStart..workEnd, lunchStart..lunchEnd (exclusive bound = workEnd).
// Questions are 1-hour blocks, lunch block is skipped.
const SCHEDULES = {
  '09-18': { start: 9,  end: 18, lunch: 12 },  // 09:00-18:00, lunch 12-13
  '10-19': { start: 10, end: 19, lunch: 13 },  // 10:00-19:00, lunch 13-14
};

function listSchedules(lang = 'th') {
  const label = {
    th: (s) => `${pad(s.start)}:00–${pad(s.end)}:00  (พัก ${pad(s.lunch)}:00–${pad(s.lunch+1)}:00)`,
    en: (s) => `${pad(s.start)}:00–${pad(s.end)}:00  (lunch ${pad(s.lunch)}:00–${pad(s.lunch+1)}:00)`,
    cn: (s) => `${pad(s.start)}:00–${pad(s.end)}:00  (午休 ${pad(s.lunch)}:00–${pad(s.lunch+1)}:00)`,
  };
  const fn = label[lang] || label.th;
  return Object.entries(SCHEDULES).map(([id, s]) => ({ id, label: fn(s) }));
}

function scheduleHours(scheduleId) {
  const s = SCHEDULES[scheduleId] || SCHEDULES['09-18'];
  const hours = [];
  for (let h = s.start; h < s.end; h++) {
    if (h === s.lunch) continue;
    hours.push(h);
  }
  return hours;
}

// ============================================================
// 1) Question sets (intro + hourly + shared tail + per-division)
// ============================================================
// Each question: { key, category, text: { th, en, cn } }
// The HOUR question uses a function so it can interpolate the hour.

const INTRO_QUESTIONS = [
  {
    key: 'warmup',
    category: 'intro',
    text: {
      th: 'สวัสดีครับ! ผมเป็น AI ที่จะช่วยรวบรวมข้อมูลการทำงานประจำวันของคุณ ใช้เวลาประมาณ 15–20 นาที — เริ่มจากคำถามง่าย ๆ ก่อน: ช่วยอธิบายบทบาทหลักของคุณสั้น ๆ (1–2 ประโยค) ได้ไหม?',
      en: 'Hi! I am an AI that will help capture your daily workflow. It takes about 15–20 minutes — to start: could you briefly describe your main role in 1–2 sentences?',
      cn: '您好！我是帮助记录您日常工作流程的AI，大约需要15–20分钟。先请用1–2句话简单介绍您的主要职责。',
    },
  },
];

const HOUR_QUESTION = {
  category: 'timeblock',
  text: {
    th: (h) => `ช่วง ${pad(h)}:00–${pad(h+1)}:00 ปกติคุณทำอะไรบ้าง? ใช้เครื่องมือ/ระบบอะไร และประสานงานกับใคร?`,
    en: (h) => `Between ${pad(h)}:00–${pad(h+1)}:00, what do you usually do? What tools/systems do you use, and who do you work with?`,
    cn: (h) => `${pad(h)}:00–${pad(h+1)}:00时段，您通常做什么？使用什么工具？与谁协作？`,
  },
};

const SHARED_TAIL = [
  {
    key: 'weekly_tasks',
    category: 'weekly',
    text: {
      th: 'มีงานที่ทำเฉพาะบางวันของสัปดาห์ หรือรายเดือน/รายไตรมาสมั้ย? เช่น ประชุมทีมทุกจันทร์, ปิดยอดสิ้นเดือน',
      en: 'Any tasks you only do on specific weekdays / monthly / quarterly? (e.g., Monday team meeting, month-end closing)',
      cn: '是否有每周特定几天、每月或每季度才做的工作？（例如：周一例会、月末结账）',
    },
  },
  {
    key: 'pain_points',
    category: 'problem',
    text: {
      th: 'งานไหนรู้สึกเสียเวลาที่สุด / น่าเบื่อที่สุด / ทำซ้ำบ่อยเกินไป? ทำไมถึงช้า?',
      en: 'Which task feels the most time-wasting / most tedious / most repetitive? Why is it slow?',
      cn: '哪项工作最浪费时间、最繁琐或最重复？为什么慢？',
    },
  },
  {
    key: 'bottlenecks',
    category: 'problem',
    text: {
      th: 'รออะไรจากคนอื่น/ระบบอื่น แล้วทำให้ทำงานต่อไม่ได้บ้างมั้ย? (bottleneck)',
      en: 'Is there anything you wait on from other people/systems that blocks your work? (bottlenecks)',
      cn: '是否需要等待他人或其他系统，导致您无法继续工作？（瓶颈）',
    },
  },
  {
    key: 'own_kpi',
    category: 'kpi',
    text: {
      th: 'ถ้าจะวัดว่าคุณทำงานได้ดีในแต่ละวัน คุณคิดว่าควรวัดจากอะไร? (ไม่ต้องเป็นศัพท์ทางการ)',
      en: 'How would you measure whether you did a good job each day? (in your own words)',
      cn: '您认为应该用什么来衡量您每天工作的好坏？（不必是正式术语）',
    },
  },
  {
    key: 'ai_wishlist',
    category: 'ai',
    text: {
      th: 'ถ้ามี AI มาช่วย คุณอยากให้ AI ทำงานอะไรแทนคุณมากที่สุด?',
      en: 'If AI could help, what task would you most want AI to take off your plate?',
      cn: '如果有AI帮忙，您最希望AI替您做什么工作？',
    },
  },
];

const DIVISION_QUESTIONS = {
  hr: [
    { key: 'div_hr_focus',  category: 'division', text: {
      th: 'คุณดูแลงาน HR ด้านไหนเป็นหลัก? (สรรหา / Payroll / OD / Training / ER / อื่นๆ)',
      en: 'Which HR function do you primarily handle? (Recruitment / Payroll / OD / Training / ER / Other)',
      cn: '您主要负责哪方面的HR工作？（招聘/薪资/组织发展/培训/员工关系/其他）',
    }},
    { key: 'div_hr_system', category: 'division', text: {
      th: 'ใช้ระบบ HR อะไร? (เช่น HRIS, ATS, Excel, Google Sheets) และมีข้อมูลอะไรที่ยังต้องทำมือ?',
      en: 'What HR systems do you use (HRIS, ATS, Excel, Sheets)? What still has to be done manually?',
      cn: '使用什么HR系统？（HRIS/ATS/Excel/Sheets）还有哪些数据需要手动处理？',
    }},
    { key: 'div_hr_scale',  category: 'division', text: {
      th: 'ดูแลพนักงาน/สาขา จำนวนเท่าไร? มี deadline เกี่ยวกับเงินเดือน/ภาษีบุคคลอะไรที่สำคัญ?',
      en: 'How many employees/branches do you handle? Any critical payroll / personal-tax deadlines?',
      cn: '您负责多少员工/门店？有哪些重要的工资/个税截止日期？',
    }},
  ],
  accounting: [
    { key: 'div_acc_scope', category: 'division', text: {
      th: 'ด้านไหนเป็นหลัก? (AR / AP / GL / ภาษี / ปิดงบ / ต้นทุน / อื่นๆ)',
      en: 'Which area is your focus? (AR / AP / GL / Tax / Closing / Costing / Other)',
      cn: '主要负责哪方面？（应收/应付/总账/税务/结账/成本/其他）',
    }},
    { key: 'div_acc_system', category: 'division', text: {
      th: 'ใช้ระบบบัญชี/ERP อะไร? (เช่น Business Central, SAP, Xero, Express) และมี integration กับระบบอื่นมั้ย?',
      en: 'Which accounting/ERP system? (BC, SAP, Xero, Express…) Integrations with other systems?',
      cn: '使用什么会计/ERP系统？（BC/SAP/Xero等）是否与其他系统集成？',
    }},
    { key: 'div_acc_cycle', category: 'division', text: {
      th: 'รอบการปิดงบและ deadline ภาษี (ภพ.30, ภงด) เป็นยังไง? ช่วงไหนงานหนักที่สุด?',
      en: 'Closing cycle and tax deadlines (VAT, WHT)? When is your heaviest workload?',
      cn: '结账周期和税务截止日期（VAT、预扣税）如何？什么时候工作最繁重？',
    }},
  ],
  marketing: [
    { key: 'div_mkt_scope', category: 'division', text: {
      th: 'ด้านไหนเป็นหลัก? (Digital / Offline / Content / Brand / PR / Performance)',
      en: 'Your focus area? (Digital / Offline / Content / Brand / PR / Performance)',
      cn: '主要方向？（数字/线下/内容/品牌/公关/效果营销）',
    }},
    { key: 'div_mkt_channel', category: 'division', text: {
      th: 'Channel หลักที่รับผิดชอบคืออะไร? (Facebook, TikTok, Line OA, หน้าร้าน) และ budget ต่อเดือนประมาณเท่าไร?',
      en: 'Primary channels you manage? (Facebook, TikTok, Line OA, in-store) Monthly budget?',
      cn: '您负责的主要渠道？（Facebook/TikTok/Line OA/门店）月度预算大约多少？',
    }},
    { key: 'div_mkt_kpi', category: 'division', text: {
      th: 'Campaign เฉลี่ยทำกี่ครั้งต่อเดือน? วัดความสำเร็จจาก metric อะไร (impression, lead, sales, CAC)?',
      en: 'How many campaigns per month? Which metrics measure success (impressions, leads, sales, CAC)?',
      cn: '平均每月多少个活动？用什么指标衡量成功（曝光/线索/销售/CAC）？',
    }},
  ],
  scm: [
    { key: 'div_scm_scope', category: 'division', text: {
      th: 'ด้านไหนเป็นหลัก? (จัดซื้อ / Inventory / Logistics / Vendor management)',
      en: 'Your focus? (Purchasing / Inventory / Logistics / Vendor management)',
      cn: '主要方向？（采购/库存/物流/供应商管理）',
    }},
    { key: 'div_scm_scale', category: 'division', text: {
      th: 'ดูแล SKU กี่รายการ? supplier กี่ราย? มี item critical ที่ห้าม out-of-stock อะไรบ้าง?',
      en: 'How many SKUs and suppliers do you handle? Any critical items that must not go out-of-stock?',
      cn: '您管理多少SKU和供应商？有哪些关键物料不能缺货？',
    }},
    { key: 'div_scm_lead', category: 'division', text: {
      th: 'Lead time เฉลี่ยของแต่ละ supplier? งานไหนที่ supplier มักจะ delay?',
      en: 'Average lead time per supplier? Which items frequently get delayed?',
      cn: '各供应商平均交货周期？哪些物料经常延误？',
    }},
  ],
  scm_inter: [
    { key: 'div_scmi_scope', category: 'division', text: {
      th: 'นำเข้า/ส่งออกประเทศไหนบ้าง? ใช้ Incoterms แบบไหนเป็นหลัก?',
      en: 'Which countries for import/export? Typical Incoterms?',
      cn: '主要进出口哪些国家？通常使用哪种贸易术语？',
    }},
    { key: 'div_scmi_doc',  category: 'division', text: {
      th: 'เอกสารที่ต้องจัดการเป็นประจำ (B/L, Invoice, Packing List, L/C, ใบขนสินค้า) ทำผ่านระบบอะไร?',
      en: 'Regular docs you handle (B/L, Invoice, Packing List, L/C, customs) — via what system?',
      cn: '经常处理的单据（提单、发票、装箱单、信用证、报关单）—使用什么系统？',
    }},
    { key: 'div_scmi_risk', category: 'division', text: {
      th: 'ปัญหาที่เจอบ่อย? (ศุลกากร, ขนส่ง, อัตราแลกเปลี่ยน, supplier ต่างประเทศ)',
      en: 'Common issues you face? (Customs, shipping, FX, overseas suppliers)',
      cn: '常遇到的问题？（海关/运输/汇率/海外供应商）',
    }},
  ],
  operations: [
    { key: 'div_ops_scope', category: 'division', text: {
      th: 'ดูแลอะไรบ้าง? (สาขา / ครัวกลาง / ระบบงาน / QA) จำนวนสาขาที่รับผิดชอบ?',
      en: 'What do you oversee? (Branches / central kitchen / process / QA) How many locations?',
      cn: '您负责什么？（门店/中央厨房/流程/品控）多少家门店？',
    }},
    { key: 'div_ops_sla',   category: 'division', text: {
      th: 'SLA / มาตรฐานที่ต้องรักษา (เวลาเสิร์ฟ, คุณภาพ, ต้นทุน) และวัดยังไง?',
      en: 'SLAs / standards you must maintain (service time, quality, cost) — how do you measure?',
      cn: '需维持的SLA或标准（服务时间/质量/成本）如何衡量？',
    }},
    { key: 'div_ops_issue', category: 'division', text: {
      th: 'ปัญหาสาขาที่เกิดบ่อยที่สุด 3 อันดับคืออะไร? ใช้เวลาแก้แต่ละครั้งนานแค่ไหน?',
      en: 'Top 3 most frequent branch issues? How long does each take to resolve?',
      cn: '门店最常见的3大问题？每次解决需要多久？',
    }},
  ],
  it: [
    { key: 'div_it_scope',   category: 'division', text: {
      th: 'ด้านไหน? (Support / Dev / Infra / Security / Data) และระบบหลักที่ดูแล?',
      en: 'Focus? (Support / Dev / Infra / Security / Data) Core systems you own?',
      cn: '方向？（支持/开发/基础设施/安全/数据）负责的核心系统？',
    }},
    { key: 'div_it_ticket',  category: 'division', text: {
      th: 'Ticket/incident ต่อวัน-สัปดาห์ประมาณเท่าไร? มี on-call มั้ย?',
      en: 'Tickets/incidents per day-week? Do you do on-call?',
      cn: '每天/每周工单或事件数量？是否轮值on-call？',
    }},
    { key: 'div_it_project', category: 'division', text: {
      th: 'มีโปรเจกต์ที่ IT ดูแล/พัฒนาอยู่ตอนนี้? deploy ยังไง (manual/CI-CD)?',
      en: 'Current IT projects? Deployment method (manual / CI-CD)?',
      cn: '目前的IT项目？部署方式（手动/CI-CD）？',
    }},
  ],
  warehouse: [
    { key: 'div_wh_scope', category: 'division', text: {
      th: 'ทำด้านไหน? (รับของ / เบิกของ / ตรวจนับ / จัดเก็บ / จัดส่ง)',
      en: 'Your focus? (Receiving / Picking / Counting / Storage / Shipping)',
      cn: '负责哪方面？（收货/拣货/盘点/存储/发货）',
    }},
    { key: 'div_wh_scale', category: 'division', text: {
      th: 'จำนวน SKU ที่ดูแล / เนื้อที่คลัง / ปริมาณการเบิก-จ่ายต่อวัน?',
      en: 'SKUs / warehouse area / daily pick-put volume?',
      cn: '管理多少SKU？仓库面积？每日出入库量？',
    }},
    { key: 'div_wh_loss',  category: 'division', text: {
      th: 'มี loss / ของหาย / ของเสียเกิดกี่ % ต่อเดือน? ขั้นตอนตรวจนับ (cycle count) ทำยังไง?',
      en: 'Monthly loss / damage / shrinkage %? How is cycle counting done?',
      cn: '每月损失/破损/盘亏百分比？循环盘点如何进行？',
    }},
  ],
  training: [
    { key: 'div_trn_scope', category: 'division', text: {
      th: 'Training ด้านไหน? (New-hire / Recurring / Soft skill / Technical / Leadership)',
      en: 'Training focus? (New-hire / Recurring / Soft skill / Technical / Leadership)',
      cn: '培训方向？（新员工/常规/软技能/技术/领导力）',
    }},
    { key: 'div_trn_size',  category: 'division', text: {
      th: 'Class size เฉลี่ย? จำนวนรอบต่อเดือน? คนเทรนเป็น in-house หรือ outsource?',
      en: 'Average class size? Sessions per month? In-house trainer or outsourced?',
      cn: '平均班级规模？每月场次？内部讲师还是外聘？',
    }},
    { key: 'div_trn_tool',  category: 'division', text: {
      th: 'ใช้ LMS หรือเครื่องมืออะไรในการเทรน? วัดผลหลังเทรนยังไง (pre/post-test, KPI หน้างาน)?',
      en: 'LMS or tools used? How do you measure post-training impact (pre/post-test, on-job KPI)?',
      cn: '使用什么LMS或工具？如何衡量培训效果（前/后测/现场KPI）？',
    }},
  ],
  bd: [
    { key: 'div_bd_scope',    category: 'division', text: {
      th: 'BD ด้านไหน? (Franchise / Partnership / New market / New product)',
      en: 'BD focus? (Franchise / Partnership / New market / New product)',
      cn: 'BD方向？（加盟/合作/新市场/新产品）',
    }},
    { key: 'div_bd_pipeline', category: 'division', text: {
      th: 'Pipeline ตอนนี้กี่ดีล มูลค่ารวมเท่าไร? ดีลใหญ่สุดที่กำลังปิดอยู่คืออะไร?',
      en: 'Current pipeline — # deals and total value? The biggest deal in progress?',
      cn: '目前管道中多少个交易？总价值多少？正在推进的最大交易？',
    }},
    { key: 'div_bd_block',    category: 'division', text: {
      th: 'อะไรที่ทำให้ดีล delay / fail บ่อยที่สุด? ขั้นตอนที่ใช้เวลานานที่สุดคือช่วงไหน?',
      en: 'What causes most deals to delay/fail? Which stage takes the longest?',
      cn: '什么原因常导致交易延迟/失败？哪个阶段耗时最长？',
    }},
  ],
  ceo: [
    { key: 'div_ceo_priorities', category: 'division', text: {
      th: 'Top 3 strategic priorities ของบริษัทในไตรมาสนี้คืออะไร?',
      en: 'Top 3 strategic priorities for this quarter?',
      cn: '本季度公司前3大战略重点是什么？',
    }},
    { key: 'div_ceo_cadence',    category: 'division', text: {
      th: 'รอบการตัดสินใจ/ประชุมผู้บริหาร ถี่แค่ไหน? ประชุมกับ stakeholder (นักลงทุน/คู่ค้า) ถี่แค่ไหน?',
      en: 'Executive decision / meeting cadence? How often with stakeholders (investors/partners)?',
      cn: '高管决策/会议频率？与利益相关者（投资人/合作伙伴）多久一次？',
    }},
    { key: 'div_ceo_risk',       category: 'division', text: {
      th: 'Top 3 risk และ top 3 opportunity ที่บริษัทเผชิญอยู่ตอนนี้?',
      en: 'Top 3 risks and top 3 opportunities the company faces now?',
      cn: '公司目前面临的前3大风险和前3大机会？',
    }},
  ],
};

// Match a division to its questions. Try exact id first, then prefix match
// so custom divisions like "ceo_85cp" still hit the "ceo" bucket.
function questionsForDivision(employee) {
  if (!employee) return [];
  const id = String(employee.division_id || '').toLowerCase();
  if (DIVISION_QUESTIONS[id]) return DIVISION_QUESTIONS[id];
  const name = String(employee.division_name || '').toLowerCase();
  for (const k of Object.keys(DIVISION_QUESTIONS)) {
    if (id.startsWith(k) || name.startsWith(k) || name === k) return DIVISION_QUESTIONS[k];
  }
  return [];
}

// ============================================================
// 2) Build full question script for a given interview
// ============================================================
function normalizeLang(lang) {
  return ['th', 'en', 'cn'].includes(lang) ? lang : 'th';
}

function buildScript(interview) {
  const lang = normalizeLang(interview.lang);
  // Prefer per-user hours stored on the interview (position-anchored model where the
  // user's profile sets work_start/end/break). Fall back to the preset schedule for
  // legacy interviews that never had hours computed.
  const hours = (Array.isArray(interview.hours) && interview.hours.length)
    ? interview.hours
    : scheduleHours(interview.schedule || '09-18');

  const intro = INTRO_QUESTIONS.map(q => ({
    key: q.key, category: q.category, text: q.text[lang] || q.text.th,
  }));

  const hourly = hours.map(h => ({
    key: `hour_${h}`,
    category: 'timeblock',
    text: (HOUR_QUESTION.text[lang] || HOUR_QUESTION.text.th)(h),
  }));

  const tail = SHARED_TAIL.map(q => ({
    key: q.key, category: q.category, text: q.text[lang] || q.text.th,
  }));

  const divQs = questionsForDivision(interview.employee).map(q => ({
    key: q.key, category: q.category, text: q.text[lang] || q.text.th,
  }));

  return [...intro, ...hourly, ...tail, ...divQs];
}

// Legacy script (for interviews created before the schedule/lang refactor).
// Kept so old in-progress interviews can still be resumed.
const LEGACY_SCRIPT = [
  { key: 'warmup',            category: 'intro',     text: 'สวัสดีครับ — ช่วยเล่าวันทำงานปกติของคุณหน่อย เริ่มกี่โมง เลิกกี่โมง?' },
  { key: 'morning_first',     category: 'morning',   text: '30 นาทีแรกของวัน คุณมักจะทำอะไรก่อน?' },
  { key: 'morning_main',      category: 'morning',   text: 'ช่วง 09:30–12:00 งานหลักคืออะไร?' },
  { key: 'morning_tools',     category: 'morning',   text: 'เครื่องมือ/ระบบที่ใช้ประจำช่วงเช้า?' },
  { key: 'morning_people',    category: 'morning',   text: 'ช่วงเช้าประสานงานกับใคร?' },
  { key: 'noon_break',        category: 'noon',      text: 'พักเที่ยงกี่โมง นานเท่าไร?' },
  { key: 'afternoon_main',    category: 'afternoon', text: 'ช่วงบ่าย 13:00–16:00 ทำอะไร?' },
  { key: 'afternoon_reports', category: 'afternoon', text: 'รายงานประจำวันที่ต้องทำ?' },
  { key: 'afternoon_deadline',category: 'afternoon', text: 'Deadline รายวัน?' },
  { key: 'evening_closing',   category: 'evening',   text: 'ก่อนเลิกงานช่วงเย็นทำอะไร?' },
  { key: 'weekly_tasks',      category: 'weekly',    text: 'งานรายสัปดาห์/เดือน?' },
  { key: 'pain_points',       category: 'problem',   text: 'งานที่เสียเวลาที่สุด?' },
  { key: 'bottlenecks',       category: 'problem',   text: 'รออะไรจากคน/ระบบอื่น?' },
  { key: 'own_kpi',           category: 'kpi',       text: 'ควรวัดผลคุณจากอะไร?' },
  { key: 'ai_wishlist',       category: 'ai',        text: 'อยากให้ AI ช่วยอะไร?' },
];

function isLegacyInterview(interview) {
  return !interview.schedule && !interview.lang;
}

function getNextQuestion(interview) {
  const script = isLegacyInterview(interview) ? LEGACY_SCRIPT : buildScript(interview);
  const answered = new Set(interview.answers.map(a => a.key));
  for (const step of script) {
    if (!answered.has(step.key)) {
      return { key: step.key, text: step.text, category: step.category, done: false };
    }
  }
  return { done: true };
}

// ============================================================
// 3) Probe logic (short answers get nudged, lang-aware)
// ============================================================
function shouldProbe(answer, lang = 'th') {
  if (!answer) return null;
  const trimmed = answer.trim();
  if (trimmed.length < 15) {
    return {
      th: 'ช่วยเล่าละเอียดกว่านี้อีกนิดนะครับ — ยกตัวอย่างเป็นรูปธรรม หรือบอกเวลาที่ใช้ได้มั้ย?',
      en: 'Could you elaborate a bit more — give a concrete example or the time it takes?',
      cn: '能再详细说明一下吗？给个具体例子或所需时间？',
    }[normalizeLang(lang)] || null;
  }
  return null;
}

// ============================================================
// 4) Document generators  (output language: Thai only)
// ============================================================

// Crude task-extractor: split by commas/newlines, keep non-empty.
function extractTasks(text) {
  if (!text) return [];
  return text
    .split(/[,\n;]|และ|แล้วก็|then|,/gi)
    .map(s => s.trim())
    .filter(s => s.length >= 3);
}

function getAnswer(interview, key) {
  const a = interview.answers.find(x => x.key === key);
  return a ? a.value : '';
}

// Detect which schema the interview uses and normalize time content for both.
function collectTimeContent(interview) {
  const legacy = {
    morning_first: getAnswer(interview, 'morning_first'),
    morning_main:  getAnswer(interview, 'morning_main'),
    morning_tools: getAnswer(interview, 'morning_tools'),
    morning_people:getAnswer(interview, 'morning_people'),
    noon_break:    getAnswer(interview, 'noon_break'),
    afternoon_main:     getAnswer(interview, 'afternoon_main'),
    afternoon_reports:  getAnswer(interview, 'afternoon_reports'),
    afternoon_deadline: getAnswer(interview, 'afternoon_deadline'),
    evening_closing:    getAnswer(interview, 'evening_closing'),
  };
  const hasLegacy = Object.values(legacy).some(v => v && v.trim());
  if (hasLegacy) return { mode: 'legacy', ...legacy };

  const hourly = {};
  for (let h = 0; h < 24; h++) {
    const v = getAnswer(interview, `hour_${h}`);
    if (v) hourly[h] = v;
  }
  const hours = Object.keys(hourly).map(Number).sort((a,b) => a-b);
  return { mode: 'new', hours, hourly };
}

function buildWorkflowMd(interview) {
  const e = interview.employee;
  const get = k => getAnswer(interview, k) || '(ไม่ระบุ)';
  const t = collectTimeContent(interview);

  const timeSection = t.mode === 'legacy'
    ? `### ช่วงเช้า (08:00 – 12:00)
- **เวลาทำงาน:** ${get('warmup')}
- **30 นาทีแรก:** ${t.morning_first || '(ไม่ระบุ)'}
- **งานหลักช่วงสาย:** ${t.morning_main || '(ไม่ระบุ)'}
- **เครื่องมือ/ระบบ:** ${t.morning_tools || '(ไม่ระบุ)'}
- **ประสานงานกับ:** ${t.morning_people || '(ไม่ระบุ)'}

### ช่วงเที่ยง
- ${t.noon_break || '(ไม่ระบุ)'}

### ช่วงบ่าย (13:00 – 16:00)
- **งานหลัก/ประชุม:** ${t.afternoon_main || '(ไม่ระบุ)'}
- **รายงานประจำวัน:** ${t.afternoon_reports || '(ไม่ระบุ)'}
- **Deadline รายวัน:** ${t.afternoon_deadline || '(ไม่ระบุ)'}

### ช่วงเย็น / ปิดงาน
- ${t.evening_closing || '(ไม่ระบุ)'}`
    : `### ตารางงานรายชั่วโมง
${t.hours.length
  ? t.hours.map(h => `- **${pad(h)}:00–${pad(h+1)}:00:** ${t.hourly[h]}`).join('\n')
  : '(ไม่ระบุ)'}`;

  const divAnswers = interview.answers.filter(a => a.key.startsWith('div_'));
  const divSection = divAnswers.length
    ? '\n## ข้อมูลเฉพาะฝ่าย\n' + divAnswers.map(a => `- **${a.key.replace(/^div_[a-z]+_/, '')}:** ${a.value}`).join('\n') + '\n'
    : '';

  return `# Workflow: ${e.name}

> สร้างจากการอินเทอร์วิวอัตโนมัติเมื่อ ${fmtDateTime(interview.finishedAt)}

## ข้อมูลพนักงาน
- **ชื่อ:** ${e.name}
- **ตำแหน่ง:** ${e.role}
- **แผนก:** ${e.department || e.division_name || '-'}
- **อีเมล:** ${e.email || '-'}
- **ภาษาที่ใช้สัมภาษณ์:** ${normalizeLang(interview.lang).toUpperCase()}
- **ช่วงเวลาทำงาน:** ${interview.schedule || '(legacy)'}

## บทบาทสั้น ๆ
${get('warmup')}

## ตารางงานประจำวัน (Daily Schedule)

${timeSection}
${divSection}
## งานรายสัปดาห์ / รายเดือน
${get('weekly_tasks')}

## ปัญหา / คอขวดที่เจอ
- **งานที่เสียเวลามากที่สุด:** ${get('pain_points')}
- **รออะไรจากคน/ระบบอื่น:** ${get('bottlenecks')}

## ตัวชี้วัดที่พนักงานรู้สึก (ดิบ ใช้สำหรับทำ KPI)
${get('own_kpi')}

## งานที่พนักงานอยากให้ AI ช่วย
${get('ai_wishlist')}
`;
}

function buildWorkflowCsv(interview) {
  const rows = [
    ['ช่วงเวลา', 'งาน', 'เครื่องมือ', 'คนที่เกี่ยวข้อง', 'ความถี่', 'หมายเหตุ'],
  ];
  const t = collectTimeContent(interview);

  if (t.mode === 'legacy') {
    const tools = getAnswer(interview, 'morning_tools') || '';
    const people = getAnswer(interview, 'morning_people') || '';
    const push = (period, key, freq) => {
      const tasks = extractTasks(getAnswer(interview, key));
      for (const task of tasks) rows.push([period, task, tools, people, freq, '']);
    };
    push('เช้า (08:00-09:30)', 'morning_first', 'ทุกวัน');
    push('สาย (09:30-12:00)', 'morning_main', 'ทุกวัน');
    push('เที่ยง', 'noon_break', 'ทุกวัน');
    push('บ่าย (13:00-16:00)', 'afternoon_main', 'ทุกวัน');
    push('บ่าย - รายงาน', 'afternoon_reports', 'ทุกวัน');
    push('เย็น', 'evening_closing', 'ทุกวัน');
    push('รายสัปดาห์/เดือน', 'weekly_tasks', 'ไม่ใช่ทุกวัน');
  } else {
    for (const h of t.hours) {
      const tasks = extractTasks(t.hourly[h]);
      if (tasks.length) {
        for (const task of tasks) rows.push([`${pad(h)}:00-${pad(h+1)}:00`, task, '', '', 'ทุกวัน', '']);
      } else {
        rows.push([`${pad(h)}:00-${pad(h+1)}:00`, t.hourly[h], '', '', 'ทุกวัน', '']);
      }
    }
    const weekly = extractTasks(getAnswer(interview, 'weekly_tasks'));
    for (const w of weekly) rows.push(['รายสัปดาห์/เดือน', w, '', '', 'ไม่ใช่ทุกวัน', '']);
  }

  const esc = s => {
    const str = String(s ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  return '\ufeff' + rows.map(r => r.map(esc).join(',')).join('\n');
}

function buildDiagramMd(interview) {
  const t = collectTimeContent(interview);
  const nodes = [];
  const edges = [];
  const add = (id, label) => nodes.push(`    ${id}["${String(label).replace(/"/g, "'").slice(0, 60)}"]`);

  add('S', 'เริ่มวันทำงาน');
  const chain = ['S'];

  if (t.mode === 'legacy') {
    const m1 = extractTasks(t.morning_first);
    const m2 = extractTasks(t.morning_main);
    const n  = extractTasks(t.noon_break);
    const a1 = extractTasks(t.afternoon_main);
    const a2 = extractTasks(t.afternoon_reports);
    const ev = extractTasks(t.evening_closing);
    const groups = [
      ['M1', m1[0] || 'งานช่วงเช้า'],
      ['M2', m2[0] || 'งานหลักช่วงสาย'],
      ['N',  n[0]  || 'พักเที่ยง'],
      ['A1', a1[0] || 'งานบ่าย'],
      ['A2', a2[0] || 'รายงาน'],
      ['E',  ev[0] || 'ปิดงาน'],
    ];
    for (const [id, label] of groups) { add(id, label); chain.push(id); }
  } else {
    for (const h of t.hours) {
      const id = `H${h}`;
      const first = extractTasks(t.hourly[h])[0] || t.hourly[h] || '-';
      add(id, `${pad(h)}:00  ${first}`);
      chain.push(id);
    }
  }
  add('END', 'เลิกงาน');
  chain.push('END');
  for (let i = 0; i < chain.length - 1; i++) edges.push(`    ${chain[i]} --> ${chain[i+1]}`);

  return `# Workflow Diagram: ${interview.employee.name}

\`\`\`mermaid
flowchart TD
${nodes.join('\n')}
${edges.join('\n')}
\`\`\`

> Paste ไฟล์นี้ที่ [mermaid.live](https://mermaid.live) เพื่อ render เป็นแผนภาพ
`;
}

function buildJdMd(interview) {
  const e = interview.employee;
  const t = collectTimeContent(interview);

  let mainTasks = [];
  let secondaryTasks = [];
  let tools = [];
  let people = [];

  if (t.mode === 'legacy') {
    mainTasks = [
      ...extractTasks(t.morning_main),
      ...extractTasks(t.afternoon_main),
    ].slice(0, 8);
    secondaryTasks = [
      ...extractTasks(t.afternoon_reports),
      ...extractTasks(t.evening_closing),
      ...extractTasks(getAnswer(interview, 'weekly_tasks')),
    ].slice(0, 8);
    tools = extractTasks(t.morning_tools);
    people = extractTasks(t.morning_people);
  } else {
    for (const h of t.hours) {
      const parts = extractTasks(t.hourly[h]);
      if (parts[0]) mainTasks.push(parts[0]);
      if (parts.length > 1) secondaryTasks.push(...parts.slice(1));
    }
    mainTasks = mainTasks.slice(0, 8);
    secondaryTasks = [
      ...secondaryTasks,
      ...extractTasks(getAnswer(interview, 'weekly_tasks')),
    ].slice(0, 8);
  }

  const divAnswers = interview.answers.filter(a => a.key.startsWith('div_'));
  const divFacts = divAnswers.length
    ? '\n## ข้อมูลเฉพาะฝ่าย\n' + divAnswers.map(a => `- ${a.value}`).join('\n')
    : '';

  return `# Job Description (ฉบับร่างจาก workflow จริง)

## ตำแหน่ง
**${e.role}** — แผนก${e.department || e.division_name || ''}

## สรุปบทบาท (Role Summary)
${getAnswer(interview, 'warmup') || 'รับผิดชอบงานประจำวันตามขอบเขตที่ได้รับมอบหมาย'}

## หน้าที่หลัก (Primary Responsibilities)
${mainTasks.length ? mainTasks.map(t => `- ${t}`).join('\n') : '- (ยังไม่ระบุชัดเจน)'}

## หน้าที่รอง (Secondary Responsibilities)
${secondaryTasks.length ? secondaryTasks.map(t => `- ${t}`).join('\n') : '- -'}

## เครื่องมือ/ระบบที่ต้องใช้เป็น
${tools.length ? tools.map(t => `- ${t}`).join('\n') : '- (ไม่ระบุ — ดูในตารางชั่วโมงประกอบ)'}

## การประสานงาน
${people.length ? people.map(t => `- ${t}`).join('\n') : '- (ดูในตารางชั่วโมงประกอบ)'}
${divFacts}

## คุณสมบัติที่สังเกตได้จากงานจริง
- มีระเบียบวินัยในการจัดการเวลา
- สื่อสารกับหลายฝ่าย
- ใช้เครื่องมือดิจิทัลพื้นฐานได้คล่อง

> หมายเหตุ: JD นี้สร้างจากการอินเทอร์วิวจริง ควรให้หัวหน้าแผนกทบทวนและปรับเพิ่ม competency/requirement ที่จำเป็น
`;
}

function buildKpiMd(interview) {
  const e = interview.employee;
  const own = getAnswer(interview, 'own_kpi');
  const pain = getAnswer(interview, 'pain_points');
  const deadline = getAnswer(interview, 'afternoon_deadline');
  const reports = getAnswer(interview, 'afternoon_reports');

  const kpis = [];
  if (reports || getAnswer(interview, 'weekly_tasks')) {
    kpis.push({
      name: 'ความตรงเวลาของรายงานประจำวัน/สัปดาห์',
      measure: 'จำนวนครั้งที่ส่งรายงานทันเวลาในเดือน',
      formula: '(วันที่ส่งทัน / วันทำงานทั้งหมด) × 100%',
      target: '≥ 95%',
      freq: 'รายวัน (สรุปรายเดือน)',
    });
  }
  if (deadline) {
    kpis.push({
      name: 'ความตรงต่อ deadline รายวัน',
      measure: 'ปริมาณงานที่เสร็จก่อน deadline ที่ระบุ',
      formula: '(งานทันเวลา / งานทั้งหมดที่มี deadline) × 100%',
      target: '≥ 98%',
      freq: 'รายวัน',
    });
  }
  if (pain) {
    kpis.push({
      name: `ลดเวลางานคอขวด (${pain.slice(0, 40)}...)`,
      measure: 'เวลาเฉลี่ยต่อครั้งในการทำงานที่เคยติดขัด',
      formula: 'เวลาที่ใช้เฉลี่ย (นาที/ครั้ง)',
      target: 'ลด ≥ 20% จาก baseline ใน 90 วัน',
      freq: 'รายสัปดาห์',
    });
  }
  if (own) {
    kpis.push({
      name: 'KPI จากมุมพนักงานเอง',
      measure: own.slice(0, 80),
      formula: '(ปรับร่วมกับหัวหน้า)',
      target: '(กำหนดร่วม)',
      freq: 'รายสัปดาห์',
    });
  }
  kpis.push({
    name: 'ความพึงพอใจของผู้ร่วมงาน',
    measure: 'คะแนน 360° จากคนที่ประสานงานด้วย',
    formula: 'คะแนนเฉลี่ย 1–5',
    target: '≥ 4.0',
    freq: 'รายไตรมาส',
  });

  const rows = kpis.map((k, i) => `### KPI ${i+1}: ${k.name}
- **สิ่งที่วัด:** ${k.measure}
- **สูตร:** ${k.formula}
- **เป้าหมาย:** ${k.target}
- **ความถี่:** ${k.freq}
`).join('\n');

  return `# KPI: ${e.name} (${e.role})

> ร่างจาก workflow จริง — ควรทบทวนร่วมกับหัวหน้าก่อนประกาศใช้

${rows}

## วิธีใช้
1. Baseline — วัดผลปัจจุบัน 2-4 สัปดาห์แรกโดยยังไม่ตั้งเป้า
2. ตกลงเป้ากับหัวหน้า ปรับตัวเลขตามบริบทจริง
3. ทบทวนทุกไตรมาส — ตัด/เพิ่ม KPI ตามงานที่เปลี่ยน
`;
}

const AI_REPLACEABLE_KEYWORDS = [
  { label: 'จัดการอีเมล',         match: /email|อีเมล|เมล/i,          suggestion: 'ใช้ AI ช่วยร่าง/จัดหมวดหมู่อีเมลอัตโนมัติ (เช่น Gmail smart reply, Claude API)', score: 'กลาง' },
  { label: 'สรุปประชุม/เอกสาร',   match: /สรุป|summary|minute/i,       suggestion: 'ใช้ AI สรุปประชุม/สรุปเอกสาร (Otter, Fireflies, Claude)',                      score: 'สูง' },
  { label: 'คีย์ข้อมูลซ้ำ',        match: /กรอก|คีย์|copy|ก๊อป|paste/i, suggestion: 'สร้าง script/automation ดึงข้อมูลแทนการคีย์มือ',                              score: 'สูง' },
  { label: 'ทำรายงาน',            match: /รายงาน|report|dashboard/i,   suggestion: 'ใช้ AI generate รายงานตามเทมเพลตจากข้อมูลดิบ',                                 score: 'สูง' },
  { label: 'ตอบลูกค้าซ้ำ ๆ',      match: /ตอบลูกค้า|reply|ตอบแช/i,    suggestion: 'AI chatbot ตอบคำถามซ้ำ ๆ (FAQ auto-reply)',                                    score: 'สูง' },
  { label: 'แปลภาษา',             match: /แปล|translate/i,             suggestion: 'Claude/DeepL แปลเบื้องต้น มนุษย์ตรวจ',                                         score: 'สูง' },
  { label: 'ตรวจ/Review งาน',     match: /ตรวจ|check|review/i,         suggestion: 'AI ช่วย pre-check ตามเกณฑ์ ก่อนมนุษย์อนุมัติ',                                score: 'กลาง' },
  { label: 'นัดหมาย/ตารางเวลา',   match: /นัด|schedule|calendar/i,     suggestion: 'AI scheduling assistant (Reclaim, Motion)',                                     score: 'กลาง' },
];

function buildOptimizationMd(interview) {
  const e = interview.employee;
  const all = interview.answers.map(a => a.value).join('\n');
  const findings = [];

  for (const k of AI_REPLACEABLE_KEYWORDS) {
    if (k.match.test(all)) {
      findings.push({
        problem: `มีงาน "${k.label}" ในรูทีนประจำ ซึ่งสามารถ automate ได้`,
        proposal: k.suggestion,
        impact: k.score,
        risk: k.score === 'สูง' ? 'ต่ำ — มี tool สำเร็จรูป' : 'กลาง — อาจต้องปรับ workflow',
      });
    }
  }

  const bot = getAnswer(interview, 'bottlenecks');
  if (bot && bot.trim().length > 5) {
    findings.push({
      problem: `รองาน/ข้อมูลจากคนอื่น: "${bot.slice(0, 80)}"`,
      proposal: 'ตั้ง SLA การส่งงานระหว่างทีม + dashboard ติดตามสถานะแบบ realtime',
      impact: 'สูง',
      risk: 'กลาง — ต้องคุยข้ามทีม',
    });
  }

  const wishlist = getAnswer(interview, 'ai_wishlist');
  if (wishlist && wishlist.trim().length > 3) {
    findings.push({
      problem: `พนักงานขอเอง: "${wishlist.slice(0, 100)}"`,
      proposal: 'จัดลำดับเป็นความต้องการระดับสูง เพราะผู้ทำงานเห็น pain point โดยตรง',
      impact: 'สูง',
      risk: 'ต่ำ',
    });
  }

  if (!findings.length) {
    findings.push({
      problem: '—',
      proposal: 'ยังไม่พบจุดที่ชัดเจนจากคำตอบปัจจุบัน ลองอินเทอร์วิวเชิงลึกเพิ่ม',
      impact: 'ต่ำ',
      risk: '-',
    });
  }

  const rows = findings.map((f, i) => `### ข้อเสนอที่ ${i+1}
- **ปัญหา:** ${f.problem}
- **ข้อเสนอ:** ${f.proposal}
- **ผลกระทบ (impact):** ${f.impact}
- **ความเสี่ยง:** ${f.risk}
`).join('\n');

  return `# Optimization: ${e.name} (${e.role})

> ข้อเสนอการปรับปรุง workflow รายบุคคล จากข้อมูลอินเทอร์วิว
> วัตถุประสงค์: ตัดงานซ้ำซ้อน / ใช้ AI แทนงานที่ automate ได้ / เพิ่มเวลาให้งานสำคัญ

## สรุปสั้น
พบข้อเสนอ ${findings.length} ข้อ — โปรดทบทวนก่อนนำไปใช้

${rows}

## ประมาณการเวลาที่อาจประหยัดได้
หากทำตามข้อเสนอทั้งหมด ประมาณ **${findings.length * 2}–${findings.length * 4} ชั่วโมง/สัปดาห์** (ตัวเลขหยาบ ควร baseline ก่อนวัดจริง)
`;
}

function generateDocuments(interview) {
  return {
    'workflow.md':          buildWorkflowMd(interview),
    'workflow.csv':         buildWorkflowCsv(interview),
    'workflow-diagram.md':  buildDiagramMd(interview),
    'job-description.md':   buildJdMd(interview),
    'kpi.md':               buildKpiMd(interview),
    'optimization.md':      buildOptimizationMd(interview),
  };
}

// ============================================================
// 5) Company-wide analysis
// ============================================================
function analyzeCompany(interviews) {
  const total = interviews.length;
  if (!total) return '# ยังไม่มีข้อมูลอินเทอร์วิวให้วิเคราะห์\n';

  const byDiv = {};
  for (const iv of interviews) {
    const d = iv.employee.division_name || iv.employee.division_id || 'unknown';
    byDiv[d] = (byDiv[d] || 0) + 1;
  }

  const pains = interviews.map(iv => ({
    name: iv.employee.name,
    role: iv.employee.role,
    division: iv.employee.division_name || iv.employee.division_id,
    pain: getAnswer(iv, 'pain_points'),
    wish: getAnswer(iv, 'ai_wishlist'),
    bottleneck: getAnswer(iv, 'bottlenecks'),
  })).filter(p => p.pain || p.wish || p.bottleneck);

  const tally = {};
  for (const k of AI_REPLACEABLE_KEYWORDS) {
    let count = 0;
    for (const iv of interviews) {
      const all = iv.answers.map(a => a.value).join('\n');
      if (k.match.test(all)) count++;
    }
    if (count) tally[k.label] = { count, suggestion: k.suggestion, score: k.score };
  }

  const divSection = Object.entries(byDiv)
    .map(([d, n]) => `- **${d}:** ${n} คน`).join('\n');

  const keywordSection = Object.entries(tally)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([label, v]) => `- **${label}** เจอใน ${v.count}/${total} คน (${Math.round(v.count/total*100)}%) — ${v.suggestion}`)
    .join('\n');

  const painHighlights = pains.slice(0, 10).map(p =>
    `- **${p.name}** (${p.role} · ${p.division})\n  - Pain: ${p.pain || '-'}\n  - Wish: ${p.wish || '-'}`
  ).join('\n');

  return `# รายงานวิเคราะห์ภาพรวมบริษัท — Optimization

> รวบรวมจากอินเทอร์วิว ${total} คน · สร้างเมื่อ ${fmtDateTime()}

## ความครอบคลุมรายฝ่าย
${divSection || '(ไม่มีข้อมูล)'}

## งานที่ AI สามารถช่วยได้ — จัดลำดับตามความถี่
${keywordSection || '(ไม่พบ keyword ที่เกี่ยวข้อง)'}

## Pain points & AI wishlist จากพนักงาน (top 10)
${painHighlights || '(ไม่มีข้อมูล)'}

## ข้อเสนอภาพรวม
1. งานที่เจอซ้ำหลายคน → ทำ pilot 1 initiative ครอบคลุมหลายฝ่าย เช่น AI meeting summary, auto-report generator
2. Bottleneck ข้ามทีม → ตั้ง dashboard กลางติดตามสถานะ + SLA
3. AI wishlist ที่พนักงานขอซ้ำ → จัดลำดับเป็น roadmap 3-6 เดือน
`;
}

module.exports = {
  getNextQuestion,
  shouldProbe,
  generateDocuments,
  analyzeCompany,
  listSchedules,
  buildScript,
  SCHEDULES,
  DIVISION_QUESTIONS,
  questionsForDivision,
};
