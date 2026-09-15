function escapeCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function toCSV(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n')
}

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Safari can abandon the download if the blob URL is revoked before it
  // finishes reading it, since the read happens asynchronously after
  // click() returns — give it a moment before cleaning up.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCSV(filename: string, rows: unknown[][]) {
  downloadBlob(filename, toCSV(rows), 'text/csv;charset=utf-8;')
}

export function downloadText(filename: string, content: string) {
  downloadBlob(filename, content, 'text/plain;charset=utf-8;')
}
