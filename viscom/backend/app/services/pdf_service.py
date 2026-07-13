import os
import base64
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML, CSS
from sqlalchemy.orm import Session
from app.core.config import settings

TEMPLATE_DIR = Path(__file__).parent.parent / "templates" / "pdf"
env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))


def _get_logo_data_uri(logo_path: str) -> str | None:
    if not logo_path or not os.path.exists(logo_path):
        return None
    try:
        with open(logo_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
        ext = os.path.splitext(logo_path)[1].lower().lstrip(".")
        mime = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp", "svg": "svg+xml"}.get(ext, "png")
        return f"data:image/{mime};base64,{data}"
    except Exception:
        return None


def _get_company(db: Session) -> dict:
    from app.models.company import Company
    co = db.query(Company).first()
    if co:
        return {
            "name": co.name or settings.COMPANY_NAME,
            "cnpj": co.cnpj or settings.COMPANY_CNPJ,
            "address": co.address or settings.COMPANY_ADDRESS,
            "phone": co.phone or settings.COMPANY_PHONE,
            "email": co.email or settings.COMPANY_EMAIL,
            "logo": _get_logo_data_uri(co.logo_path),
        }
    return {
        "name": settings.COMPANY_NAME,
        "cnpj": settings.COMPANY_CNPJ,
        "address": settings.COMPANY_ADDRESS,
        "phone": settings.COMPANY_PHONE,
        "email": settings.COMPANY_EMAIL,
        "logo": _get_logo_data_uri(getattr(settings, "LOGO_PATH", None)),
    }


def _render_pdf(template_name: str, context: dict) -> bytes:
    tpl = env.get_template(template_name)
    html_str = tpl.render(**context)
    return HTML(string=html_str, base_url=str(TEMPLATE_DIR)).write_pdf()


def generate_quote_pdf(quote_id: str, db: Session) -> bytes:
    from app.models.quote import Quote
    quote = db.query(Quote).filter(Quote.id == quote_id).first()
    if not quote:
        raise ValueError("Orçamento não encontrado")
    items_data = []
    for it in quote.items:
        items_data.append({
            "product": it.product.name if it.product else "",
            "width_m": it.width_m,
            "height_m": it.height_m,
            "area_m2": it.area_m2,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "discount_pct": it.discount_pct,
            "subtotal": it.subtotal,
        })
    from decimal import Decimal
    sub = sum(i.subtotal for i in quote.items) if quote.items else Decimal("0")
    discount = Decimal(str(quote.discount_general or 0))
    total = (sub * (1 - discount / 100)).quantize(Decimal("0.01"))
    return _render_pdf("quote.html", {
        "company": _get_company(db),
        "quote": quote,
        "items": items_data,
        "subtotal": sub,
        "total": total,
    })


def generate_os_pdf(os_id: str, db: Session) -> bytes:
    from app.models.service_order import ServiceOrder
    os_obj = db.query(ServiceOrder).filter(ServiceOrder.id == os_id).first()
    if not os_obj:
        raise ValueError("OS não encontrada")
    items_data = []
    for it in os_obj.items:
        items_data.append({
            "product": it.product.name if it.product else "",
            "material_type": it.material_type,
            "installation_type": it.installation_type,
            "finishing": it.finishing,
            "width_m": it.width_m,
            "height_m": it.height_m,
            "area_m2": it.area_m2,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "subtotal": it.subtotal,
        })
    return _render_pdf("service_order.html", {
        "company": _get_company(db),
        "os": os_obj,
        "items": items_data,
    })


def generate_receipt_pdf(receipt_id: str, db: Session) -> bytes:
    from app.models.receipt import Receipt
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise ValueError("Recibo não encontrado")
    return _render_pdf("receipt.html", {
        "company": _get_company(db),
        "receipt": receipt,
    })


def generate_report_pdf(title: str, headers: list, rows: list, totals: dict | None = None) -> bytes:
    return _render_pdf("report.html", {
        "title": title,
        "headers": headers,
        "rows": rows,
        "totals": totals or {},
    })
