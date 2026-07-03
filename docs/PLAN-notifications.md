# แผนงาน — ระบบแจ้งเตือนกรอกงานรายชั่วโมงเข้ามือถือจริง (PWA + Web Push)

> เอกสารนี้เป็น "แผนสำหรับ developer หยิบไปทำต่อ" — ยังไม่ใช่โค้ดจริง
> ผู้เขียน: Planner · วันที่: 2026-07-03 · โปรเจกต์: HR-Interview (Node/Express, JSON storage, multi-tenant)

---

## 0. สรุปสั้น (TL;DR)

- **เป้าหมาย**: พนักงานได้ noti เด้งเข้ามือถือจริง "เฉพาะเมื่อชั่วโมงที่ผ่านมายังไม่ได้กรอก" ในเวลาทำงานของแต่ละคน ข้ามพักเที่ยง/วันหยุดบริษัท/วันลา
- **เทคโนโลยี**: PWA (manifest + service worker) + Web Push (VAPID, npm `web-push`) — ฟรี ไม่พึ่ง LINE
- **ทำงานได้เพราะ**: production อยู่หลัง Cloudflare Tunnel = HTTPS จริง (Web Push/SW บังคับ HTTPS) และ deploy เป็น PM2 process เดียว (scheduler ในโปรเซสเดียวใช้ได้ทันที ไม่ต้องมี worker แยก)
- **ขนาดงานรวม: กลาง–ใหญ่** (แบ่ง 5 เฟส · เฟส 1–2 เล็ก, เฟส 3 กลาง, เฟส 4 ใหญ่สุด คือ scheduler)
- **ลำดับที่แนะนำ**: PWA พื้นฐาน → ปุ่ม "ทดสอบแจ้งเตือน" (ต้นแบบพิสูจน์ push จริง) → subscribe/บันทึก → scheduler เต็ม → ปุ่มเปิด/ปิด (พนักงาน + admin)

---

## 1. บริบทจากโค้ดจริง (อ่านแล้ว — อ้างอิงเลขบรรทัด `server.js`)

จุดที่ต้องเข้าใจก่อนแตะโค้ด (เพื่อให้ต่อของเดิมได้เนียน ไม่พังของที่มีอยู่):

| เรื่อง | ตำแหน่ง | สิ่งที่ต้อง reuse / ระวัง |
|---|---|---|
| เวลาทำงานรายคน → ชั่วโมงที่ต้องกรอก | `calcUserHours(user)` ~347 | คืน `{start,end,lunchStart,lunchEnd,hours[]}` โดย **ตัดพักเที่ยงออกแล้ว** — scheduler ใช้ `hours[]` ตรวจว่าชั่วโมงก่อนหน้าอยู่ในเวลางานไหม (null = user ยังไม่ตั้งเวลา → ไม่เตือน) |
| สร้างตารางชั่วโมง + สถานะกรอก/ไม่กรอก | `buildWorklogForUser(db,user,date)` ~1560 | คืน `entries[{hour,items}]`, `filled`, `holiday`, `dayOff` — scheduler เช็ค "ชั่วโมง H กรอกหรือยัง" ได้จาก `entries.find(e=>e.hour===H).items.length` |
| วันหยุดบริษัท | `loadHolidaySet(db)` ~1546, `isCompanyHoliday(hs,date)` ~1550 | reuse ตรง ๆ — ถ้าเป็นวันหยุด/วันลาให้ **ข้าม ไม่เตือน** |
| สถานะ reminder เดิม (in-app) | `GET /api/worklog/status` ~1626 | ตรรกะ "วันหยุด/ลา → complete=true" มีอยู่แล้ว scheduler ยึดหลักเดียวกัน |
| อ่าน/เขียน worklog รายวัน | `db.loadWorklog(uid,date)` ~196, `db.saveWorklog` ~197 | ไฟล์ `data/tenants/<tid>/worklogs/<uid>/<YYYY-MM-DD>.json` |
| tenant db (ไม่ผ่าน HTTP) | `tenantDb(id)` ~148, `loadTenants()` ~233 | **สำคัญมาก**: scheduler ไม่มี ALS context → ต้องเรียก `tenantDb(t.id)` ตรง ๆ วนจาก `loadTenants()` (เลียน pattern background job ที่ `reanalyze-all` ~1185 ที่ capture `const db = ctxDb()` ก่อน context หมด) |
| accessors ต่อ tenant | `tenantDb` return object ~166–202 | เพิ่ม accessor ใหม่สำหรับ push-subs และ notify-settings ที่นี่ (เลียน `holidays`/`saveHolidays` ~180/191) |
| static + no-cache | `express.static setHeaders` ~496 | `.html/.js/.css/.md` ได้ `Cache-Control: no-cache` แล้ว — **`sw.js`/`manifest.json` เข้าเงื่อนไข `.js`? → `sw.js` เข้า, `manifest.json` ยังไม่เข้า** ต้องเพิ่ม `manifest|json` (ดูข้อ 8.4) |
| mount tenant | `app.use('/t/:tenantId', tenantRouter)` ~2326 | ทุก route ใต้ `/t/:tenantId` — SW scope ต้องระวัง (ดูข้อ 2.3) |
| จุดตั้ง scheduler | `app.listen` ~2513 | เรียก `startReminderScheduler()` ใน callback ของ listen (หลัง server ขึ้น) |
| pattern toggle ระดับบริษัท | `GET/PUT /api/admin/claude` ~1138/1153 | เลียนแบบทำ toggle "เปิดแจ้งเตือนทั้งบริษัท" (แต่ **ไม่ต้อง** ขอรหัส admin ซ้ำก็ได้ — ความเสี่ยงต่ำกว่า Claude ที่มีค่าใช้จ่าย) |
| timezone bug ที่ต้องแก้ | `todayLocal()` ~1540 = `toLocaleDateString('en-CA')` **ไม่ระบุ tz** (ใช้ tz ของ server) | บน droplet ถ้า tz ไม่ใช่ Asia/Bangkok จะเพี้ยน — scheduler **ต้องคำนวณเวลาไทยเอง** (ดูข้อ 3.3) ใช้ pattern เดียวกับ `/api/schedules` ~1346 ที่ใช้ `{ timeZone: 'Asia/Bangkok' }` |

