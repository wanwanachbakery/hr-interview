# PLAN — HR-Interview รอบที่ 2 (batch2)

> เอกสารนี้ = แผนเทคนิคสำหรับ developer หยิบไปทำได้ทันที · เขียนจากการอ่านโค้ดจริง (`server.js` ~3,440 บรรทัด, single-file backend) · **ห้ามเขียนโค้ด/commit จากเอกสารนี้ — เป็นแผนอย่างเดียว**
>
> สถาปัตยกรรมที่ยึด (ยืนยันจากโค้ด):
> - Backend รวมใน `server.js` ไฟล์เดียว · Express + JSON files · ไม่มี framework frontend (HTML + inline `<script>` ต่อหน้า + shared `public/app-shell.js`/`i18n.js`) · **แอปนี้ยังไม่ได้บังคับ CSP** (อยู่ backlog) → หน้าใหม่ทำตาม pattern inline script เดิมได้
> - Token = HMAC(SHA-256) base64url เอง (`signToken`/`verifyToken`) ไม่ใช่ JWT lib
> - Cookie 2 ชนิด: `auth` (tenant, `Path=/t/:tid`) · `super_auth` (`Path=/`)
> - **Tenant isolation gate** อยู่ที่ `authMiddleware` (บรรทัด ~435): `session.tenant_id !== req.tenant.id` → reject
> - Token revocation ด้วย `tv` (missing = 0), must_change gate, rate-limit (`rlCheck/rlFail/rlOk`), atomic `writeJson`, fail-loud `readJson` — ครบแล้ว ใช้ซ้ำ
> - Backup: `BACKUP_FILE_RE`, `execFile('tar', ...)` ผ่าน `runTar(args, cwd)` (relative path เท่านั้น กัน Windows drive-colon), isolation ผ่าน `-C <base> <relname>`

---

## 0. โครงสร้างไฟล์ — เพิ่ม/แก้อะไรบ้าง (ภาพรวมทั้ง 4 งาน)

### Backend (`server.js`) — แก้ไฟล์เดียว เพิ่มเป็น section ใหม่
| ส่วน | ตำแหน่งอ้างอิงเดิม | งาน |
|---|---|---|
| `GROUP_EXEC_AUTH_FILE = data/_group_exec_auth.json` + helper read/write | ข้าง `SUPER_AUTH_FILE` (~90) | 1 |
| branch `group_exec` ใน `authMiddleware` | ~435 | 1 |
| เพิ่ม `group_exec` ใน read-visibility helper (`canView`/`canViewEmployee`/`canViewUserWorklog`/`userVisibleTo`) + full-view branch ของ endpoint อ่าน | หลายจุด (ดู §1.4) | 1 |
| `/api/exec/*` root-level router + `requireGroupExec` + must_change gate | ข้าง super layer (~2988) | 1 |
| `/api/super/group-exec` (provisioning) | ในกลุ่ม super routes (~3135) | 1 |
| `restoreArchive()` + `POST /api/super/backup/restore` + `POST /api/admin/backup/restore` | ข้าง backup helpers (~750) + routes (~2556, ~3170) | 2 |
| `appendAudit()` + storage/rotation + hooks ทุก event | helper ใหม่ (~200) + แทรกจุดยิง event | 3 |
| `GET /api/admin/audit` + `GET /api/super/audit` | tenant router + super layer | 3 |
| `readJsonCached(file, fallback)` (mtime+size key) + ใช้ใน `authMiddleware` | ข้าง `readJson` (~151) | 4 |

### Frontend (`public/`)
| ไฟล์ใหม่ | หน้าที่ | งาน |
|---|---|---|
| `exec-login.html` | หน้า login ผู้บริหารกลุ่ม (คู่ขนาน `super-login.html`) | 1 |
| `exec.html` | portal `/exec` — ลิสต์ทุกบริษัท + สถิติสรุป + ลิงก์ drill-in | 1 |
| `admin-audit.html` | หน้าดู audit ของ tenant (admin) | 3 |
| `super-audit.html` | หน้าดู system audit (super) | 3 |

