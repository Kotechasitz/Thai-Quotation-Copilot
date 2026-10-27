// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from '@/lib/download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloadText', () => {
  it('clicks a temporary link named after the file and revokes the Blob URL afterwards', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:test-url';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });

    downloadText('QT-256910-001.csv', '﻿สวัสดี', 'text/csv;charset=utf-8');

    expect(clicked).toEqual([{ href: 'blob:test-url', download: 'QT-256910-001.csv' }]);
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM survives into the file
    expect(document.querySelector('a[download]')).toBeNull(); // link removed again
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
