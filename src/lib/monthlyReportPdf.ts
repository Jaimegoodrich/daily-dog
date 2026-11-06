import { jsPDF } from 'jspdf'
import { dogReportLines, type ClientMonthReport } from '@/lib/monthlyReport'

const MARGIN = 54 // 0.75in
const LINE = 14

/** Builds the monthly client report as a letter-size PDF. */
export function buildMonthlyReportPdf(clients: ClientMonthReport[], monthLabel: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const textWidth = pageWidth - MARGIN * 2
  let y = MARGIN

  function ensureRoom(height: number) {
    if (y + height > pageHeight - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
  }

  function write(text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number } = {}) {
    const { size = 11, bold = false, indent = 0, gap = 0 } = opts
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const wrapped = doc.splitTextToSize(text, textWidth - indent) as string[]
    const lineHeight = Math.max(LINE, size * 1.3)
    for (const line of wrapped) {
      ensureRoom(lineHeight)
      doc.text(line, MARGIN + indent, y + size)
      y += lineHeight
    }
    y += gap
  }

  write('Daily Dog — Monthly Client Report', { size: 18, bold: true })
  write(monthLabel, { size: 13, gap: 12 })

  for (const client of clients) {
    // Keep a client's name on the same page as their first dog.
    ensureRoom(LINE * 5)
    doc.setDrawColor(200)
    doc.line(MARGIN, y, pageWidth - MARGIN, y)
    y += 10
    write(client.clientName, { size: 14, bold: true, gap: 4 })

    for (const dog of client.dogs) {
      const [first, ...rest] = dogReportLines(dog)
      ensureRoom(LINE * 2)
      write(first, { bold: true, indent: 8 })
      for (const line of rest) {
        const nested = line.startsWith('  ')
        write(line.trim(), { indent: nested ? 28 : 8 })
      }
      y += 8
    }
    y += 6
  }

  if (clients.length === 0) write('No hikes or boarding this month.')

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(`${monthLabel} — page ${i} of ${pages}`, pageWidth / 2, pageHeight - MARGIN / 2, { align: 'center' })
  }
  return doc
}
