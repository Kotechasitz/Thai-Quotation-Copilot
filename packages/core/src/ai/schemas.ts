import { z } from 'zod';

/**
 * Schemas sent to the model. Keep them simple (object/array/enum/string/number/nullable only):
 * no `.optional()`, no unions other than enums, no `.default()` — Gemini structured output
 * does not support the whole of JSON Schema.
 */

const extractedItemSchema = z.object({
  lineId: z.string().describe('Short unique id of this line, e.g. "L1", "L2" in order of appearance'),
  rawText: z.string().describe('The original customer text for this line, copied verbatim'),
  productQuery: z.string().describe('Product name to search for, without quantity or size, e.g. "ท่อ PVC"'),
  quantity: z.number().nullable().describe('Requested quantity; null if the customer did not state one'),
  unit: z.string().nullable().describe('Requested counting unit such as "เส้น" or "โหล"; null if none'),
  specs: z.array(z.string()).describe('Specifications such as sizes or grades, e.g. ["4 หุน", "ชั้น 8.5"]'),
  notes: z.string().nullable().describe('Any other remark about this line; null if none'),
});

export const extractionSchema = z.object({
  items: z.array(extractedItemSchema).describe('Every product the customer asks for, one entry per request line'),
  customer: z
    .object({
      name: z.string().nullable().describe('Customer contact person name; null if not stated'),
      company: z.string().nullable().describe('Customer company name; null if not stated'),
      contact: z.string().nullable().describe('Phone, email or LINE id; null if not stated'),
    })
    .describe('Customer details found in the inquiry'),
  missingInfo: z
    .array(
      z.object({
        lineId: z.string().nullable().describe('The line this question is about; null if it concerns the whole inquiry'),
        question: z.string().describe('A question to ask the customer, written in Thai'),
      }),
    )
    .describe('Questions to ask the customer back because information is missing or unclear'),
  language: z.enum(['th', 'en', 'mixed']).describe('Main language of the inquiry'),
});

export const matchSchema = z.object({
  results: z
    .array(
      z.object({
        lineId: z.string().describe('The lineId of the request line this result is for'),
        status: z
          .enum(['matched', 'ambiguous', 'unmatched'])
          .describe('matched = one clear SKU; ambiguous = several plausible SKUs; unmatched = none fit'),
        sku: z.string().nullable().describe('The chosen SKU, copied exactly from the candidates; null unless matched'),
        alternativeSkus: z
          .array(z.string())
          .describe('Other plausible SKUs from the candidates (all plausible ones when ambiguous)'),
        confidence: z.enum(['high', 'medium', 'low']).describe('How sure you are about this result'),
        reason: z.string().describe('Short explanation in Thai shown to the user'),
      }),
    )
    .describe('Exactly one result per request line'),
});

export type ExtractedRequest = z.infer<typeof extractionSchema>;
export type ExtractedItem = ExtractedRequest['items'][number];
export type RawMatch = z.infer<typeof matchSchema>['results'][number];
