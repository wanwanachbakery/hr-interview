/**
 * stress-test.js
 *
 * Creates 100 fake employees across all divisions,
 * runs full interviews in parallel, measures timing and errors,
 * then triggers company analysis.
 *
 * Usage: node scripts/stress-test.js
 */

const BASE = process.env.BASE || 'http://localhost:3000';
const TOTAL = 100;
const CONCURRENCY = 20; // how many interviews run at once

// --- Data pools (Thai + English mix, realistic) ---------------
const FIRST_NAMES = [
  'สมชาย','สมศรี','มานพ','มาลี','วิชัย','วิภา','ประเสริฐ','ประภา','ณัฐพงษ์','ณัฐชา',
  'ธนากร','ธัญญา','ศิริ','ศรันย์','กิตติ','กนกวรรณ','นพดล','นภา','พิชัย','พิมพ์ชนก',
  'อนุชา','อารีย์','ภาคภูมิ','ภัทรา','John','Mary','Alex','Anna','David','Sarah',
  'Michael','Linda','James','Nina','Peter','Grace','Kevin','Jenny','Tom','Emily',
];
const LAST_NAMES = [
  'ใจดี','รักเรียน','ทองดี','ศรีสุข','คำหวาน','แสงทอง','ประเสริฐ','มั่นคง','สมบูรณ์','ชัยชนะ',
  'Smith','Wong','Lee','Kim','Jones','Park','Chen','Brown','Tan','Garcia',
];

const DIVISION_CONFIG = {
  accounting:  { count: 12, roles: ['Accountant','Senior Accountant','AP Officer','AR Officer','บัญชีต้นทุน','Junior Accountant'],
                 depts: ['บัญชีลูกหนี้','บัญชีเจ้าหนี้','บัญชีต้นทุน','ภาษี'],
                 duties: ['ออกใบกำกับ/ติดตามลูกหนี้','กระทบยอดธนาคาร','ตรวจสอบเอกสารจ่าย','ทำงบทดลอง','รายงาน VAT ภ.พ.30'] },
  marketing:   { count: 10, roles: ['Marketing Executive','Digital Marketer','Content Creator','SEO Specialist','Graphic Designer'],
                 depts: ['Online','Offline','Event','Design'],
                 duties: ['ยิงแอด Facebook/Google','ทำคอนเทนต์ลง IG/TikTok','จัดอีเวนต์รายเดือน','ออกแบบสื่อโปรโมท','วิเคราะห์ข้อมูลลูกค้า'] },
  hr:          { count: 8,  roles: ['HR Officer','Recruiter','HRBP','HR Admin','Payroll'],
                 depts: ['Recruiting','Payroll','Training','ER'],
                 duties: ['คัดเลือกผู้สมัคร','ทำเงินเดือน','จัดอบรม','ดูแลสวัสดิการ','ตรวจเช็คขาดลา'] },
  scm:         { count: 15, roles: ['SCM Officer','Logistics Coordinator','Planner','Import/Export','จัดซื้อในประเทศ'],
                 depts: ['Planning','Logistics','Domestic Purchase','Inbound'],
                 duties: ['วางแผนจัดซื้อ','ติดตามของเข้า','ออกใบสั่งซื้อ PO','ประสานงานซัพพลายเออร์','เจรจาราคา'] },
  scm_inter:   { count: 10, roles: ['Int\'l Purchaser','Import Officer','Shipping Coordinator','Customs Broker Liaison'],
                 depts: ['China','SEA','US/EU','Customs'],
                 duties: ['สั่งของต่างประเทศ','ติดต่อ freight','เคลียร์ศุลกากร','ทำ LC / T/T','ตรวจสอบ Bill of Lading'] },
  operations:  { count: 12, roles: ['Operations Officer','Store Manager','Area Manager','Operations Assistant'],
                 depts: ['Store','Area','Quality','Process'],
                 duties: ['ดูแลหน้าร้าน','ตรวจ SOP','รายงานยอดประจำวัน','จัดการพนักงานในร้าน','แก้ปัญหาลูกค้าหน้างาน'] },
  it:          { count: 7,  roles: ['IT Support','System Admin','Developer','Data Analyst'],
                 depts: ['Support','Infrastructure','Development','Data'],
                 duties: ['แก้ปัญหาคอมพ์พนักงาน','ดูแลเซิร์ฟเวอร์','พัฒนาระบบภายใน','ทำรายงาน BI'] },
  warehouse:   { count: 12, roles: ['Warehouse Officer','Forklift Driver','Picker','Receiving','Shipping'],
                 depts: ['Receiving','Picking','Shipping','Inventory'],
                 duties: ['รับของเข้า','จัดเก็บสินค้า','หยิบสินค้าตามออเดอร์','แพ็คส่ง','ตรวจนับสต็อก'] },
  training:    { count: 8,  roles: ['Trainer','L&D Specialist','Training Coordinator','Instructional Designer'],
                 depts: ['Sales Training','Operations Training','Onboarding','E-Learning'],
                 duties: ['สอนพนักงานใหม่','ออกแบบหลักสูตร','จัดอบรมประจำเดือน','ทำคู่มือ','ประเมินผลอบรม'] },
  bd:          { count: 6,  roles: ['BD Manager','BD Executive','Partnership Manager','Sales Executive'],
                 depts: ['New Business','Partnership','Channel','Strategy'],
                 duties: ['หาพาร์ทเนอร์ใหม่','ประชุมลูกค้าองค์กร','ปิดดีลใหญ่','วิเคราะห์ตลาด','ทำ proposal'] },
};

