/**
 * scripts/xlsx-report.js — สร้างไฟล์ Excel (.xlsx) รายงานวิเคราะห์ ด้วย exceljs
 *
 * แยกเป็น 2 แบบ:
 *   companyAnalysisWorkbook(data)  → รายงานบริษัท/ฝ่าย/แผนก (5 ชีต: บทสรุป/ธีมปัญหา/โอกาส AI/ข้อเสนอ+Roadmap/ความเสี่ยง)
 *   personProfileWorkbook(data)    → โปรไฟล์รายตำแหน่ง/บุคคล (7 ชีต ครอบคลุม 13 หัวข้อ)
 *   overviewWorkbook(data)         → รายงานภาพรวม v1.17 (1 ชีต/หัวข้อ + ตารางงานแนะนำของตำแหน่ง)
 *
 * รับ "ข้อมูลที่จัดโครงแล้ว" (plain object) จาก server.js — ไฟล์นี้ทำแค่จัดรูปแบบ/สไตล์
 * คืนค่าเป็น ExcelJS.Workbook — ผู้เรียกใช้ workbookBuffer(wb) เพื่อได้ Buffer
 */
'use strict';
const ExcelJS = require('exceljs');

const BLUE = 'FF378ADD';
const DARK = 'FF0F3D6B';
const MUTE = 'FF64748B';
const ZEBRA = 'FFF6F9FC';
const BORDER_C = 'FFD5DDE5';
const FONT = 'Tahoma';

const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
const thin = { style: 'thin', color: { argb: BORDER_C } };
const allBorder = { top: thin, left: thin, right: thin, bottom: thin };
const wrapTop = { vertical: 'top', wrapText: true };
const wrapCenter = { vertical: 'middle', horizontal: 'center', wrapText: true };

function titleBlock(ws, title, subs) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: FONT, bold: true, size: 15, color: { argb: DARK } };
  let r = 2;
  for (const s of (subs || [])) {
    ws.getCell('A' + r).value = s;
    ws.getCell('A' + r).font = { name: FONT, size: 10, color: { argb: MUTE } };
    r++;
  }
  return r + 1; // เว้น 1 บรรทัดก่อนหัวตาราง
}

function headerRow(ws, rowNum, cols) {
  const row = ws.getRow(rowNum);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c;
    cell.fill = headFill;
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.border = allBorder;
    cell.alignment = wrapCenter;
  });
  row.height = 24;
}

// rows: array of arrays. opts.centerCols = [idx...], opts.boldCol0 = bool
function dataRows(ws, startRow, rows, opts = {}) {
  const centerCols = new Set(opts.centerCols || []);
  let r = startRow;
  for (const vals of rows) {
    const row = ws.getRow(r);
    let maxLines = 1;
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v == null ? '' : v;
      cell.border = allBorder;
      cell.alignment = centerCols.has(i) ? wrapCenter : wrapTop;
      cell.font = (opts.boldCol0 && i === 0)
        ? { name: FONT, size: 10, bold: true, color: { argb: DARK } }
        : { name: FONT, size: 10 };
      if ((r - startRow) % 2 === 1) cell.fill = zebraFill;
      const lines = String(v == null ? '' : v).split('\n').length;
      if (lines > maxLines) maxLines = lines;
    });
    row.height = Math.max(opts.minHeight || 18, 15 * maxLines);
    r++;
  }
  return r;
}

function setWidths(ws, widths) { widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }
function freezeAt(ws, rowNum) { ws.views = [{ state: 'frozen', ySplit: rowNum - 1 }]; }

