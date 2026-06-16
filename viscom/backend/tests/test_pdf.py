"""Smoke tests for PDF generation."""
import pytest
from decimal import Decimal
from datetime import date
import uuid

from app.services.pdf_service import generate_report_pdf


def test_report_pdf_returns_bytes():
    pdf_bytes = generate_report_pdf(
        title="Relatório de Vendas",
        headers=["Período", "Quantidade", "Total"],
        rows=[["Janeiro/2025", "15", "R$ 3.500,00"], ["Fevereiro/2025", "12", "R$ 2.800,00"]],
        totals={"total": "R$ 6.300,00"},
    )
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000  # PDF should have content
    assert pdf_bytes[:4] == b"%PDF"  # PDF magic bytes


def test_report_pdf_with_empty_rows():
    pdf_bytes = generate_report_pdf(
        title="Sem dados",
        headers=["Col1", "Col2"],
        rows=[],
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"


def test_quote_pdf_integration(client, admin_headers, db):
    from app.models.client import Client
    from app.models.product import Product
    from app.models.quote import Quote, QuoteItem

    cl = Client(id=str(uuid.uuid4()), name="PDF Test Client", person_type="PF",
                cpf_cnpj="529.982.247-25", phone="(11) 11111-1111")
    pr = Product(id=str(uuid.uuid4()), name="PDF Test Product", unit="m2",
                 price_client=Decimal("30.00"), price_reseller=Decimal("20.00"))
    db.add(cl)
    db.add(pr)
    db.commit()

    q = Quote(id=str(uuid.uuid4()), number=9999, client_id=cl.id,
              created_by_id=cl.id, status="aberto",
              valid_until=date.today(), discount_general=Decimal("0"))
    db.add(q)
    db.flush()
    db.add(QuoteItem(id=str(uuid.uuid4()), quote_id=q.id, product_id=pr.id,
                     width_m=Decimal("2"), height_m=Decimal("1"), area_m2=Decimal("2"),
                     quantity=1, unit_price=Decimal("30.00"), discount_pct=Decimal("0"),
                     subtotal=Decimal("60.00")))
    db.commit()

    resp = client.get(f"/v1/pdf/quote/{q.id}", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
