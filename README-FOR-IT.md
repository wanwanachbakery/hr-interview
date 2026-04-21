# เอกสารส่งต่อให้ทีม IT — Employee Interview App

> ระบบ AI อินเทอร์วิวพนักงาน JIANCHA — เก็บข้อมูล workflow ของพนักงานเพื่อสร้าง JD / KPI / ข้อเสนอปรับปรุง
> เอกสารนี้สำหรับทีม IT นำไปต่อยอด deploy / maintain / เชื่อม AI

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Backend | **Node.js + Express 4** |
| Frontend | HTML + CSS + Vanilla JS (ไม่ใช้ framework) |
| Storage | **JSON files** (ใน `data/` และ `outputs/`) |
| Auth | Cookie-based (HMAC-SHA256 signed), session 7 วัน |
| AI | Mock logic ใน `scripts/mock-ai.js` — ยังไม่เชื่อม Claude API |

Dependencies: แค่ `express` 1 ตัว

---

## 2. โครงสร้างไฟล์

```
employee-interview-app/
├── server.js                      # Express + API endpoints + auth middleware
├── package.json
├── .claude/launch.json            # สำหรับ Claude Preview (ไม่จำเป็นในการรันจริง)
├── data/
│   ├── divisions.json             # 10+ ฝ่าย (accounting, marketing, hr, scm, ...)
│   ├── employees.json             # พนักงานทุกคน
│   ├── interviews/*.json          # คำตอบ 1 ไฟล์ต่อ 1 พนักงาน
│   ├── auth.json                  # รหัสผ่าน master + per division
│   └── .secret                    # สุ่มอัตโนมัติ — สำหรับ sign cookie
├── outputs/
│   ├── _company/
│   │   └── optimization-report.md # รายงานรวมบริษัท (admin-only)
│   └── emp_xxxx/                  # 6 ไฟล์ต่อพนักงาน 1 คน
│       ├── workflow.md
│       ├── workflow.csv
│       ├── workflow-diagram.md    # Mermaid
│       ├── job-description.md
│       ├── kpi.md
│       └── optimization.md
├── public/                        # Frontend pages
│   ├── index.html                 # /          เลือกฝ่าย
│   ├── division.html              # /division  หน้ารายฝ่าย
│   ├── interview.html             # /interview Chat UI สัมภาษณ์
│   ├── review.html                # /review    ดาวน์โหลด output
│   ├── dashboard.html             # /dashboard (admin only)
│   ├── admin.html                 # /admin     (admin only) จัดการรหัส
│   ├── login.html                 # /login
│   ├── examples.html              # /examples  ตัวอย่างการตอบ
│   └── styles.css
└── scripts/
    ├── mock-ai.js                 # ⭐ ตัวหลัก: คำถาม 15 ข้อ + generator 6 ไฟล์ + company analysis
    └── stress-test.js             # สร้าง 100 พนักงานทดสอบ + รัน interview
```

---

## 3. API Endpoints

### Public (ไม่ต้อง login)
| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/api/login`  | `{password}` → cookie session |
| POST | `/api/logout` | ลบ session |

### Authenticated (ทุกคนที่ login)
| Method | Path | หน้าที่ |
|---|---|---|
| GET  | `/api/me`                     | role ของ session ปัจจุบัน |
| GET  | `/api/divisions`              | ฝ่ายที่เห็นได้ (division user: ฝ่ายตัวเอง, admin: ทั้งหมด) |
| GET  | `/api/employees`              | พนักงาน (scoped ตาม session) |
| POST | `/api/employees`              | เพิ่มพนักงาน (scoped) |
| POST | `/api/interview/:id/start`    | เริ่มอินเทอร์วิว |
| POST | `/api/interview/:id/message`  | ส่งคำตอบ รับคำถามถัดไป |
| POST | `/api/interview/:id/finish`   | generate 6 ไฟล์ |
| GET  | `/api/interview/:id`          | ดูคำตอบทั้งหมด (scoped) |
| GET  | `/api/outputs/:id/:file`      | โหลดไฟล์ผลลัพธ์ (scoped) |

### Admin only
| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/api/divisions`              | เพิ่มฝ่ายใหม่ |
| POST | `/api/company/analyze`        | รายงานรวมบริษัท |
| GET  | `/api/outputs/_company/:file` | โหลดรายงานรวม |
| GET  | `/api/admin/passwords`        | ดูรหัสทุกฝ่าย |

---

## 4. รหัสผ่านปัจจุบัน

เก็บใน `data/auth.json`:

