# คู่มือใช้งาน HR-Interview (Phase 1–4)

> ครอบคลุมทุกฟีเจอร์: Login รายคน, โครงสร้างองค์กร 4 ชั้น, RBAC 5 ระดับ, self-service profile, แก้ชื่อ ฝ่าย/แผนก/ตำแหน่ง ตามสิทธิ์, รายงานพร้อมฟิลเตอร์ตามสิทธิ์

---

## 1. การเริ่มต้นใช้งาน

### 1.1 รัน server
```powershell
cd D:\99-Ai\07-HT-wwn\Hr-wwn
npm start
```
เปิดเบราว์เซอร์ที่ → `http://localhost:3000`

### 1.2 Login ครั้งแรก
ระบบติดตั้งมาพร้อมบัญชี **master admin** (เปลี่ยนทันทีหลัง login ครั้งแรก)

| Username | Password |
|----------|----------|
| `admin`  | `WWN2026!Init` |

ดูรหัสปัจจุบันได้ที่ไฟล์ `data/auth.json`

> **ความปลอดภัย**: รหัสเก็บแบบ plain text ใน `auth.json` — เหมาะกับ dev เท่านั้น ก่อนใช้จริงต้อง hash (argon2/bcrypt) ตามที่ README-FOR-IT.md แนะนำ

---

## 2. สิทธิ์ผู้ใช้ 5 ระดับ

ระบบมี role 6 ตัว (รวม admin):

| Role | ภาษาไทย | สิทธิ์การมองเห็น |
|------|---------|------------------|
| `admin` | ผู้ดูแลระบบ | ทุกอย่าง + จัดการ user/องค์กร |
| `executive` | ผู้บริหาร | **ดูได้ทั้งหมด** (read-only ในระบบหลัก) |
| `manager` | ผู้จัดการ | ดูฝ่ายตัวเอง + admin ตั้งค่าให้ดูฝ่าย/แผนก/ตำแหน่งอื่นเพิ่มได้ |
| `division_head` | หัวหน้าฝ่าย | ดูฝ่ายตัวเอง + ทุกแผนก/ตำแหน่งในฝ่าย |
| `section_head` | หัวหน้าแผนก | ดูแผนกตัวเอง + ตำแหน่งในแผนก |
| `officer` | เจ้าหน้าที่ | ดูตำแหน่งตัวเองเท่านั้น |

### กฎการเลือก scope ตอนสร้าง user
- **ผู้บริหาร**: ไม่ต้องระบุ ฝ่าย/แผนก/ตำแหน่ง (เห็นหมด)
- **ผู้จัดการ / หัวหน้าฝ่าย**: ต้องระบุ **ฝ่าย**
- **หัวหน้าแผนก**: ต้องระบุ **แผนก** (และฝ่ายต้นสังกัด)
- **เจ้าหน้าที่**: ต้องระบุ **ตำแหน่ง** (และแผนก/ฝ่ายต้นสังกัด)

---

## 3. ขั้นตอนการตั้งค่าระบบสำหรับ Admin

### Step 1 — Login เป็น admin
- Username: `admin`
- Password: `WWN2026!Init` (หรือที่เปลี่ยนไว้)

### Step 2 — ตั้งชื่อบริษัท
1. เข้าเมนู **🔐 Admin** → **🏢 โครงสร้างองค์กร** (`/admin/org`)
2. กรอกชื่อบริษัท (TH/EN) → **บันทึก**

### Step 3 — สร้างฝ่าย
ที่หน้า `/admin/org`:
1. กรอกชื่อฝ่าย เช่น "ฝ่ายบัญชี"
2. ใส่ icon (emoji) และสี ถ้าต้องการ
3. กด **+ เพิ่มฝ่าย**

### Step 4 — สร้างแผนกในฝ่าย
ในกล่องฝ่ายที่สร้างไว้ จะมีฟอร์ม **+ เพิ่มแผนก** — กรอกแล้วกด submit

