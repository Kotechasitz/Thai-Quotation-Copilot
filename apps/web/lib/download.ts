/** Saves `text` as a file through the browser (client side only). A UTF-8 BOM in `text` is kept as written. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick so the browser has started the download first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