| ไฟล์เดิมที่แก้ | สิ่งที่เพิ่ม | งาน |
|---|---|---|
| `super-tenants.html` | section "จัดการบัญชีผู้บริหารกลุ่ม" (ตั้ง/รีเซ็ตรหัส, เปิด/ปิด) | 1 |
| `dashboard.html`, `reports.html`, `worklog-report.html`, `worklog-team.html`, `admin*.html`, `index.html` | ซ่อนปุ่มแก้ไข/admin/danger เมื่อ `role==='group_exec'` (อ่านจาก `/api/me`) | 1 |
| `admin.html` | ปุ่ม "กู้คืนข้อมูล (Restore)" + modal ยืนยัน | 2 |
| `super-backup.html` | ปุ่ม Restore ระดับระบบ/รายบริษัท + modal ยืนยัน | 2 |

### ข้อมูล (runtime, gitignored ใต้ `data/`)
- `data/_group_exec_auth.json` — credential ผู้บริหารกลุ่ม (งาน 1)
- `data/_audit.json` (+ `_audit-<stamp>.json` หลัง rotate) — system audit (งาน 3)
- `data/tenants/<tid>/audit.json` (+ rotate) — audit ราย tenant (งาน 3)
- `backups/**/*.pre-restore-<stamp>.tar.gz` — safety snapshot ก่อน restore (งาน 2)

---

## งาน 1 — บัญชีผู้บริหารกลุ่ม (group_exec) · READ-ONLY ข้ามทุกบริษัท  ⭐ (เจาะ tenant isolation — ออกแบบละเอียดสุด)

### 1.1 Auth model
- **เก็บ credential**: `data/_group_exec_auth.json` เลียน `_super_auth.json` เป๊ะ
  ```
  { enabled:false, master_salt, master_hash, tv:0, must_change:false, updated_at }
  ```
  - **default = ปิดใช้งาน**: ไฟล์ไม่มี หรือ `enabled!==true` → login ถูกปฏิเสธเสมอ (fail-safe) · ไม่ ensure() ไฟล์นี้ตอน boot ด้วยรหัส default (ต่างจาก super/tenant) — บัญชีนี้ "ไม่มีตัวตน" จนกว่า super จะเปิด
  - บัญชีเดียวทั้งระบบ (username โดยนัย = "ผู้บริหารกลุ่ม", ไม่ต้องกรอก username — เหมือน super ที่กรอกแค่ password)
- **Login route**: `POST /api/exec/login` (root-level, ไม่ใช่ tenant)
  - เช็ค `enabled===true` ก่อน → ถ้าปิด: 403 (ข้อความกลาง ๆ ไม่บอกว่าบัญชีมี/ไม่มี)
  - `verifyPassword` เทียบ hash · **ใช้ `rlCheck/rlFail/rlOk` ตัวเดิม** (rate-limit ต่อ IP)
  - สำเร็จ → `signToken({ role:'group_exec', tv, exp })` **ไม่มี `tenant_id`** (นี่คือหัวใจ: token ไม่ผูก tenant)
  - Cookie: `group_auth=<token>; Path=/; HttpOnly; SameSite=Lax` (+Secure ตาม `cookieSuffix`) · Path=/ เพื่อให้ส่งไปทั้ง `/exec` และทุก `/t/:tid`
- **`tv` (token-version)**: bump เมื่อ super เปลี่ยน/รีเซ็ตรหัส หรือ **ปิดใช้งาน** → token เดิมตายทันที · re-issue cookie ให้ session ปัจจุบันหลัง self-change
- **must_change**: เมื่อ super ตั้ง/รีเซ็ตรหัส → `must_change:true` · gate บล็อกทุก `/api/exec/*` และการ drill-in tenant ยกเว้น allowlist (เปลี่ยนรหัส/สถานะ/logout) จนกว่าจะเปลี่ยน (mirror `SUPER_MUST_CHANGE_ALLOW`)

### 1.2 การบังคับ read-only ข้าม tenant (จุดอ่อนไหวสุด — ต้อง fail-safe)
เพิ่ม **branch เดียว** ต้นทาง `authMiddleware` (ก่อนเช็ค `session.tenant_id === req.tenant.id`):

```
// pseudo — ไม่ใช่โค้ดจริง
if (isPublicRequest(req)) return next();
const gtoken = parseCookie(req, 'group_auth');
const gs = verifyToken(gtoken);
if (gs && gs.role === 'group_exec') {
   const ga = readGroupExecAuth();
   if (!ga.enabled) return rejectAuth();                 // ปิดใช้งาน = ตายทันที
   if (Number(ga.tv||0) !== Number(gs.tv||0)) return rejectAuth();  // revoke
   if (ga.must_change) return rejectAuth();              // ยังไม่เปลี่ยนรหัส → ห้าม drill-in
   if (req.method !== 'GET') return res.status(403)...   // (A) เขียนไม่ได้เด็ดขาด
   if (!EXEC_TENANT_READ_ALLOW(req.path)) return 403;    // (B) allowlist path เท่านั้น
   req.session = { role:'group_exec' };                  // ไม่มี user_id/scope
   req.isGroupExec = true;
   appendAudit(...view...);                              // งาน 3: log ว่าเข้าดู tid ไหน
   return next();
}
// ...ไม่ใช่ group_exec → เดินเส้นเดิม (auth cookie + tenant_id match) ทุกประการ
```

