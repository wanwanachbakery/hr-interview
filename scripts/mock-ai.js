/**
 * mock-ai.js
 *
 * Simulates an AI interviewer + document generator.
 * Later this module can be swapped for real Claude API calls without
 * changing the server or frontend.
 *
 * Exports:
 *   getNextQuestion(interview)   -> { key, text, done }
 *   shouldProbe(answer)          -> string | null
 *   generateDocuments(interview) -> { [filename]: content }
 *   analyzeCompany(interviews)   -> markdown string
 */

// ============================================================
// 1) Interview script (ordered)
// ============================================================
// Each step has: key, text (bilingual TH+EN), category
const SCRIPT = [
  { key: 'warmup',            category: 'intro',   text: 'สวัสดีครับ / Hi! ผมเป็น AI ที่จะช่วยรวบรวมข้อมูลการทำงานประจำวันของคุณ ใช้เวลาประมาณ 10-15 นาที เริ่มจากคำถามง่าย ๆ ก่อน — วันทำงานปกติของคุณเริ่มกี่โมง และเลิกกี่โมงครับ?' },
  { key: 'morning_first',     category: 'morning', text: '30 นาทีแรกของวัน คุณมักจะทำอะไรก่อน? (เช่น เช็คอีเมล, เปิดระบบ, อ่านรายงานเมื่อวาน) ช่วยเล่าตามลำดับจริง' },
  { key: 'morning_main',      category: 'morning', text: 'ช่วงสาย (ประมาณ 09:30–12:00) งานหลักของคุณคืออะไร? ทำบ่อยแค่ไหน ใช้เวลาเท่าไหร่ต่อครั้ง?' },
  { key: 'morning_tools',     category: 'morning', text: 'เครื่องมือ/ระบบ/โปรแกรม ที่ใช้ประจำในช่วงเช้ามีอะไรบ้าง? (เช่น LINE, Google Sheets, ERP, POS)' },
  { key: 'morning_people',    category: 'morning', text: 'ช่วงเช้าต้องประสานงานกับใครบ้าง? (ชื่อ/ตำแหน่ง/ทีม)' },
  { key: 'noon_break',        category: 'noon',    text: 'พักเที่ยงกี่โมง และนานเท่าไหร่? มีประชุม lunch หรืองานช่วงพักมั้ย?' },
  { key: 'afternoon_main',    category: 'afternoon', text: 'ช่วงบ่าย (13:00–16:00) ทำอะไรบ้าง? มีประชุมประจำมั้ย วันไหนบ้าง?' },
  { key: 'afternoon_reports', category: 'afternoon', text: 'มีรายงาน/เอกสารที่ต้องทำทุกวันมั้ย? ทำยังไง ใช้เวลาเท่าไหร่?' },
  { key: 'afternoon_deadline',category: 'afternoon', text: 'มี deadline รายวันอะไรบ้าง เช่น ต้องส่งยอดก่อน 17:00?' },
  { key: 'evening_closing',   category: 'evening', text: 'ก่อนเลิกงาน ช่วงเย็นทำอะไรบ้าง? (สรุปงาน, ส่งรายงาน, เตรียมของวันพรุ่งนี้, เช็ค stock, ฯลฯ)' },
  { key: 'weekly_tasks',      category: 'weekly',  text: 'มีงานที่ทำเฉพาะบางวันของสัปดาห์ หรือรายเดือน/รายไตรมาสมั้ย? เช่น ประชุมทีมทุกจันทร์, ปิดยอดสิ้นเดือน' },
  { key: 'pain_points',       category: 'problem', text: 'งานชิ้นไหนรู้สึกเสียเวลาที่สุด / น่าเบื่อที่สุด / ทำซ้ำบ่อยเกินไป? ทำไมถึงช้า?' },
  { key: 'bottlenecks',       category: 'problem', text: 'รออะไรจากคนอื่น/ระบบอื่น แล้วทำให้ทำงานต่อไม่ได้บ้างมั้ย? (bottleneck)' },
  { key: 'own_kpi',           category: 'kpi',     text: 'ถ้าจะวัดว่าคุณทำงานได้ดีในแต่ละวัน คุณคิดว่าควรวัดจากอะไร? (เล่าในมุมของคุณเอง ไม่ต้องเป็นศัพท์ทางการ)' },
  { key: 'ai_wishlist',       category: 'ai',      text: 'คำถามสุดท้าย — ถ้ามี AI มาช่วย คุณอยากให้ AI ทำงานอะไรแทนคุณมากที่สุด?' },
];