### Step 5 — สร้างตำแหน่งในแผนก
ในกล่องแผนก จะมีฟอร์ม **+ เพิ่มตำแหน่ง**

### Step 6 — สร้าง User
1. เมนู **👥 ผู้ใช้** (`/admin/users`)
2. กด **+ เพิ่มผู้ใช้ใหม่**
3. กรอก:
   - Username (ห้ามเป็น `admin`)
   - รหัสผ่าน
   - ชื่อ-นามสกุล
   - **Role** — เลือก 1 ใน 5
   - **ฝ่าย / แผนก / ตำแหน่ง** ตามที่ role ต้องการ
   - เวลาเข้า/ออก/พัก (ค่าเริ่มต้น 09:00–18:00, พัก 12:00–13:00)
4. **กรณี Manager** — ถ้าจะอนุญาตให้ดูฝ่าย/แผนก/ตำแหน่งอื่นเพิ่ม ติ๊กในกล่อง "ตั้งค่า scope เพิ่มเติม"
5. **บันทึก**

### Step 7 — เปลี่ยนรหัส master admin
ที่หน้า `/admin` → กดการ์ด **🔑 รหัส Master Admin** → กรอกรหัสใหม่

---

## 4. เมนูสำหรับ Admin (สรุป)

| URL | หน้า | ทำอะไรได้ |
|-----|------|-----------|
| `/admin` | Admin Console | ภาพรวม + ลิงก์ไปเมนูอื่น + เปลี่ยนรหัส master |
| `/admin/org` | โครงสร้างองค์กร | ชื่อบริษัท · ฝ่าย · แผนก · ตำแหน่ง (CRUD) |
| `/admin/users` | จัดการผู้ใช้ | เพิ่ม/แก้/ลบ user · กำหนด role + scope |

---

## 5. โครงสร้างไฟล์ข้อมูล (`data/`)

ระบบเก็บทุกอย่างใน JSON files:

| ไฟล์ | เก็บอะไร |
|------|---------|
| `company.json` | ชื่อบริษัท (object เดียว) |
| `divisions.json` | รายการฝ่าย |
| `sections.json` | รายการแผนก (ผูกกับ `division_id`) |
| `positions.json` | รายการตำแหน่ง (ผูกกับ `section_id`) |
| `users.json` | รายชื่อ user + รหัส hash (scrypt) |
| `auth.json` | รหัส master admin |
| `.secret` | secret สำหรับ sign cookie (สร้างอัตโนมัติ) |

### ตัวอย่าง user record (รหัสถูก hash)
```json
{
  "id": "usr_xxxx",
  "username": "somchai",
  "name": "สมชาย ใจดี",
  "password_salt": "...",
  "password_hash": "...",
  "role": "section_head",
  "division_id": "div_xxx",
  "section_id": "sec_xxx",
  "position_id": null,
  "work_start": "09:00",
  "work_end": "18:00",
  "break_start": "12:00",
  "break_end": "13:00",
  "scope_override": null,
  "created_at": "2026-05-11T..."
}
```

---

## 6. API หลัก (สำหรับนักพัฒนา)

| Method | Endpoint | สิทธิ์ |
|--------|----------|--------|
| POST | `/api/login` (body: username, password) | public |
| POST | `/api/logout` | login required |
| GET | `/api/me` | login required |
| GET | `/api/me/profile` | login required (Phase 3) |
| GET/PUT | `/api/company` | get=ใครก็ได้, put=admin |
| GET/POST/PUT/DELETE | `/api/divisions[/:id]` | get=ตามสิทธิ์, อื่นๆ=admin |
| GET/POST/PUT/DELETE | `/api/sections[/:id]` | get=ตามสิทธิ์, อื่นๆ=admin |
| GET/POST/PUT/DELETE | `/api/positions[/:id]` | get=ตามสิทธิ์, อื่นๆ=admin |
| GET/POST/PUT/DELETE | `/api/users[/:id]` | admin only |
| GET/PUT | `/api/admin/auth` | admin only (master password) |

