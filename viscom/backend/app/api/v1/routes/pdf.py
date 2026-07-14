from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
import traceback
import base64
import os

from app.core.database import get_db
from app.core.security import get_current_active_user

router = APIRouter(prefix="/pdf", tags=["pdf"])


def _get_company_data(db: Session) -> dict:
    from app.models.company import Company
    from app.core.config import settings
    co = db.query(Company).first()
    if co:
        logo = None
        if co.logo_path and os.path.exists(co.logo_path):
            try:
                with open(co.logo_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                ext = os.path.splitext(co.logo_path)[1].lower().lstrip(".")
                mime = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp"}.get(ext, "png")
                logo = f"data:image/{mime};base64,{b64}"
            except Exception:
                pass
        return {"name": co.name or "", "cnpj": co.cnpj or "", "address": co.address or "",
                "phone": co.phone or "", "email": co.email or "", "logo": logo}
    return {"name": getattr(settings, "COMPANY_NAME", ""), "cnpj": getattr(settings, "COMPANY_CNPJ", ""),
            "address": getattr(settings, "COMPANY_ADDRESS", ""), "phone": getattr(settings, "COMPANY_PHONE", ""),
            "email": getattr(settings, "COMPANY_EMAIL", ""), "logo": None}


def _fmt_currency(value) -> str:
    try:
        return f"R$ {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "R$ 0,00"


def _fmt_date(value) -> str:
    if not value:
        return "-"
    try:
        return value.strftime("%d/%m/%Y")
    except Exception:
        return str(value)


def _header_html(company: dict, title: str, number: str, extra: str = "") -> str:
    logo_html = f'<img src="{company["logo"]}" style="max-height:70px;max-width:150px;object-fit:contain;margin-right:16px">' if company.get("logo") else ""
    return f"""
    <div class="header">
      <div style="display:flex;align-items:center">
        {logo_html}
        <div>
          <div class="company-name">{company['name']}</div>
          <div class="company-info">
            {"CNPJ: " + company['cnpj'] + "<br>" if company['cnpj'] else ""}
            {company['address'] + "<br>" if company['address'] else ""}
            {"Tel: " + company['phone'] if company['phone'] else ""}
            {" | " + company['email'] if company['email'] else ""}
          </div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="doc-title">{title}</div>
        <div class="doc-number">{number}</div>
        {extra}
      </div>
    </div>"""


BASE_CSS = """
<style>
  @page { size: A4; margin: 2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
  body { font-size: 10pt; color: #333; }
  .header { border-bottom: 3px solid #1e40af; padding-bottom: 12px; margin-bottom: 20px;
            display: flex; justify-content: space-between; align-items: flex-start; }
  .company-name { font-size: 16pt; font-weight: bold; color: #1e40af; }
  .company-info { font-size: 9pt; color: #555; line-height: 1.6; margin-top:4px; }
  .doc-title { font-size: 14pt; font-weight: bold; color: #1e40af; }
  .doc-number { font-size: 11pt; color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; font-size: 9pt; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 9pt; }
  tr:nth-child(even) td { background: #f8fafc; }
  .tr { text-align: right; } .tc { text-align: center; }
  .section { margin: 14px 0; }
  .section-title { font-weight: bold; color: #1e40af; border-bottom: 1px solid #e5e7eb;
                   padding-bottom: 3px; margin-bottom: 6px; font-size: 10pt; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size:9pt; }
  .lbl { font-weight: bold; color: #555; }
  .total-box { background: #1e40af; color: white; padding: 8px 14px; text-align: right;
               font-size: 12pt; font-weight: bold; border-radius: 4px; margin-top: 10px; }
  .sig { margin-top: 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-line { border-top: 1px solid #333; padding-top: 5px; text-align: center; font-size: 9pt; color: #555; }
  .notes { background: #f8fafc; border-left: 3px solid #1e40af; padding: 8px; font-size: 9pt; color: #555; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
<script>window.onload = function() { window.print(); }</script>
"""


@router.get("/html/quote/{quote_id}", response_class=HTMLResponse)
def quote_html(quote_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    from app.models.quote import Quote
    from decimal import Decimal
    quote = db.query(Quote).filter(Quote.id == quote_id, Quote.is_deleted == False).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    company = _get_company_data(db)
    header = _header_html(company, "ORÇAMENTO", f"Nº {str(quote.number).zfill(5)}",
                          f'<div style="font-size:9pt;color:#555">Data: {_fmt_date(quote.created_at)}</div>'
                          + (f'<div style="font-size:9pt;color:#555">Validade: {_fmt_date(quote.valid_until)}</div>' if quote.valid_until else ""))
    rows = ""
    for it in quote.items:
        w = f"{float(it.width_m):.2f}" if it.width_m else "-"
        h = f"{float(it.height_m):.2f}" if it.height_m else "-"
        area = f"{float(it.area_m2):.4f}" if it.area_m2 else "-"
        rows += f"""<tr><td>{it.product.name if it.product else ""}</td>
          <td class="tc">{w}</td><td class="tc">{h}</td><td class="tc">{area}</td>
          <td class="tc">{it.quantity}</td><td class="tr">{_fmt_currency(it.unit_price)}</td>
          <td class="tc">{it.discount_pct}%</td><td class="tr">{_fmt_currency(it.subtotal)}</td></tr>"""
    sub = sum(i.subtotal for i in quote.items) if quote.items else Decimal("0")
    disc = Decimal(str(quote.discount_general or 0))
    total = sub * (1 - disc / 100)
    disc_row = f'<tr><td>Desconto ({quote.discount_general}%):</td><td class="tr" style="color:#dc2626">- {_fmt_currency(sub * disc / 100)}</td></tr>' if disc > 0 else ""
    html = f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Orçamento {str(quote.number).zfill(5)}</title>{BASE_CSS}</head><body>
    {header}
    <div class="section"><div class="section-title">Cliente</div>
    <div class="info-grid">
      <div><span class="lbl">Nome:</span> {quote.client.name if quote.client else "-"}</div>
      <div><span class="lbl">CPF/CNPJ:</span> {quote.client.cpf_cnpj if quote.client else "-"}</div>
      <div><span class="lbl">Telefone:</span> {(quote.client.phone or "-") if quote.client else "-"}</div>
      <div><span class="lbl">E-mail:</span> {(quote.client.email or "-") if quote.client else "-"}</div>
    </div></div>
    <div class="section"><div class="section-title">Itens do Orçamento</div>
    <table><thead><tr><th>Produto</th><th class="tc">Larg.(m)</th><th class="tc">Alt.(m)</th>
      <th class="tc">Área(m²)</th><th class="tc">Qtd</th><th class="tr">Preço Unit.</th>
      <th class="tc">Desc.%</th><th class="tr">Subtotal</th></tr></thead><tbody>{rows}</tbody></table></div>
    <div style="text-align:right"><table style="width:280px;margin-left:auto">
      <tr><td>Subtotal:</td><td class="tr">{_fmt_currency(sub)}</td></tr>{disc_row}</table>
    <div class="total-box">TOTAL: {_fmt_currency(total)}</div></div>
    {"<div class='section'><div class='section-title'>Observações</div><div class='notes'>" + quote.notes + "</div></div>" if quote.notes else ""}
    </body></html>"""
    return HTMLResponse(content=html)


@router.get("/html/service-order/{os_id}", response_class=HTMLResponse)
def os_html(os_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    from app.models.service_order import ServiceOrder
    os_obj = db.query(ServiceOrder).filter(ServiceOrder.id == os_id, ServiceOrder.is_deleted == False).first()
    if not os_obj:
        raise HTTPException(status_code=404, detail="OS não encontrada")
    company = _get_company_data(db)
    abertura = _fmt_date(os_obj.opened_at or os_obj.created_at)
    extra = f'<div style="font-size:9pt;color:#555">Abertura: {abertura}</div>'
    if os_obj.deadline:
        extra += f'<div style="font-size:9pt;color:#c00;font-weight:bold">Prazo: {_fmt_date(os_obj.deadline)}</div>'
    header = _header_html(company, "ORDEM DE SERVIÇO", f"OS Nº {str(os_obj.number).zfill(5)}", extra)
    rows = ""
    for it in os_obj.items:
        wh = f"{float(it.width_m):.2f}×{float(it.height_m):.2f}" if it.width_m and it.height_m else "-"
        area = f"{float(it.area_m2):.4f}" if it.area_m2 else "-"
        rows += f"""<tr><td>{it.product.name if it.product else ""}</td>
          <td>{it.material_type or "-"}</td><td>{it.installation_type or "-"}</td>
          <td>{it.finishing or "-"}</td><td class="tc">{wh}</td><td class="tc">{area}</td>
          <td class="tc">{it.quantity}</td><td class="tr">{_fmt_currency(it.unit_price)}</td>
          <td class="tr">{_fmt_currency(it.subtotal)}</td></tr>"""
    html = f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>OS {str(os_obj.number).zfill(5)}</title>{BASE_CSS}</head><body>
    {header}
    <div class="info-grid" style="margin-bottom:14px">
      <div class="section" style="margin:0"><div class="section-title">Cliente</div>
        <div><span class="lbl">Nome:</span> {os_obj.client.name if os_obj.client else "-"}</div>
        <div><span class="lbl">CPF/CNPJ:</span> {(os_obj.client.cpf_cnpj or "-") if os_obj.client else "-"}</div>
        <div><span class="lbl">Telefone:</span> {(os_obj.client.phone or "-") if os_obj.client else "-"}</div>
      </div>
      <div class="section" style="margin:0"><div class="section-title">Dados da OS</div>
        <div><span class="lbl">Vendedor:</span> {os_obj.created_by.name if os_obj.created_by else "-"}</div>
        <div><span class="lbl">Status:</span> {os_obj.status.replace("_", " ").title()}</div>
        <div><span class="lbl">Pagamento:</span> {os_obj.payment_method or "-"}</div>
        <div><span class="lbl">Condições:</span> {os_obj.payment_conditions or "-"}</div>
      </div>
    </div>
    <div class="section"><div class="section-title">Itens de Produção</div>
    <table><thead><tr><th>Produto</th><th>Material</th><th>Instalação</th><th>Acabamento</th>
      <th class="tc">L×A</th><th class="tc">Área(m²)</th><th class="tc">Qtd</th>
      <th class="tr">Vlr Unit.</th><th class="tr">Subtotal</th></tr></thead><tbody>{rows}</tbody></table>
    <div class="total-box">TOTAL: {_fmt_currency(os_obj.total_value)}</div></div>
    {"<div class='section'><div class='section-title'>Obs. Produção</div><div class='notes'>" + os_obj.production_notes + "</div></div>" if os_obj.production_notes else ""}
    {"<div class='section'><div class='section-title'>Obs. Instalação</div><div class='notes'>" + os_obj.installation_notes + "</div></div>" if os_obj.installation_notes else ""}
    <div class="sig"><div><div class="sig-line">Responsável pela Empresa</div></div>
    <div><div class="sig-line">Assinatura do Cliente<br>{os_obj.client.name if os_obj.client else ""}</div></div></div>
    </body></html>"""
    return HTMLResponse(content=html)


@router.get("/html/receipt/{receipt_id}", response_class=HTMLResponse)
def receipt_html(receipt_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    from app.models.receipt import Receipt
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Recibo não encontrado")
    company = _get_company_data(db)
    header = _header_html(company, "RECIBO", f"Nº {str(receipt.number).zfill(5)}",
                          f'<div style="font-size:9pt;color:#555">Data: {_fmt_date(receipt.receipt_date)}</div>')
    os_row = f'<div><span class="lbl">OS Nº:</span> {str(receipt.os.number).zfill(5)}</div>' if receipt.os else ""
    html = f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo {str(receipt.number).zfill(5)}</title>{BASE_CSS}</head><body>
    {header}
    <div style="margin:24px 0;font-size:26pt;text-align:center;font-weight:bold;color:#1e40af;border:2px solid #1e40af;padding:10px;border-radius:6px">
      {_fmt_currency(receipt.amount)}</div>
    <div style="font-size:11pt;line-height:2;margin:18px 0">
      Recebi(emos) de <strong>{receipt.payer_name}</strong>,
      a importância de <em>{receipt.amount_words}</em>,
      referente a <strong>{receipt.reference}</strong>,
      pago por meio de <strong>{receipt.payment_method}</strong>.
    </div>
    <div class="info-grid" style="margin-top:16px">
      <div><span class="lbl">Cliente:</span> {receipt.client.name if receipt.client else "-"}</div>
      <div><span class="lbl">CPF/CNPJ:</span> {(receipt.client.cpf_cnpj or "-") if receipt.client else "-"}</div>
      {os_row}
      <div><span class="lbl">Forma de Pagamento:</span> {receipt.payment_method}</div>
    </div>
    <div class="sig" style="margin-top:60px">
      <div><div class="sig-line">Assinatura do Pagador<br>{receipt.payer_name}</div></div>
      <div><div class="sig-line">{company['name']}<br>{"CNPJ: " + company['cnpj'] if company['cnpj'] else ""}</div></div>
    </div>
    <div style="margin-top:24px;padding-top:16px;border-top:2px dashed #ccc;font-size:8pt;color:#999;text-align:center">
      Recibo Nº {str(receipt.number).zfill(5)} — {company['name']} — {_fmt_date(receipt.receipt_date)}
    </div>
    </body></html>"""
    return HTMLResponse(content=html)


@router.get("/test")
def test_pdf(_=Depends(get_current_active_user)):
    return {"status": "ok", "message": "Endpoint de PDF ativo. Use /pdf/html/quote/{id} para visualizar/imprimir."}