// ============================================================
// A) รายงานวิเคราะห์ บริษัท/ฝ่าย/แผนก — 5 ชีต
// data = { title, subs:[...], sheets:[ { name, lines:[{text,bold,sub}] } x5 ] }
// ============================================================
function companyAnalysisWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Interview';
  for (const sh of data.sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ showGridLines: false }] });
    let r = titleBlock(ws, data.title + (sh.heading ? ' — ' + sh.heading : ''), r0Subs(data.subs, sh));
    headerRow(ws, r, ['รายละเอียด']);
    r++;
    const lines = (sh.lines && sh.lines.length) ? sh.lines : [{ text: '(ยังไม่มีข้อมูล — กรุณากดวิเคราะห์ก่อน)' }];
    const rows = lines.map(l => [l.text]);
    const endR = dataRows(ws, r, rows);
    // ทำ bold/หัวข้อย่อย
    lines.forEach((l, i) => {
      if (l.bold || l.sub) {
        const cell = ws.getCell(r + i, 1);
        cell.font = { name: FONT, size: l.sub ? 12 : 10, bold: true, color: { argb: DARK } };
      }
    });
    setWidths(ws, [110]);
    freezeAt(ws, r);
    void endR;
  }
  return wb;
}
function r0Subs(subs, sh) { return subs; }

