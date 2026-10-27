import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { EVAL_CATEGORIES, type EvalCase } from './score.ts';

const expectedLineSchema = z.object({
  sku: z.string().min(1).nullable(),
  status: z.enum(['matched', 'ambiguous', 'unmatched']),
  quantity: z.number().positive().nullable(),
});

const evalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(EVAL_CATEGORIES),
  catalog: z.enum(['plumbing', 'office']),
  inquiry: z.string().min(1),
  expected: z.array(expectedLineSchema).min(1),
});

/** Parses and validates a cases file; fails fast naming the offending case id. */
export function parseCases(json: string): EvalCase[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error('cases.json ต้องเป็น array');
  return raw.map((entry, index) => {
    const parsed = evalCaseSchema.safeParse(entry);
    if (!parsed.success) {
      const id = typeof (entry as { id?: unknown } | null)?.id === 'string' ? (entry as { id: string }).id : `#${index}`;
      const issue = parsed.error.issues[0];
      throw new Error(`cases.json: เคส ${id} ไม่ถูกต้อง (${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'unknown'})`);
    }
    const c = parsed.data;
    for (const line of c.expected) {
      if (line.status === 'matched' && line.sku === null) {
        throw new Error(`cases.json: เคส ${c.id} มีบรรทัด matched ที่ไม่มี sku`);
      }
      if (line.status !== 'matched' && line.sku !== null) {
        throw new Error(`cases.json: เคส ${c.id} มีบรรทัด ${line.status} ที่ระบุ sku (ต้องเป็น null)`);
      }
    }
    return c;
  });
}

export function loadCases(path: string | URL): EvalCase[] {
  return parseCases(readFileSync(path, 'utf8'));
}
