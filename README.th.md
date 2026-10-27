# Thai Quotation Copilot

[English](README.md) | [ภาษาไทย](README.th.md)

**วางข้อความสั่งซื้อของลูกค้า (ไทย อังกฤษ หรือปนกัน) แล้วได้ร่างใบเสนอราคาภาษาไทยในไม่กี่วินาที AI อ่านข้อความและเลือกสินค้าจาก catalog ของคุณ ส่วนราคา VAT และภาษีหัก ณ ที่จ่าย คำนวณด้วยโค้ด ไม่ใช่ AI**

> โปรเจกต์เดโม ใช้ข้อมูลสังเคราะห์เท่านั้น (ดู [ข้อจำกัดที่ทราบ](#ข้อจำกัดที่ทราบ))

## ทำงานอย่างไร

1. **CSV** - อัปโหลด catalog สินค้าเป็นไฟล์ CSV ระบบอ่านและตรวจสอบในเบราว์เซอร์ แล้วเก็บไว้ใน `localStorage` ของเบราว์เซอร์
2. **AI แยกรายการ** - ข้อความลูกค้าถูกส่งไปที่เซิร์ฟเวอร์พร้อม catalog แบบย่อที่ไม่มีราคา โมเดลแยกข้อความเป็นรายการสินค้า (อะไร จำนวนเท่าไร หน่วยอะไร)
3. **โค้ดค้นหา** - สำหรับแต่ละรายการ โค้ดที่ทำงานแบบกำหนดผลได้ (ค้นข้อความที่รองรับภาษาไทย จากชื่อ ชื่อเรียกอื่น และหมวดหมู่) คัดสินค้าที่น่าจะตรง **20 อันดับแรก** เป็น candidate
4. **AI เลือก โค้ดตรวจ** - โมเดลเลือก sku หนึ่งตัวต่อบรรทัดจาก candidate ของบรรทัดนั้น (หรือบอกว่า "ไม่พบ") จากนั้นโค้ดตรวจว่า sku ที่ได้อยู่ใน candidate ของบรรทัดนั้นจริง ถ้าไม่ใช่จะไม่รับ

ราคา **ไม่เคย** ถูกส่งให้ AI และไม่ได้มาจาก AI หลังจับคู่เสร็จ เบราว์เซอร์จะค้น sku ใน catalog ของคุณ แล้วคำนวณยอดต่อบรรทัด ส่วนลด VAT (ค่าเริ่มต้น 7% ตั้งค่าได้) และหัก ณ ที่จ่าย (0 / 1 / 2 / 3 / 5% คิดจากยอดก่อน VAT) เงินทั้งหมดเก็บเป็นสตางค์ (จำนวนเต็ม) และปัดเศษแบบ half-up

## มาตรการป้องกัน

- **AI ไม่เห็นราคา** catalog ที่ส่งให้โมเดลไม่มีช่องราคา จึงไม่สามารถแต่งหรือรั่วไหลราคาได้
- **ตรวจ sku ด้วยโค้ด** sku ที่โมเดลตอบต้องอยู่ใน candidate ของบรรทัดนั้น ไม่เช่นนั้นบรรทัดจะเป็น "ไม่พบสินค้า"
- **ต้องอนุมัติก่อน export** ต้องตรวจและอนุมัติใบเสนอราคา (จำนวนทุกบรรทัดต้องมากกว่า 0) ก่อนจึงพิมพ์หรือส่งออกได้
- **เซิร์ฟเวอร์ไม่เก็บข้อมูล** เซิร์ฟเวอร์ไม่บันทึกหรือ log ข้อความลูกค้าและ catalog (log แค่จำนวน token เวลา และสถานะ) ข้อมูลของคุณอยู่ในเบราว์เซอร์
- **เพดานตายตัว** ข้อความไม่เกิน 5,000 ตัวอักษร ไม่เกิน 50 รายการ deadline ของ AI 60 วินาที และส่ง AI ครั้งละไม่เกิน 10 รายการ

## เริ่มต้นใช้งาน

ต้องมี Node.js 24 และ npm

```bash
npm install
cp .env.example .env        # (cmd.exe: copy .env.example .env) แล้วแก้ .env ใส่ key ของตัวเอง
npm run dev -w apps/web     # http://localhost:3000
```

ในแอป เปิดหน้า **Catalog** แล้วโหลด catalog ตัวอย่าง (งานประปา หรือเครื่องเขียน/สำนักงาน) จากนั้นวางข้อความตัวอย่างที่หน้าแรก ไฟล์ตัวอย่างอยู่ใน repository:

- Catalog: `samples/catalogs/plumbing.csv`, `samples/catalogs/office.csv` (และ `large-10k.csv` สำหรับทดสอบประสิทธิภาพ)
- ข้อความลูกค้า: `samples/inquiries/01.txt` ถึง `10.txt`

ข้อมูลตัวอย่างทั้งหมดเป็นข้อมูลสังเคราะห์ ใช้บริษัทสมมุติ "บริษัท ตัวอย่างวัสดุ จำกัด"

### ผู้ให้บริการ AI (provider)

ตั้งค่าใน `.env` (ดู `.env.example`):

| `AI_PROVIDER` | ตัวอย่าง `AI_MODEL` | ข้อมูลยืนยันตัวตน |
| --- | --- | --- |
| `google` (ค่าเริ่มต้น) | `gemini-3.6-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` (จาก Google AI Studio) |
| `gateway` ([Vercel AI Gateway](https://vercel.com/docs/ai-gateway)) | `anthropic/claude-haiku-5.5` | `AI_GATEWAY_API_KEY` (วิธีที่ตรวจสอบแล้ว) ส่วน OIDC บน Vercel SDK รองรับ แต่โปรเจกต์นี้ยังไม่ได้ทดสอบ |

เมื่อใช้ `gateway` ทุกคำขอจะส่ง `disallowPromptTraining: true` เพื่อให้ gateway เลือกเส้นทางเฉพาะผู้ให้บริการที่ไม่นำ prompt ไปเทรนโมเดล ข้อควรทราบ: คำขอจะล้มเหลวถ้าไม่มีผู้ให้บริการของโมเดลนั้นที่ตรงเงื่อนไขนี้ และเงื่อนไขนี้ไม่ใช้กับ key ของผู้ให้บริการที่นำมาเอง (BYOK) เมื่อรันบนเครื่อง ต้องตั้ง `AI_GATEWAY_API_KEY` (หรือใช้ `VERCEL_OIDC_TOKEN` จาก `vercel env pull` ซึ่งหมดอายุใน 12 ชั่วโมง) ส่วนบน Vercel ระบบข้ามการตรวจ key นี้และให้ gateway SDK แจ้ง error เองถ้ายืนยันตัวตนไม่ได้ ดูต้นทุนของแต่ละตัวเลือกใน [docs/costs.md](docs/costs.md)

## บรรทัดคำสั่ง (CLI)

รันที่ root ของ repository คำสั่ง `quote`, `eval`, `eval:daily` อ่าน `.env` และเรียกโมเดลจริง

```bash
# ค้นหาใน catalog ด้วยโค้ดค้นหาอย่างเดียว (ไม่ใช้ AI ไม่ต้องมี key)
npm run search -- --catalog samples/catalogs/plumbing.csv "ท่อ PVC 4 หุน"

# รัน pipeline เต็มกับข้อความลูกค้า 1 ชุด แล้วพิมพ์ผลเป็น JSON
npm run quote -- --catalog samples/catalogs/plumbing.csv --inquiry samples/inquiries/01.txt

# วัดความแม่นยำของโมเดลกับชุดทดสอบที่มีเฉลย (scripts/eval/cases.json)
npm run eval -- --provider gateway --model anthropic/claude-haiku-5.5

# แบบเดียวกัน แต่แบ่งรายวันสำหรับ free tier ของ Gemini: ทำต่อจากเดิมและรันไม่เกิน 8 เคส
npm run eval:daily
```

ผล eval ถูกเขียนที่ `scripts/eval/results/` ใช้ข้อมูลสังเคราะห์เท่านั้น

ตรวจโค้ด: `npm test`, `npm run typecheck`, `npm run lint`

## รูปแบบไฟล์ CSV

แถวแรกต้องเป็นหัวคอลัมน์ ลำดับคอลัมน์ไม่มีผล และคอลัมน์ที่เกินมาจะถูกข้าม

| คอลัมน์ | บังคับ | หมายเหตุ |
| --- | --- | --- |
| `sku` | ใช่ | รหัสสินค้า ห้ามซ้ำ |
| `name_th` | ต้องมีอย่างน้อย `name_th` หรือ `name_en` | ชื่อสินค้าภาษาไทย |
| `name_en` | ต้องมีอย่างน้อย `name_th` หรือ `name_en` | ชื่อสินค้าภาษาอังกฤษ |
| `unit` | ใช่ | หน่วยขาย (เช่น เส้น ชิ้น รีม) |
| `unit_price` | ใช่ | ราคาต่อหน่วย รับ `1250`, `1,250.00` และ `฿1,250.00` |
| `aliases` | ไม่ | ชื่อเรียกอื่นที่ลูกค้าใช้ คั่นด้วย `\|` |
| `category` | ไม่ | หมวดหมู่สินค้า |
| `description` | ไม่ | คำอธิบายอิสระ |

- ดาวน์โหลด **ไฟล์ template CSV** ได้จากหน้า Catalog
- **Encoding:** รองรับ UTF-8 (มีหรือไม่มี BOM) และ Windows-874 (encoding ไทยแบบเก่าที่ Excel บน Windows ภาษาไทยใช้เวลาบันทึกเป็น "CSV") ตรวจจับให้อัตโนมัติ
- **ไม่รองรับ CSV ที่คั่นด้วย semicolon (`;`)** ตัวคั่นต้องเป็น comma (Excel บางการตั้งค่าภูมิภาคบันทึกเป็น `;` ให้บันทึกใหม่เป็นแบบคั่นด้วย comma)
- ถ้าขาดคอลัมน์บังคับ จะได้ error ระดับไฟล์ข้อเดียวที่บอกชื่อคอลัมน์ ส่วนแถวที่ผิดจะแจ้งเป็นเลขแถว

## ข้อจำกัดที่ทราบ

- **Safari** ไม่พิมพ์หัวตารางซ้ำทุกหน้าเมื่อพิมพ์ใบเสนอราคายาว ๆ
- **Gemini free tier มีโควตาจำกัดและไม่เป็นส่วนตัว** จากการทดสอบของเรา โควตาฟรีของ `gemini-3.6-flash` คือ 20 คำขอต่อวันต่อโมเดล และ Google อาจนำข้อมูลที่ส่งผ่าน free tier ไปปรับปรุงผลิตภัณฑ์ของตน จึงใช้ได้กับ **ข้อมูลสังเคราะห์เท่านั้น**
- **ข้อมูลอยู่ใน `localStorage` ของเบราว์เซอร์** ถ้าล้างข้อมูลเว็บไซต์ หรือเปลี่ยนเบราว์เซอร์/เครื่อง catalog และร่างจะหายไป ถ้า `localStorage` ใช้ไม่ได้ (หน้าต่างส่วนตัว พื้นที่เต็ม) แอปจะทำงานต่อในหน่วยความจำและเตือนว่าบันทึกไม่ได้
- นี่คือเดโม การสร้าง PDF ใช้หน้าต่างพิมพ์ของเบราว์เซอร์ ไม่ได้สร้างจากฝั่งเซิร์ฟเวอร์

## Deploy บน Vercel

โปรเจกต์นี้เป็น monorepo แบบ npm workspaces แอป Next.js อยู่ที่ `apps/web` และเรียกใช้แพ็กเกจใน `packages/`

### จาก private repository (Vercel dashboard)

1. push repository ขึ้น GitHub (เป็น private ได้)
2. ใน Vercel: **Add New... > Project** แล้วเลือก import repository
3. ตั้ง **Root Directory** เป็น `apps/web` (แก้ภายหลังได้ที่ **Settings > Build and Deployment**)
4. ที่ **Settings > Build and Deployment > Root Directory** ตรวจว่าเปิด **"Include files outside of the root directory in the Build Step"** อยู่ (ค่าเริ่มต้นเปิดอยู่สำหรับโปรเจกต์ใหม่ และจำเป็น เพราะ `apps/web` ใช้ `packages/core` และ `packages/providers`)
5. เพิ่ม environment variables (**Settings > Environment Variables**):
   - `AI_PROVIDER` และ `AI_MODEL`
   - `GOOGLE_GENERATIVE_AI_API_KEY` สำหรับ `google` หรือ `AI_GATEWAY_API_KEY` สำหรับ `gateway` (แนะนำให้ใช้ key; OIDC บน Vercel ยังไม่ได้ทดสอบในโปรเจกต์นี้)
6. Deploy ขั้น build ไม่ต้องใช้ตัวแปรของ AI ตัวแปรเหล่านี้ถูกอ่านตอนสร้างใบเสนอราคาเท่านั้น

route จับคู่ให้ function รันได้นานสูงสุด 90 วินาที (`maxDuration = 90`) ส่วนงาน AI ภายในมี deadline ของตัวเองที่ 60 วินาที (`AI_TIMEOUT_MS`) ถ้าโมเดลช้าเกินจะได้ข้อความ timeout ที่อ่านรู้เรื่องก่อนที่แพลตฟอร์มจะหยุด function เมื่อเปิด Fluid Compute (เป็นค่าเริ่มต้น) แพ็กเกจ Hobby ตั้งได้สูงสุด 300 วินาที และ Pro สูงสุด 800 วินาที ([เอกสาร duration ของ Vercel](https://vercel.com/docs/functions/configuring-functions/duration) อ่านเมื่อ 2026-10-27) ส่วน Node.js เริ่มต้นของ Vercel คือ 24.x ([เอกสารของ Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) อ่านเมื่อ 2026-10-27) ตรงกับโปรเจกต์นี้

### ป้องกัน deployment เดโม

`/api/match` ไม่มีระบบล็อกอิน ใครที่มี URL ของ deployment ก็เรียกได้ และทุกครั้งที่เรียกจะใช้โควตาหรือเครดิต AI ของ **คุณ** ถ้าใช้ Google free tier การเรียกพลาดแค่ไม่กี่ครั้ง (crawler ลิงก์ที่ถูกแชร์ต่อ หรือสคริปต์) ก็ทำให้โควตารายวันหมดและเดโมใช้ไม่ได้ ควรเปิด Vercel Deployment Protection ก่อนแชร์ URL:

- **Vercel Authentication**: เฉพาะผู้ใช้ Vercel ที่ล็อกอินและมีสิทธิ์ในโปรเจกต์เท่านั้นที่เปิดเว็บได้ ที่ **Settings > Deployment Protection** ให้เลือก **All Deployments** เพื่อให้โดเมน production ถูกป้องกันด้วย (Standard Protection เปิดโดเมน production ไว้เป็นสาธารณะ) เอกสารระบุว่าการป้องกัน All Deployments ด้วย Vercel Authentication ใช้ได้ทุกแพ็กเกจ
- **Password Protection**: ผู้เข้าชมกรอกรหัสผ่านร่วม เอกสารระบุว่ามีใน Pro ($20 ต่อเดือนต่อโปรเจกต์ที่ป้องกัน) และ Enterprise และไม่มีใน Hobby

ที่มา: [Deployment Protection on Vercel](https://vercel.com/docs/deployment-protection) (อ่านเมื่อ 2026-10-27) แพ็กเกจอาจเปลี่ยน ควรตรวจหน้านี้อีกครั้งก่อนตัดสินใจ

### ปุ่ม "Deploy to Vercel" (ใช้ได้เมื่อ repository เป็น public เท่านั้น)

ปุ่มคลิกเดียวใช้ได้กับ repository แบบ **public** เท่านั้น เมื่อเปิดเป็น public แล้ว ให้แทน `<YOUR_REPO_URL>` (เช่น `https://github.com/<owner>/<repo>`) ใน URL แม่แบบนี้ (ค่า `repository-url` อาจต้องเข้ารหัส URL ในบางเครื่องมือ เช่น `https%3A%2F%2Fgithub.com%2F<owner>%2F<repo>`):

```
https://vercel.com/new/clone?repository-url=<YOUR_REPO_URL>&root-directory=apps/web&env=AI_PROVIDER,AI_MODEL,GOOGLE_GENERATIVE_AI_API_KEY
```

นำไปใช้เป็นลิงก์ เช่น `[![Deploy with Vercel](https://vercel.com/button)](<URL ด้านบน>)` หลัง import ครั้งแรกให้ตรวจ "Include files outside of the root directory" (ข้อ 4 ด้านบน) และ redeploy ถ้ามีการแก้ไข

## สัญญาอนุญาต

[MIT](LICENSE) ฟอนต์ Sarabun ที่แนบมาใช้สัญญาอนุญาต SIL Open Font License 1.1 (`apps/web/app/fonts/OFL.txt`)