---

## 7. ตัวอย่าง use case

### 7.1 ผู้จัดการฝ่าย A ที่ต้องดูฝ่าย B ด้วย
1. Login admin → `/admin/users`
2. แก้ user คนนั้น → role: `manager`, ฝ่าย: A
3. ใน **"ตั้งค่า scope เพิ่มเติม"** ติ๊กฝ่าย B
4. บันทึก — User เห็นได้ทั้ง A และ B

### 7.2 หัวหน้าแผนกบัญชี
- role: `section_head`
- แผนก: บัญชี
- จะเห็น: แผนกตัวเอง + ตำแหน่งทุกอันในแผนกบัญชี

### 7.3 เจ้าหน้าที่บัญชี
- role: `officer`
- ตำแหน่ง: เจ้าหน้าที่บัญชี
- จะเห็น: ตำแหน่งตัวเองเท่านั้น

---

## 8. ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|-------|------------------|
| Login ไม่ได้ → "username หรือรหัสผ่านไม่ถูกต้อง" | username พิมพ์ผิด หรือยังไม่ได้สร้าง user / ตรวจ `data/users.json` |
| ลบฝ่ายไม่ได้ | มีแผนก/user อยู่ในฝ่ายนี้ — ต้องลบของในฝ่ายก่อน |
| เปลี่ยน role แล้วบันทึกไม่ได้ | role ใหม่ต้องการ ฝ่าย/แผนก/ตำแหน่ง — ตั้งให้ครบก่อน |
| ลืมรหัส master admin | แก้ไฟล์ `data/auth.json` แล้ว restart server |

---

## 9. หน้า User (Phase 3)

User ที่ไม่ใช่ admin จะ login มาที่ `/` (หน้าแรก) ซึ่งแสดง:
- ข้อมูลโปรไฟล์ตัวเอง
- ลิงก์ไป `/profile` (แก้โปรไฟล์) และ `/reports` (รายงาน)

### 9.1 `/profile` — แก้ข้อมูลตัวเอง
**ทุก user (ยกเว้น admin) ทำได้:**
- แก้ชื่อ-นามสกุล
- ตั้งเวลาเข้า/ออก/พัก (รูปแบบ HH:MM)
- เปลี่ยนรหัสผ่าน (เว้นว่าง = ไม่เปลี่ยน)

**ห้าม:** เปลี่ยน role / ฝ่าย / แผนก / ตำแหน่ง ของตัวเอง (admin เท่านั้น)

### 9.2 แก้ชื่อ ฝ่าย/แผนก/ตำแหน่ง ในหน้า /profile
แต่ละ role แก้ได้ต่างกัน:

| Role | แก้ชื่อฝ่าย | แก้ชื่อแผนก | แก้ชื่อตำแหน่ง |
|------|------------|-------------|----------------|
| executive | ทุกฝ่าย | ทุกแผนก | ทุกตำแหน่ง |
| manager | ฝ่ายในขอบเขต | แผนกในขอบเขต | ตำแหน่งในขอบเขต |
| division_head | เฉพาะฝ่ายตัวเอง | ทุกแผนกในฝ่ายตัวเอง | ทุกตำแหน่งในฝ่ายตัวเอง |
| section_head | – | เฉพาะแผนกตัวเอง | ทุกตำแหน่งในแผนกตัวเอง |
| officer | – | – | – (ห้ามแก้) |

**ข้อจำกัด**: ย้ายแผนกไปฝ่ายอื่น / ย้ายตำแหน่งไปแผนกอื่น = **admin เท่านั้น**

---

## 10. หน้า รายงาน — `/reports` (Phase 4)

ทุก user ที่ login เข้ามาดูได้ — เนื้อหาฟิลเตอร์ตามสิทธิ์อัตโนมัติ

