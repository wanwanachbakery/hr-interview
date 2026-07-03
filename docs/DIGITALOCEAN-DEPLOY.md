# คู่มือนำ HR-Interview ขึ้นระบบจริง — DigitalOcean + Cloudflare

สถาปัตยกรรม: **Droplet (Ubuntu) + PM2 + Cloudflare Tunnel + domain wanwanachapp.com**
ผลลัพธ์: `https://wanwanachapp.com` ใช้งานได้ 24/7 พร้อม HTTPS อัตโนมัติ

> ⚠️ ใช้ **Droplet** เท่านั้น — **ห้ามใช้ App Platform** (ดิสก์ ephemeral ข้อมูลจะหาย)

---

## ขั้นที่ 1 — ซื้อ domain บน Cloudflare

1. ที่หน้า Domain purchase → ช่อง search พิมพ์ `wanwanachapp`
2. เลือก **wanwanachapp.com** → กด **Confirm** → จ่ายเงิน (~$10.46/ปี)
3. domain จะอยู่ใน Cloudflare อัตโนมัติ (DNS พร้อมใช้ทันที — ไม่ต้องย้าย nameserver)

---

## ขั้นที่ 2 — สร้าง Droplet บน DigitalOcean

1. DigitalOcean → **Create → Droplets**
2. ตั้งค่า:
   - **Region:** Singapore (ใกล้ไทยสุด)
   - **Image:** Ubuntu 24.04 (LTS) x64
   - **Size:** Basic → Regular → **$6/mo** (1GB RAM / 1 CPU / 25GB SSD)
   - **Authentication:** Password (ตั้งรหัส root ที่จำได้) หรือ SSH key
   - **Hostname:** `hr-interview`
3. กด **Create Droplet** → รอ ~1 นาที → จด **IP address** ที่ได้ (เช่น `159.xxx.xxx.xxx`)

---

## ขั้นที่ 3 — เข้า Droplet + นำโค้ดขึ้น

### 3.1 เข้า Droplet
ที่หน้า Droplet ใน DigitalOcean → กด **Console** (เปิด terminal ในเบราว์เซอร์ ไม่ต้องลงโปรแกรม)
หรือถ้าใช้ Windows: `ssh root@<IP ของ droplet>` ใน PowerShell

### 3.2 นำโค้ดขึ้น — เลือก 1 วิธี

**วิธี A — ผ่าน GitHub (แนะนำ ถ้ามี repo)**
```bash
# บน droplet
git clone https://github.com/<user>/<repo>.git /opt/hr-interview
```

**วิธี B — อัปโหลดไฟล์ zip**
1. บนเครื่องคุณ: ดับเบิลคลิก `BUILD-PACKAGE.bat` → ได้โฟลเดอร์ package
2. zip โฟลเดอร์นั้น
3. อัปโหลดผ่าน `scp` (PowerShell บนเครื่องคุณ):
   ```powershell
   scp HR-Interview-Package.zip root@<IP>:/opt/
   ```
4. บน droplet:
   ```bash
   apt-get install -y unzip
   mkdir -p /opt/hr-interview
   unzip /opt/HR-Interview-Package.zip -d /opt/hr-interview
   # ปรับ path ให้ server.js อยู่ที่ /opt/hr-interview/server.js
   ```

---

## ขั้นที่ 4 — รัน setup script (ติดตั้ง Node + PM2 + cloudflared)

อัปโหลด `deploy/setup-droplet.sh` ขึ้น droplet (มากับโค้ดอยู่แล้วถ้า clone/zip ทั้งโปรเจกต์) แล้ว:

```bash
cd /opt/hr-interview
bash deploy/setup-droplet.sh
```

script จะ:
- ติดตั้ง Node.js 20 + git
- `npm install` (เฉพาะ production deps)
- ติดตั้ง PM2 → รันแอป + ตั้งให้เริ่มเองหลัง reboot
- ติดตั้ง cloudflared