function getNextQuestion(interview) {
  const answered = new Set(interview.answers.map(a => a.key));
  for (const step of SCRIPT) {
    if (!answered.has(step.key)) {
      return { key: step.key, text: step.text, category: step.category, done: false };
    }
  }
  return { done: true };
}

// ============================================================
// 2) Probe logic
// ============================================================
function shouldProbe(answer) {
  if (!answer) return null;
  const trimmed = answer.trim();
  if (trimmed.length < 15) {
    return 'ช่วยเล่าละเอียดกว่านี้อีกนิดนะครับ — ยกตัวอย่างเป็นรูปธรรม หรือบอกเวลาที่ใช้ด้วยได้มั้ย?';
  }
  return null;
}

// ============================================================
// 3) Document generators
// ============================================================

// crude task-extractor: split by commas/newlines, keep non-empty
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

function buildWorkflowMd(interview) {
  const e = interview.employee;
  const get = k => getAnswer(interview, k) || '(ไม่ระบุ)';
  return `# Workflow: ${e.name}

> สร้างจากการอินเทอร์วิวอัตโนมัติเมื่อ ${new Date(interview.finishedAt || Date.now()).toLocaleString('th-TH')}

## ข้อมูลพนักงาน
- **ชื่อ:** ${e.name}
- **ตำแหน่ง:** ${e.role}
- **แผนก:** ${e.department}
- **อีเมล:** ${e.email || '-'}

## ตารางงานประจำวัน (Daily Schedule)

### ช่วงเช้า (08:00 – 12:00)
- **เวลาทำงาน:** ${get('warmup')}
- **30 นาทีแรก:** ${get('morning_first')}
- **งานหลักช่วงสาย:** ${get('morning_main')}
- **เครื่องมือ/ระบบ:** ${get('morning_tools')}
- **ประสานงานกับ:** ${get('morning_people')}

### ช่วงเที่ยง
- ${get('noon_break')}

### ช่วงบ่าย (13:00 – 16:00)
- **งานหลัก/ประชุม:** ${get('afternoon_main')}
- **รายงานประจำวัน:** ${get('afternoon_reports')}
- **Deadline รายวัน:** ${get('afternoon_deadline')}

### ช่วงเย็น / ปิดงาน
- ${get('evening_closing')}

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
  const push = (period, key, freq) => {
    const tasks = extractTasks(getAnswer(interview, key));
    for (const t of tasks) {
      rows.push([period, t, getAnswer(interview, 'morning_tools') || '', getAnswer(interview, 'morning_people') || '', freq, '']);
    }
  };
  push('เช้า (08:00-09:30)', 'morning_first', 'ทุกวัน');
  push('สาย (09:30-12:00)', 'morning_main', 'ทุกวัน');
  push('เที่ยง', 'noon_break', 'ทุกวัน');
  push('บ่าย (13:00-16:00)', 'afternoon_main', 'ทุกวัน');
  push('บ่าย - รายงาน', 'afternoon_reports', 'ทุกวัน');
  push('เย็น', 'evening_closing', 'ทุกวัน');
  push('รายสัปดาห์/เดือน', 'weekly_tasks', 'ไม่ใช่ทุกวัน');

  // CSV escape
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
  const nodes = [];
  const edges = [];
  const add = (id, label) => nodes.push(`    ${id}["${label.replace(/"/g, "'").slice(0, 60)}"]`);

  add('S', 'เริ่มวันทำงาน');
  const m1 = extractTasks(getAnswer(interview, 'morning_first'));
  const m2 = extractTasks(getAnswer(interview, 'morning_main'));
  const n  = extractTasks(getAnswer(interview, 'noon_break'));
  const a1 = extractTasks(getAnswer(interview, 'afternoon_main'));
  const a2 = extractTasks(getAnswer(interview, 'afternoon_reports'));
  const ev = extractTasks(getAnswer(interview, 'evening_closing'));

  const chain = ['S'];
  const groups = [
    ['M1', m1.length ? m1[0] : 'งานช่วงเช้า'],
    ['M2', m2.length ? m2[0] : 'งานหลักช่วงสาย'],
    ['N',  n.length  ? n[0]  : 'พักเที่ยง'],
    ['A1', a1.length ? a1[0] : 'งานบ่าย'],
    ['A2', a2.length ? a2[0] : 'รายงาน'],
    ['E',  ev.length ? ev[0] : 'ปิดงาน'],
  ];
  for (const [id, label] of groups) { add(id, label); chain.push(id); }
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
  const mainTasks = [
    ...extractTasks(getAnswer(interview, 'morning_main')),
    ...extractTasks(getAnswer(interview, 'afternoon_main')),
  ].slice(0, 8);
  const secondaryTasks = [
    ...extractTasks(getAnswer(interview, 'afternoon_reports')),
    ...extractTasks(getAnswer(interview, 'evening_closing')),
    ...extractTasks(getAnswer(interview, 'weekly_tasks')),
  ].slice(0, 8);
  const tools = extractTasks(getAnswer(interview, 'morning_tools'));
  const people = extractTasks(getAnswer(interview, 'morning_people'));

  return `# Job Description (ฉบับร่างจาก workflow จริง)

## ตำแหน่ง
**${e.role}** — แผนก${e.department}

## สรุปบทบาท (Role Summary)
รับผิดชอบงานประจำวันในแผนก${e.department} โดยเน้นการ${mainTasks[0] || 'ดำเนินงานตามขอบเขตที่ได้รับมอบหมาย'}
และประสานงานร่วมกับ${people.join(', ') || 'ทีมงานที่เกี่ยวข้อง'} เพื่อสนับสนุนเป้าหมายของบริษัท

## หน้าที่หลัก (Primary Responsibilities)
${mainTasks.length ? mainTasks.map(t => `- ${t}`).join('\n') : '- (ยังไม่ระบุชัดเจน)'}

## หน้าที่รอง (Secondary Responsibilities)
${secondaryTasks.length ? secondaryTasks.map(t => `- ${t}`).join('\n') : '- -'}

## เครื่องมือ/ระบบที่ต้องใช้เป็น
${tools.length ? tools.map(t => `- ${t}`).join('\n') : '- (ไม่ระบุ)'}

## การประสานงาน
ต้องทำงานร่วมกับ: ${people.join(', ') || '-'}

## คุณสมบัติที่สังเกตได้จากงานจริง
- มีระเบียบวินัยในการจัดการเวลา (มี deadline รายวัน)
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
  if (reports) {
    kpis.push({
      name: 'ความตรงเวลาของรายงานประจำวัน',
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
  // generic fallback
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

// --- per-employee optimization ------------------------------
// Simple heuristic: detect keywords that hint at AI-replaceable / redundant work
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

  // Redundancy within own day: same tools mentioned multiple times
  const tools = getAnswer(interview, 'morning_tools').toLowerCase();
  if (tools && (tools.match(/line|อีเมล|email|sheet/g) || []).length >= 2) {
    findings.push({
      problem: 'เปิดหลายระบบ/หลายแชทควบคู่กัน เสียเวลาสลับหน้าต่าง',
      proposal: 'รวม notification, ตั้งช่วงเวลาเช็ค LINE/อีเมล เป็นรอบ (เช่น 3 รอบ/วัน) แทนการตอบทันทีตลอดเวลา',
      impact: 'กลาง',
      risk: 'ต่ำ',
    });
  }

  // Bottleneck mentioned → suggest systemic fix
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
// 4) Company-wide analysis
// ============================================================
// Normalize Thai/English task strings for comparison
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\u0E00-\u0E7Fa-z0-9]/g, '');
}

// Generic/shared tasks that everyone does — NOT duplicate work
const SHARED_TASK_PATTERNS = [
  /ประชุม/, /meeting/i, /standup/i,
  /เช็คอีเมล/, /เช็ค email/i, /ตอบอีเมล/, /เปิดระบบ/, /เปิดคอม/,
  /พักเที่ยง/, /เลิกงาน/, /เริ่มงาน/, /ปิดระบบ/, /ปิดคอม/,
  /ทำงานตามแผน/, /เช็คงานครบ/, /เตรียมของ/, /สรุปงาน/, /ส่งอีเมล/,
  /ตอบ LINE/, /ตอบลูกค้า/, /รายงานประจำวัน/, /รายงานรายวัน/,
  /โทรประสานงาน/, /ทำเอกสาร/, /สรุปส่งหัวหน้า/, /ออกไปลงพื้นที่/,
];
function isSharedTask(raw) {
  return SHARED_TASK_PATTERNS.some(p => p.test(raw));
}

// Bucket a bottleneck description into a category
const BOTTLENECK_PATTERNS = [
  { label: 'รอฝ่ายบัญชี',  match: /บัญชี|ใบกำกับ|ภาษี|invoice/i },
  { label: 'รอฝ่ายขาย',    match: /sales|ขาย|approve.*(เครดิต|credit)/i },
  { label: 'รอฝ่าย IT',    match: /\bit\b|ระบบ|server|app|เน็ต|network/i },
  { label: 'รอคลังสินค้า', match: /คลัง|warehouse|สต็อก|stock|ของ/i },
  { label: 'รอผู้จัดการ',  match: /หัวหน้า|ผู้จัดการ|manager|approve/i },
  { label: 'รอซัพพลายเออร์', match: /supplier|ซัพพลาย|vendor|ผู้ขาย/i },
];
function classifyBottleneck(text) {
  for (const p of BOTTLENECK_PATTERNS) if (p.match.test(text)) return p.label;
  return 'อื่น ๆ';
}

// Cap a list of owner strings at MAX and append "+N more"
function capOwners(arr, max = 8) {
  const uniq = [...new Set(arr)];
  if (uniq.length <= max) return uniq.join(', ');
  return uniq.slice(0, max).join(', ') + ` + อีก ${uniq.length - max} คน`;
}

function analyzeCompany(interviews) {
  if (!interviews.length) return '# Company Optimization Report\n\nยังไม่มีข้อมูลอินเทอร์วิว';

  // --- 1. Duplicate tasks matrix ---
  const taskOwners = {}; // normalized-task -> [{name, role, raw}]
  const RELEVANT_KEYS = ['morning_first', 'morning_main', 'afternoon_main', 'afternoon_reports', 'evening_closing', 'weekly_tasks'];
  for (const iv of interviews) {
    for (const key of RELEVANT_KEYS) {
      const raw = getAnswer(iv, key);
      for (const t of extractTasks(raw)) {
        if (isSharedTask(t)) continue;                // skip meetings/email/breaks
        const n = normalize(t);
        if (n.length < 6) continue;                   // raise threshold to cut noise
        if (!taskOwners[n]) taskOwners[n] = [];
        taskOwners[n].push({ name: iv.employee.name, role: iv.employee.role, division: iv.employee.division_name || '', raw: t });
      }
    }
  }
  // Must cross departments to really count as "duplicate work"
  const duplicates = Object.entries(taskOwners)
    .map(([n, arr]) => {
      const uniqueNames = new Set(arr.map(x => x.name));
      const uniqueDivs  = new Set(arr.map(x => x.division));
      return { n, arr, uniqueNames, uniqueDivs };
    })
    .filter(x => x.uniqueNames.size >= 2 && x.uniqueDivs.size >= 2)  // cross-division only
    .sort((a, b) => b.uniqueNames.size - a.uniqueNames.size)
    .slice(0, 15)                                                    // top 15
    .map(({ n, arr }) => ({
      key: n,
      example: arr[0].raw,
      owners: [...new Set(arr.map(x => `${x.name} (${x.role})`))],
      divisions: [...new Set(arr.map(x => x.division))],
    }));

  // --- 2. AI-replaceable task ranking (global) ---
  const aiHits = {};
  for (const iv of interviews) {
    const all = iv.answers.map(a => a.value).join('\n');
    for (const k of AI_REPLACEABLE_KEYWORDS) {
      if (k.match.test(all)) {
        const kk = k.suggestion;
        if (!aiHits[kk]) aiHits[kk] = { count: 0, employees: [], score: k.score };
        aiHits[kk].count++;
        aiHits[kk].employees.push(iv.employee.name);
      }
    }
  }
  const aiRank = Object.entries(aiHits)
    .map(([sugg, info]) => ({ sugg, ...info }))
    .sort((a, b) => b.count - a.count);

  // --- 3. Shared bottlenecks ---
  const bottlenecks = interviews
    .map(iv => ({ name: iv.employee.name, text: getAnswer(iv, 'bottlenecks') }))
    .filter(x => x.text && x.text.trim().length > 5);

  // --- 4. Load per division + per role (top 10) ---
  const byDiv = {};
  const byRole = {};
  for (const iv of interviews) {
    const d = iv.employee.division_name || '(ไม่ระบุ)';
    const r = iv.employee.role;
    byDiv[d]  = (byDiv[d]  || 0) + 1;
    byRole[r] = (byRole[r] || 0) + 1;
  }
  const topRoles = Object.entries(byRole).sort((a,b) => b[1]-a[1]).slice(0, 10);

  // --- 5. ROI estimate ---
  const totalFindings = (duplicates.length * 2) + aiRank.reduce((s, a) => s + a.count, 0) + bottlenecks.length;
  const estHours = totalFindings * 2; // crude heuristic

  let md = `# 🔍 รายงานรวมบริษัท — Optimization Report