**สภาพปัจจุบัน**: มีแค่ in-app banner (`index.html` ~116, toggle `localStorage.worklog_remind` ที่ `worklog.html` ~358). **ยังไม่มี** `manifest.json`, `sw.js`, และ dependency `web-push`/`node-cron` (ดู `package.json` — มีแค่ express/xlsx/anthropic-sdk).

---

## 2. PWA (Progressive Web App)

### 2.1 `public/manifest.json` (ไฟล์ใหม่ — static เดียวใช้ร่วมทุก tenant)
ฟิลด์ที่ต้องมี:
- `name`: "HR-Interview — บันทึกงาน" · `short_name`: "บันทึกงาน"
- `display`: `standalone` · `theme_color`: `#0284c7` (สีฟ้าเดียวกับ progress bar) · `background_color`: `#ffffff`
- `icons`: 192x192 และ 512x512 (ดูข้อ 2.2) + แนะนำเพิ่ม `purpose: "any maskable"` 512 อีกตัว
- `start_url`: **ปัญหา multi-tenant** — start_url ต้องชี้เข้า `/t/<tid>/worklog` ของแต่ละบริษัท แต่ manifest เป็นไฟล์ static เดียว
  - **ทางเลือก A (แนะนำ)**: ใช้ start_url แบบ relative `"."` หรือ `"worklog"` แล้ว **ผูก manifest แบบ per-tenant** โดยเพิ่ม route `GET /t/:tenantId/manifest.json` (dynamic) ที่ generate JSON โดยใส่ `start_url: "/t/<tid>/worklog"`, `scope: "/t/<tid>/"`, `name` = ชื่อบริษัทจริง (จาก `db.company().name`). ทุกหน้าใต้ tenant ลิงก์ `<link rel="manifest" href="/t/<tid>/manifest.json">`
  - **ทางเลือก B (ง่ายกว่าแต่ start_url ไม่ตรง)**: static manifest.json ตัวเดียว, ยอมให้ start_url เป็น `/` (จะเด้งไป super-login) — **ไม่แนะนำ** เพราะ UX แย่ตอนเปิดจาก home screen
  - **สรุป: ใช้ทางเลือก A** — manifest เป็น dynamic route ต่อ tenant

### 2.2 ไอคอน (192 / 512)
- **วิธีง่ายสุด**: ใช้ `public/logo.png` เดิม → สร้าง 2 ขนาด (`public/icon-192.png`, `public/icon-512.png`) ด้วยเครื่องมือ resize (เช่น squoosh.app หรือ ImageMagick `magick logo.png -resize 192x192 icon-192.png`)
  - ต้องเช็คว่า `logo.png` เป็นสี่เหลี่ยมจัตุรัสหรือไม่ ถ้าไม่ ให้ pad พื้นหลังขาว/theme color ให้เป็นจัตุรัสก่อน resize (ไอคอน PWA ควรเป็นจัตุรัส)
- ไม่ต้องพึ่ง build tool — commit ไฟล์ png 2 ตัวเข้า `public/` ได้เลย (ไม่ใช่ secret)