// ============================================================
// B) โปรไฟล์รายตำแหน่ง/บุคคล — 7 ชีต (13 หัวข้อ)
// data = {
//   name, position, division, section,
//   profile: [[หัวข้อ, รายละเอียด] x7],
//   kpis: [[kpi, วัดอะไร, สูตร, เป้า, ความถี่] ...],
//   opt:  [[#, ปัญหา, ข้อเสนอ, ผลกระทบ, ความเสี่ยง] ...],
//   workflow: [[ช่วงเวลา, งาน] ...], weekly: '...',
//   problems: [[ประเด็น, รายละเอียด] ...],
//   voice: '...',
//   ai: [ '...', ... ],
//   savedHint: '...'  (ข้อความเตือนถ้าข้อมูลไม่ครบ)
// }
// opts.tabPrefix = เติมหน้าชื่อแท็บ (สำหรับ ZIP หลายคน — ปกติไม่ใส่)
// ============================================================
function personProfileWorkbook(data, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Interview';
  const pre = opts.tabPrefix ? (opts.tabPrefix + '·') : '';
  const sub = [
    `${data.position || '-'} · ${[data.division, data.section].filter(Boolean).join(' / ') || '-'}`,
    `ออกรายงาน ${data.dateStr || ''} · ระบบ HR-Interview${data.version ? ' v' + data.version : ''}`,
  ];

  // ชีต 1: โปรไฟล์ตำแหน่ง (ข้อ 1-7)
  let ws = wb.addWorksheet((pre + 'โปรไฟล์ตำแหน่ง').slice(0, 31), { views: [{ showGridLines: false }] });
  let r = titleBlock(ws, `โปรไฟล์ตำแหน่ง — ${data.name || ''}`, sub);
  headerRow(ws, r, ['หัวข้อ', 'รายละเอียด']); r++;
  dataRows(ws, r, data.profile || [], { boldCol0: true, minHeight: 28 });
  setWidths(ws, [28, 92]); freezeAt(ws, r);

  // ชีต 2: KPI (ข้อ 8)
  ws = wb.addWorksheet((pre + 'KPI').slice(0, 31), { views: [{ showGridLines: false }] });
  r = titleBlock(ws, `KPI — ${data.name || ''}`, ['8. ตัวชี้วัด พร้อมวิธีวัด · ควรทบทวนร่วมกับหัวหน้า']);
  headerRow(ws, r, ['KPI', 'สิ่งที่วัด', 'สูตร/วิธีวัด', 'เป้าหมาย', 'ความถี่']); r++;
  dataRows(ws, r, (data.kpis && data.kpis.length) ? data.kpis : [['(ยังไม่มีข้อมูล KPI)', '', '', '', '']], { centerCols: [3, 4], minHeight: 28 });
  setWidths(ws, [32, 34, 32, 22, 16]); freezeAt(ws, r);

  // ชีต 3: Optimization (ข้อ 9)
  ws = wb.addWorksheet((pre + 'Optimization').slice(0, 31), { views: [{ showGridLines: false }] });
  r = titleBlock(ws, `Optimization — ${data.name || ''}`, ['9. ข้อเสนอปรับปรุงงาน']);
  headerRow(ws, r, ['#', 'ปัญหา', 'ข้อเสนอ', 'ผลกระทบ', 'ความเสี่ยง']); r++;
  dataRows(ws, r, (data.opt && data.opt.length) ? data.opt : [['', '(ยังไม่มีข้อเสนอ)', '', '', '']], { centerCols: [0, 3], minHeight: 26 });
  setWidths(ws, [5, 40, 44, 11, 22]); freezeAt(ws, r);

  // ชีต 4: ข้อ 10 — v1.17 ตารางงาน (วัน/สัปดาห์/เดือน/ไตรมาส/ปี) ถ้ามีรายงานรายคนแล้ว · ไม่งั้นใช้ Workflow จากสัมภาษณ์
  if (data.schedule && data.schedule.length) {
    ws = wb.addWorksheet((pre + 'ตารางงาน').slice(0, 31), { views: [{ showGridLines: false }] });
    r = titleBlock(ws, `ตารางงาน — ${data.name || ''}`, ['10. ตารางงาน (วัน/สัปดาห์/เดือน/ไตรมาส/ปี) — อนุมานจากบันทึกงานจริง']);
    headerRow(ws, r, ['ช่วง', 'เวลา/ช่วงในวัน', 'งาน', 'เป้าหมาย/ผลที่คาดหวัง', 'หมายเหตุ']); r++;
    dataRows(ws, r, data.schedule.map(x => [x[0], x[1] || '-', x[2] || '-', x[3] || '-', x[4] || '']), { boldCol0: true, centerCols: [1], minHeight: 22 });
    setWidths(ws, [14, 16, 44, 34, 22]); freezeAt(ws, r);
  } else {
    ws = wb.addWorksheet((pre + 'Workflow').slice(0, 31), { views: [{ showGridLines: false }] });
    r = titleBlock(ws, `Workflow — ${data.name || ''}`, ['10. ขั้นตอนงานประจำวัน/สัปดาห์']);
    headerRow(ws, r, ['ช่วงเวลา', 'งานที่ทำ']); r++;
    const endR = dataRows(ws, r, (data.workflow && data.workflow.length) ? data.workflow : [['', '(ยังไม่มีข้อมูล)']], { centerCols: [0], minHeight: 22 });
    if (data.weekly) {
      const wr = ws.getRow(endR + 1);
      wr.getCell(1).value = 'รายสัปดาห์'; wr.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: DARK } }; wr.getCell(1).border = allBorder; wr.getCell(1).alignment = wrapTop;
      wr.getCell(2).value = data.weekly; wr.getCell(2).font = { name: FONT, size: 10 }; wr.getCell(2).border = allBorder; wr.getCell(2).alignment = wrapTop;
    }
    setWidths(ws, [16, 80]); freezeAt(ws, r);
  }

  // ชีต 5: ปัญหา/คอขวด (ข้อ 11)
  ws = wb.addWorksheet((pre + 'ปัญหา-คอขวด').slice(0, 31), { views: [{ showGridLines: false }] });
  r = titleBlock(ws, `ปัญหา / คอขวด — ${data.name || ''}`, ['11. ปัญหา/คอขวดที่เจอ (จากคำบอกเล่าจริง)']);
  headerRow(ws, r, ['ประเด็น', 'รายละเอียด']); r++;
  dataRows(ws, r, (data.problems && data.problems.length) ? data.problems : [['', '(ยังไม่มีข้อมูล)']], { boldCol0: true, minHeight: 28 });
  setWidths(ws, [28, 82]); freezeAt(ws, r);

  // ชีต 6: เสียงพนักงาน / KPI ดิบ (ข้อ 12)
  ws = wb.addWorksheet((pre + 'เสียงพนักงาน').slice(0, 31), { views: [{ showGridLines: false }] });
  r = titleBlock(ws, `ตัวชี้วัดที่พนักงานรู้สึก (ดิบ) — ${data.name || ''}`, ['12. คำพูดดิบจากการสัมภาษณ์ ใช้ตั้ง KPI']);
  headerRow(ws, r, ['หัวข้อ', 'คำตอบดิบ']); r++;
  dataRows(ws, r, [['พนักงานคิดว่าควรวัดอะไร', data.voice || '(ยังไม่มีข้อมูล)']], { boldCol0: true, minHeight: 40 });
  setWidths(ws, [28, 82]); freezeAt(ws, r);

  // ชีต 7: งานที่อยากให้ AI ช่วย (ข้อ 13)
  ws = wb.addWorksheet((pre + 'AIที่อยากให้ช่วย').slice(0, 31), { views: [{ showGridLines: false }] });
  r = titleBlock(ws, `งานที่อยากให้ AI ช่วย — ${data.name || ''}`, ['13. จากคำตอบจริง ใช้จัดลำดับความต้องการ']);
  headerRow(ws, r, ['#', 'สิ่งที่อยากให้ AI/ระบบช่วย']); r++;
  const aiRows = (data.ai && data.ai.length) ? data.ai.map((a, i) => [String(i + 1), a]) : [['', '(ยังไม่มีข้อมูล)']];
  dataRows(ws, r, aiRows, { centerCols: [0], minHeight: 22 });
  setWidths(ws, [5, 80]); freezeAt(ws, r);

  return wb;
}