**การตัดสินใจด้านความปลอดภัย (สำคัญ):**
1. **fail-safe เป็น allowlist ไม่ใช่ denylist** — `EXEC_TENANT_READ_ALLOW` = ชุด regex ของ path อ่านที่อนุญาต (เช่น `/api/company`, `/api/divisions`, `/api/sections`, `/api/positions`, `/api/employees`, `/api/reports/*`, `/api/worklog/team`, `/api/worklog/view/*`, `/api/worklog/report*`, `/api/interviews/history`, `/api/interview/:id` (GET), `/api/me`, `/api/outputs/*` (ดูรายงาน), + หน้า HTML `/dashboard`,`/reports`,`/worklog-report`,`/division`,`/review` ฯลฯ) · **default = ปฏิเสธ** → endpoint ใหม่ในอนาคตจะถูกบล็อกอัตโนมัติจนกว่าจะจงใจเพิ่มเข้า allowlist (ตรงหลักทีม "scope ว่าง = เห็นว่าง ไม่ใช่เห็นหมด")
2. **บล็อก write ทุก method ที่ไม่ใช่ GET** ก่อนถึง allowlist (defense ชั้นแรก) — ครอบ POST/PUT/DELETE/PATCH ทั้งหมด รวม side-effect endpoint ที่เผลอเป็น GET ก็ยังโดน allowlist กรองอีกชั้น
3. **บล็อก admin/super/secret เด็ดขาด**: allowlist **ต้องไม่มี** path ที่ขึ้นต้น `/api/admin/` และห้ามมี backup download/list · group_auth ใช้ role `group_exec` เท่านั้น จึงไม่มีทางผ่าน `requireAdmin`/`requireSuperAdmin` (คนละ role, คนละ cookie) → เข้าถึง `_secret`/`auth.json`/backup ไม่ได้เลย
4. **ไม่แตะ tenant cookie logic เดิม**: branch group_exec return ก่อน ไม่แก้เส้น named-user/master-admin เดิม → ไม่เปิดช่องให้ role อื่น bypass · การตรวจ `gs.role==='group_exec'` มาจาก payload ที่ server sign เอง (HMAC) → tenant user ปลอม role ไม่ได้
5. **ไม่ผูก tenant**: token ไม่มี `tenant_id` จึงเห็น **ทุก** `/t/:tid/` รวมบริษัทที่สร้างใหม่ภายหลัง (tenant มาจาก `findTenant` live ทุก request) — ไม่ต้อง grant ราย tenant

### 1.3 สิ่งที่เห็น (reuse endpoint เดิม + hide UI)
**แนวทาง: reuse endpoint/หน้าเดิม** (ตามหลักทีม "where-builder เดียวใช้ซ้ำทุกทางออก" — ห้ามทำ query อ่านแยกที่อาจ diverge)
- Portal `/exec` (ไฟล์ `exec.html`) เรียก `GET /api/exec/tenants` → ลิสต์ทุกบริษัท + สถิติสรุป (จำนวน user, จำนวน interview เสร็จ, %worklog ฯลฯ — คำนวณจาก `tenantDb(tid)` วนทุก tenant แบบ super ทำใน `/api/super/tenants`)
- Drill-in: exec คลิกบริษัท → เปิด `/t/<tid>/dashboard`, `/t/<tid>/reports`, `/t/<tid>/worklog-report` **หน้าเดิม** (group_auth cookie Path=/ ส่งไปให้อัตโนมัติ) → endpoint เดิมคืนข้อมูลแบบ full-read
- **hide edit/admin UI**: `/api/me` (ใน tenant router) ต้องรองรับ `role==='group_exec'` → คืน `{ role:'group_exec', readonly:true }` · หน้า HTML เช็ค flag นี้แล้วซ่อนปุ่มแก้ไข/เพิ่ม/ลบ/admin/danger-zone · **ย้ำ: การซ่อนปุ่มเป็นแค่ UX — การบังคับจริงอยู่ที่ middleware (write=403)**