เสร็จแล้วแอปจะรันที่ `http://localhost:3000` บน droplet (ยังเข้าจากภายนอกไม่ได้จนกว่าจะต่อ tunnel)

ตรวจสอบ: `pm2 status` → ต้องเห็น `hr-interview` สถานะ **online**

---

## ขั้นที่ 5 — เชื่อม Cloudflare Tunnel กับ domain

```bash
# 5.1 login (เปิด URL ที่ขึ้นในเบราว์เซอร์ → เลือก wanwanachapp.com → Authorize)
cloudflared tunnel login

# 5.2 สร้าง tunnel
cloudflared tunnel create hrapp

# 5.3 ผูก domain เข้ากับ tunnel
cloudflared tunnel route dns hrapp wanwanachapp.com

# 5.4 หา UUID ของ tunnel (ดูชื่อไฟล์ .json)
ls /root/.cloudflared/
```

### 5.5 สร้างไฟล์ config
```bash
nano /root/.cloudflared/config.yml
```
ใส่เนื้อหา (แทน `<UUID>` ด้วยเลขที่เห็นจาก step 5.4):
```yaml
tunnel: hrapp
credentials-file: /root/.cloudflared/<UUID>.json

ingress:
  - hostname: wanwanachapp.com
    service: http://localhost:3000
  - service: http_status:404
```
กด `Ctrl+O` Enter บันทึก, `Ctrl+X` ออก

### 5.6 ติดตั้ง tunnel เป็น service (รัน 24/7)
```bash
cloudflared service install
systemctl start cloudflared
systemctl enable cloudflared
systemctl status cloudflared   # ต้องเห็น active (running)
```

---

## ขั้นที่ 6 — ทดสอบ

เปิดเบราว์เซอร์: **https://wanwanachapp.com/super/login**
(ครั้งแรกอาจรอ DNS 1-5 นาที)

- ✅ เห็นหน้า super-admin login + แม่กุญแจ HTTPS = สำเร็จ!

---

## ขั้นที่ 7 — ตั้งค่าก่อนใช้จริง (สำคัญ!)

1. **เปลี่ยนรหัส super-admin** → login `/super/login` (`super!2026`) → กด เปลี่ยนรหัส
2. **ลบ demo tenants** (demo, demo-siamsweet, demo-itsolutions) ที่หน้า super-admin
3. **เปลี่ยนรหัส admin ของ tenant จริง** (wanwanach ฯลฯ) → ปุ่ม reset admin pw
4. **Backup ข้อมูล** — ตั้ง cron บน droplet:
   ```bash
   # backup data ทุกวันตี 2 ไปเก็บใน /root/backups
   (crontab -l 2>/dev/null; echo "0 2 * * * tar czf /root/backups/hr-\$(date +\%F).tar.gz /opt/hr-interview/data") | crontab -
   mkdir -p /root/backups
   ```

---

## ขั้นที่ 8 — เปิดใช้ Claude API (สร้างเอกสารด้วย AI จริง)

ระบบจะใช้ **Claude (Sonnet 4.6)** สร้าง Job Description / KPI / Optimization และรายงานภาพรวมบริษัท
ถ้า **ไม่ได้** ตั้งค่า key ระบบจะใช้ตัวสร้างเอกสารแบบ mock เดิม (ทำงานได้ปกติ แต่เป็นแม่แบบสำเร็จรูป)

> 🔐 **ห้ามใส่ API key ในโค้ดหรือ push ขึ้น GitHub เด็ดขาด** — เก็บเป็น env var บน droplet เท่านั้น

```bash
# บน droplet
cd /opt/hr-interview
git pull
npm install --omit=dev          # ติดตั้ง @anthropic-ai/sdk ที่เพิ่มเข้ามา

# ใส่ key (แทน sk-ant-... ด้วย key จริงของคุณ)
export ANTHROPIC_API_KEY="sk-ant-..."
pm2 restart hr-interview --update-env
pm2 save                         # บันทึก env ไว้ให้คงอยู่หลัง reboot
```