> วิเคราะห์ workflow ของพนักงาน ${interviews.length} คน
> สร้างเมื่อ ${new Date().toLocaleString('th-TH')}

## 1. งานซ้ำซ้อนข้ามคน/ข้ามแผนก

`;
  if (duplicates.length === 0) {
    md += '_ไม่พบงานที่ทำซ้ำข้ามฝ่ายอย่างชัดเจน_\n\n';
  } else {
    md += '_แสดงเฉพาะงานที่ทำข้ามฝ่าย ≥ 2 ฝ่าย — ไม่รวมประชุม/เช็คอีเมล/งานทั่วไป_\n\n';
    md += '| # | งาน (ตัวอย่าง) | จำนวนคน | ฝ่ายที่เกี่ยวข้อง | ทำโดย (ย่อ) | ข้อเสนอ |\n|---|---|---|---|---|---|\n';
    duplicates.forEach((d, i) => {
      md += `| ${i+1} | ${d.example} | ${d.owners.length} | ${d.divisions.join(', ')} | ${capOwners(d.owners, 5)} | กำหนดเจ้าของงานหลัก 1 ฝ่าย คนอื่นรับ output แทนการทำซ้ำ |\n`;
    });
    md += '\n';
  }

  md += `## 2. งานที่ทั้งบริษัทใช้ AI แทนได้ (เรียงตามผลกระทบ)