### 1.4 จุดที่ต้องเพิ่ม `group_exec` ให้เป็น "full-read" (audit ให้ครบ — ตกหล่น = exec เห็นว่างเปล่า)
เพิ่ม `group_exec` เข้า branch อ่าน (ห้ามแตะ branch เขียน):
- `canView` (~569): `if (r==='group_exec') return true;`
- `canEdit` (~609): **ห้ามเพิ่ม** (ต้องคง return false) — ยืนยันว่า group_exec ตกลงมา default false
- `canViewEmployee` (~1627), `canViewUserWorklog` (~2229), `userVisibleTo` (ใช้ใน reports)
- Full-view branch ใน endpoint: `/api/divisions` (1009), `/api/sections` (1066), `/api/positions` (1137), `/api/reports/users` (1429), `/api/reports/summary` (1462), `/api/employees` (1650)
- `requireRoles('admin','executive','manager')` ที่ `/api/outputs/_company/:file` (2530) → เพิ่ม `'group_exec'` ถ้าต้องการให้ดู/โหลดรายงานภาพรวม (เป็น GET, อยู่ใน allowlist)
> เหตุผล: reuse where-builder เดิม + write ถูกบล็อกที่ middleware แล้ว (belt-and-braces) → เพิ่ม read scope ปลอดภัย

### 1.5 Provisioning (super panel)
- `GET /api/super/group-exec` → `{ enabled, must_change, updated_at }` (ไม่คืน hash)
- `PUT /api/super/group-exec/password` → ตั้ง/รีเซ็ตรหัส (super รู้ค่า → `must_change:true`, `enabled:true`, bump tv) · min 6 ตัว
- `POST /api/super/group-exec/disable` → `enabled:false` + bump tv (kill session ทันที)
- UI: section ใหม่ใน `super-tenants.html`

### 1.6 ลำดับงาน (งาน 1)
1. T1.1 store + helper (`readGroupExecAuth/writeGroupExecAuth`) + provisioning endpoints + UI super → **DoD:** super ตั้งรหัส/เปิด/ปิดได้, ไฟล์ถูกสร้าง, hash ไม่รั่ว
2. T1.2 `/api/exec/login|logout|me` + must_change gate + rate-limit + `exec-login.html` → **DoD:** login ได้เมื่อ enabled, โดนบล็อกเมื่อ disabled/must_change, rate-limit ทำงาน
3. T1.3 branch `group_exec` ใน `authMiddleware` (write-block + allowlist) → **DoD:** GET allowlist ผ่าน, ทุก write = 403, ทุก `/api/admin/*` = 403
4. T1.4 เพิ่ม group_exec เข้า read-visibility helper + full-view branch → **DoD:** exec เห็นข้อมูลครบเท่า admin บนหน้า read
5. T1.5 `/api/exec/tenants` + `exec.html` portal + drill-in → **DoD:** ลิสต์ทุกบริษัท+สถิติ, คลิกเข้าดู dashboard/report ของแต่ละบริษัทได้
6. T1.6 hide UI (`/api/me` รองรับ group_exec + ซ่อนปุ่มทุกหน้า) → **DoD:** ไม่มีปุ่มแก้/admin โผล่ตอน group_exec

### 1.7 ความเสี่ยง + วิธีลด (งาน 1)
| ความเสี่ยง | วิธีลด |
|---|---|
| allowlist ตกหล่น endpoint อ่าน → exec เห็นว่าง | เขียน smoke ไล่ทุกหน้า read + เทียบผลกับ admin |
| endpoint อ่านในอนาคตเผลอเปิด write ผ่าน GET | middleware บล็อก non-GET + allowlist default-deny (2 ชั้น) |
| branch group_exec เปิดช่อง bypass tenant isolation ให้ role อื่น | branch ตรวจ `role==='group_exec'` จาก HMAC payload เท่านั้น + return ก่อนเส้นเดิม (ไม่แก้ logic เดิม) |
| exec โหลด backup/secret ได้ | allowlist ห้าม `/api/admin/*` + คนละ role/cookie จาก super |
| ลืม bump tv ตอน disable → session ยังใช้ได้ | gate เช็ค `enabled` ทุก request (ไม่พึ่ง tv อย่างเดียว) |