| บทบาท | รหัส | สิทธิ์ |
|---|---|---|
| Master Admin | `aADMIN-2026` | เห็นทุกฝ่าย + dashboard + รายงานรวม |
| บัญชี | `bACC-2026` | เฉพาะฝ่ายตัวเอง |
| การตลาด | `cMKT-2026` | " |
| HR | `dHR-2026` | " |
| SCM | `eSCM-2026` | " |
| SCM Inter. | `fSCMI-2026` | " |
| Operations | `gOPS-2026` | " |
| IT | `hIT-2026` | " |
| คลังสินค้า | `iWH-2026` | " |
| เทรนนิ่ง | `jTRN-2026` | " |
| BD | `kBD-2026` | " |

**⚠️ ก่อน deploy public IT ควรเปลี่ยนให้ยาวและเดายากขึ้น** — อย่าน้อย 16 ตัวอักษร + mix letter/number/symbol

---

## 5. วิธีรัน local

```bash
cd employee-interview-app
npm install
npm start
# http://localhost:3000
```

Port configurable via `PORT=8080 npm start`

---

## 6. Roadmap ที่แนะนำให้ IT ทำต่อ

### Priority 1 — ก่อน deploy production
- [ ] **Migrate JSON → database** (SQLite/Postgres) — ตอนนี้ `fs.writeFileSync` ทุก request มี race condition ถ้ามีคนใช้พร้อมกันหลักร้อย
- [ ] **Rate limiting** ที่ `/api/login` — ตอนนี้ brute force ได้ไม่จำกัด
- [ ] **HTTPS only** — cookie ตอนนี้ไม่มี `Secure` flag
- [ ] เพิ่ม **CSP headers** และ `helmet.js`
- [ ] เปลี่ยนรหัสผ่านเป็นรูปแบบ hash (argon2/bcrypt) แทน plain text ใน `auth.json`
- [ ] **Environment variables** — ตอนนี้ hardcode PORT=3000, ย้าย auth/secret ไป env

### Priority 2 — Deploy
- **Option A: Railway** (แนะนำ) — `railway up` ได้เลย 5 นาที, $5 credit/ด.
- **Option B: Self-host** — Docker + nginx reverse proxy ที่ server บริษัท
- **Option C: Render/Fly.io** — ฟรี tier ได้ แต่ sleep หลัง idle

Dockerfile ตัวอย่าง:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Priority 3 — เชื่อม Claude API
แทนที่ 4 ฟังก์ชันใน `scripts/mock-ai.js`:
- `getNextQuestion(interview)` — ให้ Claude เลือกคำถามต่อไปตามบริบท
- `shouldProbe(answer)` — ใช้ Claude เช็คคุณภาพคำตอบ, ถาม probe ฉลาดขึ้น
- `generateDocuments(interview)` — ให้ Claude เขียน JD/KPI/optimization แบบเนียน
- `analyzeCompany(interviews)` — ใช้ Claude หา pattern / insight ข้ามพนักงาน

ตัวอย่าง (pseudo):
```js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();  // ต้องมี ANTHROPIC_API_KEY env

async function generateJD(interview) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `เขียน Job Description จากข้อมูลอินเทอร์วิวนี้:\n${JSON.stringify(interview)}`
    }]
  });
  return res.content[0].text;
}
```

ประมาณการค่าใช้จ่าย: **~$0.05-0.20 / พนักงาน 1 คน** (ขึ้นกับ model)

### Priority 4 — Features เพิ่มเติม
- [ ] Backup อัตโนมัติ (cron → S3/Google Drive)
- [ ] Export เป็น .docx/.xlsx จริง (แทน .md/.csv)
- [ ] Voice input — พูดแทนพิมพ์ (Whisper API)
- [ ] Multi-language (ไทย/อังกฤษ/จีน)
- [ ] Email notification หลังอินเทอร์วิวเสร็จ
- [ ] Analytics dashboard (ใครตอบเสร็จ, ใครยังค้าง, เวลาเฉลี่ยในการตอบ)

---

## 7. ผลการทดสอบ

**Stress test 100 พนักงาน พร้อมกัน (concurrency 20):**
- สร้าง: 52ms
- รัน interviews ทั้งหมด: 235ms (2ms/คน)
- Company analysis: 5ms
- **Total: 0.3 วินาที, 0 errors**

⚠️ แต่ที่ 500+ คนพร้อมกัน JSON file write จะเริ่มเป็น bottleneck — ต้องย้าย database

---

## 8. ติดต่อ

เจ้าของไฟล์นี้: คุณแหฮ่า / @happ
Project path: `/Users/happ/ai project/employee-interview-app/`
