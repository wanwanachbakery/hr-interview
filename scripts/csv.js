/**
 * scripts/csv.js — serializer กลางสำหรับสร้าง CSV ฝั่ง server ตัวเดียวของทั้งระบบ.
 *
 * รวม defense ไว้จุดเดียว (ห้าม concat CSV เองที่อื่น):
 *   - formula-injection defense: prefix ' ให้ cell ที่ขึ้นต้นด้วย  = + - @  หรือ TAB/CR
 *   - RFC-4180 quote-escaping: ครอบด้วย " เมื่อมี " , CR LF และ escape " → ""
 *   - UTF-8 BOM: ให้ Excel อ่านภาษาไทยถูก
 *   - CRLF line endings
 */
'use strict';

const BOM = '﻿';

// ตัดฤทธิ์สูตร: cell ที่ขึ้นต้นด้วย = + - @ หรือ TAB(0x09)/CR(0x0D) ถูก Excel/Sheets
// ตีความเป็นสูตร/คำสั่ง → นำหน้าด้วย ' เพื่อบังคับให้เป็นข้อความ
function neutralizeFormula(v) {
  if (v && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

// escape หนึ่ง cell ตาม RFC-4180 (หลังตัดฤทธิ์สูตรแล้ว)
function escapeCell(value) {
  let v = value == null ? '' : String(value);
  v = neutralizeFormula(v);
  if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

// rows: array ของ array (แถวแรกมักเป็น header) → สตริง CSV พร้อม BOM + CRLF
function toCsv(rows) {
  const body = (rows || [])
    .map(row => (Array.isArray(row) ? row : [row]).map(escapeCell).join(','))
    .join('\r\n');
  return BOM + body;
}

// ชื่อไฟล์ดาวน์โหลดปลอดภัย: allowlist สำหรับ ascii fallback (กัน header/path injection)
// + filename*=UTF-8'' สำหรับชื่อไทย/อักขระพิเศษ. คืนค่า header ที่ใส่ใน
// Content-Disposition ได้ตรง ๆ.
function contentDisposition(name, fallback = 'download.csv') {
  const raw = String(name || '').trim() || fallback;
  const ascii = (raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)) || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

module.exports = { toCsv, escapeCell, neutralizeFormula, contentDisposition, BOM };