**แผนสำรอง:** ถ้า reuse endpoint แล้วพบ write endpoint ที่เป็น GET (side-effect) → ย้าย logic side-effect ออกจาก GET ก่อน หรือถอด path นั้นออกจาก allowlist

---

## งาน 2 — ปุ่มกู้คืนข้อมูล (Restore)  ⚠️ destructive

### 2.1 Endpoint
- Super: `POST /api/super/backup/restore` — body `{ file, confirm:'RESTORE', scope:'system'|'tenant', tenant_id? }` (จากไฟล์ที่มีอยู่) — reuse `BACKUP_FILE_RE`
- Admin: `POST /api/admin/backup/restore` — body `{ file, confirm:'RESTORE' }` — scope=tenant ล็อกที่ `req.tenant.id` จาก session (ห้ามรับ tenant_id จาก body)
- (ตัวเลือก) อัปโหลดไฟล์: JSON body จำกัด 5mb เล็กไป → ทำ endpoint แยกรับ raw/multipart หรือขึ้นขนาด limit เฉพาะ path นี้ · **แนะนำเฟสแรกรองรับ "restore จากไฟล์ backup ที่มีอยู่" ก่อน** (ครอบ use-case หลัก) แล้วค่อยเพิ่ม upload

### 2.2 Flow (server) — helper `restoreArchive(archivePath, {scope, tenantId})`
1. **ยืนยัน**: ต้องมี `confirm:'RESTORE'` (ตาม pattern `confirm:'DELETE'` เดิม) มิฉะนั้น 400
2. **validate ชื่อไฟล์** ด้วย `BACKUP_FILE_RE` + ไฟล์ต้องอยู่ใน `backupDirFor(scope)` ที่ถูกต้อง (super=system, admin=tenant ตัวเอง)
3. **list entries ก่อนแตก**: `tar -tzf <file>` → ตรวจทุก entry:
   - reject ถ้ามี `..`, path เริ่มด้วย `/` หรือ drive letter, หรือ symlink
   - **isolation**: tenant restore → ทุก entry ต้องขึ้นต้น `data/tenants/<tid>/` หรือ `outputs/tenants/<tid>/` เท่านั้น (ตรงกับ layout ที่ `createTenantBackup` เขียน) · เจอ entry นอก subtree = reject ทั้งไฟล์ (กันไฟล์ที่ถูกดัดแปลงให้เขียนทับ tenant อื่น/secret)
4. **safety backup ก่อน**: เรียก `createTenantBackup(tid)` / `createSystemBackup()` เก็บสถานะปัจจุบัน (ไฟล์ `.tar.gz` ปกติ) → กู้กลับได้ถ้า restore พลาด
5. **แตกลง staging**: `tar -xzf <file> -C <tmpStagingDir>` (dir ชั่วคราวใน FS เดียวกับ data — ให้ rename เป็น atomic)
6. **atomic swap**:
   - tenant: `rename(data/tenants/<tid> → <tid>.old-<stamp>)` แล้ว `rename(staging/data/tenants/<tid> → data/tenants/<tid>)` (ทำคู่กับ outputs) → ลบ `.old` เมื่อสำเร็จ · ถ้าพลาดกลางคัน rename กลับ
   - system: ต้องระวังมากกว่า (สลับทั้ง `data/`+`outputs/`) — ทำทีละ subtree ที่อยู่ใน archive, ข้าม `_secret`/`_vapid.json` ถ้านโยบายไม่ต้องการทับ (ตัดสินใจ: system restore = ทับทั้งก้อนตามที่ super สำรอง)
7. **invalidate cache** (งาน 4): mtime เปลี่ยนจาก rename → cache users/auth หาย auto (ยืนยันในเทสต์)
8. **audit** (งาน 3): log `backup.restore` (scope, file, actor, ผล)

### 2.3 การตัดสินใจด้านความปลอดภัย
- **path traversal**: ตรวจ entry list ก่อนแตกเสมอ (ไม่พึ่ง tar อย่างเดียว) · reject ทั้งไฟล์เมื่อเจอ entry น่าสงสัย
- **isolation**: tenant restore เขียนเฉพาะ subtree ของ tenant นั้น (บังคับด้วย prefix check + rename เฉพาะ subtree) · `tenant_id` มาจาก session ไม่ใช่ body
- **atomic**: rename-based swap (FS เดียวกัน) — ไฟดับกลางคันไม่ทำข้อมูลพังครึ่ง ๆ
- **สำรองก่อนเสมอ**: destructive แต่ recoverable

