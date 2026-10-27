import { describe, expect, it } from 'vitest';
import { bahtText } from '../src/index.ts';

describe('bahtText', () => {
  it.each([
    [0, 'ศูนย์บาทถ้วน'],
    [100, 'หนึ่งบาทถ้วน'],
    [1100, 'สิบเอ็ดบาทถ้วน'],
    [2000, 'ยี่สิบบาทถ้วน'],
    [2100, 'ยี่สิบเอ็ดบาทถ้วน'],
    [10100, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [107050, 'หนึ่งพันเจ็ดสิบบาทห้าสิบสตางค์'],
    [25, 'ยี่สิบห้าสตางค์'],
    [100000000, 'หนึ่งล้านบาทถ้วน'],
    [1100000000, 'สิบเอ็ดล้านบาทถ้วน'],
    [100000000000000, 'หนึ่งล้านล้านบาทถ้วน'],
    [33714600, 'สามแสนสามหมื่นเจ็ดพันหนึ่งร้อยสี่สิบหกบาทถ้วน'],
  ])('bahtText(%i) = %s', (satang, expected) => {
    expect(bahtText(satang)).toBe(expected);
  });

  it('reads satang-only and single satang values', () => {
    expect(bahtText(1)).toBe('หนึ่งสตางค์');
    expect(bahtText(21)).toBe('ยี่สิบเอ็ดสตางค์');
    expect(bahtText(101)).toBe('หนึ่งบาทหนึ่งสตางค์');
  });

  it('uses เอ็ด for a trailing 1 after a higher group (common BAHTTEXT convention)', () => {
    // 1,000,001 baht
    expect(bahtText(100000100)).toBe('หนึ่งล้านเอ็ดบาทถ้วน');
    // 2,000,011 baht
    expect(bahtText(200001100)).toBe('สองล้านสิบเอ็ดบาทถ้วน');
  });

  it('skips an empty lower group', () => {
    expect(bahtText(500000000)).toBe('ห้าล้านบาทถ้วน');
    // 1,000,000,000,001 baht
    expect(bahtText(100000000000100)).toBe('หนึ่งล้านล้านเอ็ดบาทถ้วน');
  });

  it('rejects invalid input', () => {
    expect(() => bahtText(-1)).toThrow(RangeError);
    expect(() => bahtText(1.5)).toThrow(RangeError);
    expect(() => bahtText(Number.NaN)).toThrow(RangeError);
    expect(() => bahtText(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});
