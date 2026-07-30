# คู่มือ Deploy HR-Interview ผ่าน Cloudflare Tunnel

ขึ้น HR-Interview ออนไลน์ฟรี โดยให้ลูกค้าเข้าใช้ผ่าน internet ขณะที่ server ยังรันอยู่บน PC ของคุณ

---

## สิ่งที่ต้องเตรียม

1. **PC Windows ที่เปิดตลอด 24 ชม.** — server + tunnel จะรันบนนี้
2. **บัญชี Cloudflare** (ฟรี ไม่ต้องใส่บัตร) — https://dash.cloudflare.com/sign-up
3. **Domain name** สำหรับ URL ถาวร (ตัวเลือก):
   - ซื้อใหม่ผ่าน Cloudflare Registrar (~$10/ปี, ไม่มีกำไรบวก)
   - ใช้ domain ที่มีอยู่ → ย้าย nameserver มา Cloudflare (ฟรี)
   - หรือใช้ **Quick Tunnel** (ฟรี 100% แต่ URL เปลี่ยนทุกครั้ง — เหมาะกับทดลองสั้นๆ)

---

## ขั้นตอนที่ 1: ติดตั้ง cloudflared

เปิด PowerShell **เป็น Administrator** แล้วรัน:
```powershell
winget install --id Cloudflare.cloudflared
```
หรือถ้าไม่มี winget โหลด `.msi` ตรงจาก:
https://github.com/cloudflare/cloudflared/releases/latest

ตรวจสอบ:
```powershell
cloudflared --version
```
ขึ้นเลข version = ใช้ได้

---

## ขั้นตอนที่ 2: เริ่ม server HR-Interview ในโหมด production

ใน PowerShell ที่โฟลเดอร์โปรเจกต์:
```powershell
$env:SECURE_COOKIES="true"
$env:PORT="3000"
npm start
```

หรือดับเบิลคลิก `scripts\start-production.bat` ในโฟลเดอร์โปรเจกต์ — มันจะตั้ง env var + รันให้

server จะขึ้นที่ `http://localhost:3000`

---

## ขั้นตอนที่ 3A: Quick Tunnel (เร็วสุด — URL เปลี่ยนทุกครั้ง)

เปิด PowerShell อีกหน้าต่าง แล้วรัน:
```powershell
cloudflared tunnel --url http://localhost:3000
```

จะเห็น URL เช่น:
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://something-random.trycloudflare.com                                                |
+--------------------------------------------------------------------------------------------+
```

แชร์ URL นั้นให้ลูกค้าได้เลย — **ใช้ได้จนกว่าจะกด Ctrl+C** ถ้ารันใหม่ URL จะเปลี่ยน

**ข้อจำกัด:** ทุกครั้งที่ปิด-เปิดใหม่ URL เปลี่ยน → ลูกค้าต้องเปลี่ยน bookmark
→ เหมาะกับ demo/PoC เท่านั้น ไม่เหมาะให้ลูกค้าใช้จริงระยะยาว

---

## ขั้นตอนที่ 3B: Named Tunnel + Domain (URL ถาวร — แนะนำสำหรับ production)

### 3B.1 — เชื่อม cloudflared กับบัญชี Cloudflare
```powershell
cloudflared tunnel login
```
เบราว์เซอร์จะเปิดให้ login Cloudflare → กด **Authorize** → ปิดเบราว์เซอร์

### 3B.2 — สร้าง tunnel
```powershell
cloudflared tunnel create hrwwn
```
จะได้ tunnel UUID เช่น `abc12345-6789-...`

### 3B.3 — ผูก DNS เข้ากับ tunnel
สมมติคุณมี domain `mycompany.com` อยู่ใน Cloudflare แล้ว:
```powershell
cloudflared tunnel route dns hrwwn hr.mycompany.com
```

จะได้ URL ถาวร: **https://hr.mycompany.com**

### 3B.4 — สร้างไฟล์ config
สร้างไฟล์ `C:\Users\<ชื่อ>\.cloudflared\config.yml` (Windows path):

```yaml
tunnel: hrwwn
credentials-file: C:\Users\<ชื่อ>\.cloudflared\<tunnel-uuid>.json

ingress:
  - hostname: hr.mycompany.com
    service: http://localhost:3000
  - service: http_status:404