### 2.4 ลำดับ / DoD / ความเสี่ยง
- T2.1 `restoreArchive` helper (validate+isolation+safety+swap) → **DoD:** unit test (BACKUP_TEST_MODE) restore tenant สำเร็จ, entry ปลอมถูก reject, safety backup ถูกสร้าง
- T2.2 endpoint super/admin + confirm → **DoD:** admin restore ได้เฉพาะ tenant ตัวเอง (ลอง restore ข้าม tenant = ปฏิเสธ)
- T2.3 UI modal ยืนยันใน `admin.html`/`super-backup.html` → **DoD:** ต้องพิมพ์ยืนยันก่อน, สำเร็จแล้วข้อมูลกลับมา
- ความเสี่ยง: restore แล้วข้อมูลปัจจุบันหาย → มี safety backup + `.old-<stamp>` · tarball วางยา → entry-list validation · `tar` ไม่มีบนเครื่อง → reuse ข้อความ ENOENT เดิมของ `runTar`
- แผนสำรอง: ถ้า atomic folder-swap มีปัญหาบน Windows (ลบ dir ไม่ได้เพราะ handle ค้าง) → fallback เป็น extract-to-staging + copy-over + ลบ `.old` async

---

## งาน 3 — Audit log (append-only)

### 3.1 Storage + schema
- ราย tenant: `data/tenants/<tid>/audit.json` · ระดับระบบ: `data/_audit.json`
- **รูปแบบ = NDJSON (1 event/บรรทัด) append ด้วย `fs.appendFileSync`** → append-only จริง + ถูกกว่า read-modify-write (สำคัญเพราะ audit ยิงถี่) · (ทางเลือก: JSON array ผ่าน writeJson — แต่แพงกว่าและไม่ append-only แท้)
- schema ต่อ event:
  ```
  { ts, ts_bkk, actor:{role,user_id?,username?}, action, target?, tenant_id?, ip, result:'ok'|'fail', meta? }
  ```
- **redaction**: ห้ามเก็บ password/hash/salt/token/secret · `meta` เก็บเฉพาะ id/ชื่อฟิลด์ที่เปลี่ยน ไม่เก็บค่า sensitive

### 3.2 helper `appendAudit(scope, event)`
- scope `null` → `_audit.json` · scope `<tid>` → tenant file
- เติม `ts`, `ts_bkk` (ผ่าน `nowBangkok()`), `ip` อัตโนมัติ
- ห่อ try/catch — audit ล้มต้องไม่ทำให้ request หลักพัง (log warn เฉย ๆ)
- **rotation**: ก่อน append เช็คขนาดไฟล์ (เช่น > 5MB) → rename เป็น `audit-<stamp>.json` แล้วเริ่มไฟล์ใหม่ (กันโตไม่จำกัด)

### 3.3 Event ที่ต้องบันทึก (จุดยิงในโค้ด)
| event | จุด |
|---|---|
| `login.success` / `login.fail` | tenant `/api/login`, `/api/super/login`, `/api/exec/login` |
| `user.create/update/delete` | `/api/users` POST/PUT/DELETE (~1250/1294/1361) |
| `org.*` (division/section/position CRUD) | endpoints ~1012–1208 |
| `password.change` / `password.reset` | `/api/admin/auth` PUT, `/api/super/password`, `reset-admin-password`, exec password |
| `danger.wipe.*` | `/api/admin/wipe/*` (~2891–2945) |
| `backup.create/delete/restore` | tenant+super backup routes |
| `tenant.create/delete/rename` | super tenant routes (~3046–3132) |
| `group_exec.view` | branch group_exec ใน authMiddleware (บันทึก tid ที่เข้าดู — throttle/ dedup ต่อ tid ต่อช่วงเวลา กัน log ท่วม) |

### 3.4 หน้าดู
- `GET /api/admin/audit?limit=&before=` (requireAdmin) → อ่าน tenant audit (paginate, ใหม่สุดก่อน) + `admin-audit.html`
- `GET /api/super/audit?...` (requireSuperAdmin) → system audit + `super-audit.html`
- group_exec: **ไม่จำเป็น** (spec: admin เห็นของ tenant, super เห็น system) — ถ้าจะให้ดู ต้องเป็น read-only ผ่าน allowlist

