export type QuoteErrorCode =
  | 'INPUT_TOO_LONG'
  | 'EMPTY_INPUT'
  | 'NO_ITEMS'
  | 'TOO_MANY_ITEMS'
  | 'AI_INVALID_OUTPUT'
  | 'AI_BUSY'
  | 'AI_TIMEOUT'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_CONFIG';

/** User-facing Thai text per error code. */
export const QUOTE_ERROR_MESSAGES: Record<QuoteErrorCode, string> = {
  EMPTY_INPUT: 'กรุณาวางข้อความจากลูกค้า',
  INPUT_TOO_LONG: 'ข้อความยาวเกิน 5,000 ตัวอักษร',
  NO_ITEMS: 'ไม่พบรายการสินค้าในข้อความ',
  TOO_MANY_ITEMS: 'รายการเกิน 50 รายการต่อครั้ง กรุณาแบ่งส่ง',
  AI_INVALID_OUTPUT: 'ระบบ AI ตอบกลับไม่ถูกรูปแบบ กรุณาลองใหม่',
  AI_BUSY: 'ระบบไม่ว่าง ลองใหม่อีกสักครู่',
  AI_TIMEOUT: 'ระบบใช้เวลานานเกินไป กรุณาลองใหม่',
  AI_QUOTA_EXCEEDED: 'โควตา AI ของวันนี้หมดแล้ว กรุณาลองใหม่ภายหลัง หรือเปิด billing ของ Google AI',
  AI_CONFIG: 'ตั้งค่า AI ไม่ถูกต้อง (API key หรือชื่อ model) กรุณาตรวจการตั้งค่า',
};

export class QuoteError extends Error {
  readonly code: QuoteErrorCode;

  /** `options.cause` keeps the provider error so callers can log its status code (never its message). */
  constructor(code: QuoteErrorCode, options?: { cause?: unknown }) {
    super(QUOTE_ERROR_MESSAGES[code], options);
    this.name = 'QuoteError';
    this.code = code;
  }
}