```

แทน `<ชื่อ>` ด้วยชื่อ user Windows ของคุณ + `<tunnel-uuid>` ด้วย UUID ที่ได้จาก step 3B.2

### 3B.5 — เริ่ม tunnel
```powershell
cloudflared tunnel run hrwwn
```

ลูกค้าเข้าได้ที่ `https://hr.mycompany.com` แล้ว!

---

## ขั้นตอนที่ 3C: หลายโปรแกรมบนโดเมนเดียว (แยกด้วย subdomain)

เป้าหมาย: ใช้โดเมนเดียว (`wanwanachapp.com`) แต่มีหลายโปรแกรม แยกกันด้วย **subdomain นำหน้า** เช่น
`hr-interview.wanwanachapp.com` · `shop.wanwanachapp.com` · `kpi-system.wanwanachapp.com`

**ทำไมใช้ subdomain (ไม่ใช่ path เช่น /hr-interview/):** แต่ละแอปอยู่ที่ root ของ subdomain ตัวเอง →
ไฟล์ CSS/JS/ไอคอน และ cookie/PWA ทำงานถูกต้องโดย **ไม่ต้องแก้โค้ดแอปเลย** และแยกขาดจากกันสะอาด

### 3C.1 — เพิ่ม subdomain ให้โปรแกรมที่มีอยู่ (HR-Interview)

แต่ละโปรแกรม 1 แอป = 1 พอร์ต (HR ใช้ 3000). เพิ่ม hostname เข้า tunnel เดียวกันได้เลย:

1. เขียน config.yml ใหม่ให้ครอบทุก hostname (สคริปต์ช่วยเขียนให้):
   ```powershell
   node scripts\_write-tunnel-config.js hrwwn wanwanachapp.com=3000 hr-interview.wanwanachapp.com=3000
   ```
   (`hostname=port` · เว้น port = 3000 · ใส่ได้หลายตัวคั่นด้วยช่องว่าง)

2. ผูก DNS ให้ subdomain ใหม่ (ครั้งเดียว):
   ```powershell
   cloudflared tunnel route dns hrwwn hr-interview.wanwanachapp.com
   ```

3. restart tunnel:
   ```powershell
   cloudflared tunnel run hrwwn
   ```
   (ถ้ารันเป็น service: `net stop cloudflared` แล้ว `net start cloudflared` — หรือ restart service)

เสร็จ! เข้าได้ทั้ง `https://wanwanachapp.com/t/wanwanach/` และ
`https://hr-interview.wanwanachapp.com/t/wanwanach/` (แอปเดียวกัน)

> **ทางเลือกที่ง่ายกว่าถ้าใช้ Cloudflare Dashboard:** Zero Trust → Networks → Tunnels →
> เลือก tunnel → **Public Hostnames** → **Add a public hostname** →
> Subdomain: `hr-interview`, Domain: `wanwanachapp.com`, Service: `HTTP` → `localhost:3000` → Save
> (Dashboard สร้าง DNS ให้อัตโนมัติ ไม่ต้องแก้ config.yml เอง)

### 3C.2 — เพิ่มโปรแกรม "ใหม่" ในอนาคต (เช่น ระบบร้านค้า)

1. รันแอปใหม่ที่ **พอร์ตอื่น** (เช่น 3001) — คนละโปรเจกต์/โฟลเดอร์กับ HR
2. เพิ่ม hostname ของมันเข้า config เดียวกัน แล้วรันสคริปต์ซ้ำ (ใส่ครบทุกโปรแกรม):
   ```powershell
   node scripts\_write-tunnel-config.js hrwwn wanwanachapp.com=3000 hr-interview.wanwanachapp.com=3000 shop.wanwanachapp.com=3001
   ```
3. `cloudflared tunnel route dns hrwwn shop.wanwanachapp.com`  แล้ว restart tunnel

โปรแกรมเก่า (HR) **ไม่ถูกกระทบเลย** — แค่เพิ่ม ingress rule ของโปรแกรมใหม่

> สรุปการเพิ่มโปรแกรมใหม่ = (1) รันแอปใหม่คนละพอร์ต (2) เพิ่ม hostname=port ในสคริปต์ (3) route dns + restart

---

## ขั้นตอนที่ 4: ทำให้ทำงาน 24/7 (Auto-start)