### 3.5 ลำดับ / DoD / ความเสี่ยง
- T3.1 `appendAudit` + rotation + storage → **DoD:** เขียน NDJSON ได้, rotate เมื่อเกินขนาด, ไม่ทำ request พังเมื่อเขียนไม่ได้
- T3.2 แทรก hook ทุก event ตาราง 3.3 → **DoD:** ทำ action แล้วมี record ตรง event/actor/target, **ไม่มี password/hash โผล่ใน log**
- T3.3 endpoint + หน้าดู → **DoD:** admin เห็นเฉพาะ tenant ตัวเอง, super เห็น system, paginate ได้
- ความเสี่ยง: log ท่วมจาก group_exec.view → dedup ต่อ tid/ช่วงเวลา · disk เต็ม → rotation + cap ไฟล์เก่า (เก็บ N ไฟล์) · เผลอ log sensitive → code review + test ยืนยันไม่มี hash/token ในไฟล์

---

## งาน 4 — Cache hot-path (users.json / auth.json ต่อ tenant, keyed by mtime)

### 4.1 ปัญหา/เป้า
ตั้งแต่ทำ token-version, `authMiddleware` อ่าน `req.db.users()` (named user) หรือ `req.db.auth()` (master) **ทุก request** → เพิ่ม disk read บน hot path · cache ในหน่วยความจำเพื่อลดการอ่าน โดย **ต้องยังเห็นค่าล่าสุดหลังเปลี่ยนรหัส/role** (tv ต้องถูก)

### 4.2 การออกแบบ
- `readJsonCached(file, fallback)`: Map `file → { key, data }` โดย `key = mtimeMs + ':' + size` (จาก `fs.statSync`)
  - stat ได้ + key ตรง → คืน cache (ต้องคืน **clone** หรือถือว่า read-only ห้าม mutate — caller ปัจจุบันไม่ mutate object ที่ได้จาก `users()`/`auth()` ในที่ที่แชร์)
  - key ไม่ตรง / stat ผิด (ENOENT) → drop entry, อ่านสด (`readJson` เดิม), เก็บ cache ใหม่
- **ใช้เฉพาะ hot path**: แทน `req.db.users()`/`req.db.auth()` ใน `authMiddleware` เท่านั้น (blast radius แคบ) · **ไม่แก้ `readJson` ตัวกลาง** (กัน side-effect ที่คาดเดายาก)
- **ความถูกต้องกับ tv**: `writeJson` = temp + `rename` → mtime เปลี่ยนทุกครั้งที่บันทึก users/auth (เปลี่ยนรหัส/role/ลบ user/reset/ restore) → key เปลี่ยน → cache invalidate อัตโนมัติ ✔ · size เป็น key รองกัน mtime ชนภายใน ms เดียว

### 4.3 การตัดสินใจ
- mtime+size invalidation = ถูกต้องเพราะทุก write ผ่าน rename (atomic) → หลักทีมข้อ writeJson atomic รองรับพอดี
- single PM2 process (fork) → cache coherent ทั้งแอป · (ถ้าอนาคตเป็น cluster: mtime-based ยังปลอดภัยเพราะแต่ละ worker เห็น mtime จริงบนดิสก์)
- restore (งาน 2) ทำ rename folder → mtime เปลี่ยน → cache หาย (ต้องมีเทสต์ยืนยัน)

### 4.4 ลำดับ / DoD / ความเสี่ยง
- T4.1 `readJsonCached` + ใช้ใน authMiddleware → **DoD:** request ซ้ำไม่อ่านไฟล์รอบสอง (พิสูจน์ด้วย spy/counter), หลังเปลี่ยนรหัส (tv bump) request ถัดไปเห็นค่าใหม่ (token เก่าถูก reject ทันที)
- ความเสี่ยง: mtime granularity หยาบบางระบบ → เพิ่ม size ใน key แล้ว · caller mutate cache object → กำหนดสัญญา read-only + review จุดใช้ · restore ไม่ invalidate → เทสต์ครอบ

---

