import { Alert, AlertDescription } from '@/components/ui/alert';

export const STORAGE_WARNING = 'บันทึกในเครื่องไม่ได้ ข้อมูลจะหายเมื่อปิดหน้า';

interface StorageWarningProps {
  /** False when the browser's storage is unavailable altogether. */
  persistent: boolean;
  /** True when the last write of this page's data failed (quota exceeded). */
  writeFailed?: boolean;
  /** Message for a failed write; defaults to the generic warning. */
  writeFailedMessage?: string;
}

/** Shown when localStorage is blocked or a write failed: the app keeps working from memory only. */
export function StorageWarning({
  persistent,
  writeFailed = false,
  writeFailedMessage = STORAGE_WARNING,
}: StorageWarningProps) {
  if (persistent && !writeFailed) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{persistent ? writeFailedMessage : STORAGE_WARNING}</AlertDescription>
    </Alert>
  );
}
