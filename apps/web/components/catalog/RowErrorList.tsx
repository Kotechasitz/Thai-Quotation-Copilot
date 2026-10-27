import { formatRowError, type RowError } from '@tqc/core';

export const MAX_SHOWN_ROW_ERRORS = 50;

interface RowErrorListProps {
  errors: RowError[];
}

/** First 50 row errors as "แถว 3 · unit_price: ...", then a count of the rest. */
export function RowErrorList({ errors }: RowErrorListProps) {
  if (errors.length === 0) return null;
  const shown = errors.slice(0, MAX_SHOWN_ROW_ERRORS);
  const hidden = errors.length - shown.length;
  return (
    <div className="space-y-1">
      <ul aria-label="แถวที่มีข้อผิดพลาด" className="list-disc space-y-0.5 pl-5 text-sm text-red-700">
        {shown.map((error, index) => (
          // The same row/column can repeat only with different messages; index keeps keys unique
          // and the list never reorders.
          <li key={`${error.row}-${error.column}-${index}`}>{formatRowError(error)}</li>
        ))}
      </ul>
      {hidden > 0 && <p className="text-sm text-zinc-600">{`และอีก ${hidden} รายการ`}</p>}
    </div>
  );
}
