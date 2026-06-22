# Deploy HR-Interview to Fly.io (Free Tier + Persistent Volume)

คู่มือ deploy multi-tenant HR-Interview ขึ้น Fly.io ฟรี โดยมี persistent volume สำหรับเก็บข้อมูลระยะยาว

---

## 1. สิ่งที่ต้องเตรียม

- บัญชี **Fly.io** (ฟรี) — สมัครที่ https://fly.io/app/sign-up
- **ติดตั้ง flyctl CLI**:
  - Windows: `iwr https://fly.io/install.ps1 -useb | iex`
  - Mac: `brew install flyctl`
  - Linux: `curl -L https://fly.io/install.sh | sh`
- **บัตรเครดิต** (Fly ขอเพื่อยืนยันตัวตน — ไม่หักถ้าอยู่ในขอบเขต free tier)

---

## 2. เตรียมโปรเจกต์

ทุกอย่างพร้อมในโปรเจกต์แล้ว:
- `Dockerfile` — image config
- `fly.toml` — Fly app config (port 3000, volume mount, HTTPS)
- `.dockerignore` — กรองไฟล์ที่ไม่ deploy

---

## 3. Login + เลือกชื่อ app

```bash
fly auth login
```

แก้บรรทัด `app = "hr-interview"` ใน `fly.toml` เป็นชื่อที่ **unique** บน Fly.io
เช่น `app = "hr-yourname"` หรือ `app = "siam-hr"` (ใช้ตัวอักษร a-z, 0-9, ขีดกลาง)

URL ที่ได้: `https://<ชื่อ-app>.fly.dev`

---

## 4. Launch app ครั้งแรก

```bash
fly launch --no-deploy --copy-config
```

- `--no-deploy`: ยังไม่ deploy ตอนนี้ — รอสร้าง volume ก่อน
- `--copy-config`: ใช้ `fly.toml` ที่มีอยู่แทนการสร้างใหม่
- ตอบ **No** ถ้าถามเรื่อง Postgres / Redis (ไม่ใช้)
- ตอบ **No** ถ้าถามเรื่อง deploy ตอนนี้

---

## 5. สร้าง Persistent Volume

```bash
fly volumes create hrdata --size 1 --region sin
```

- `hrdata`: ชื่อ volume (ต้องตรงกับ `source` ใน `fly.toml`)
- `--size 1`: 1 GB (free tier ให้รวม 3 GB — เพิ่มทีหลังได้)
- `--region sin`: Singapore (ใกล้ไทยที่สุดใน free region)

ตอบ **Yes** ถ้าถามเรื่อง snapshot retention

---

## 6. Deploy

```bash
fly deploy
```

ใช้เวลา 2-5 นาที (build image → upload → start machine)

เสร็จแล้วจะได้ URL: `https://<ชื่อ-app>.fly.dev/super/login`

---

## 7. เข้าใช้งานครั้งแรก

1. เปิด `https://<ชื่อ-app>.fly.dev/super/login`
2. Login ด้วย:
   - Password: `super!2026`
3. **เปลี่ยนรหัส Super-admin ทันที** (เมนู "🔑 เปลี่ยนรหัส Super-admin")
4. สร้าง tenant แรก:
   - Tenant ID: `companya` (a-z, 0-9, ขีดกลาง)
   - ชื่อบริษัท: เช่น "บริษัท ABC จำกัด"
   - รหัส admin เริ่มต้น: ตั้งเองหรือเว้นว่าง = `WWN2026!Init`
5. URL ของ tenant: `https://<ชื่อ-app>.fly.dev/t/companya`

ส่ง URL นั้นให้ admin ของบริษัท → admin login ด้วย username `admin` + รหัสที่ตั้งไว้

---

## 8. คำสั่งบ่อยใช้

| คำสั่ง | ทำอะไร |
|--------|--------|
| `fly logs` | ดู log แบบ real-time |
| `fly status` | ดูสถานะ machines |
| `fly deploy` | Deploy เวอร์ชันใหม่ |
| `fly ssh console` | SSH เข้า container (ดู `/app/persist/data`) |
| `fly volumes list` | ดู volume + ขนาด |
| `fly scale memory 512` | เพิ่ม RAM (ถ้า 256mb ไม่พอ) |
| `fly machine stop` | หยุด (เพื่อประหยัด — แต่ฟรีทั้งวันอยู่แล้ว) |
| `fly machine start` | เริ่มใหม่ |