### 2.3 Service Worker `public/sw.js` (ไฟล์ใหม่) + การ register
หน้าที่ SW: (1) รับ event `push` → แสดง notification, (2) event `notificationclick` → เปิด/โฟกัสหน้า worklog ของ tenant นั้น
- **เรื่อง scope ที่ต้องระวังที่สุด**: SW คุมได้แค่ path ภายใต้ scope ของมัน โดย scope = โฟลเดอร์ที่ไฟล์ SW ถูกเสิร์ฟ
  - ถ้า register `navigator.serviceWorker.register('/sw.js')` → scope = `/` (ครอบทุก tenant) — ทำงานได้ แต่ปนกันทุกบริษัทในตัว SW เดียว (ยอมรับได้ เพราะ subscription เก็บฝั่ง server แยก tenant อยู่แล้ว)
  - **แนวทางแนะนำ**: register ที่ path root `/sw.js` ด้วย `{ scope: '/' }` (ค่า default) — SW ตัวเดียวพอ ไม่ต้องทำ per-tenant SW เพราะ push payload จะพก URL ปลายทาง (`/t/<tid>/worklog`) มาเองใน notificationclick
  - ระวัง: ถ้าจะให้ scope แคบเป็น `/t/<tid>/` ต้องเสิร์ฟ sw.js จาก path นั้นและใส่ header `Service-Worker-Allowed` — ซับซ้อนโดยไม่จำเป็น → **ไม่ทำ**
- **จุด register**: ใส่ใน `public/app-shell.js` (โหลดทุกหน้า tenant อยู่แล้ว) — register หลัง DOMContentLoaded, ครอบ try/catch, เช็ค `'serviceWorker' in navigator`
- **notificationclick**: `event.notification.data.url` (server ใส่มาใน payload) → `clients.matchAll()` ถ้ามี tab เปิดอยู่ให้ `focus()` ไม่งั้น `clients.openWindow(url)`
- **bump cache**: register ด้วย `?v=` และ bump เมื่อแก้ sw.js (ตามบทเรียนทีมเรื่อง cache) — แต่ SW มี lifecycle ของตัวเอง อาจต้อง `self.skipWaiting()` + `clients.claim()` เพื่อให้ SW ใหม่ทำงานทันที

---

## 3. Web Push (VAPID) — ฝั่ง server

### 3.1 VAPID keys = ความลับ (ห้าม commit)
- ใช้ npm `web-push` → `webpush.generateVAPIDKeys()` ได้ `{publicKey, privateKey}`
- **สร้างครั้งแรกอัตโนมัติ** ตอน server boot (เลียน pattern `SECRET_FILE` ~99–105): ถ้าไม่มี `data/_vapid.json` ให้ generate แล้วเขียนลง `data/_vapid.json` = `{ publicKey, privateKey, subject: "mailto:it@wanwanach.com", created_at }`
- `data/` อยู่ใน `.gitignore` แล้ว (บรรทัด 10) → private key ไม่หลุด git ✅ (ยืนยันแล้ว)
- **สำคัญ**: VAPID key **generate ครั้งเดียวห้ามเปลี่ยน** — ถ้าเปลี่ยนหลัง user subscribe แล้ว subscription เดิมจะใช้ไม่ได้ทั้งหมด (ต้อง resubscribe ใหม่หมด). ห้ามลบ `data/_vapid.json` บน droplet → ใส่ในคู่มือ deploy ให้ backup รวมกับ `data/`
- public key เท่านั้นที่ส่งให้ client

### 3.2 Endpoints ใหม่ (ใต้ `tenantRouter`, ต้องล็อกอิน — reuse `authMiddleware`)
| Method + Path | หน้าที่ | หมายเหตุ |
|---|---|---|
| `GET /api/push/key` | คืน `{ publicKey }` ให้ client ใช้ subscribe | อ่านจาก `_vapid.json` (cache ในตัวแปร module) |
| `POST /api/push/subscribe` | รับ `PushSubscription` (endpoint+keys) จาก browser → เก็บผูกกับ user ปัจจุบัน + tenant | dedupe ด้วย `endpoint` (อุปกรณ์เดิม subscribe ซ้ำ = update ไม่เพิ่ม) |
| `POST /api/push/unsubscribe` | ลบ subscription ของ endpoint นั้นออก | ใช้ตอนกดปิดที่หน้า worklog |
| `POST /api/push/test` | ส่ง push จริงไปทุก subscription ของ user นี้ทันที | ปุ่มพิสูจน์ระบบ (ต้นแบบเฟส 2) |

- ทุก endpoint ดึง `user_id` จาก `req.session.user_id`, tenant จาก `req.tenant.id` → **push ข้ามบริษัทเป็นไปไม่ได้** เพราะเก็บแยกโฟลเดอร์ tenant (ดูข้อ 3.4)

