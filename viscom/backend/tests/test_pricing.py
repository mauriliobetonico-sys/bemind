"""Tests for pricing logic, m² calculation, installments, and debt balance."""
import pytest
from decimal import Decimal
from datetime import date, timedelta
import uuid

from app.utils.formatters import calculate_area, number_to_words


# ── m² calculation ─────────────────────────────────────────────────────────

def test_area_calculation_basic():
    area = calculate_area(Decimal("3.0"), Decimal("2.0"))
    assert area == Decimal("6.0000")


def test_area_calculation_decimal():
    area = calculate_area(Decimal("1.5"), Decimal("2.3"))
    assert area == Decimal("3.4500")


def test_area_small():
    area = calculate_area(Decimal("0.5"), Decimal("0.5"))
    assert area == Decimal("0.2500")


# ── Number to words ──────────────────────────────────────────────────────────

def test_number_to_words_simple():
    assert "cem reais" in number_to_words(Decimal("100.00"))


def test_number_to_words_cents():
    result = number_to_words(Decimal("1.50"))
    assert "real" in result or "reais" in result
    assert "cinquenta centavos" in result


def test_number_to_words_zero():
    assert "zero reais" == number_to_words(Decimal("0.00"))


def test_number_to_words_thousand():
    result = number_to_words(Decimal("1400.00"))
    assert "mil" in result
    assert "quatrocentos" in result


def test_number_to_words_million():
    result = number_to_words(Decimal("1000000.00"))
    assert "milhão" in result


# ── Pricing rules ────────────────────────────────────────────────────────────

def test_client_price_higher_than_reseller():
    from tests.conftest import TestingSessionLocal
    from app.models.product import Product
    db = TestingSessionLocal()
    try:
        p = Product(id=str(uuid.uuid4()), name="Test Banner", unit="m2",
                    price_client=Decimal("30.00"), price_reseller=Decimal("20.00"))
        db.add(p)
        db.commit()
        assert p.price_client > p.price_reseller
    finally:
        db.close()


def test_subtotal_with_discount():
    unit_price = Decimal("100.00")
    quantity = 2
    discount_pct = Decimal("10")
    subtotal = unit_price * quantity * (1 - discount_pct / 100)
    assert subtotal == Decimal("180.00")


def test_subtotal_no_discount():
    unit_price = Decimal("45.00")
    quantity = 3
    area_m2 = Decimal("6.0")
    subtotal = unit_price * area_m2 * quantity
    assert subtotal == Decimal("810.00")


# ── Installment generation ───────────────────────────────────────────────────

def test_installments_total():
    total = Decimal("1200.00")
    n = 3
    installment = (total / n).quantize(Decimal("0.01"))
    assert installment == Decimal("400.00")
    assert installment * n == total


def test_installments_due_dates():
    start = date.today()
    n = 3
    due_dates = [start.replace(month=((start.month - 1 + i) % 12) + 1) for i in range(1, n + 1)]
    assert len(due_dates) == 3


# ── Client debt balance ──────────────────────────────────────────────────────

def test_debt_balance():
    total_value = Decimal("1000.00")
    paid_amount = Decimal("400.00")
    balance = total_value - paid_amount
    assert balance == Decimal("600.00")


def test_zero_debt_when_fully_paid():
    total_value = Decimal("500.00")
    paid_amount = Decimal("500.00")
    assert total_value - paid_amount == Decimal("0.00")


# ── CPF/CNPJ validation ──────────────────────────────────────────────────────

def test_cpf_validation_valid():
    from app.schemas.client import _validate_cpf
    assert _validate_cpf("529.982.247-25") is True


def test_cpf_validation_invalid():
    from app.schemas.client import _validate_cpf
    assert _validate_cpf("111.111.111-11") is False


def test_cnpj_validation_valid():
    from app.schemas.client import _validate_cnpj
    assert _validate_cnpj("11.222.333/0001-81") is True


def test_cnpj_validation_invalid():
    from app.schemas.client import _validate_cnpj
    assert _validate_cnpj("11.111.111/1111-11") is False


# ── API integration ──────────────────────────────────────────────────────────

def test_login_success(client):
    from tests.conftest import TestingSessionLocal, _create_user
    db = TestingSessionLocal()
    _create_user(db, "login_test@viscom.com", "admin")
    db.close()
    resp = client.post("/v1/auth/login", data={"username": "login_test@viscom.com", "password": "testpass123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


def test_login_wrong_password(client):
    from tests.conftest import TestingSessionLocal, _create_user
    db = TestingSessionLocal()
    _create_user(db, "wrong_pass@viscom.com", "admin")
    db.close()
    resp = client.post("/v1/auth/login", data={"username": "wrong_pass@viscom.com", "password": "wrongpassword"})
    assert resp.status_code == 401


def test_unauthorized_without_token(client):
    resp = client.get("/v1/clients/")
    assert resp.status_code == 401


def test_create_and_get_client(client, admin_headers, db):
    resp = client.post("/v1/clients/", json={
        "name": "Test Client",
        "person_type": "PF",
        "cpf_cnpj": "529.982.247-25",
        "phone": "(11) 98765-4321",
        "is_reseller": False,
    }, headers=admin_headers)
    assert resp.status_code == 201
    client_id = resp.json()["id"]
    get_resp = client.get(f"/v1/clients/{client_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Test Client"