### ที่หน้านี้แสดง
1. **สรุปภาพรวม** — จำนวนผู้ใช้ที่มองเห็นได้, จำนวนฝ่าย, breakdown by role
2. **จำนวนผู้ใช้แต่ละฝ่าย** — table ที่เห็นเฉพาะฝ่ายในขอบเขต
3. **รายชื่อผู้ใช้** — พร้อมฟิลเตอร์ ชื่อ / role / ฝ่าย / แผนก

### ใครเห็นอะไร
| Role | เห็นในรายงาน |
|------|--------------|
| admin | ทุกคน, ทุกฝ่าย |
| executive | ทุกคน, ทุกฝ่าย |
| manager | ผู้ใช้ในฝ่ายของตัว + ฝ่ายที่ admin override |
| division_head | ผู้ใช้ในฝ่ายตัวเอง |
| section_head | ผู้ใช้ในแผนกตัวเอง |
| officer | เฉพาะตัวเอง |

---

## 11. ฟีเจอร์หลัก — Interview + JD/KPI Generator

ระบบดั้งเดิมของ HR-Interview คือการสัมภาษณ์พนักงานเพื่อสร้างเอกสาร 3 ฉบับ:
- **JD** (Job Description) — รายละเอียดงาน
- **KPI** — ตัวชี้วัด
- **Optimization** — ข้อเสนอแนะการปรับปรุง

### 11.1 Flow การใช้งาน
1. เข้า `/dashboard` (จากหน้าแรก กดการ์ด "🎤 อินเทอร์วิว + JD/KPI")
2. กดเข้าฝ่ายที่ต้องการ → หน้า `/division?id=...`
3. กรอกชื่อ + ตำแหน่ง + หน้าที่หลัก ของพนักงานในกล่อง "เพิ่มพนักงาน" → กด **เริ่มอินเทอร์วิวเลย**
4. AI ถามคำถามทีละข้อ (15–17 ข้อ ขึ้นอยู่กับ schedule + ฝ่าย) → พนักงานตอบ
5. กด **สร้างเอกสาร** → ระบบ generate ไฟล์ .md 3 ฉบับ ลง `outputs/{employee_id}/`
6. ดูผลที่ `/review?id=...`

### 11.2 สิทธิ์ในการใช้ฟีเจอร์อินเทอร์วิว

| Role | เพิ่มพนักงาน | สัมภาษณ์ | ลบ | วิเคราะห์รวมบริษัท |
|------|-------------|----------|-----|--------------------|
| admin | ทุกฝ่าย | ทุกคน | ✓ | ✓ |
| executive | ทุกฝ่าย | ทุกคน | – | ✓ |
| manager | ในขอบเขต (ฝ่ายตัว + override) | ในขอบเขต | – | ✓ |
| division_head | ฝ่ายตัวเอง | ในฝ่ายตัว | – | – |
| section_head | แผนกตัวเอง | ในแผนกตัว | – | – |
| officer | **เฉพาะตัวเอง** (auto-fill scope) | เฉพาะของตัว | – | – |

> **ลบพนักงาน + ข้อมูลอินเทอร์วิว** = admin เท่านั้น (เพื่อป้องกันการสูญหาย)

### 11.3 หน้า Dashboard
- ทุก role เข้าได้ — ข้อมูลฟิลเตอร์ตามสิทธิ์อัตโนมัติ
- ปุ่ม **🔍 วิเคราะห์ภาพรวมบริษัท** จะแสดงเฉพาะ admin/exec/manager
- ปุ่ม **🗑 ลบ** จะแสดงเฉพาะ admin
- ปฏิทินมี toggle "เฉพาะฝ่ายนี้ / ทุกฝ่าย" สำหรับ admin/exec/manager

### 11.4 รายงาน optimization-report.md
- เก็บที่ `outputs/_company/optimization-report.md`
- ดาวน์โหลด/เปิดดูได้ที่ `/api/outputs/_company/optimization-report.md`
- เปิดได้เฉพาะ admin / executive / manager
- **กดปุ่ม "วิเคราะห์ภาพรวมบริษัท" จะ overwrite ไฟล์เดิม** — ระบบมี report เดียว ไม่มีประวัติ

