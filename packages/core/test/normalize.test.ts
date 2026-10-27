import { describe, expect, it } from 'vitest';
import {
  extractAngle,
  extractSize,
  normalizeText,
  resolveUnit,
  toLite,
  type CatalogItem,
} from '../src/index.ts';

describe('normalizeText', () => {
  it('recomposes sara am from nikhahit + sara aa', () => {
    expect(normalizeText('ทํา')).toBe('ทำ');
  });

  it('keeps an already composed sara am intact (NFKC must not split it)', () => {
    expect(normalizeText('ทำ')).toBe('ทำ');
  });

  it('fixes nikhahit + tone mark + sara aa ordering', () => {
    expect(normalizeText('นํ้า')).toBe('น้ำ');
  });

  it('folds full-width, Thai digits, zero-width chars, case and whitespace', () => {
    expect(normalizeText('ท่อ ＰＶＣ  ๔ หุน​')).toBe('ท่อ pvc 4 หุน');
  });

  it('trims and collapses mixed whitespace', () => {
    expect(normalizeText('  a \t\n b  ')).toBe('a b');
  });
});

describe('extractSize', () => {
  it('reads hun as eighths of an inch', () => {
    expect(extractSize('ท่อ pvc 4 หุน')).toEqual({ value: 0.5, unit: 'in' });
    expect(extractSize('6 หุน')).toEqual({ value: 0.75, unit: 'in' });
  });

  it('reads fractions with inch markers', () => {
    expect(extractSize('1/2 นิ้ว')).toEqual({ value: 0.5, unit: 'in' });
    expect(extractSize('1/2"')).toEqual({ value: 0.5, unit: 'in' });
    expect(extractSize('½″')).toEqual({ value: 0.5, unit: 'in' });
  });

  it('reads whole and mixed inches', () => {
    expect(extractSize('2 นิ้ว')).toEqual({ value: 2, unit: 'in' });
    expect(extractSize('1 1/4 นิ้ว')).toEqual({ value: 1.25, unit: 'in' });
    expect(extractSize('1½ นิ้ว')).toEqual({ value: 1.5, unit: 'in' });
  });

  it('reads millimetres', () => {
    expect(extractSize('25 มม.')).toEqual({ value: 25, unit: 'mm' });
    expect(extractSize('25mm')).toEqual({ value: 25, unit: 'mm' });
  });

  it('returns null when there is no size', () => {
    expect(extractSize('ข้องอ')).toBeNull();
  });
});

describe('extractAngle', () => {
  it('reads degrees', () => {
    expect(extractAngle('ข้องอ 90 องศา')).toBe(90);
    expect(extractAngle('45°')).toBe(45);
  });

  it('returns null when there is no angle', () => {
    expect(extractAngle('ท่อ 4 หุน')).toBeNull();
  });
});

describe('resolveUnit', () => {
  it('converts dozens into the piece-group unit', () => {
    expect(resolveUnit('โหล', 'ชิ้น', 2)).toEqual({
      quantity: 24,
      note: 'แปลง 2 โหล = 24 ชิ้น',
      unitMismatch: false,
    });
  });

  it('leaves identical units untouched', () => {
    expect(resolveUnit('เส้น', 'เส้น', 3)).toEqual({
      quantity: 3,
      note: null,
      unitMismatch: false,
    });
  });

  it('treats ชิ้น/ตัว/อัน as the same unit', () => {
    expect(resolveUnit('ตัว', 'ชิ้น', 4)).toEqual({
      quantity: 4,
      note: null,
      unitMismatch: false,
    });
  });

  it('does not flag a mismatch when no unit was requested', () => {
    expect(resolveUnit(null, 'ชิ้น', 5)).toEqual({
      quantity: 5,
      note: null,
      unitMismatch: false,
    });
  });

  it('flags a mismatch for incompatible units', () => {
    expect(resolveUnit('กล่อง', 'ชิ้น', 1)).toEqual({
      quantity: 1,
      note: null,
      unitMismatch: true,
    });
  });

  it('keeps a null quantity null', () => {
    expect(resolveUnit('โหล', 'ชิ้น', null).quantity).toBeNull();
  });
});

describe('toLite', () => {
  it('drops price and description', () => {
    const item: CatalogItem = {
      sku: 'P-1',
      nameTh: 'ท่อ',
      nameEn: 'Pipe',
      unit: 'เส้น',
      unitPriceSatang: 12345,
      aliases: ['ท่อพีวีซี'],
      category: 'ท่อ',
      description: 'secret',
    };
    const lite = toLite(item);
    expect(lite).toEqual({
      sku: 'P-1',
      nameTh: 'ท่อ',
      nameEn: 'Pipe',
      unit: 'เส้น',
      aliases: ['ท่อพีวีซี'],
      category: 'ท่อ',
    });
    expect('unitPriceSatang' in lite).toBe(false);
    expect(lite.aliases).not.toBe(item.aliases);
  });
});