ตรวจสอบว่าใช้ Claude แล้ว:
```bash
pm2 logs hr-interview --lines 30 | grep "document engine"
# ต้องเห็น:  [ai] document engine: Claude (claude-sonnet-4-6)
```

ทดสอบเชื่อมต่อ Claude (ไม่เขียนข้อมูลลงดิสก์):
```bash
ANTHROPIC_API_KEY="sk-ant-..." node scripts/smoke-claude.js
```

**เปลี่ยน key:** ใส่ค่าใหม่แล้วทำซ้ำเหมือนตอนตั้งครั้งแรก (`export ... ; pm2 restart hr-interview --update-env ; pm2 save`)

**ปิด Claude (กลับไปใช้ mock):**
```bash
pm2 delete hr-interview
PORT=3000 NODE_ENV=production SECURE_COOKIES=true AUTO_OPEN_BROWSER=false \
  pm2 start server.js --name hr-interview --update-env   # เริ่มใหม่โดยไม่มี ANTHROPIC_API_KEY
pm2 save
```

> หมายเหตุ: เมื่อเปิด Claude แล้ว การกด "ปิดอินเทอร์วิว" จะใช้เวลานานขึ้นเล็กน้อย (ไม่กี่วินาที–~30 วิ) เพราะ AI กำลังคิดและร่างเอกสารจริง

---

## ขั้นที่ 9 — แจ้งเตือนกรอกงานเข้ามือถือ (PWA + Web Push)

ระบบมีการแจ้งเตือนพนักงานเข้ามือถือจริงเมื่อผ่านชั่วโมงทำงานแล้วยังไม่ได้กรอกงาน
(ทำงานได้เพราะอยู่หลัง Cloudflare Tunnel = HTTPS จริง ซึ่ง Web Push บังคับ)

**ตอน deploy ครั้งนี้ (มี dependency ใหม่ `web-push`) ต้องรัน `npm install` ก่อน restart:**
```bash
cd /opt/hr-interview
git pull
npm install --omit=dev          # ติดตั้ง web-push ที่เพิ่มเข้ามา (สำคัญ! ไม่งั้น push จะไม่ทำงาน)
pm2 restart hr-interview
```

ตรวจสอบว่า push พร้อมทำงาน:
```bash
pm2 logs hr-interview --lines 40 | grep "\[push\]\|\[reminder\]"
# ต้องเห็น:  [push] Web Push ready (VAPID configured)
#            [reminder] scheduler started (every 5 min, Asia/Bangkok time)
```

> ⚠️ ถ้าลืม `npm install` จะเห็น `[push] "web-push" not installed …` — server ยังรันได้ปกติ
> แต่จะไม่มีการแจ้งเตือนเข้ามือถือ (ป้ายเตือนในเว็บเดิมยังทำงาน) จนกว่าจะติดตั้งแล้ว restart

**กุญแจ VAPID — ห้ามลบ/ห้ามหลุด git:**
- server สร้างคู่กุญแจครั้งแรกอัตโนมัติที่ `data/_vapid.json` (อยู่ใต้ `data/` = gitignore แล้ว ไม่หลุด git)
- **ห้ามลบไฟล์นี้เด็ดขาด** — ถ้าลบแล้วสร้างใหม่ กุญแจจะเปลี่ยน ทำให้อุปกรณ์ที่เปิดแจ้งเตือนไว้แล้ว "ใช้ไม่ได้ทั้งหมด" (พนักงานต้องกดเปิดแจ้งเตือนใหม่ทุกคน)
- backup ในขั้นที่ 7 ครอบ `data/` ทั้งโฟลเดอร์อยู่แล้ว = สำรอง `_vapid.json` ไปด้วย ✅