### 11.5 หมายเหตุสำคัญ
- เอกสาร JD/KPI/Optimization ที่ generate เป็น **ไฟล์ Markdown ภาษาไทย** สร้างโดย mock AI (`scripts/mock-ai.js`)
- ยังไม่ได้ต่อกับ Claude API จริง — ค่าใช้จ่าย $0.05–0.20 ต่อพนักงาน ตามที่ README-FOR-IT.md ระบุ
- พนักงาน 1 คน = 1 record ใน `data/employees.json` + 1 ไฟล์ใน `data/interviews/{emp_id}.json` + 1 โฟลเดอร์ใน `outputs/{emp_id}/`

---

## 12. Position-anchored Model (สำคัญที่สุด)

**หลักคิด:** Interview ผูกกับ **ตำแหน่ง** (position) — ไม่ใช่กับตัว user
ตำแหน่งเป็น "หน่วยถาวร" ส่วน user หมุนเข้า/ออกตามเวลา

### 12.1 หลักการ
- ทุก user (ยกเว้น admin) ต้องผูก **ฝ่าย + แผนก + ตำแหน่ง ครบ 3 ฟิลด์**
- ระบบ auto-create employee record ทันทีที่ admin สร้าง/แก้ user
- 1 user = 1 active employee record = 1 interview ที่ตอบเอง (ไม่ใช่หัวหน้าทำแทน)
- หัวหน้า "ดูได้" แต่ตอบแทนไม่ได้

### 12.2 Flow 4 กรณี

**กรณี 1: Admin สร้าง user**
```
admin POST /api/users { username, name, role, division_id, section_id, position_id }
  → user บันทึก
  → ระบบ auto-create emp { user_id, position_id, status: not_started }
```

**กรณี 2: User ตอบ interview**
```
user login → / → เห็น "🎤 อินเทอร์วิวของฉัน" status: รอตอบ
  → กดเข้า /interview?id=xxx
  → ตอบจนจบ + กด finish
  → status: completed · เอกสาร JD/KPI สร้างที่ outputs/{emp_id}/
```

**กรณี 3: Admin ย้าย user (เปลี่ยน position)**
```
admin PUT /api/users/:id { position_id: NEW }
  → emp เก่า archived = true, vacated_at = now (interview answers ยังอยู่)
  → สร้าง emp ใหม่ (position ใหม่, status: not_started)
  → User login ครั้งหน้า → เห็น interview ใหม่รอตอบ
  → ข้อมูลเก่ายังเก็บเป็น "ประวัติของตำแหน่งเก่า"
```

**กรณี 4: Admin ลบ user**
```
admin DELETE /api/users/:id
  → emp.user_id = null, emp.archived = true, emp.vacated_reason = "user_deleted"
  → interview file ยังอยู่ ติดกับตำแหน่งเป็นประวัติ
  → ตำแหน่งกลายเป็น "ว่าง" รอ user คนใหม่
```

### 12.3 สิทธิ์ในโมเดลใหม่

| การกระทำ | ใคร |
|----------|-----|
| สร้าง emp (manual) | **admin เท่านั้น** (escape hatch; ปกติ auto-create) |
| Start/Answer/Finish interview | **owner_user_id เท่านั้น** (+ admin สำหรับ data fix) |
| ดู emp/interview ของคนอื่น | ตามขอบเขต RBAC (canView) |
| ลบ emp + interview | admin เท่านั้น |
| Archived record | **immutable** — ตอบเพิ่มไม่ได้ ดูได้อย่างเดียว |
| ลบ position | **ไม่ได้เลย** ถ้ามี emp ใดผูกอยู่ (active หรือ archived) |

### 12.4 Fields ใน emp record

