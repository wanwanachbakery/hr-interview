/**
 * Demo: officer (mali) interviews herself end-to-end.
 * Uses native fetch (Node 18+).
 */
const BASE = 'http://localhost:3000';
let cookie = '';

function setCookieFromRes(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  const m = sc.match(/auth=([^;]+)/);
  if (m) cookie = 'auth=' + m[1];
}
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json', cookie };
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  setCookieFromRes(res);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
const line = (t) => console.log('\n=== ' + t + ' ===');

// Realistic answers for a packer at an online candy company
const ANSWERS = {
  warmup:  'แพ็คขนมตามออเดอร์ที่ออนไลน์ส่งมาให้ ตรวจคุณภาพก่อนปิดกล่อง พิมพ์ใบจ่าหน้า แล้วส่ง Kerry/Flash',
  hour_8:  '08:00 มาถึงคลัง เช็คออเดอร์ค้างจากเมื่อวาน + ออเดอร์ใหม่ที่เพจส่งมา 06:00–08:00',
  hour_9:  '09:00 เริ่มแพ็คล็อตแรก เรียงตามเขตจัดส่ง ขนมแห้งใส่ถุงดูดอากาศ ขนมสดใส่กระดาษกันชน',
  hour_10: '10:00 แพ็คต่อ + คุยกับแอดมินเพจถ้ามีรายละเอียดพิเศษ (ขอข้อความ, ห่อของขวัญ ฯลฯ)',
  hour_11: '11:00 ปริ้นใบจ่าหน้า เรียงกล่องตามเขต รอรถขนส่งมารับ',
  hour_13: '13:00 หลังพักเที่ยง — เริ่มล็อตที่ 2 ออเดอร์ที่เข้ามาช่วงเช้า',
  hour_14: '14:00 แพ็คต่อ + ตรวจสต็อกขนมที่เหลือ แจ้งแอดมินถ้าใกล้หมด',
  hour_15: '15:00 รถขนส่งรอบบ่ายมารับ ตรวจรายการกับ driver',
  hour_16: '16:00 เคลียร์โต๊ะ + ทำความสะอาดที่แพ็ค จัดวัสดุห่อให้พรุ่งนี้',
  hour_17: '17:00 เช็คออเดอร์ที่ยังค้าง บันทึกในกลุ่ม Line ถ้าต้องแพ็คพรุ่งนี้',
  // Shared tail questions — most likely keys
  bored:        'การพิมพ์ใบจ่าหน้าทีละใบเสียเวลา อยากให้มีระบบพิมพ์รวมหลายใบในครั้งเดียว',
  rules:        'ขนมสดต้องส่งไม่เกิน 2 วัน · กล่องน้ำหนักเกิน 5 กก. ใส่กล่องคู่ · ห้ามส่งช่วงฝนตกหนัก',
  people:       'แอดมินเพจ (น้อย) · ทีมจัดซื้อ (กรณีของหมด) · driver Kerry/Flash',
  improvements: 'อยากได้สแกนเนอร์บาร์โค้ดและเครื่องพิมพ์ใบจ่าหน้าที่เร็วกว่านี้ · ระบบแจ้งเตือนสต็อกใกล้หมด',
  pain:         'ช่วงเทศกาลออเดอร์เยอะมาก แพ็คคนเดียวไม่ทัน ต้องโทรเรียกคนช่วย',
};

function answerFor(key) {
  if (ANSWERS[key]) return ANSWERS[key];
  // generic fallback
  return 'ตอบสำหรับคำถาม ' + key + ' — รายละเอียดเพิ่มเติมเฉพาะของพนักงานแพ็คขนม';
}

(async () => {
  line('Login as officer mali');
  console.log(await api('POST', '/api/login', { username: 'mali', password: 'off1234' }));

  line('What employees mali can see (should be only her own)');
  const myEmps = await api('GET', '/api/employees');
  console.log(myEmps.map(e => ({ id: e.id, name: e.name, status: e.interviewStatus })));
  if (!myEmps.length) { console.log('No employee record — exit'); return; }
  const empId = myEmps[0].id;

  line('Start interview');
  const startBody = { lang: 'th', schedule: '08-17' in {} ? '08-17' : '09-18', interviewDate: '2026-05-11' };
  const start = await api('POST', `/api/interview/${empId}/start`, startBody);
  console.log('First question key=', start.question.key);

  line('Answer loop (max 25 turns)');
  let q = start.question;
  let n = 0;
  while (!q.done && n < 25) {
    const ans = answerFor(q.key);
    const r = await api('POST', `/api/interview/${empId}/message`, { key: q.key, value: ans, skipProbe: true });
    if (r.probe) {
      console.log('  probe ignored:', r.probe.slice(0, 40) + '...');
      continue;
    }
    console.log(`  [${q.key}] -> "${ans.slice(0, 50)}${ans.length > 50 ? '...' : ''}"`);
    q = r.question;
    n++;
  }
  console.log(`Answered ${n} turns. done=${q.done}`);

  line('Finish interview → generate JD/KPI/Optimization');
  const fin = await api('POST', `/api/interview/${empId}/finish`);
  console.log('Generated files:', fin.files);

  line('Re-check employee status');
  const after = await api('GET', '/api/employees');
  console.log(after.map(e => ({ name: e.name, status: e.interviewStatus, completedAt: e.completedAt })));
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
