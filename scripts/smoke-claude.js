/**
 * smoke-claude.js — verify the live Claude document engine.
 *
 * Usage (PowerShell, local):
 *   $env:ANTHROPIC_API_KEY="sk-ant-..."; node scripts/smoke-claude.js
 *
 * Usage (droplet / bash):
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/smoke-claude.js
 *
 * It runs one employee through generateDocuments() and a 2-person company
 * through analyzeCompany(), printing the first lines of each generated doc.
 * If you see real, employee-specific Thai prose (not the templated mock), the
 * Claude path is working. No data is written to disk.
 */
const claude = require('./claude-ai');

const iv1 = {
  lang: 'th', schedule: '09-18', finishedAt: new Date().toISOString(),
  employee: { id: 'e1', name: 'สมหญิง ใจดี', role: 'พนักงานขายหน้าร้าน', division_name: 'ฝ่ายขาย', division_id: 'sales' },
  answers: [
    { key: 'warmup', value: 'ดูแลลูกค้าหน้าร้าน แนะนำสินค้า และปิดการขาย' },
    { key: 'hour_9', value: 'เปิดร้าน เช็คสต็อก คีย์ยอดขายเมื่อวานลง Excel ด้วยมือ' },
    { key: 'hour_10', value: 'รับลูกค้าหน้าร้าน ตอบแชทลูกค้าใน Line OA' },
    { key: 'hour_11', value: 'จัดเรียงสินค้า เติมของที่หมด' },
    { key: 'weekly_tasks', value: 'สรุปยอดขายรายสัปดาห์ส่งหัวหน้าทุกวันจันทร์' },
    { key: 'pain_points', value: 'คีย์ยอดขายลง Excel ทุกเช้า เสียเวลามาก ทำซ้ำทุกวัน' },
    { key: 'bottlenecks', value: 'รอราคาสินค้าใหม่จากฝ่ายจัดซื้อ บางทีรอ 2-3 วัน' },
    { key: 'own_kpi', value: 'ยอดขายต่อวัน จำนวนลูกค้าที่ปิดการขายได้' },
    { key: 'ai_wishlist', value: 'อยากให้ AI ช่วยสรุปยอดขายอัตโนมัติ และช่วยตอบลูกค้าใน Line' },
  ],
};

const iv2 = {
  lang: 'th', schedule: '09-18', finishedAt: new Date().toISOString(),
  employee: { id: 'e2', name: 'อนุชา รักงาน', role: 'พนักงานบัญชี', division_name: 'ฝ่ายบัญชี', division_id: 'accounting' },
  answers: [
    { key: 'warmup', value: 'ทำบัญชีรับ-จ่าย และปิดงบรายเดือน' },
    { key: 'hour_9', value: 'คีย์ใบกำกับภาษีเข้าระบบ Express ทีละใบ' },
    { key: 'pain_points', value: 'คีย์ใบกำกับภาษีด้วยมือทุกใบ เดือนละหลายร้อยใบ' },
    { key: 'bottlenecks', value: 'รอเอกสารจากฝ่ายขายมาช้า ทำให้ปิดงบไม่ทัน' },
    { key: 'ai_wishlist', value: 'อยากให้ AI อ่านใบกำกับภาษีแล้วคีย์ให้อัตโนมัติ (OCR)' },
  ],
};

function head(s, n) {
  return String(s || '').split('\n').slice(0, n).join('\n');
}

(async () => {
  console.log('ANTHROPIC_API_KEY set:', claude.isEnabled());
  console.log('model:', claude.MODEL);
  if (!claude.isEnabled()) {
    console.log('\n⚠️  No key — this would only exercise the mock fallback. Set ANTHROPIC_API_KEY and re-run.');
  }

  console.log('\n=== generateDocuments(พนักงานขาย) ===');
  let t = Date.now();
  const docs = await claude.generateDocuments(iv1);
  console.log(`(took ${((Date.now() - t) / 1000).toFixed(1)}s)\n`);
  console.log('--- job-description.md ---\n' + head(docs['job-description.md'], 8) + '\n');
  console.log('--- kpi.md ---\n' + head(docs['kpi.md'], 8) + '\n');
  console.log('--- optimization.md ---\n' + head(docs['optimization.md'], 8) + '\n');
  console.log('mechanical docs still present:',
    ['workflow.md', 'workflow.csv', 'workflow-diagram.md'].every(k => docs[k]));

  console.log('\n=== analyzeCompany(2 คน) ===');
  t = Date.now();
  const report = await claude.analyzeCompany([iv1, iv2]);
  console.log(`(took ${((Date.now() - t) / 1000).toFixed(1)}s)\n`);
  console.log(head(report, 14));

  console.log('\n✅ done');
})().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