### 3.3 Scheduler (ในโปรเซสเดียว) — หัวใจของงาน
- **กลไก**: เลือกได้ 2 ทาง (ดูข้อดี/ข้อเสียในข้อ 5) → **แนะนำ `setInterval` ทุก ~5 นาที** (ลด dependency) หรือ `node-cron` `"*/5 * * * *"`
- **ฟังก์ชันหลัก** `checkAndSendReminders()` ทำทุกครั้งที่ tick:
  1. คำนวณ **เวลาไทยปัจจุบัน** เอง (อย่าพึ่ง server tz): ใช้ `new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })` แปลงเป็น `{ dateStr: YYYY-MM-DD, hour: HH }` — ต้องมี helper `nowBangkok()`
  2. หา **"ชั่วโมงเป้าหมายที่ต้องตรวจ"** = ชั่วโมงที่ **เพิ่งจบไป** = `hour - 1` (เช่น เวลา 11:05 → ตรวจว่าช่อง 10:00–11:00 กรอกหรือยัง). กติกา: เตือนเรื่องชั่วโมงที่ผ่านมา ไม่ใช่ชั่วโมงปัจจุบันที่ยังทำอยู่
  3. วน `loadTenants()` → แต่ละ tenant `const db = tenantDb(t.id)`
     - ข้ามถ้า **admin ปิดฟีเจอร์เตือนของบริษัทนี้** (`db.notifySettings().enabled === false`, ดูข้อ 4)
     - `if (isCompanyHoliday(loadHolidaySet(db), dateStr)) continue;` (ทั้งบริษัทหยุด — ข้าม)
  4. วน `db.users()` (เฉพาะที่ไม่ใช่ admin และมี `calcUserHours(user)` ไม่เป็น null):
     - ชั่วโมงเป้าหมาย `H` ต้องอยู่ใน `calcUserHours(user).hours` (คือในเวลางานเขา และไม่ใช่พักเที่ยง) — ไม่งั้นข้าม
     - `const wl = db.loadWorklog(user.id, dateStr)` → ถ้ามี `wl.dayOff` (ลา/สลับหยุด) → ข้าม
     - ตรวจ "ช่อง H กรอกยัง": นับ entry ที่ `hour===H && task.trim()` — ถ้ามีแล้ว → ข้าม (กรอกครบแล้วไม่กวน)
     - ตรวจ **กันส่งซ้ำ** (ข้อ 3.5): ถ้าเคยส่ง `user+date+H` แล้ว → ข้าม
     - ผ่านทุกด่าน → ส่ง push ไปทุก subscription ของ user นี้ + บันทึกว่าเตือน `user+date+H` แล้ว
  5. payload push: `{ title: "⏰ อย่าลืมบันทึกงาน", body: "ชั่วโมง HH:00–HH:00 ยังไม่ได้กรอก", data: { url: "/t/<tid>/worklog" } }`
- **ต้องเป็น async ป้องกัน error ล้ม loop**: ห่อ try/catch ต่อ user, ต่อ tenant — user คนเดียวพังห้ามล้มทั้งรอบ

### 3.4 เก็บ subscription ที่ไหน — โครงสร้างไฟล์
- **ต่อ tenant, ต่อ user**: `data/tenants/<tid>/push-subs.json`
  ```json
  {
    "<userId>": [
      { "endpoint": "https://fcm...", "keys": {"p256dh":"...","auth":"..."},
        "ua": "iPhone Safari", "created_at": "2026-07-03T..." }
    ]
  }
  ```
  - เหตุผลเลือกไฟล์เดียวต่อ tenant (ไม่แยกรายไฟล์): จำนวน sub ต่อบริษัทไม่มาก (คนละ 1–3 อุปกรณ์), อ่านทั้งก้อนใน scheduler ครั้งเดียวเร็วกว่า, ล้อ pattern `holidays.json`/`categories.json` ที่เป็นไฟล์รวมต่อ tenant
  - accessor ใหม่ใน `tenantDb`: `pushSubs()` / `savePushSubs(o)` (เลียน `holidays`/`saveHolidays`)
- **การลบ sub ที่ตาย (410/404)**: เมื่อ `webpush.sendNotification` โยน error status 404/410 → ลบ endpoint นั้นออกจากไฟล์ (subscription หมดอายุ/ผู้ใช้ถอนสิทธิ์)

### 3.5 กันส่งซ้ำ (dedupe) — จำว่าเตือน user+date+hour ไปแล้ว
- **ทางเลือก A (แนะนำ — persist)**: ไฟล์ `data/tenants/<tid>/notify-log.json` = `{ "<userId>": { "<YYYY-MM-DD>": [10, 11, 14] } }` (เก็บชั่วโมงที่เตือนไปแล้วต่อวัน)
  - ก่อนส่ง: เช็คว่า `H` อยู่ใน array แล้วหรือยัง · หลังส่ง: push `H` เข้าไป
  - **เก็บถาวรจึงรอด restart** (สำคัญ! ดูข้อ 8.3 — กัน scheduler ยิงรัวตอน pm2 restart)
  - **cleanup**: ลบ key วันที่เก่ากว่า 3 วันทุกครั้งที่เขียน (กันไฟล์บวม)
- ทางเลือก B (in-memory Set) — ง่ายแต่หายตอน restart → **ไม่แนะนำ** เพราะจะยิงซ้ำหลัง deploy

---

## 4. การตั้งค่าเปิด/ปิด (แยก 2 ระดับให้ชัด)

