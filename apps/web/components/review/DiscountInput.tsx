'use client';

import { useState } from 'react';
import { formatBaht, type Discount } from '@tqc/core';
import { DecimalInput } from '@/components/review/DecimalInput';
import { NativeSelect } from '@/components/ui/native-select';
import { parseBahtAsSatang, parsePercent, type ParseResult } from '@/lib/draft-input';

type DiscountType = Discount['type'];

interface DiscountInputProps {
  /** Accessible name of the value field, e.g. "ส่วนลด บรรทัดที่ 1". */
  label: string;
  /** Accessible name of the percent/baht selector. */
  typeLabel: string;
  value: Discount | null;
  onChange: (discount: Discount | null) => void;
}

/** Zero means "no discount". */
const zeroAsNull = (result: ParseResult<number | null>): ParseResult<number | null> =>
  result.ok && result.value === 0 ? { ok: true, value: null } : result;

/** formatBaht throws on anything but a non-negative safe integer; an odd stored value must not crash the screen. */
const formatSatang = (satang: number): string =>
  Number.isSafeInteger(satang) && satang >= 0 ? formatBaht(satang) : String(satang);

const parsePercentDiscount = (text: string) => zeroAsNull(parsePercent(text, 'ส่วนลด'));
const parseBahtDiscount = (text: string) => zeroAsNull(parseBahtAsSatang(text, 'ส่วนลด'));

/** Discount in percent or baht; baht is converted to integer satang before it leaves this component. */
export function DiscountInput({ label, typeLabel, value, onChange }: DiscountInputProps) {
  const [type, setType] = useState<DiscountType>(value?.type ?? 'percent');
  if (value !== null && value.type !== type) setType(value.type);

  const committed = value === null ? null : value.type === 'percent' ? value.value : value.satang;

  return (
    <div className="flex items-start gap-1.5">
      <NativeSelect
        aria-label={typeLabel}
        className="w-20 shrink-0"
        value={type}
        onChange={(event) => {
          setType(event.target.value as DiscountType);
          onChange(null);
        }}
      >
        <option value="percent">%</option>
        <option value="amount">บาท</option>
      </NativeSelect>
      <DecimalInput
        // A fresh field per type: the old text means something else in the other unit.
        key={type}
        label={label}
        value={committed}
        format={type === 'amount' ? formatSatang : String}
        parse={type === 'amount' ? parseBahtDiscount : parsePercentDiscount}
        onCommit={(next) =>
          onChange(
            next === null ? null : type === 'amount' ? { type: 'amount', satang: next } : { type: 'percent', value: next },
          )
        }
      />
    </div>
  );
}