// ============================================================
// C) รายงานภาพรวม v1.17 — 1 ชีตต่อ 1 หัวข้อ (+ ชีตตารางงานของตำแหน่ง)
// data = { title, subs:[...], kind:'scope'|'position', sections:[{icon,title,body}],
//          schedule:[[ช่วง, คนที่('0'=ทุกคน), เวลา, งาน, เป้าหมาย]], headcount:{current,recommended,reason} }
// ============================================================
const sheetName = (s) => String(s).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31);
// ไทม์ไลน์หลายคน: rows=[ช่วง, คนที่, "HH:MM–HH:MM", งาน, เป้าหมาย] → [[เวลา, งานคนที่1..n]] ช่วงเวลาตรงกันทุกคอลัมน์
function alignTimeline(rows, n) {
  const hours = {}, extra = [];
  for (const x of rows) {
    const m = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(String(x[2] || '').trim());
    const slot = Number(x[1]) || 0;
    if (!m) { extra.push(x); continue; }
    let a = +m[1], b = +m[3];
    if (b <= a) b += 24;
    for (let h = a; h < b; h++) {
      const H = hours[h] || (hours[h] = Array(n).fill(''));
      if (slot >= 1 && slot <= n) H[slot - 1] = x[3] || ''; else H.fill(x[3] || '');
    }
  }
  const p = (h) => String(h % 24).padStart(2, '0') + ':00';
  const hs = Object.keys(hours).map(Number).sort((a, b) => a - b), out = [];
  for (let i = 0; i < hs.length;) {
    let j = i;
    const sig = hours[hs[i]].join('|');
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1 && hours[hs[j + 1]].join('|') === sig) j++;
    out.push([p(hs[i]) + '–' + p(hs[j] + 1)].concat(hours[hs[i]]));
    i = j + 1;
  }
  for (const x of extra) { const c = Array(n).fill(''), s = Number(x[1]) || 0; if (s >= 1 && s <= n) c[s - 1] = x[3]; else c.fill(x[3]); out.push([x[2] || '-'].concat(c)); }
  return out;
}
function linesSheet(wb, name, title, subs, lines) {
  const ws = wb.addWorksheet(sheetName(name), { views: [{ showGridLines: false }] });
  let r = titleBlock(ws, title, subs);
  headerRow(ws, r, ['รายละเอียด']); r++;
  const ls = (lines && lines.length) ? lines : [{ text: '(ยังไม่มีข้อมูล)' }];
  dataRows(ws, r, ls.map(l => [l.text]));
  ls.forEach((l, i) => { if (l.bold) ws.getCell(r + i, 1).font = { name: FONT, size: 11, bold: true, color: { argb: DARK } }; });
  setWidths(ws, [110]); freezeAt(ws, r);
  return ws;
}
function overviewWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Interview';
  const subs = data.subs || [];
  const toLines = (body) => String(body || '').split('\n').filter(t => t.trim()).map(t => ({ text: t }));
  (data.sections || []).forEach((s, i) => {
    const short = s.title.replace(/\s*[&/]\s*/g, '-').replace(/\s+/g, ' ');
    const isSched = data.kind === 'position' && /ตาราง/.test(s.title);
    if (isSched) {
      const rows = data.schedule || [];
      const hc = data.headcount || {};
      const maxSlot = rows.reduce((m, x) => Math.max(m, Number(x[1]) || 0), 0);
      const n = Math.max(Number(hc.recommended) || 1, maxSlot, 1);
      const ws = wb.addWorksheet(sheetName(`${i + 1}.${short}`), { views: [{ showGridLines: false }] });
      let r = titleBlock(ws, `${data.title} — ${s.title}`, subs.concat([n > 1 ? `แบ่งงาน ${n} คน (คอลัมน์ คนที่ 1..${n})` : 'ทำได้โดย 1 คน']));
      const day = rows.filter(x => x[0] === 'ทุกวันทำงาน');
      const other = rows.filter(x => x[0] !== 'ทุกวันทำงาน');
      const label = (txt) => { const row = ws.getRow(r); row.getCell(1).value = txt; row.getCell(1).font = { name: FONT, size: 11, bold: true, color: { argb: DARK } }; r++; };
      // (1) 1 วันทำงานปกติ — หลายคนจัดช่วงเวลาให้ตรงกันทุกคอลัมน์
      label('1 วันทำงานปกติ ต้องทำอะไรบ้าง');
      const head1 = n > 1 ? ['เวลา'].concat(Array.from({ length: n }, (_, k) => `คนที่ ${k + 1}`)) : ['เวลา', 'งานที่ต้องทำ', 'เป้าหมาย'];
      headerRow(ws, r, head1); const firstData = ++r;
      const dayRows = n > 1 ? alignTimeline(day, n).map(x => x.map(c => c || '-')) : day.map(x => [x[2] || '-', x[3] || '-', x[4] || '-']);
      r = dataRows(ws, r, dayRows.length ? dayRows : [['(ยังไม่มีข้อมูล)'].concat(Array(head1.length - 1).fill(''))], { boldCol0: true, minHeight: 20 });
      // (2)+(3) งานเฉพาะบางวัน + รายสัปดาห์–รายปี
      if (other.length) {
        r++; label('งานเฉพาะบางวัน / รายสัปดาห์ / เดือน / ไตรมาส / ปี');
        const head2 = ['ช่วง'].concat(n > 1 ? ['คนที่'] : []).concat(['เวลา', 'งาน', 'เป้าหมาย']);
        while (head2.length < head1.length) head2.push('');
        headerRow(ws, r, head2); r++;
        dataRows(ws, r, other.map(x => [x[0]].concat(n > 1 ? [Number(x[1]) >= 1 ? 'คนที่ ' + Number(x[1]) : 'ทุกคน'] : []).concat([x[2] || '-', x[3] || '-', x[4] || '-'])), { boldCol0: true, minHeight: 20 });
      }
      setWidths(ws, n > 1 ? [16].concat(Array(Math.max(n, 4)).fill(Math.max(24, Math.floor(100 / Math.max(n, 4))))) : [16, 50, 36, 30, 30]);
      freezeAt(ws, firstData);
      return;
    }
    let lines = toLines(s.body);
    if (data.kind === 'position' && i === 0 && data.headcount) {
      lines = [{ text: `แนะนำ ${data.headcount.recommended} คน (ปัจจุบัน ${data.headcount.current} คน)`, bold: true }].concat(lines);
    }
    linesSheet(wb, `${i + 1}.${short}`, `${data.title} — ${s.title}`, subs, lines);
  });
  if (!wb.worksheets.length) linesSheet(wb, 'รายงาน', data.title, subs, []);
  return wb;
}

async function workbookBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { companyAnalysisWorkbook, personProfileWorkbook, overviewWorkbook, workbookBuffer };
