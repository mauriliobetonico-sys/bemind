import PDFDocument from 'pdfkit';
import { PERIODICITY_LABELS, type Periodicity } from '@aimos/shared';

export interface ProposalPdfData {
  agency: { name: string; document: string | null; address: string | null; email: string | null; phone: string | null; footer: string | null };
  clientName: string;
  clientDocument: string | null;
  number: string;
  title: string;
  createdAt: Date;
  validUntil: string;
  periodicity: Periodicity;
  items: { name: string; description: string | null; quantity: number; unitPriceCents: number; recurrence: string; totalCents: number }[];
  recurringSubtotalCents: number;
  discountCents: number;
  recurringTotalCents: number;
  oneTimeTotalCents: number;
  notes: string | null;
  acceptance: { name: string; at: Date; via: string } | null;
}

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (d: string | Date) => (typeof d === 'string' ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d.toLocaleDateString('pt-BR'));
const INK = '#14171c';
const MUTED = '#5b6573';
const ACCENT = '#0f766e';

/** PDF da proposta (Helvetica/WinAnsi cobre os acentos do português). */
export function renderProposalPdf(d: ProposalPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${d.number} — ${d.title}`, Author: d.agency.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.fillColor(ACCENT).fontSize(10).font('Helvetica-Bold').text(d.agency.name.toUpperCase(), { characterSpacing: 1 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    const agencyLine = [d.agency.document, d.agency.email, d.agency.phone].filter(Boolean).join('  ·  ');
    if (agencyLine) doc.text(agencyLine);
    if (d.agency.address) doc.text(d.agency.address);
    doc.moveDown(1.5);

    doc.fillColor(MUTED).fontSize(9).text(`PROPOSTA ${d.number}`, { characterSpacing: 1 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(d.title);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(`Para: ${d.clientName}${d.clientDocument ? ` (${d.clientDocument})` : ''}`);
    doc.fillColor(MUTED).text(`Emitida em ${date(d.createdAt)}  ·  Válida até ${date(d.validUntil)}  ·  Recorrência ${PERIODICITY_LABELS[d.periodicity].toLowerCase()}`);
    doc.moveDown(1.2);

    // Tabela de serviços
    const cols = [width * 0.46, width * 0.1, width * 0.16, width * 0.12, width * 0.16];
    const header = ['Serviço', 'Qtd.', 'Valor unit.', 'Tipo', 'Total'];
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    let x = left;
    header.forEach((h, i) => {
      doc.text(h.toUpperCase(), x, y, { width: cols[i]!, align: i === 0 ? 'left' : 'right' });
      x += cols[i]!;
    });
    y += 16;
    doc.moveTo(left, y - 4).lineTo(left + width, y - 4).strokeColor('#dfe3e8').stroke();
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    for (const it of d.items) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      x = left;
      const cells = [it.name, String(it.quantity).replace('.', ','), brl(it.unitPriceCents), it.recurrence === 'recurring' ? 'Recorrente' : 'Único', brl(it.totalCents)];
      const startY = y;
      cells.forEach((c, i) => {
        doc.fillColor(INK).text(c, x, startY, { width: cols[i]!, align: i === 0 ? 'left' : 'right' });
        x += cols[i]!;
      });
      y = Math.max(doc.y, startY + 14);
      if (it.description) {
        doc.fillColor(MUTED).fontSize(9).text(it.description, left, y, { width: cols[0]! + cols[1]! + cols[2]! });
        doc.fontSize(10);
        y = doc.y;
      }
      y += 8;
      doc.moveTo(left, y - 4).lineTo(left + width, y - 4).strokeColor('#eef0f3').stroke();
    }

    // Totais
    y += 8;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? INK : MUTED);
      doc.text(label, left + width * 0.45, y, { width: width * 0.35, align: 'right' });
      doc.fillColor(INK).text(value, left + width * 0.8, y, { width: width * 0.2, align: 'right' });
      y += bold ? 20 : 16;
    };
    const per = PERIODICITY_LABELS[d.periodicity].toLowerCase();
    if (d.discountCents > 0) {
      line(`Subtotal recorrente (${per})`, brl(d.recurringSubtotalCents));
      line('Desconto', `− ${brl(d.discountCents)}`);
    }
    line(`Investimento recorrente (${per})`, brl(d.recurringTotalCents), true);
    if (d.oneTimeTotalCents > 0) line('Investimento único (setup)', brl(d.oneTimeTotalCents), true);

    if (d.notes) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Observações', left, y + 10);
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(d.notes, { width });
    }

    if (d.acceptance) {
      doc.moveDown(1.5);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('PROPOSTA ACEITA', { characterSpacing: 1 });
      doc
        .font('Helvetica')
        .fillColor(INK)
        .text(`Aceita por ${d.acceptance.name} em ${d.acceptance.at.toLocaleString('pt-BR')} (${d.acceptance.via === 'online' ? 'aceite eletrônico pelo link da proposta' : 'aceite registrado pela agência'}).`);
    }

    if (d.agency.footer) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(d.agency.footer, left, doc.page.height - 80, { width, align: 'center' });
    }
    doc.end();
  });
}