const ANSWER_TEMPLATES = {
  // Generic scripted answers that vary slightly per employee to simulate real interviews
  warmup:            ['เริ่ม 08:30 เลิก 17:30 ครับ','เริ่ม 09:00 เลิก 18:00 ค่ะ','เริ่ม 08:00 เลิก 17:00 ครับ'],
  morning_first:     ['เช็คอีเมล เปิดระบบ อ่านข้อความ LINE จากทีม','เช็คงานค้าง เปิดระบบทั้งหมด ดู dashboard','ตอบ LINE ลูกค้า เช็ค email ดูรายงานเมื่อวาน'],
  morning_main:      ['ทำงานหลักตามหน้าที่ของตำแหน่ง ใช้เวลา 2-3 ชั่วโมง','ออกใบเสนอราคา/ใบสั่ง, ติดตามงานค้าง, คุยกับทีม','ประมวลผลข้อมูล ทำรายงาน วิเคราะห์ ส่งให้หัวหน้า','ประสานงานข้ามทีม, ทำเอกสารหลัก, รับเรื่องจากลูกค้า'],
  morning_tools:     ['LINE, อีเมล, Google Sheets, ERP','ERP, Excel, LINE OA, ระบบภายใน','Google Workspace, Notion, Slack, ERP'],
  morning_people:    ['หัวหน้าทีม, ทีมข้างเคียง, ลูกค้า','ผู้จัดการ, ทีมบัญชี, ฝ่ายขาย','ทีมเดียวกัน, supplier, ลูกค้า'],
  noon_break:        ['พัก 12:00-13:00','พัก 12:30-13:30','พัก 12:00-13:00 กินข้าวคนเดียวหรือกับทีม'],
  afternoon_main:    ['ประชุมทีม, ทำงานตามแผน, ตอบลูกค้า','โทรประสานงาน, ทำเอกสาร, เข้าประชุม','ออกไปลงพื้นที่, เข้าประชุม Ops, รายงานหัวหน้า'],
  afternoon_reports: ['สรุปงานรายวันส่งหัวหน้า','ทำรายงาน KPI รายวัน ส่งก่อน 17:00','สรุปยอดส่ง LINE กลุ่มทุกเย็น'],
  afternoon_deadline:['ส่งก่อน 17:00','ส่งรายงานก่อน 17:30','ต้องเสร็จก่อนเลิกงาน'],
  evening_closing:   ['เช็คงานครบ, ปิดระบบ, เตรียมของพรุ่งนี้','สรุปส่งหัวหน้า, เตรียมประชุมพรุ่งนี้','ส่งอีเมลปิดวัน, เช็คสต็อก'],
  weekly_tasks:      ['ประชุมทีมทุกจันทร์, ปิดยอดสิ้นเดือน','รายงานสัปดาห์ทุกศุกร์, รายงาน forecast ทุกไตรมาส','ประชุม KPI รายเดือน, review ทุกสัปดาห์'],
  pain_points:       ['ทำสรุปรายงานซ้ำ ๆ เสียเวลา','ต้อง copy ข้อมูลจากหลายระบบมาทำรายงาน','รอ approve จากหัวหน้านาน'],
  bottlenecks:       ['รอบัญชีออกใบกำกับ','รอ sales approve','รอ IT แก้ระบบ','รอคลังตอบเรื่องของ'],
  own_kpi:           ['ยอดงานต่อวัน, ความตรงเวลา, ความถูกต้อง','จำนวนที่ทำได้, feedback ลูกค้า','% error, turnaround time'],
  ai_wishlist:       ['AI สรุปรายงานอัตโนมัติ','AI ช่วยตอบลูกค้าเบื้องต้น','AI ช่วยเขียนอีเมล'],
};