---

## 9. ใช้ Domain ของตัวเอง (Optional)

ถ้ามี domain เช่น `hr.mycompany.com` อยากให้ใช้แทน `hr-interview.fly.dev`:

```bash
fly certs add hr.mycompany.com
```

Fly จะให้ DNS records ที่ต้องตั้งที่ registrar:
- `A record`: hr.mycompany.com → (IP ที่ Fly ให้)
- หรือ `CNAME`: hr → `<app>.fly.dev`

ตั้งเสร็จรอ 1-5 นาที Fly จะออก HTTPS cert อัตโนมัติ

### ไม่รู้ว่า domain อยู่ที่ registrar ไหน?
ตรวจสอบโดย:
1. https://lookup.icann.org/ → ใส่ domain → ดู "Registrar" ในผลลัพธ์
2. หรือเข้า https://www.whois.com/whois/ → ใส่ domain
3. หรือเปิด PowerShell แล้วรัน: `nslookup -type=ns yourdomain.com`

---

## 10. Backup ข้อมูล (ทำสม่ำเสมอ!)

ข้อมูลทั้งหมดอยู่ใน volume `hrdata` ที่ Fly.io
แม้ Fly จะ backup volume อัตโนมัติทุก 5 วัน แต่แนะนำสำรองมาเครื่องตัวเองด้วย:

```bash
# Download data folder (zip + scp via ssh)
fly ssh console -C "tar czf /tmp/hrdata.tar.gz /app/persist"
fly ssh sftp get /tmp/hrdata.tar.gz ./hrdata-backup.tar.gz
```

หรือใน Fly Dashboard → Volumes → "Take snapshot"

---

## 11. ค่าใช้จ่าย (Free Tier)

| รายการ | Free quota | เพียงพอสำหรับ |
|--------|-----------|---------------|
| VM compute | 3 shared-cpu-1x · 256mb | 1-2 app เล็ก |
| Persistent volume | 3 GB รวม | HR data ของหลายสิบบริษัท |
| Bandwidth | 160 GB outbound/เดือน | ลูกค้าเข้าได้สบาย |
| HTTPS / cert | ฟรี (Let's Encrypt) | ทุก domain |

ใช้เกินจะคิดตาม: $0.0000022/sec compute + $0.15/GB-month volume + $0.02/GB bandwidth

สำหรับ HR app ที่มี 2-3 บริษัทขนาดเล็ก → คาดว่าอยู่ใน free tier ตลอด

---

## 12. Troubleshooting

**Q: `fly deploy` ค้างที่ "deploying machine 1"**
A: ดู `fly logs` มีข้อความ error ไหม · อาจเป็นเพราะ memory ไม่พอ → `fly scale memory 512`

**Q: เข้า URL แล้วได้ 502 Bad Gateway**
A: Machine ยังไม่ start หรือ crash → `fly logs` ดู error · ปกติ machine ตื่นจาก stop ใช้เวลา 5-10 วินาที

**Q: ลืมรหัส Super-admin**
A: SSH เข้า container แล้วลบไฟล์:
```bash
fly ssh console
cd /app/persist/data
rm _super_auth.json
exit
fly apps restart hr-interview
```
ระบบจะสร้างใหม่ด้วยรหัสเริ่มต้น `super!2026`

**Q: อยากย้ายไป cloud อื่น**
A: Download volume (ดูข้อ 10) → upload ไปที่ใหม่ + ปรับ DATA_DIR/OUTPUT_DIR env ให้ตรง

---

## 13. Update โค้ดเวอร์ชันใหม่

แก้โค้ดในเครื่อง → push:

```bash
fly deploy
```

Fly จะ:
1. Build Docker image ใหม่
2. Restart machine ด้วย image ใหม่
3. Volume `hrdata` ยังเหมือนเดิม → data ไม่หาย ✓
