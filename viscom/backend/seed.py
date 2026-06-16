#!/usr/bin/env python3
"""Seed script: populates the database with initial data for development/demo."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date, timedelta
from decimal import Decimal
import uuid

from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models import (
    User, Company, Client, Product, ConfigList,
    Quote, QuoteItem, ServiceOrder, ServiceOrderItem, StatusHistory,
    Receivable, Payment, Receipt,
)
from app.utils.formatters import number_to_words

Base.metadata.create_all(bind=engine)

db = SessionLocal()

def seed():
    print("🌱 Iniciando seed...")

    # Company
    if not db.query(Company).first():
        db.add(Company(
            id=str(uuid.uuid4()),
            name="VisCom Comunicação Visual Ltda.",
            cnpj="12.345.678/0001-90",
            address="Rua das Artes Gráficas, 500 - Centro - São Paulo/SP - CEP 01310-000",
            phone="(11) 3333-4444",
            email="contato@viscom.com.br",
        ))
        print("  ✓ Empresa criada")

    # Users
    admin = db.query(User).filter(User.email == "admin@viscom.com").first()
    if not admin:
        admin = User(id=str(uuid.uuid4()), name="Administrador", email="admin@viscom.com",
                     hashed_password=hash_password("admin123"), role="admin")
        db.add(admin)
        print("  ✓ Admin: admin@viscom.com / admin123")

    vendedor = db.query(User).filter(User.email == "vendedor@viscom.com").first()
    if not vendedor:
        vendedor = User(id=str(uuid.uuid4()), name="João Vendedor", email="vendedor@viscom.com",
                        hashed_password=hash_password("vendedor123"), role="vendedor")
        db.add(vendedor)
        print("  ✓ Vendedor: vendedor@viscom.com / vendedor123")

    db.commit()

    # Config Lists
    configs = [
        ("material_type", "Lona 440g"), ("material_type", "Lona Blacklight"),
        ("material_type", "Vinil Adesivo Brilho"), ("material_type", "Vinil Adesivo Fosco"),
        ("material_type", "ACM 3mm"), ("material_type", "PS Cristal"),
        ("material_type", "Acrílico"), ("material_type", "Placa PVC"),
        ("installation_type", "Sem Instalação"), ("installation_type", "Parede"),
        ("installation_type", "Fachada"), ("installation_type", "Totem"),
        ("installation_type", "Veículo"), ("installation_type", "Vidro"),
        ("finishing", "Ilhós"), ("finishing", "Bastão"), ("finishing", "Laminação Fosca"),
        ("finishing", "Recorte Eletrônico"), ("finishing", "Sem Acabamento"),
        ("payment_method", "Dinheiro"), ("payment_method", "PIX"),
        ("payment_method", "Cartão de Débito"), ("payment_method", "Cartão de Crédito"),
        ("payment_method", "Boleto"), ("payment_method", "Transferência Bancária"),
    ]
    for cat, val in configs:
        if not db.query(ConfigList).filter(ConfigList.category == cat, ConfigList.value == val).first():
            db.add(ConfigList(id=str(uuid.uuid4()), category=cat, value=val))
    db.commit()
    print("  ✓ Listas de configuração criadas")

    # Products
    products_data = [
        ("Banner Lona 440g", "m2", "25.00", "18.00"),
        ("Banner Lona Backlight", "m2", "35.00", "25.00"),
        ("Adesivo Vinil Brilho", "m2", "45.00", "32.00"),
        ("Adesivo Vinil Fosco", "m2", "50.00", "36.00"),
        ("Placa ACM", "m2", "280.00", "220.00"),
        ("Placa PVC 3mm", "m2", "85.00", "65.00"),
        ("Letra Caixa Acrílico Iluminado", "unidade", "350.00", "280.00"),
        ("Envelopamento Veicular Completo", "unidade", "2500.00", "2000.00"),
        ("Faixa Lona", "m2", "22.00", "16.00"),
        ("Placa PS Cristal", "m2", "120.00", "90.00"),
    ]
    products = {}
    for name, unit, pc, pr in products_data:
        p = db.query(Product).filter(Product.name == name).first()
        if not p:
            p = Product(id=str(uuid.uuid4()), name=name, unit=unit,
                        price_client=Decimal(pc), price_reseller=Decimal(pr))
            db.add(p)
        products[name] = p
    db.commit()
    print(f"  ✓ {len(products)} produtos criados")

    # Clients
    c1 = db.query(Client).filter(Client.cpf_cnpj == "123.456.789-09").first()
    if not c1:
        c1 = Client(id=str(uuid.uuid4()), name="Maria Silva", person_type="PF",
                    cpf_cnpj="123.456.789-09", phone="(11) 98765-4321",
                    email="maria@email.com", cidade="São Paulo", uf="SP",
                    created_by_id=admin.id)
        db.add(c1)

    c2 = db.query(Client).filter(Client.cpf_cnpj == "987.654.321-00").first()
    if not c2:
        c2 = Client(id=str(uuid.uuid4()), name="Pedro Santos", person_type="PF",
                    cpf_cnpj="987.654.321-00", phone="(11) 97654-3210",
                    cidade="Campinas", uf="SP", created_by_id=vendedor.id)
        db.add(c2)

    c3 = db.query(Client).filter(Client.cpf_cnpj == "11.222.333/0001-81").first()
    if not c3:
        c3 = Client(id=str(uuid.uuid4()), name="Empresa Modelo Ltda.", person_type="PJ",
                    cpf_cnpj="11.222.333/0001-81", phone="(11) 3322-1100",
                    email="contato@empresamodelo.com.br", cidade="São Paulo", uf="SP",
                    created_by_id=admin.id)
        db.add(c3)

    rev1 = db.query(Client).filter(Client.cpf_cnpj == "44.555.666/0001-77").first()
    if not rev1:
        rev1 = Client(id=str(uuid.uuid4()), name="Gráfica Parceira ME", person_type="PJ",
                      cpf_cnpj="44.555.666/0001-77", phone="(11) 4455-6677",
                      is_reseller=True, reseller_discount_pct=Decimal("10"),
                      cidade="São Paulo", uf="SP", created_by_id=admin.id)
        db.add(rev1)

    db.commit()
    c1 = db.query(Client).filter(Client.cpf_cnpj == "123.456.789-09").first()
    c3 = db.query(Client).filter(Client.cpf_cnpj == "11.222.333/0001-81").first()
    print("  ✓ Clientes e revendedor criados")

    banner = db.query(Product).filter(Product.name == "Banner Lona 440g").first()
    adesivo = db.query(Product).filter(Product.name == "Adesivo Vinil Brilho").first()
    acm = db.query(Product).filter(Product.name == "Placa ACM").first()

    # Quote
    if not db.query(Quote).first():
        quote = Quote(
            id=str(uuid.uuid4()), number=1, client_id=c1.id,
            created_by_id=vendedor.id, status="aprovado",
            valid_until=date.today() + timedelta(days=30),
            discount_general=Decimal("0"),
        )
        db.add(quote)
        db.flush()
        db.add(QuoteItem(id=str(uuid.uuid4()), quote_id=quote.id, product_id=banner.id,
                         width_m=Decimal("3"), height_m=Decimal("1"), area_m2=Decimal("3"),
                         quantity=2, unit_price=Decimal("25.00"), discount_pct=Decimal("0"),
                         subtotal=Decimal("150.00")))
        db.add(QuoteItem(id=str(uuid.uuid4()), quote_id=quote.id, product_id=adesivo.id,
                         width_m=Decimal("2"), height_m=Decimal("1.5"), area_m2=Decimal("3"),
                         quantity=1, unit_price=Decimal("45.00"), discount_pct=Decimal("5"),
                         subtotal=Decimal("128.25")))
        db.commit()
        print("  ✓ Orçamento #1 criado (aprovado)")

    # Service Orders
    if not db.query(ServiceOrder).first():
        # OS 1 - Em produção
        os1 = ServiceOrder(
            id=str(uuid.uuid4()), number=1, client_id=c1.id,
            created_by_id=vendedor.id, status="em_producao",
            deadline=date.today() + timedelta(days=7),
            total_value=Decimal("750.00"),
            payment_method="PIX", payment_conditions="À vista",
        )
        db.add(os1)
        db.flush()
        db.add(ServiceOrderItem(id=str(uuid.uuid4()), os_id=os1.id, product_id=banner.id,
                                 material_type="Lona 440g", installation_type="Sem Instalação",
                                 finishing="Ilhós", width_m=Decimal("5"), height_m=Decimal("2"),
                                 area_m2=Decimal("10"), quantity=3, unit_price=Decimal("25.00"),
                                 subtotal=Decimal("750.00")))
        db.add(StatusHistory(id=str(uuid.uuid4()), os_id=os1.id, old_status=None,
                              new_status="aberta", changed_by_id=vendedor.id))
        db.add(StatusHistory(id=str(uuid.uuid4()), os_id=os1.id, old_status="aberta",
                              new_status="em_producao", changed_by_id=admin.id, notes="Iniciando produção"))
        db.flush()

        # OS 2 - Finalizada com financeiro
        os2 = ServiceOrder(
            id=str(uuid.uuid4()), number=2, client_id=c3.id,
            created_by_id=admin.id, status="finalizada",
            deadline=date.today() - timedelta(days=5),
            total_value=Decimal("2800.00"),
            payment_method="Boleto", payment_conditions="2x de R$ 1.400,00",
        )
        db.add(os2)
        db.flush()
        db.add(ServiceOrderItem(id=str(uuid.uuid4()), os_id=os2.id, product_id=acm.id,
                                 material_type="ACM 3mm", installation_type="Fachada",
                                 finishing="Sem Acabamento", width_m=Decimal("5"), height_m=Decimal("2"),
                                 area_m2=Decimal("10"), quantity=1, unit_price=Decimal("280.00"),
                                 subtotal=Decimal("2800.00")))
        db.add(StatusHistory(id=str(uuid.uuid4()), os_id=os2.id, old_status=None,
                              new_status="finalizada", changed_by_id=admin.id))
        db.flush()

        # Receivables for OS2
        rec1 = Receivable(id=str(uuid.uuid4()), os_id=os2.id, client_id=c3.id,
                          description="OS #2 - Parcela 1/2", total_value=Decimal("1400.00"),
                          due_date=date.today() - timedelta(days=30),
                          paid_amount=Decimal("1400.00"), status="paid",
                          installment_number=1, total_installments=2)
        rec2 = Receivable(id=str(uuid.uuid4()), os_id=os2.id, client_id=c3.id,
                          description="OS #2 - Parcela 2/2", total_value=Decimal("1400.00"),
                          due_date=date.today() + timedelta(days=5),
                          paid_amount=Decimal("0"), status="pending",
                          installment_number=2, total_installments=2)
        db.add(rec1)
        db.add(rec2)
        db.flush()
        db.add(Payment(id=str(uuid.uuid4()), receivable_id=rec1.id, amount=Decimal("1400.00"),
                       payment_date=date.today() - timedelta(days=25),
                       payment_method="Boleto", created_by_id=admin.id))

        # Receipt
        db.add(Receipt(id=str(uuid.uuid4()), number=1, os_id=os2.id, client_id=c3.id,
                       payer_name="Empresa Modelo Ltda.", amount=Decimal("1400.00"),
                       amount_words=number_to_words(Decimal("1400.00")),
                       reference="Pagamento parcela 1/2 - OS #2",
                       payment_method="Boleto",
                       receipt_date=date.today() - timedelta(days=25),
                       created_by_id=admin.id))
        db.commit()
        print("  ✓ 2 Ordens de Serviço criadas")
        print("  ✓ Recebíveis e recibo criados")

    print("\n✅ Seed concluído!")
    print("\nCredenciais:")
    print("  Admin:    admin@viscom.com / admin123")
    print("  Vendedor: vendedor@viscom.com / vendedor123")


if __name__ == "__main__":
    try:
        seed()
    finally:
        db.close()
