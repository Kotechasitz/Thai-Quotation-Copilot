import { describe, expect, it } from 'vitest';
import { parseBahtAsSatang, parsePercent, parseQuantity } from '@/lib/draft-input';

describe('parseQuantity', () => {
  it('accepts positive numbers with up to 3 decimals and treats blank as "no quantity"', () => {
    expect(parseQuantity('10')).toEqual({ ok: true, value: 10 });
    expect(parseQuantity(' 2.5 ')).toEqual({ ok: true, value: 2.5 });
    expect(parseQuantity('0.125')).toEqual({ ok: true, value: 0.125 });
    expect(parseQuantity('3.')).toEqual({ ok: true, value: 3 });
    expect(parseQuantity('')).toEqual({ ok: true, value: null });
    expect(parseQuantity('   ')).toEqual({ ok: true, value: null });
  });

  it.each([
    ['0', 'จำนวนต้องมากกว่า 0'],
    ['0.000', 'จำนวนต้องมากกว่า 0'],
    ['-2', 'จำนวนต้องมากกว่า 0'],
    ['1.2345', 'จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง'],
    ['abc', 'กรุณากรอกจำนวนเป็นตัวเลข'],
    ['1e3', 'กรุณากรอกจำนวนเป็นตัวเลข'],
    ['1.2.3', 'กรุณากรอกจำนวนเป็นตัวเลข'],
    ['.', 'กรุณากรอกจำนวนเป็นตัวเลข'],
    ['99999999', 'จำนวนมากเกินไป'],
  ])('rejects %j with a Thai message', (text, error) => {
    expect(parseQuantity(text)).toEqual({ ok: false, error });
  });
});

describe('parsePercent', () => {
  it('accepts 0-100 with up to 2 decimals', () => {
    expect(parsePercent('0', 'ส่วนลด')).toEqual({ ok: true, value: 0 });
    expect(parsePercent('7.5', 'ส่วนลด')).toEqual({ ok: true, value: 7.5 });
    expect(parsePercent('100', 'ส่วนลด')).toEqual({ ok: true, value: 100 });
    expect(parsePercent('', 'ส่วนลด')).toEqual({ ok: true, value: null });
  });

  it.each([
    ['100.01', 'ส่วนลด ต้องอยู่ระหว่าง 0 ถึง 100%'],
    ['150', 'ส่วนลด ต้องอยู่ระหว่าง 0 ถึง 100%'],
    ['-5', 'ส่วนลด ต้องอยู่ระหว่าง 0 ถึง 100%'],
    ['1.234', 'ส่วนลด มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง'],
    ['ten', 'กรุณากรอก ส่วนลด เป็นตัวเลข'],
  ])('rejects %j', (text, error) => {
    expect(parsePercent(text, 'ส่วนลด')).toEqual({ ok: false, error });
  });

  it('uses the given label in messages', () => {
    expect(parsePercent('101', 'VAT')).toEqual({ ok: false, error: 'VAT ต้องอยู่ระหว่าง 0 ถึง 100%' });
  });
});

describe('parseBahtAsSatang', () => {
  it('converts baht to integer satang without float error', () => {
    expect(parseBahtAsSatang('1,250.50')).toEqual({ ok: true, value: 125_050 });
    expect(parseBahtAsSatang('0.1')).toEqual({ ok: true, value: 10 });
    expect(parseBahtAsSatang('19.99')).toEqual({ ok: true, value: 1_999 });
    expect(parseBahtAsSatang('0.29')).toEqual({ ok: true, value: 29 });
    expect(parseBahtAsSatang('5')).toEqual({ ok: true, value: 500 });
    expect(parseBahtAsSatang('')).toEqual({ ok: true, value: null });
  });

  it.each([
    ['-1', 'ส่วนลด ต้องไม่ติดลบ'],
    ['1.005', 'ส่วนลด มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง'],
    ['x', 'กรุณากรอก ส่วนลด เป็นตัวเลข'],
    ['9999999999', 'จำนวนเงินมากเกินไป'],
  ])('rejects %j', (text, error) => {
    expect(parseBahtAsSatang(text)).toEqual({ ok: false, error });
  });
});