```json
{
  "id": "emp_xxx",
  "position_id": "pos_xxx",       // ANCHOR
  "user_id": "usr_xxx",            // null ถ้า vacant/archived
  "name": "...",                   // freeze ตอน assign
  "role": "...",                   // freeze (= position.name)
  "division_id": "...",
  "section_id": "...",
  "primary_duty": "...",
  "interviewStatus": "not_started|in_progress|completed",
  "archived": false,
  "vacated_at": null,
  "vacated_reason": null,           // "position_change" | "user_deleted"
  "createdAt": "..."
}
```

### 12.5 API ใหม่
- GET `/api/me/employee` — user หา active emp ของตัวเอง (สำหรับหน้าแรก)
- GET `/api/positions/:id/history` — ดูประวัติของตำแหน่ง (ใครเคยรับ, interview ของแต่ละคน)
- GET `/api/employees?include_archived=true` — รวม archived ด้วย (default แสดงแต่ active)

### 12.6 หน้าจอ
- **`/`** (user home) — การ์ด "🎤 อินเทอร์วิวของฉัน" + ปุ่มเข้าหน้า interview
- **`/dashboard`** — list ทุกตำแหน่งในขอบเขต พร้อมสถานะ (ว่าง / รอตอบ / กำลังตอบ / เสร็จ)
- **`/admin/users`** — แจ้งเตือนว่าเปลี่ยน position = reset interview

---

## 13. Production Deployment (Cloudflare Tunnel)

### 13.1 ภาพรวม
HR-Interview พร้อม deploy ออนไลน์แบบฟรีผ่าน **Cloudflare Tunnel**:
- Server รันบน PC ของคุณ (Node.js)
- Cloudflare Tunnel แปลง localhost:3000 ให้เข้าได้จาก internet พร้อม HTTPS
- ลูกค้าเข้าผ่าน URL เช่น `https://hr.mycompany.com`

ดูรายละเอียดเต็มใน **[docs/CLOUDFLARE-TUNNEL.md](CLOUDFLARE-TUNNEL.md)**

### 13.2 Security Hardening ที่ทำให้แล้ว
| รายการ | สถานะ |
|--------|--------|
| Master password ถูก hash (scrypt + salt) | ✓ migrate อัตโนมัติครั้งแรกที่ start |
| Login rate limit: 5 ครั้ง/5 นาที → block 15 นาที | ✓ |
| Cookie `Secure` flag เมื่อ `SECURE_COOKIES=true` | ✓ |
| `app.set('trust proxy', 1)` รองรับ X-Forwarded-* | ✓ |
| ปิด `X-Powered-By` header | ✓ |

### 13.3 รัน production
**Windows (ดับเบิลคลิก):**
```
scripts\start-production.bat
```

**หรือ command line:**
```powershell
$env:SECURE_COOKIES="true"
npm start
```

### 13.4 หมายเหตุสำคัญ
- **ลืม master password** → ต้องแก้ไฟล์ `data/auth.json` โดยตรง (ลบทั้งไฟล์ → server จะสร้างใหม่ด้วย default `WWN2026!Init`)
- **Backup** → คัดลอกโฟลเดอร์ `data/` สม่ำเสมอ — ข้อมูลทุกอย่างอยู่ที่นั่น
- **PC ปิด = ลูกค้าเข้าไม่ได้** → ตั้ง Cloudflare Tunnel + Node server เป็น service (ดูคู่มือ deploy)

---

## 14. คำสั่งทั่วไป

| ทำอะไร | คำสั่ง |
|--------|--------|
| รัน server | `npm start` |
| เปลี่ยน port | `$env:PORT=8080; npm start` (PowerShell) |
| หยุด server | Ctrl+C ในหน้าต่างที่รันอยู่ |
| Backup ข้อมูล | คัดลอกโฟลเดอร์ `data/` ทั้งหมด |
| Reset ระบบ | ลบทุกไฟล์ใน `data/` ยกเว้น `.gitkeep` แล้ว `npm start` (ระบบจะสร้างใหม่ให้) |