### 4.1 ระดับ "อุปกรณ์" (พนักงานรายคน) — subscribe/unsubscribe
- **หน้า `public/worklog.html`**: เพิ่มปุ่ม/สวิตช์ "🔔 เปิดแจ้งเตือนบนมือถือเครื่องนี้" (แยกจาก checkbox in-app เดิม ~97–100 ที่คุมแค่ banner)
- Flow กดเปิด: `Notification.requestPermission()` → ถ้า granted → `swReg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: <publicKey จาก /api/push/key> })` → `POST /api/push/subscribe`
- Flow กดปิด: `subscription.unsubscribe()` + `POST /api/push/unsubscribe`
- แสดงสถานะ 3 แบบ: (ก) เบราว์เซอร์ไม่รองรับ/ยังไม่ได้ Add to Home Screen (iOS), (ข) ยังไม่เปิด, (ค) เปิดแล้ว
- **การ subscribe เป็นราย "อุปกรณ์"** — เปิดในมือถือ 1 เครื่อง ไม่ทำให้เครื่องอื่นเปิด (แต่ละ browser/device มี subscription คนละอัน)

### 4.2 ระดับ "บริษัท" (admin) — เปิด/ปิดฟีเจอร์ทั้ง tenant
- **ไฟล์ตั้งค่า**: `data/tenants/<tid>/notify-settings.json` = `{ enabled: true, updated_at }` (default เปิด)
  - accessor ใหม่: `notifySettings()` / `saveNotifySettings(o)` ใน `tenantDb`
- **หน้า `public/admin.html`**: เพิ่ม card ใหม่ "🔔 แจ้งเตือนกรอกงานเข้ามือถือ" พร้อม toggle (เลียน UI switch ของ Claude card ~135–140)
- **Endpoints**: `GET /api/admin/notify` (คืน `{enabled}`), `PUT /api/admin/notify` (`requireAdmin`, set enabled) — เลียน `/api/admin/claude` ~1138/1153 แต่ไม่ต้องขอรหัส admin ซ้ำ
- **ผลกับ scheduler**: ถ้า `enabled===false` → scheduler ข้ามทั้ง tenant (ข้อ 3.3 step 3)
- **แยกให้ชัด**: admin ปิด = ทั้งบริษัทไม่มีใครได้ push (คุมภาพรวม); พนักงานไม่ subscribe = เฉพาะคนนั้น/เครื่องนั้นไม่ได้ push. ทั้งสองต้องผ่านถึงจะได้ push

---

## 5. Dependencies

| แพ็กเกจ | จำเป็น? | หมายเหตุ |
|---|---|---|
| `web-push` | **ใช่ (บังคับ)** | ส่ง Web Push + generate VAPID · ต้อง `npm install web-push` แล้ว commit `package.json`/`package-lock.json` · **บน droplet ต้อง `npm install --omit=dev`** ตอน deploy (อยู่ใน DoD ข้อ 7) |
| `node-cron` vs `setInterval` | **เลือก 1** | ดูตารางเทียบด้านล่าง |

**เทียบ node-cron กับ setInterval:**
- `setInterval(fn, 5*60*1000)` — **ข้อดี**: 0 dependency, เข้าใจง่าย, พอสำหรับ "ตรวจทุก 5 นาที". **ข้อเสีย**: ต้องคำนวณ tz เอง (ทำอยู่แล้วในข้อ 3.3), ไม่มี cron syntax
- `node-cron` — **ข้อดี**: เขียน `"0 * * * *"` ตรงต้นชั่วโมงได้, มี `timezone: 'Asia/Bangkok'` ในตัว (ตัด bug tz ได้เลย). **ข้อเสีย**: +1 dependency
- **คำแนะนำ**: เริ่มด้วย **`setInterval` 5 นาที + `nowBangkok()` helper** (ลด dependency, ทีมคุ้น pattern setInterval-like อยู่แล้ว) · ถ้าภายหลังอยากได้ตรงเป๊ะค่อยเปลี่ยนเป็น node-cron ได้ง่าย (แยก logic `checkAndSendReminders` ออกจากตัวจับเวลาไว้ตั้งแต่แรก)

---

## 6. โครงสร้างไฟล์ (สร้างใหม่ / แก้ไข)