`;
  if (aiRank.length === 0) {
    md += '_ไม่พบงานที่ชัดเจนว่า AI แทนได้จากคำตอบปัจจุบัน_\n\n';
  } else {
    md += '| อันดับ | ข้อเสนอ | จำนวนคน | ตัวอย่างคนที่เกี่ยวข้อง | Impact |\n|---|---|---|---|---|\n';
    aiRank.forEach((a, i) => {
      md += `| ${i+1} | ${a.sugg} | ${a.count} | ${capOwners(a.employees, 5)} | ${a.score} |\n`;
    });
    md += '\n';
  }

  md += `## 3. คอขวดร่วม (Shared Bottlenecks)

`;
  if (bottlenecks.length === 0) {
    md += '_ไม่มีคอขวดที่รายงานโดยพนักงาน_\n\n';
  } else {
    // Aggregate by category
    const buckets = {};
    for (const b of bottlenecks) {
      const cat = classifyBottleneck(b.text);
      if (!buckets[cat]) buckets[cat] = [];
      buckets[cat].push(b.name);
    }
    const sorted = Object.entries(buckets).sort((a,b) => b[1].length - a[1].length);
    md += '| ประเภทคอขวด | จำนวนคนที่เจอ | ตัวอย่างคนที่เจอ |\n|---|---|---|\n';
    for (const [cat, names] of sorted) {
      md += `| ${cat} | ${names.length} คน | ${capOwners(names, 5)} |\n`;
    }
    md += '\n';
    // Show top 10 verbatim quotes below, for flavor
    md += '_ตัวอย่างคำพูดของพนักงาน (สุ่ม 10 คน):_\n';
    const sample = bottlenecks.slice(0, 10);
    for (const b of sample) md += `> "${b.text}" — ${b.name}\n`;
    md += '\n> ข้อเสนอ: ฝ่ายที่เป็นคอขวดบ่อยที่สุด ควรถูกตั้งเป็นโครงการ process improvement อันดับแรก\n\n';
  }

  md += `## 4. กระจายพนักงาน