## Definition of Done (ทั้ง batch — ต้องครบทุกข้อ)
1. **งาน 1 (group_exec):** super เปิด/ปิด/ตั้งรหัสได้ · exec login เห็นทุกบริษัท (รวมที่สร้างใหม่ระหว่างทาง) แบบ read-only · **พิสูจน์ด้วย security pass สด:** ทุก POST/PUT/DELETE บน `/t/:tid/*` = 403, ทุก `/api/admin/*` และ backup download = 403, เข้าถึง `_secret`/`auth.json` ไม่ได้ · เทียบจำนวนแถวที่ exec เห็น = เท่า admin (read) · ปุ่มแก้/admin ถูกซ่อนหมด · disable แล้ว session ตายทันที
2. **งาน 2 (restore):** admin กู้เฉพาะบริษัทตัวเอง (ข้าม tenant = ปฏิเสธ) · super กู้ระบบ/รายบริษัท · มี safety backup ก่อนทุกครั้ง · tarball ที่มี `..`/entry นอก subtree ถูก reject · atomic (ไฟดับกลางคันไม่พังครึ่ง)
3. **งาน 3 (audit):** ทุก event ในตาราง 3.3 ถูกบันทึก · **ไม่มี password/hash/token ในไฟล์ audit** · rotate เมื่อเกินขนาด · admin เห็น tenant ตัวเอง / super เห็น system
4. **งาน 4 (cache):** ไม่อ่าน users/auth ซ้ำใน 1 request · หลังเปลี่ยนรหัส/role เห็นค่าล่าสุดทันที (tv check ยังถูก) · restore invalidate cache
5. รันได้ตามคู่มือ deploy เดิม (PM2 fork, `npm install` ถ้ามี dep ใหม่ — batch นี้ **ไม่เพิ่ม dep**) · ไม่มี console error ในเบราว์เซอร์
6. ลบไฟล์/ข้อมูลทดสอบ + ปิดเซิร์ฟเวอร์ชั่วคราวก่อน commit

## แนวทางการทดสอบ (ให้ tester)
- **Unit (scripts/_*.js, DATA_DIR แยก):** `restoreArchive` (isolation + entry reject + atomic), `appendAudit` (redaction + rotation), `readJsonCached` (invalidate on mtime change) · reuse `BACKUP_TEST_MODE` pattern เดิม
- **Integration/security (บังคับ — หลักทีมข้อ 9):**
  - **trace where-clause จริงของ group_exec ที่เป็นรูปธรรม**: login เป็น group_exec แล้วยิงทุก method × ทุก path ตัวอย่าง → ยืนยัน GET-allowlist ผ่าน, อื่น ๆ 403 (ทั้ง JSON และการโหลดไฟล์/report/CSV)
  - restore ข้าม tenant, restore tarball วางยา (แก้ entry เป็น `../other-tenant/...`)
  - เปลี่ยนรหัส user → token เก่าตาย + cache เห็นค่าใหม่ (รันคู่กับ TZ ปกติ)
- **เบราว์เซอร์จริง (chrome-devtools MCP):** portal `/exec` render + drill-in ทุกหน้า read + ปุ่มแก้ถูกซ่อน + mobile + ไม่มี console error + เก็บภาพยืนยัน
- **QC process:** reviewer + security pass **คู่ขนาน** สำหรับงาน 1 · หลัง fix batch security → **security verify สด** ยืนยัน gate ฝั่ง server ทำงานจริง (ไม่ใช่แค่ UI)

## ลำดับ milestone รวม
- **M1 (โครง/low-risk ก่อน):** งาน 4 cache → งาน 3 audit infra (`appendAudit`+storage+หน้าดู) — ให้ hook logging พร้อมก่อน แล้วงานอื่นยิง event ได้
- **M2 (ฟีเจอร์อ่อนไหวสุด):** งาน 1 group_exec ครบ (T1.1–T1.6) + ยิง `group_exec.view` เข้า audit
- **M3 (destructive):** งาน 2 restore + ยิง `backup.restore` เข้า audit
- **M4 (ขัดเกลา/QC):** security pass สด + reviewer + เบราว์เซอร์จริง + regression (multi-tenant isolation เดิมยังอยู่) + อัป `docs/USER-MANUAL.md`/DEPLOY

## ความเสี่ยงระดับแผน + แผนสำรอง
- **งาน 1 คือความเสี่ยงอันดับ 1** (เจาะ isolation) → ถ้า security pass เจอ bypass ให้หยุด ship งาน 1 ไปทำ M3/อื่นก่อน แล้วกลับมาแก้ (allowlist default-deny ช่วยจำกัดความเสียหาย)
- ถ้า restore atomic-swap มีปัญหาบน Windows dev → พิสูจน์บน Linux droplet (prod จริง) เป็นเกณฑ์
- ทุกงานอยู่ใน `server.js` ไฟล์เดียว → เสี่ยง merge conflict ภายในตัวเอง: ทำทีละ task, commit แยกก้อนตาม milestone (หลักทีมข้อ 10)