**การใช้งาน:**
- Admin เปิด/ปิดทั้งบริษัทได้ที่หน้า Admin → การ์ด "🔔 แจ้งเตือนกรอกงานเข้ามือถือ" (ค่าเริ่มต้น: เปิด)
- พนักงานกดเปิดบนมือถือของตัวเองที่หน้า "บันทึกงานประจำวัน" → ปุ่ม "🔔 เปิดแจ้งเตือนบนมือถือนี้"
- **iPhone/iPad**: ต้อง "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen) แล้วเปิดจากไอคอนก่อน จึงจะเปิดแจ้งเตือนได้ (ข้อจำกัดของ iOS 16.4+)

---

## ขั้นที่ 10 — การสำรองข้อมูล (Backup)

ระบบมีปุ่มสำรอง+ดาวน์โหลดข้อมูลในตัว (Super Admin = ทั้งระบบ, Admin = รายบริษัท) ไม่ต้องพึ่ง cron ในขั้นที่ 7 อีกก็ได้

- **ไฟล์สำรองเก็บที่** `/opt/hr-interview/backups/` — โดย default อยู่ **ดิสก์เดียวกับ `data/`** บน droplet
  > ⚠️ ถ้า droplet เสีย/ถูกลบ ไฟล์สำรองบนนั้นจะหายไปพร้อมกัน — **แนะนำให้เข้าหน้าสำรองข้อมูลแล้วกดดาวน์โหลดไฟล์สำรองไปเก็บไว้นอกเซิร์ฟเวอร์อย่างสม่ำเสมอ** (เครื่องตัวเอง / Google Drive ฯลฯ)
- **ไม่มี dependency ใหม่** — ฟีเจอร์นี้ใช้ `tar` ที่มีบน Linux อยู่แล้ว **ไม่ต้อง `npm install` เพิ่มสำหรับ backup** (ต่างจากขั้นที่ 9 ที่มี `web-push`)
- **auto-backup ปิดไว้เป็น default** — เปิดและตั้งเวลาได้ที่หน้า **Super Admin → สำรองข้อมูล** (ตั้งเก็บย้อนหลังได้ N ชุด)

### วิธีกู้คืน (restore) ด้วยมือบน droplet
```bash
pm2 stop hr-interview
# แตกไฟล์สำรองทับข้อมูลเดิม (แทน <ไฟล์> ด้วยชื่อไฟล์สำรองที่ต้องการกู้)
tar -xzf backups/system/<ไฟล์>.tar.gz -C /opt/hr-interview
pm2 start hr-interview
```
> สำหรับสำรองรายบริษัท (admin) ไฟล์จะอยู่ใต้ `backups/tenants/<tid>/` — กู้คืนวิธีเดียวกัน

---

## การดูแลระบบ

| งาน | คำสั่ง (บน droplet) |
|-----|---------------------|
| ดู log แอป | `pm2 logs hr-interview` |
| restart แอป | `pm2 restart hr-interview` |
| เช็คสถานะ | `pm2 status` + `systemctl status cloudflared` |
| อัปเดตโค้ดใหม่ | `cd /opt/hr-interview && git pull && npm install --omit=dev && pm2 restart hr-interview` |
| ดูพื้นที่ดิสก์ | `df -h` |

---

## Troubleshooting

**เข้า https://wanwanachapp.com แล้ว 502/error**
→ `pm2 status` แอป online ไหม · `systemctl status cloudflared` tunnel running ไหม

**DNS ยังไม่ขึ้น**
→ รอ 5-10 นาที · เช็คใน Cloudflare → DNS ว่ามี CNAME ของ wanwanachapp.com ชี้ไป tunnel

**แอป crash หลัง reboot**
→ `pm2 resurrect` หรือ `pm2 start /opt/hr-interview/server.js --name hr-interview`

---

## ค่าใช้จ่ายสรุป
- Domain: ~$10.46/ปี
- Droplet $6/mo (มี $5 credit) → เดือนแรกเกือบฟรี
- Cloudflare Tunnel + HTTPS: ฟรี