### ตามฝ่าย
| ฝ่าย | จำนวนคน |
|---|---|
`;
  for (const [d, n] of Object.entries(byDiv).sort((a,b)=>b[1]-a[1])) md += `| ${d} | ${n} |\n`;

  md += `\n### Top 10 ตำแหน่งที่มีคนเยอะที่สุด
| ตำแหน่ง | จำนวนคน |
|---|---|
`;
  for (const [r, n] of topRoles) md += `| ${r} | ${n} |\n`;

  md += `\n## 5. ประมาณการ ROI

- จำนวนประเด็นที่พบทั้งหมด: **${totalFindings}**
- เวลาประหยัดโดยประมาณต่อสัปดาห์ (ทั้งบริษัท): **${estHours}–${estHours*2} ชั่วโมง**
- หมายเหตุ: ตัวเลขนี้หยาบมาก ใช้เป็นการประมาณเบื้องต้นเท่านั้น ควร baseline ก่อนวัดผลจริง

---

## แนะนำขั้นตอนต่อไป

1. ทบทวนรายการ **งานซ้ำซ้อน** ในที่ประชุมหัวหน้าทีม ตัดสินใจเจ้าของงาน
2. เลือก **AI use case อันดับ 1-3** ทำ POC ในทีมเล็กก่อน
3. แก้ **คอขวดร่วม** ที่กระทบหลายคน — ตั้ง SLA ระหว่างทีม
4. อินเทอร์วิวรอบสองหลัง 90 วัน เทียบ baseline
`;

  return md;
}

module.exports = {
  SCRIPT,
  getNextQuestion,
  shouldProbe,
  generateDocuments,
  analyzeCompany,
};
