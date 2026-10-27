/**
 * Generates samples/catalogs/large-10k.csv: a deterministic, synthetic 10,000-row catalog
 * for the retrieval performance test. All names are invented; no real brands.
 *
 *   npx tsx scripts/gen-large-catalog.ts
 *
 * Seeded PRNG only (no Math.random), so reruns produce a byte-identical file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROWS = 10_000;
const SEED = 20261022;
const HEADER = 'sku,name_th,name_en,unit,unit_price,aliases,category,description';

/** mulberry32: tiny seeded PRNG. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Size {
  th: string;
  en: string;
  factor: number;
}
interface Variant {
  th: string;
  en: string;
  aliases: string[];
  factor: number;
}
interface Base {
  prefix: string;
  th: string;
  en: string;
  unit: string;
  price: number;
  category: string;
  sizes: Size[];
  variants: Variant[];
}

// Same inch/หุน ladder as the hand-written plumbing sample.
const INCH_SIZES: Size[] = [
  { th: '4 หุน', en: '1/2 in', factor: 1 },
  { th: '6 หุน', en: '3/4 in', factor: 1.4 },
  { th: '8 หุน', en: '1 in', factor: 2 },
  { th: '1 1/4 นิ้ว', en: '1 1/4 in', factor: 3 },
  { th: '1 1/2 นิ้ว', en: '1 1/2 in', factor: 4 },
  { th: '2 นิ้ว', en: '2 in', factor: 6 },
  { th: '2 1/2 นิ้ว', en: '2 1/2 in', factor: 9.5 },
  { th: '3 นิ้ว', en: '3 in', factor: 13 },
  { th: '4 นิ้ว', en: '4 in', factor: 22 },
];
const MM_SIZES: Size[] = [15, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160].map((mm, i) => ({
  th: `${mm} มม.`,
  en: `${mm} mm`,
  factor: 1 + i * 0.9,
}));
const PACK_SIZES: Size[] = [1, 5, 10, 12, 24, 50, 100].map((n, i) => ({
  th: n === 1 ? '' : `แพ็ค ${n} ชิ้น`,
  en: n === 1 ? '' : `Pack of ${n}`,
  factor: 1 + i * 2.2,
}));
const ANGLE_SIZES: Size[] = [45, 90]
  .flatMap((deg) =>
    INCH_SIZES.slice(0, 6).map((s) => ({
      th: `${deg} องศา ${s.th}`,
      en: `${deg} deg ${s.en}`,
      factor: s.factor,
    })),
  )
  .concat(
    [45, 90].flatMap((deg) =>
      MM_SIZES.slice(0, 4).map((s) => ({
        th: `${deg} องศา ${s.th}`,
        en: `${deg} deg ${s.en}`,
        factor: s.factor,
      })),
    ),
  );

const MATERIALS: Variant[] = [
  { th: 'PVC', en: 'PVC', aliases: ['พีวีซี'], factor: 1 },
  { th: 'PPR', en: 'PPR', aliases: ['พีพีอาร์'], factor: 1.8 },
  { th: 'HDPE', en: 'HDPE', aliases: ['เอชดีพีอี', 'พีอี'], factor: 1.5 },
  { th: 'ทองเหลือง', en: 'Brass', aliases: ['ทองเหลือง'], factor: 3.2 },
  { th: 'สแตนเลส 304', en: 'Stainless 304', aliases: ['สแตนเลส', 'stainless'], factor: 4.5 },
  { th: 'เหล็กอาบสังกะสี', en: 'Galvanized Steel', aliases: ['เหล็กกัลวาไนซ์', 'gi'], factor: 2.2 },
  { th: 'ทองแดง', en: 'Copper', aliases: ['ทองแดง'], factor: 5 },
  { th: 'พลาสติกเกรดเอ', en: 'Grade A Plastic', aliases: ['พลาสติก'], factor: 0.8 },
];
const COLOURS: Variant[] = [
  { th: 'สีขาว', en: 'White', aliases: [], factor: 1 },
  { th: 'สีดำ', en: 'Black', aliases: [], factor: 1 },
  { th: 'สีน้ำเงิน', en: 'Blue', aliases: [], factor: 1 },
  { th: 'สีแดง', en: 'Red', aliases: [], factor: 1 },
  { th: 'สีเหลือง', en: 'Yellow', aliases: [], factor: 1 },
  { th: 'สีเขียว', en: 'Green', aliases: [], factor: 1.05 },
  { th: 'สีเทา', en: 'Grey', aliases: [], factor: 1.05 },
  { th: 'สีส้ม', en: 'Orange', aliases: [], factor: 1.05 },
];
const GRADES: Variant[] = [
  { th: 'เกรดมาตรฐาน', en: 'Standard Grade', aliases: [], factor: 1 },
  { th: 'เกรดพรีเมียม', en: 'Premium Grade', aliases: ['พรีเมียม'], factor: 1.6 },
  { th: 'เกรดประหยัด', en: 'Economy Grade', aliases: ['ราคาประหยัด'], factor: 0.75 },
  { th: 'งานหนัก', en: 'Heavy Duty', aliases: ['heavy duty'], factor: 1.9 },
  { th: 'งานเบา', en: 'Light Duty', aliases: [], factor: 0.85 },
  { th: 'แบบมีเกลียว', en: 'Threaded', aliases: ['เกลียว'], factor: 1.2 },
  { th: 'แบบสวมอัด', en: 'Push-Fit', aliases: ['สวมอัด'], factor: 1.3 },
  { th: 'ชนิดกันน้ำ', en: 'Waterproof', aliases: ['กันน้ำ'], factor: 1.4 },
];

const base = (
  prefix: string,
  th: string,
  en: string,
  unit: string,
  price: number,
  category: string,
  sizes: Size[],
  variants: Variant[],
): Base => ({ prefix, th, en, unit, price, category, sizes, variants });

const BASES: Base[] = [
  base('PIPE', 'ท่อ', 'Pipe', 'เส้น', 46, 'ท่อ', INCH_SIZES, MATERIALS),
  base('PIPM', 'ท่อน้ำ', 'Water Pipe', 'เส้น', 52, 'ท่อ', MM_SIZES, MATERIALS),
  base('CNDT', 'ท่อร้อยสายไฟ', 'Conduit', 'เส้น', 38, 'ท่อ', INCH_SIZES, COLOURS),
  base('ELB', 'ข้องอ', 'Elbow', 'ชิ้น', 6, 'ข้อต่อ', ANGLE_SIZES, MATERIALS),
  base('TEE', 'สามทาง', 'Tee', 'ชิ้น', 8, 'ข้อต่อ', INCH_SIZES, MATERIALS),
  base('CPL', 'ข้อต่อตรง', 'Coupling', 'ชิ้น', 5, 'ข้อต่อ', INCH_SIZES, MATERIALS),
  base('CPM', 'ข้อต่อตรง', 'Straight Connector', 'ชิ้น', 7, 'ข้อต่อ', MM_SIZES, MATERIALS),
  base('RED', 'ข้อลด', 'Reducer', 'ชิ้น', 7, 'ข้อต่อ', MM_SIZES, MATERIALS),
  base('UNI', 'ข้อต่อสามชิ้น', 'Union', 'ชิ้น', 48, 'ข้อต่อ', INCH_SIZES, GRADES),
  base('NIP', 'นิปเปิ้ล', 'Nipple', 'ชิ้น', 28, 'ข้อต่อ', INCH_SIZES, MATERIALS),
  base('CAP', 'ฝาครอบท่อ', 'End Cap', 'ชิ้น', 4, 'ข้อต่อ', INCH_SIZES, MATERIALS),
  base('BVL', 'บอลวาล์ว', 'Ball Valve', 'ตัว', 95, 'วาล์ว', INCH_SIZES, MATERIALS),
  base('GVL', 'ประตูน้ำ', 'Gate Valve', 'ตัว', 120, 'วาล์ว', INCH_SIZES, MATERIALS),
  base('CVL', 'เช็ควาล์ว', 'Check Valve', 'ตัว', 110, 'วาล์ว', INCH_SIZES, MATERIALS),
  base('FVL', 'ลูกลอยตัดน้ำ', 'Float Valve', 'ตัว', 190, 'วาล์ว', INCH_SIZES, GRADES),
  base('STR', 'ที่กรองเศษ', 'Y-Strainer', 'ตัว', 260, 'วาล์ว', INCH_SIZES, MATERIALS),
  base('TAP', 'ก๊อกน้ำ', 'Tap', 'ตัว', 85, 'ก๊อกน้ำ', INCH_SIZES, GRADES),
  base('HOS', 'สายน้ำดี', 'Flexible Hose', 'เส้น', 35, 'อุปกรณ์เสริม', INCH_SIZES, GRADES),
  base('CLP', 'แคลมป์รัดท่อ', 'Pipe Clamp', 'ชิ้น', 5, 'อุปกรณ์เสริม', MM_SIZES, MATERIALS),
  base('GLU', 'กาวทาท่อ', 'Solvent Cement', 'กระป๋อง', 55, 'อุปกรณ์เสริม', PACK_SIZES, GRADES),
  base('TPE', 'เทปพันเกลียว', 'Thread Seal Tape', 'ม้วน', 8, 'อุปกรณ์เสริม', PACK_SIZES, COLOURS),
  base('SIL', 'ซิลิโคนกันรั่ว', 'Sealant', 'หลอด', 85, 'อุปกรณ์เสริม', PACK_SIZES, COLOURS),
  base('PMP', 'ปั๊มน้ำ', 'Water Pump', 'ตัว', 2450, 'ปั๊มน้ำ', INCH_SIZES, GRADES),
  base('FLT', 'ไส้กรองน้ำ', 'Filter Cartridge', 'ชิ้น', 95, 'เครื่องกรองน้ำ', INCH_SIZES, GRADES),
  base('PAP', 'กระดาษถ่ายเอกสาร', 'Copy Paper', 'รีม', 115, 'Paper', PACK_SIZES, COLOURS),
  base('PEN', 'ปากกา', 'Pen', 'ด้าม', 6, 'Writing', PACK_SIZES, COLOURS),
  base('MRK', 'ปากกามาร์คเกอร์', 'Marker', 'ด้าม', 14, 'Writing', PACK_SIZES, COLOURS),
  base('FLD', 'แฟ้มเอกสาร', 'Document Folder', 'อัน', 12, 'Filing', PACK_SIZES, COLOURS),
  base('BND', 'แฟ้มห่วง', 'Ring Binder', 'อัน', 85, 'Filing', PACK_SIZES, COLOURS),
  base('CLI', 'คลิปหนีบกระดาษ', 'Binder Clip', 'กล่อง', 22, 'Desk', MM_SIZES, COLOURS),
  base('TAPE', 'เทปกาว', 'Adhesive Tape', 'ม้วน', 18, 'Desk', MM_SIZES, COLOURS),
  base('STP', 'ลวดเย็บกระดาษ', 'Staples', 'กล่อง', 12, 'Desk', PACK_SIZES, GRADES),
  base('BOX', 'กล่องเก็บของ', 'Storage Box', 'ใบ', 55, 'Desk', PACK_SIZES, COLOURS),
  base('BAT', 'ถ่านอัลคาไลน์', 'Alkaline Battery', 'แพ็ค', 65, 'IT', PACK_SIZES, GRADES),
  base('CBL', 'สายไฟ', 'Electrical Cable', 'ม้วน', 420, 'ไฟฟ้า', MM_SIZES, COLOURS),
  base('SCR', 'สกรูเกลียวปล่อย', 'Self-Tapping Screw', 'กล่อง', 45, 'ฮาร์ดแวร์', MM_SIZES, MATERIALS),
  base('BLT', 'น็อตและสลักเกลียว', 'Nut and Bolt', 'ชุด', 3, 'ฮาร์ดแวร์', MM_SIZES, MATERIALS),
  base('WSH', 'แหวนรอง', 'Washer', 'ถุง', 25, 'ฮาร์ดแวร์', MM_SIZES, MATERIALS),
  base('HIN', 'บานพับ', 'Hinge', 'ตัว', 30, 'ฮาร์ดแวร์', MM_SIZES, MATERIALS),
];

const SERIES = ['', ' รุ่น B', ' รุ่น C', ' รุ่น D', ' รุ่น E', ' รุ่น F'];
const SERIES_EN = ['', ' Model B', ' Model C', ' Model D', ' Model E', ' Model F'];

const escapeCsv = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const formatMoney = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2 }) : n.toFixed(2);
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

interface Spec {
  base: Base;
  size: Size;
  variant: Variant;
  series: number;
}

function enumerateSpecs(): Spec[] {
  const out: Spec[] = [];
  // Round-robin over the bases so every base is represented regardless of the cut-off.
  const perBase = BASES.map((b) => {
    const specs: Spec[] = [];
    for (let series = 0; series < SERIES.length; series++) {
      for (const size of b.sizes) {
        for (const variant of b.variants) specs.push({ base: b, size, variant, series });
      }
    }
    return specs;
  });
  for (let k = 0; out.length < ROWS * 2; k++) {
    let added = false;
    for (const specs of perBase) {
      const s = specs[k];
      if (s) {
        out.push(s);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

function main(): void {
  const rng = makeRng(SEED);
  const pool = enumerateSpecs();
  if (pool.length < ROWS) throw new Error(`only ${pool.length} combinations, need ${ROWS}`);

  // Seeded Fisher-Yates over the first ROWS combinations so catalog order isn't grouped by base.
  const specs = pool.slice(0, ROWS);
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [specs[i], specs[j]] = [specs[j]!, specs[i]!];
  }

  const rows = specs.map((spec, i) => {
    const { base: b, size, variant, series } = spec;
    const sku = `${b.prefix}-${String(i + 1).padStart(5, '0')}`;
    const th = squash(`${b.th} ${variant.th} ${size.th}${SERIES[series]}`);
    const en = squash(`${variant.en} ${b.en} ${size.en}${SERIES_EN[series]}`);
    const mode = rng();
    const nameTh = mode < 0.7 ? th : '';
    const nameEn = mode >= 0.35 ? en : '';
    const aliases = [...variant.aliases];
    if (rng() < 0.3) aliases.push(b.en.toLowerCase());
    const price = Math.max(1, Math.round(b.price * variant.factor * size.factor * (0.9 + rng() * 0.2)));
    return [
      sku,
      nameTh,
      nameEn,
      b.unit,
      formatMoney(price),
      aliases.join('|'),
      b.category,
      '',
    ]
      .map(escapeCsv)
      .join(',');
  });

  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../samples/catalogs/large-10k.csv');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${HEADER}\n${rows.join('\n')}\n`, 'utf8');
  console.log(`wrote ${rows.length} rows to ${out}`);
}

main();