### ไฟล์สร้างใหม่
```
public/
  manifest.json          # (ถ้าเลือกทางเลือก A จะเป็น route dynamic แทน — ดู 2.1)
  sw.js                  # service worker: push + notificationclick
  icon-192.png           # ไอคอน PWA (resize จาก logo.png)
  icon-512.png           # ไอคอน PWA (resize จาก logo.png)
docs/
  PLAN-notifications.md   # ← เอกสารนี้
scripts/
  _e2e-reminder.js       # E2E ชั่วคราว (ขึ้นต้น _) — ทดสอบ logic scheduler (ลบก่อน commit)
  _seed-notify.js        # seed ข้อมูลทดสอบ (ลบก่อน commit)
```
### ไฟล์ข้อมูล runtime (server สร้างเอง, อยู่ใต้ data/ = gitignore แล้ว)
```
data/_vapid.json                          # VAPID keys (ความลับ)
data/tenants/<tid>/push-subs.json         # subscription ต่อ user
data/tenants/<tid>/notify-settings.json   # toggle ระดับบริษัท
data/tenants/<tid>/notify-log.json        # กันส่งซ้ำ user+date+hour
```
### ไฟล์ที่ต้องแก้
```
server.js
  - เพิ่ม require('web-push') + init/load _vapid.json (ใกล้ SECRET ~99)
  - เพิ่ม accessors ใน tenantDb: pushSubs/savePushSubs, notifySettings/saveNotifySettings,
    notifyLog/saveNotifyLog (~166–202)
  - เพิ่ม route dynamic GET /t/:tenantId/manifest.json (ถ้าเลือก 2.1-A)
  - เพิ่ม endpoints: /api/push/key, /subscribe, /unsubscribe, /test (~ใกล้ worklog routes 1626)
  - เพิ่ม endpoints admin: GET/PUT /api/admin/notify (~ใกล้ 1138)
  - เพิ่ม helper nowBangkok() + checkAndSendReminders() + startReminderScheduler()
  - เรียก startReminderScheduler() ใน app.listen callback (~2513)
  - แก้ express.static setHeaders ให้ครอบ manifest/json + no-cache ที่เหมาะกับ sw.js (~496)
package.json / package-lock.json
  - + "web-push" (และ "node-cron" ถ้าเลือก)
public/app-shell.js
  - register service worker (ทุกหน้า tenant) — ~ท้าย build() หรือ IIFE
public/worklog.html
  - ปุ่ม "เปิดแจ้งเตือนบนมือถือเครื่องนี้" + <link rel="manifest"> + JS subscribe/unsubscribe/test
public/admin.html
  - card + toggle "แจ้งเตือนกรอกงานเข้ามือถือ" (ระดับบริษัท)
public/index.html (+ หน้า tenant อื่น ๆ)
  - <link rel="manifest" ...> + <meta name="theme-color"> + <meta name="apple-mobile-web-app-capable">
    (iOS ต้องการ meta เหล่านี้เพื่อ Add to Home Screen แบบ standalone)
docs/DIGITALOCEAN-DEPLOY.md
  - เพิ่มหมายเหตุ: npm install web-push, ห้ามลบ data/_vapid.json, backup รวม data/
```

---

## 7. Definition of Done (DoD) — ต้องครบทุกข้อ

- [ ] **PWA ติดตั้งได้จริง**: เปิด `https://<domain>/t/<tid>/worklog` บน Android Chrome เห็น prompt/เมนู "Add to Home Screen" และเปิดจาก home screen ขึ้นแบบ standalone (ไม่มีแถบ browser)
- [ ] **iOS**: บน iOS 16.4+ Safari → Share → Add to Home Screen → เปิดจาก icon → กดเปิดแจ้งเตือนได้ (permission prompt ขึ้น) — ยืนยันว่า push เข้าจริงบน iOS ที่ add แล้ว
- [ ] **ปุ่มทดสอบ (`/api/push/test`)**: กดแล้ว noti เด้งจริงบนเครื่องที่ subscribe ทั้ง Android และ iOS
- [ ] **Scheduler ถูกต้องตาม business rule** (พิสูจน์ด้วย E2E ข้อ 8):
  - เตือนเมื่อ: ชั่วโมงก่อนหน้าอยู่ในเวลางาน + ยังไม่กรอก + ไม่ใช่วันหยุด/ลา + admin เปิด + user subscribe
  - **ไม่**เตือนเมื่อ: วันหยุดบริษัท / วันลา(dayOff) / นอกเวลางาน / ชั่วโมงพักเที่ยง / กรอกช่องนั้นแล้ว / admin ปิดบริษัท / user ไม่ subscribe
- [ ] **กันส่งซ้ำ**: ชั่วโมงเดียวกันของวันเดียวกันส่งได้ครั้งเดียว แม้ scheduler tick หลายรอบ และแม้ pm2 restart กลางวัน
- [ ] **multi-tenant isolation**: push ของบริษัท A ไม่มีทางไปเข้าเครื่องของบริษัท B (พิสูจน์ด้วย 2 tenant ใน E2E)
- [ ] **timezone**: ทดสอบโดยตั้ง tz ของ process เป็น UTC แล้ว scheduler ยังตัดสินใจตามเวลาไทยถูกต้อง
- [ ] **VAPID ปลอดภัย**: `data/_vapid.json` มีอยู่, private key ไม่โผล่ใน `git status`/diff (ตรวจก่อน commit ตาม standards)
- [ ] **dead subscription**: subscription ที่คืน 410/404 ถูกลบออกจากไฟล์อัตโนมัติ (ไม่ค้าง)
- [ ] **ของเดิมไม่พัง (regression)**: in-app banner เดิม, `/api/worklog/status`, การกรอก worklog, วันหยุด/ลา ยังทำงานเหมือนเดิม
- [ ] **deploy checklist**: `npm install --omit=dev` ติดตั้ง web-push บน droplet สำเร็จ · pm2 restart แล้ว scheduler เริ่มทำงาน (เห็น log)
- [ ] **ลบไฟล์ทดสอบ** (`scripts/_*.js`, ข้อมูล seed) และปิด server ชั่วคราวก่อน commit (ตาม standards ข้อ 23)

