'use client';

import { useId, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import type { ParseResult } from '@/lib/draft-input';
import { cn } from '@/lib/utils';

interface DecimalInputProps {
  /** Accessible name. */
  label: string;
  /** The committed (stored) value. */
  value: number | null;
  format: (value: number) => string;
  parse: (text: string) => ParseResult<number | null>;
  /** Called only with values `parse` accepted. */
  onCommit: (value: number | null) => void;
  className?: string;
  /** Shown inside the field on the right, e.g. the unit. */
  suffix?: ReactNode;
}

/**
 * Text field for a number. Text that parses is committed straight away; text that does not shows a
 * Thai message and is never committed, and on blur the field goes back to the last committed value,
 * so what is on screen always matches what is saved (and what gets approved).
 */
export function DecimalInput({ label, value, format, parse, onCommit, className, suffix }: DecimalInputProps) {
  const errorId = useId();
  const [text, setText] = useState(() => (value === null ? '' : format(value)));
  const [lastValue, setLastValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // The committed value changed from outside (unit conversion, catalog change): follow it, unless the
  // text already means that value (our own commit while the user is typing, e.g. "3." -> 3).
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = parse(text);
    if (!(parsed.ok && parsed.value === value)) {
      setText(value === null ? '' : format(value));
      setError(null);
    }
  }

  const handleChange = (next: string) => {
    setText(next);
    const parsed = parse(next);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.value !== value) onCommit(parsed.value);
  };

  const handleBlur = () => {
    if (error === null) return;
    setText(value === null ? '' : format(value));
    setError(null);
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          className={cn('bg-card font-mono tabular-nums', suffix !== undefined && 'pr-14')}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
        />
        {suffix !== undefined && (
          <span className="pointer-events-none absolute inset-y-0 right-0 flex max-w-14 items-center truncate pr-2.5 text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error !== null && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