// ---------------------------------------------------------------

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function range(n) { return Array.from({length: n}, (_, i) => i); }

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {'content-type': 'application/json'},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${r.status} ${path} -> ${text.slice(0,200)}`);
  }
  return r.json();
}

async function createEmployee(divId, cfg, idx) {
  return api('/api/employees', {
    method: 'POST',
    body: {
      name: pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES),
      role: pick(cfg.roles),
      division_id: divId,
      department: pick(cfg.depts),
      primary_duty: pick(cfg.duties),
      email: `emp${idx}@jiancha.co`,
    },
  });
}

async function runInterview(empId) {
  await api(`/api/interview/${empId}/start`, { method: 'POST' });
  // Submit all answers with skipProbe so short ones pass through cleanly
  for (const [key, pool] of Object.entries(ANSWER_TEMPLATES)) {
    await api(`/api/interview/${empId}/message`, {
      method: 'POST',
      body: { key, value: pick(pool) + ' (emp ' + empId.slice(-4) + ')', skipProbe: true },
    });
  }
  await api(`/api/interview/${empId}/finish`, { method: 'POST' });
}

// Simple concurrency-limited Promise.all
async function pMap(items, worker, concurrency) {
  const results = new Array(items.length);
  const errors = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await worker(items[i], i); }
      catch (e) { errors.push({ i, err: e.message, item: items[i] }); }
    }
  }
  await Promise.all(range(concurrency).map(run));
  return { results, errors };
}

// -------- Main --------
(async () => {
  console.log(`\n🧪 Stress test: ${TOTAL} employees, concurrency=${CONCURRENCY}\n`);
  console.log('Base:', BASE, '\n');

  // 1) Build list of employees-to-create (div_id, index)
  const plan = [];
  for (const [divId, cfg] of Object.entries(DIVISION_CONFIG)) {
    for (let i = 0; i < cfg.count; i++) plan.push({ divId, cfg, idx: plan.length });
  }
  // If config total != TOTAL, trim/pad
  while (plan.length > TOTAL) plan.pop();
  while (plan.length < TOTAL) {
    const divId = pick(Object.keys(DIVISION_CONFIG));
    plan.push({ divId, cfg: DIVISION_CONFIG[divId], idx: plan.length });
  }

  // 2) Create employees (serial-ish ok, fast endpoint)
  const t0 = Date.now();
  const { results: emps, errors: createErrs } = await pMap(plan, async (p) => {
    return await createEmployee(p.divId, p.cfg, p.idx);
  }, CONCURRENCY);
  const t1 = Date.now();
  console.log(`✅ Created ${emps.filter(Boolean).length}/${TOTAL} employees in ${t1-t0}ms`);
  if (createErrs.length) console.log(`❌ Create errors: ${createErrs.length}`, createErrs.slice(0,3));

  // 3) Run interviews in parallel
  const validEmps = emps.filter(Boolean);
  const { errors: ivErrs } = await pMap(validEmps, async (e) => {
    await runInterview(e.id);
    return true;
  }, CONCURRENCY);
  const t2 = Date.now();
  console.log(`✅ Ran ${validEmps.length - ivErrs.length}/${validEmps.length} interviews in ${t2-t1}ms (avg ${Math.round((t2-t1)/validEmps.length)}ms each)`);
  if (ivErrs.length) console.log(`❌ Interview errors: ${ivErrs.length}`, ivErrs.slice(0,5));

  // 4) Company analysis
  const ana = await api('/api/company/analyze', { method: 'POST' });
  const t3 = Date.now();
  console.log(`✅ Company analysis (${ana.count} employees) in ${t3-t2}ms`);

  // 5) Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Total time:       ', ((t3-t0)/1000).toFixed(1), 's');
  console.log('Employees created:', emps.filter(Boolean).length);
  console.log('Interviews done:  ', validEmps.length - ivErrs.length);
  console.log('Company analysed: ', ana.count);
  console.log('Create errors:    ', createErrs.length);
  console.log('Interview errors: ', ivErrs.length);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