ถ้าปิด PowerShell ที่รัน tunnel/server อยู่ บริการจะหยุด → ต้องทำเป็น Windows service

### 4.1 — Install cloudflared เป็น service
รัน PowerShell **Administrator**:
```powershell
cloudflared service install
```
ตอนนี้ cloudflared จะเริ่มเองตอน boot

### 4.2 — Auto-start Node server
สร้าง Scheduled Task ผ่าน Task Scheduler:
1. Win+R → `taskschd.msc`
2. **Create Task...**
3. Triggers: **At startup**
4. Actions: Start a program
   - Program: `C:\Program Files\nodejs\node.exe`
   - Add arguments: `D:\99-Ai\07-HT-wwn\Hr-wwn\server.js`
   - Start in: `D:\99-Ai\07-HT-wwn\Hr-wwn`
5. Settings: ✓ Run task as soon as possible after a scheduled start is missed
6. Settings: Environment variable — ใส่ผ่าน wrapper batch แทน (`start-production.bat`)

แนะนำ: เรียก `start-production.bat` แทนตรง node เพื่อให้ env vars ถูกต้อง

---

## ขั้นตอนที่ 5: เช็คว่า production hardening ทำงาน

หลัง deploy ลอง:
1. เข้าหน้า login → กดรหัสผิด 5 ครั้งติด → ครั้งที่ 6 ต้องได้ error **429** (rate limit)
2. เปิด DevTools → Network tab → ดู `Set-Cookie` ของ `/api/login` → ต้องมี `Secure` attribute
3. URL ต้องเป็น `https://` ทุกหน้า (Cloudflare บังคับ)

---

## Security Checklist ก่อนเปิดให้ลูกค้าใช้

- [x] Master password ถูก hash (auto-migrate ครั้งแรกที่ start)
- [x] Rate limit บน /api/login (5 ครั้ง/5 นาที → block 15 นาที)
- [x] Cookie มี Secure flag (เมื่อ `SECURE_COOKIES=true`)
- [x] HTTPS ผ่าน Cloudflare Tunnel (ออโตเมติก)
- [ ] **เปลี่ยน master password** จากค่า default `WWN2026!Init` → ตั้งของตัวเอง
- [ ] **Backup `data/` folder** สม่ำเสมอ (ทุกอย่างอยู่ในนี้)
- [ ] PC firewall: เปิดเฉพาะ outbound — Cloudflare Tunnel เป็น outbound connection ไม่ต้องเปิด port

---

## Troubleshooting

**Q: ลูกค้าเข้าแล้วเห็น "502 Bad Gateway"**
A: Server localhost:3000 ไม่ตอบ → กลับมาดู Node server log ว่า crash หรือไม่ได้รัน

**Q: ลูกค้าเข้าแล้ว URL เปลี่ยนจาก `https://` เป็น `http://` แล้ว login ไม่ได้**
A: `SECURE_COOKIES=true` แต่เข้าผ่าน HTTP → cookie ถูก reject ตามนิสัย — เข้าด้วย HTTPS เสมอ

**Q: ทำเป็น service แล้ว แต่ Node server หยุด ทำไง?**
A: ดู log ที่ Event Viewer (Win+R → eventvwr.msc) → Windows Logs → Application
หรือใช้ tools เช่น **PM2** (`npm install -g pm2` → `pm2 start server.js`)

**Q: PC restart แล้วต้องเริ่มมือเองทุกครั้ง**
A: ใช้ Task Scheduler ตาม step 4 — ถ้ายังไม่อยาก setup ก็คลิก `start-production.bat` ทุกครั้งที่ boot

---

## ค่าใช้จ่ายรวม

| รายการ | ค่าใช้จ่าย |
|--------|------------|
| Cloudflare account | ฟรี |
| Cloudflare Tunnel | ฟรี (ไม่จำกัด traffic สำหรับใช้ทั่วไป) |
| HTTPS certificate | ฟรี (Cloudflare ออกให้) |
| Domain (ตัวเลือก) | ~$10/ปี ผ่าน Cloudflare Registrar |
| PC ไฟฟ้า | ขึ้นกับ PC ของคุณ |
| **รวม** | **$0 ถ้าใช้ Quick Tunnel** หรือ **~$10/ปี ถ้าใช้ named tunnel + domain** |
