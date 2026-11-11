import { jsPDF } from 'jspdf'
import { formatHistoryDate, historySummary, type ClientHistory } from '@/lib/clientHistory'

const MARGIN = 40

// Column x offsets and widths (landscape letter: 792pt wide).
const COLUMNS = [
  { key: 'date', label: 'Date', width: 88 },
  { key: 'dogName', label: 'Dog', width: 70 },
  { key: 'service', label: 'Service', width: 100 },
  { key: 'pickup', label: 'Pickup', width: 120 },
  { key: 'dropoff', label: 'Dropoff', width: 120 },
  { key: 'by', label: 'Route / Staff', width: 90 },
  { key: 'notes', label: 'Notes', width: 124 },
] as const

/** Builds a client's service history for a date range as a landscape letter PDF. */
export function buildClientHistoryPdf(clientName: string, rangeLabel: string, history: ClientHistory): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Daily Dog — Client Service History', MARGIN, y + 16)
  y += 24
  doc.setFontSize(13)
  doc.text(clientName, MARGIN, y + 13)
  y += 18
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(rangeLabel, MARGIN, y + 10)
  y += 14
  doc.text(historySummary(history), MARGIN, y + 10)
  y += 22

  function header() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    let x = MARGIN
    for (const c of COLUMNS) {
      doc.text(c.label, x, y + 9)
      x += c.width
    }
    y += 14
    doc.setDrawColor(160)
    doc.line(MARGIN, y - 2, pageWidth - MARGIN, y - 2)
  }

  header()
  doc.setFontSize(8.5)
  let lastDate = ''
  for (const row of history.rows) {
    const cells = COLUMNS.map((c) => {
      const text = c.key === 'date' ? (row.date === lastDate ? '' : formatHistoryDate(row.date)) : row[c.key]
      return doc.splitTextToSize(text || '', c.width - 6) as string[]
    })
    const height = Math.max(...cells.map((l) => l.length)) * 11 + 4
    if (y + height > pageHeight - MARGIN) {
      doc.addPage()
      y = MARGIN
      header()
      doc.setFontSize(8.5)
      cells[0] = doc.splitTextToSize(formatHistoryDate(row.date), COLUMNS[0].width - 6) as string[]
    }
    if (row.date !== lastDate && lastDate) {
      doc.setDrawColor(225)
      doc.line(MARGIN, y, pageWidth - MARGIN, y)
    }
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(row.cancelled ? 140 : 20)
    let x = MARGIN
    cells.forEach((lines, i) => {
      lines.forEach((line, j) => doc.text(line, x, y + 10 + j * 11))
      x += COLUMNS[i].width
    })
    doc.setTextColor(0)
    y += height
    lastDate = row.date
  }

  if (history.rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('No hikes or boarding in this date range.', MARGIN, y + 12)
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`${clientName} — ${rangeLabel} — page ${i} of ${pages}`, pageWidth / 2, pageHeight - MARGIN / 2, {
      align: 'center',
    })
  }
  return doc
}