---

## 8. แผนการทดสอบ (สำหรับ tester)

### 8.1 Unit / logic (สำคัญสุด — regression วันหยุด/ลา/นอกเวลา)
เขียน `scripts/_e2e-reminder.js` (รันด้วย `DATA_DIR`/`PORT` แยกตาม standards) ทดสอบฟังก์ชัน `checkAndSendReminders` แบบ mock การส่ง push (stub `webpush.sendNotification` เก็บว่าจะส่งถึงใคร) แล้ว assert เมทริกซ์:

| เคส | ตั้งค่า | คาดหวัง |
|---|---|---|
| ปกติ ยังไม่กรอก | เวลาไทย 11:xx, ช่อง 10:00 ว่าง, ในเวลางาน | **ส่ง** |
| กรอกแล้ว | ช่อง 10:00 มี task | ไม่ส่ง |
| วันหยุดบริษัท | dateStr อยู่ใน holidays.dates หรือ weekly | ไม่ส่ง |
| วันลา | worklog มี dayOff | ไม่ส่ง |
| นอกเวลางาน | H ไม่อยู่ใน calcUserHours.hours | ไม่ส่ง |
| ชั่วโมงพักเที่ยง | H = ชั่วโมงพัก (12) | ไม่ส่ง (calcUserHours ตัดออกแล้ว) |
| admin ปิดบริษัท | notify-settings.enabled=false | ไม่ส่งทั้ง tenant |
| user ไม่ subscribe | push-subs ไม่มี user นี้ | ไม่ส่ง |
| ส่งซ้ำ | เรียก 2 รอบติด | ส่งรอบเดียว |
| หลัง restart | โหลด notify-log จากไฟล์ | ไม่ส่งซ้ำชั่วโมงที่เตือนแล้ว |
| 2 tenant | user A(tid1), B(tid2) | push แยกถูก tenant |

### 8.2 Integration (endpoints)
- `GET /api/push/key` คืน publicKey ที่ตรงกับ `_vapid.json`
- `POST /api/push/subscribe` แล้วเช็คว่าเขียนลง `push-subs.json` ถูก user/tenant · subscribe ซ้ำ endpoint เดิม = ไม่เพิ่ม record
- `POST /api/push/unsubscribe` ลบออกจริง
- `PUT /api/admin/notify` เปลี่ยน enabled แล้ว scheduler เคารพ
- auth: เรียก endpoint โดยไม่ล็อกอิน → 401; ข้าม tenant → 401 (ตาม `authMiddleware` ~315)

### 8.3 ทดลองใช้จริง (manual, chrome-devtools MCP + มือถือจริง)
- Android Chrome: ติดตั้ง PWA, เปิด noti, กดปุ่มทดสอบ → เด้งจริง, คลิก noti → เปิดหน้า worklog
- iOS Safari 16.4+: Add to Home Screen → เปิดจาก icon → เปิด noti → ปุ่มทดสอบเด้งจริง (iOS **ไม่รองรับ push จาก tab ปกติ** ต้อง add ก่อน — ยืนยันข้อจำกัดนี้)
- ปิด noti ที่หน้า worklog → ไม่ได้รับอีก
- admin ปิดทั้งบริษัท → คนที่ subscribe แล้วก็ไม่ได้รับ

### 8.4 หมายเหตุ static/cache สำหรับ tester
- ตรวจว่า `sw.js` และ `manifest.json` โหลดได้และไม่ถูก cache แข็ง (ต้องเห็น `Cache-Control: no-cache`) — ถ้า setHeaders ~496 ยังไม่ครอบ `manifest.json` (นามสกุล .json ไม่เข้า regex เดิม `.(html|js|css|md)`) ให้เพิ่ม `json` เข้า pattern หรือ set header ที่ route dynamic เอง

---

## 9. แผนเป็นเฟส + ต้นแบบ (ด่าน 2)

### เฟส 1 — PWA พื้นฐาน (เล็ก)
manifest (dynamic ต่อ tenant) + icon 192/512 + sw.js เปล่า (มีแค่ push/notificationclick handler) + register ใน app-shell + `<link rel="manifest">`/meta ในหน้า tenant
- **เห็นผล**: ติดตั้ง PWA ลง home screen ได้ (ยังไม่มี push)

