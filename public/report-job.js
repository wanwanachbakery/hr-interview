/* report-job.js — ป๊อปอัป "กำลังวิเคราะห์" ของงานเบื้องหลัง (รายงานรายคน + รายงานภาพรวม)
 *   ReportJob.init({ unit:'กลุ่ม'|'คน', kind:'overview'|'person'|null, onDone: fn })
 *   ReportJob.start(url, body, title)  → สั่งงาน + แสดงความคืบหน้า
 *   ReportJob.resume()                 → เปิดหน้ามาตอนงานยังรันอยู่ → แสดงแถบย่อด้านบน
 * ปุ่ม: ซ่อนหน้าต่าง (งานทำต่อ + แถบย่อ) · ยกเลิกการวิเคราะห์ (หยุดหลังรายการที่กำลังทำเสร็จ)
 */
(function () {
  const TB = () => window.TBASE || '';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let opts = { unit: 'รายการ', kind: null, onDone: null };
  let polling = false, hidden = false, title = '', last = null;
  const $ = (id) => document.getElementById(id);

  function ensureDom() {
    if ($('rj-modal')) return;
    const st = document.createElement('style');
    st.textContent =
      '.rj-modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;align-items:center;justify-content:center}' +
      '.rj-box{background:#fff;border-radius:16px;padding:24px 22px 18px;max-width:440px;width:92%;box-shadow:0 20px 50px rgba(0,0,0,.3);text-align:center}' +
      '.rj-spin{width:44px;height:44px;margin:0 auto;border:4px solid #e0f2fe;border-top-color:#0284c7;border-radius:50%;animation:rj-sp .9s linear infinite}' +
      '@keyframes rj-sp{to{transform:rotate(360deg)}}' +
      '.rj-prog{height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin:12px 0 6px}.rj-prog>div{height:100%;background:#0ea5e9;transition:width .3s}' +
      '.rj-mut{color:#64748b;font-size:13px}.rj-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px}' +
      '.rj-danger{color:#b91c1c !important;border-color:#fecaca !important}.rj-danger:hover{background:#fef2f2 !important}' +
      '.rj-bar{display:none;align-items:center;gap:10px;flex-wrap:wrap;position:sticky;top:58px;z-index:20;background:#e0f2fe;border:1px solid #7dd3fc;color:#0c4a6e;border-radius:10px;padding:8px 12px;margin:0 0 12px;font-size:13px}' +
      '.rj-bar .rj-act{margin-left:auto;display:flex;gap:6px}.rj-bar button{font-size:12px;padding:5px 10px}' +
      '.rj-dot{width:12px;height:12px;border:2px solid #7dd3fc;border-top-color:#0369a1;border-radius:50%;animation:rj-sp .9s linear infinite}' +
      '@media print{.rj-bar,.rj-modal{display:none !important}}';
    document.head.appendChild(st);
    const m = document.createElement('div');
    m.id = 'rj-modal'; m.className = 'rj-modal';
    m.innerHTML = '<div class="rj-box" id="rj-box"></div>';
    document.body.appendChild(m);
    const bar = document.createElement('div');
    bar.id = 'rj-bar'; bar.className = 'rj-bar';
    const host = document.querySelector('body > .container') || document.body;
    host.insertBefore(bar, host.firstChild);
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-rj]');
      if (!b) return;
      const act = b.getAttribute('data-rj');
      if (act === 'hide') { hidden = true; closeModal(); if (last) drawBar(last); }
      else if (act === 'show') { hidden = false; hideBar(); if (last) drawProgress(last); }
      else if (act === 'cancel') cancel();
      else if (act === 'close') { closeModal(); hideBar(); }
    });
  }
  const showModal = (html) => { $('rj-box').innerHTML = html; $('rj-modal').style.display = 'flex'; };
  const closeModal = () => { $('rj-modal').style.display = 'none'; };
  const showBar = (html) => { $('rj-bar').innerHTML = html; $('rj-bar').style.display = 'flex'; };
  const hideBar = () => { $('rj-bar').style.display = 'none'; };

  const stepTxt = (s) => `${Math.min(s.index + 1, s.total)}/${s.total}${s.current ? ' · ' + esc(s.current) : ''}`;
  function drawProgress(s) {
    const pct = s.total ? Math.round((s.index / s.total) * 100) : 0;
    const stopping = s.cancelRequested;
    showModal(`<div class="rj-spin"></div>
      <div style="font-weight:600;color:#0f3d6b;font-size:16px;margin:12px 0 4px;">${esc(title)}</div>
      <div class="rj-mut">${stopping ? '⏹ กำลังหยุด — รอ' + esc(opts.unit) + 'ที่กำลังทำให้เสร็จก่อน…' : 'กำลังวิเคราะห์ <b>' + stepTxt(s) + '</b>'}</div>
      <div class="rj-prog"><div style="width:${pct}%"></div></div>
      <div class="rj-mut" style="font-size:12px;">🧠 ปิดหน้านี้ได้ งานจะทำต่อเบื้องหลัง</div>
      <div class="rj-btns">
        <button class="ghost" data-rj="hide">➖ ซ่อนหน้าต่าง</button>
        ${stopping ? '' : '<button class="ghost rj-danger" data-rj="cancel">⏹ ยกเลิกการวิเคราะห์</button>'}
      </div>`);
  }
  function drawBar(s) {
    const stopping = s.cancelRequested;
    showBar(`<span class="rj-dot"></span><span>${esc(title)} — ${stopping ? 'กำลังหยุด…' : 'กำลังวิเคราะห์ ' + stepTxt(s)}</span>
      <span class="rj-act"><button class="ghost" data-rj="show">ดูความคืบหน้า</button>${stopping ? '' : '<button class="ghost rj-danger" data-rj="cancel">ยกเลิก</button>'}</span>`);
  }
  function drawDone(s) {
    const errs = (s.errors || []).length
      ? `<div style="text-align:left;font-size:12px;color:#b91c1c;margin:8px 0;max-height:140px;overflow:auto;">${s.errors.map(e => '• ' + esc(e)).join('<br>')}</div>` : '';
    const u = esc(opts.unit);
    let icon = '✅', head = 'วิเคราะห์เสร็จแล้ว', sub = `สำเร็จ ${s.done} · ไม่สำเร็จ ${s.failed} · ทั้งหมด ${s.total}`;
    if (s.cancelled) {
      icon = '⏹'; head = 'ยกเลิกแล้ว';
      sub = `เสร็จ ${s.done} จาก ${s.total} ${u} — ${u}ที่เสร็จแล้วเก็บไว้ครบ` +
        (opts.kind === 'person' ? '<br>ที่เหลือกด “สร้างรายงานทุกคนที่ยังไม่มี” ได้ภายหลัง' : '<br>ที่เหลือกด “วิเคราะห์ทั้งหมด → เฉพาะที่มีข้อมูลเปลี่ยน” ได้ภายหลัง') +
        (s.cancelledBy && s.cancelledBy.name ? `<br><span style="font-size:12px;">ยกเลิกโดย ${esc(s.cancelledBy.name)}</span>` : '');
    } else if (s.failed) { icon = '⚠️'; head = 'เสร็จแล้ว (มีบาง' + u + 'ไม่สำเร็จ)'; }
    if (hidden) {
      showBar(`<span>${icon} ${esc(title)} — ${head} · สำเร็จ ${s.done}/${s.total}</span><span class="rj-act"><button class="ghost" data-rj="close">ปิด</button></span>`);
    } else {
      hideBar();
      showModal(`<div style="font-size:42px;">${icon}</div><div style="font-weight:600;color:#0f3d6b;font-size:16px;margin:6px 0;">${head}</div>
        <div class="rj-mut">${sub}</div>${errs}<div class="rj-btns"><button data-rj="close">ปิด</button></div>`);
    }
  }

  async function cancel() {
    if (!confirm(`ยกเลิกการวิเคราะห์?\n\nระบบจะหยุดหลังจาก${opts.unit}ที่กำลังทำอยู่เสร็จ — ${opts.unit}ที่เสร็จแล้วเก็บไว้ครบ`)) return;
    try {
      const r = await fetch(TB() + '/api/report-job/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error || 'ยกเลิกไม่สำเร็จ'); return; }
      if (j.job) { last = j.job; hidden ? drawBar(last) : drawProgress(last); }
    } catch (_) { alert('เชื่อมต่อไม่สำเร็จ'); }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    let fails = 0;
    const tick = async () => {
      let s;
      try { const r = await fetch(TB() + '/api/report-job'); if (!r.ok) throw 0; s = await r.json(); fails = 0; }
      catch (_) {
        if (++fails > 20) { polling = false; showModal('<div style="font-size:38px;">⚠️</div><div style="margin:6px 0;">เชื่อมต่อไม่สำเร็จ — งานอาจยังทำอยู่เบื้องหลัง ลองรีเฟรชภายหลัง</div><div class="rj-btns"><button data-rj="close">ปิด</button></div>'); return; }
        setTimeout(tick, 3000); return;
      }
      last = s;
      if (s.running) { hidden ? drawBar(s) : drawProgress(s); setTimeout(tick, 1500); return; }
      polling = false;
      drawDone(s);
      if (typeof opts.onDone === 'function') { try { await opts.onDone(s); } catch (_) {} }
    };
    tick();
  }

  async function start(url, body, t) {
    ensureDom();
    if (polling) return;
    title = t || 'กำลังวิเคราะห์'; hidden = false;
    showModal('<div class="rj-spin"></div><div style="margin-top:12px;font-weight:600;">กำลังเริ่ม…</div>');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { title = 'มีงานวิเคราะห์อื่นกำลังทำอยู่'; poll(); return; }
      if (!r.ok) throw new Error(j.error || 'สั่งงานไม่สำเร็จ');
      if (j.total === 0) {
        showModal(`<div style="font-size:38px;">👍</div><div style="font-weight:600;color:#0f3d6b;margin:6px 0;">${opts.kind === 'person' ? 'ทุกคนมีรายงานแล้ว' : 'ทุกกลุ่มเป็นปัจจุบันแล้ว'}</div>` +
          (opts.kind === 'person' ? '' : '<div class="rj-mut" style="margin-bottom:6px;">ไม่มีข้อมูลเปลี่ยน — ถ้าต้องการวิเคราะห์ซ้ำ ให้เลือก “วิเคราะห์ใหม่ทั้งหมด”</div>') +
          '<div class="rj-btns"><button data-rj="close">ปิด</button></div>');
        return;
      }
      poll();
    } catch (e) {
      showModal(`<div style="font-size:38px;">⚠️</div><div style="font-weight:600;margin:6px 0;">${esc(e.message)}</div><div class="rj-btns"><button data-rj="close">ปิด</button></div>`);
    }
  }

  // เปิดหน้ามาตอนงานยังรันอยู่ (เช่น รีเฟรช) → แสดงแถบย่อด้านบน ไม่บังหน้าจอ
  async function resume() {
    ensureDom();
    try {
      const r = await fetch(TB() + '/api/report-job');
      if (!r.ok) return;
      const s = await r.json();
      if (!s.running || (opts.kind && opts.kindOnly && s.kind !== opts.kind)) return;
      title = s.kind === 'person' ? 'กำลังสร้างรายงานรายคน' : 'กำลังวิเคราะห์ภาพรวม';
      hidden = true; last = s;
      drawBar(s);
      poll();
    } catch (_) {}
  }

  function init(o) { opts = Object.assign({}, opts, o || {}); ensureDom(); }
  window.ReportJob = { init, start, resume };
})();