### เฟส 2 — ต้นแบบพิสูจน์ push จริง (เล็ก–กลาง) ⭐ ด่านสำคัญ
init VAPID (`_vapid.json`) + `GET /api/push/key` + `POST /api/push/subscribe` + **`POST /api/push/test`** + ปุ่ม "เปิดแจ้งเตือน" & "ทดสอบแจ้งเตือน" ที่หน้า worklog
- **ต้นแบบ = ปุ่ม "ทดสอบแจ้งเตือน"**: กดแล้วเด้ง noti จริงบนเครื่อง → **พิสูจน์ว่า pipeline PWA+VAPID+SW+push ทำงานครบ ก่อนลงทุนทำ scheduler** (ถ้าด่านนี้ผ่านทั้ง Android+iOS ที่เหลือคือ logic ล้วน ๆ)

### เฟส 3 — เก็บ subscription + unsubscribe + toggle บริษัท (กลาง)
`push-subs.json` เต็มรูป (dedupe endpoint, ลบ dead sub) + `/unsubscribe` + `notify-settings.json` + card admin toggle + endpoints `/api/admin/notify`

### เฟส 4 — Scheduler เต็ม (ใหญ่ — งานหลัก)
`nowBangkok()` + `checkAndSendReminders()` (business rules ครบ) + `notify-log.json` (กันส่งซ้ำ persist) + `startReminderScheduler()` (setInterval 5 นาที) + เรียกใน app.listen + E2E `_e2e-reminder.js` ครบเมทริกซ์ 8.1

### เฟส 5 — ขัดเกลา + deploy (เล็ก)
regression ของเดิม + ทดสอบมือถือจริง 2 แพลตฟอร์ม + อัป `DIGITALOCEAN-DEPLOY.md` + ลบไฟล์ทดสอบ + commit เป็นก้อน ๆ ตาม standards + `npm install --omit=dev` บน droplet

---

## 10. ความเสี่ยง & แผนสำรอง

| ความเสี่ยง | ผลกระทบ | แผนรับมือ / สำรอง |
|---|---|---|
| **iOS ต้อง Add-to-Home-Screen ก่อนถึงได้ push** (adoption ต่ำ) | พนักงาน iOS ที่ไม่ add จะไม่ได้ push เลย | มีคู่มือ+ภาพขั้นตอน add to home screen ในหน้า worklog (แสดงเฉพาะ iOS ที่ยังไม่ standalone) · in-app banner เดิมยังอยู่เป็น fallback |
| **VAPID key หลุด git / ถูกลบ** | หลุด = ความปลอดภัย; ลบ = subscription เดิมพังหมด | อยู่ใต้ `data/` (gitignore ยืนยันแล้ว) · ตรวจ `git status` ก่อน commit · เขียนเตือนใน deploy doc + backup รวม `data/` |
| **push ข้ามบริษัท (multi-tenant leak)** | ร้ายแรง | subscription เก็บแยกโฟลเดอร์ tenant + scheduler วนต่อ tenant + payload URL ใส่ tid · มี E2E 2-tenant บังคับ (8.1) |
| **scheduler ยิงรัวตอน pm2 restart** | สแปมผู้ใช้ | `notify-log.json` เก็บถาวร (ข้อ 3.5) → หลัง restart จำได้ว่าเตือนไปแล้ว ไม่ยิงซ้ำ · เช็ค log ก่อนส่งเสมอ |
| **timezone เพี้ยน** (server tz ≠ Asia/Bangkok) | เตือนผิดชั่วโมง/นอกเวลา | `nowBangkok()` คำนวณเวลาไทยเสมอ ไม่พึ่ง `todayLocal()` เดิม · E2E ตั้ง TZ=UTC ทดสอบ |
| **web-push ไม่ได้ install บน droplet** | scheduler crash ตอน require | require web-push แบบ lazy/try-catch → ถ้าไม่มีให้ log เตือนและ **ปิด push (ไม่ล้ม server)** · ระบุใน DoD ให้ `npm install --omit=dev` |
| **subscription หมดอายุ (410) สะสม** | ไฟล์บวม, ส่งเสียเปล่า | ลบ endpoint ที่ได้ 404/410 ทันทีตอนส่ง (ข้อ 3.4) |
| **ผู้ใช้เปลี่ยน/ล้าง browser** | subscription เดิมตายเงียบ | จับ 410 ลบทิ้ง · ปุ่มเปิดแจ้งเตือนตรวจ state จริงจาก `pushManager.getSubscription()` ทุกครั้งที่เข้าหน้า |
| **แคช sw.js เก่าค้าง** | แก้ SW แล้วไม่อัปเดต | `self.skipWaiting()`+`clients.claim()` + bump `?v=` ตอน register (ตามบทเรียนทีม) |
| **node-cron dependency เกินจำเป็น** | โค้ดหนักขึ้น | เริ่มด้วย setInterval (ข้อ 5) แยก logic ออกจาก timer ไว้ก่อน เปลี่ยนทีหลังง่าย |
