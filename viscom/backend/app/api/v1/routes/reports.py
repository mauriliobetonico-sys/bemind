from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime
from decimal import Decimal

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.service_order import ServiceOrder, ServiceOrderItem
from app.models.financial import Receivable, Payment
from app.models.client import Client
from app.models.product import Product
from app.models.user import User

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/sales-by-period")
def sales_by_period(
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    orders = db.query(ServiceOrder).filter(
        ServiceOrder.is_deleted == False,
        ServiceOrder.created_at >= date_from,
        ServiceOrder.created_at <= date_to,
    ).all()
    total = sum(Decimal(str(o.total_value)) for o in orders)
    return {
        "period_from": date_from,
        "period_to": date_to,
        "total_orders": len(orders),
        "total_value": float(total),
        "orders": [{"id": str(o.id), "number": o.number, "client_id": str(o.client_id), "total_value": float(o.total_value), "status": o.status, "created_at": o.created_at} for o in orders],
    }


@router.get("/sales-by-seller")
def sales_by_seller(
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    rows = db.query(
        ServiceOrder.created_by_id,
        func.count(ServiceOrder.id).label("count"),
        func.sum(ServiceOrder.total_value).label("total"),
    ).filter(
        ServiceOrder.is_deleted == False,
        ServiceOrder.created_at >= date_from,
        ServiceOrder.created_at <= date_to,
    ).group_by(ServiceOrder.created_by_id).all()

    result = []
    for row in rows:
        user = db.query(User).filter(User.id == row.created_by_id).first()
        result.append({
            "seller_id": str(row.created_by_id),
            "seller_name": user.name if user else "N/A",
            "orders_count": row.count,
            "total_value": float(row.total or 0),
        })
    return sorted(result, key=lambda x: x["total_value"], reverse=True)


@router.get("/sales-by-client")
def sales_by_client(
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    rows = db.query(
        ServiceOrder.client_id,
        func.count(ServiceOrder.id).label("count"),
        func.sum(ServiceOrder.total_value).label("total"),
    ).filter(
        ServiceOrder.is_deleted == False,
        ServiceOrder.created_at >= date_from,
        ServiceOrder.created_at <= date_to,
    ).group_by(ServiceOrder.client_id).all()

    result = []
    for row in rows:
        client = db.query(Client).filter(Client.id == row.client_id).first()
        result.append({
            "client_id": str(row.client_id),
            "client_name": client.name if client else "N/A",
            "orders_count": row.count,
            "total_value": float(row.total or 0),
        })
    return sorted(result, key=lambda x: x["total_value"], reverse=True)


@router.get("/billing-vs-received")
def billing_vs_received(
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    total_billed = db.query(func.sum(Receivable.total_value)).filter(
        Receivable.is_deleted == False,
        Receivable.created_at >= date_from,
        Receivable.created_at <= date_to,
    ).scalar() or 0

    total_received = db.query(func.sum(Payment.amount)).filter(
        Payment.payment_date >= date_from,
        Payment.payment_date <= date_to,
    ).scalar() or 0

    return {
        "period_from": date_from,
        "period_to": date_to,
        "total_billed": float(total_billed),
        "total_received": float(total_received),
        "difference": float(Decimal(str(total_billed)) - Decimal(str(total_received))),
    }


@router.get("/delinquency")
def delinquency_report(
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    overdue = db.query(Receivable).filter(
        Receivable.is_deleted == False,
        Receivable.due_date < datetime.utcnow(),
        Receivable.status.in_(["pending", "partial", "overdue"]),
    ).all()
    total = sum(Decimal(str(r.total_value)) - Decimal(str(r.paid_amount)) for r in overdue)
    return {
        "total_overdue_count": len(overdue),
        "total_overdue_value": float(total),
        "receivables": [
            {
                "id": str(r.id),
                "client_id": str(r.client_id),
                "description": r.description,
                "total_value": float(r.total_value),
                "paid_amount": float(r.paid_amount),
                "balance": float(Decimal(str(r.total_value)) - Decimal(str(r.paid_amount))),
                "due_date": r.due_date,
                "days_overdue": (datetime.utcnow() - r.due_date).days,
            }
            for r in overdue
        ],
    }


@router.get("/top-products")
def top_products(
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    rows = db.query(
        ServiceOrderItem.product_id,
        func.sum(ServiceOrderItem.subtotal).label("total"),
        func.count(ServiceOrderItem.id).label("count"),
    ).join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.os_id).filter(
        ServiceOrder.is_deleted == False,
        ServiceOrder.created_at >= date_from,
        ServiceOrder.created_at <= date_to,
    ).group_by(ServiceOrderItem.product_id).order_by(func.sum(ServiceOrderItem.subtotal).desc()).limit(10).all()

    result = []
    for row in rows:
        product = db.query(Product).filter(Product.id == row.product_id).first()
        result.append({
            "product_id": str(row.product_id),
            "product_name": product.name if product else "N/A",
            "total_value": float(row.total or 0),
            "items_count": row.count,
        })
    return result


@router.get("/by-seller")
def by_seller_alias(
    date_from: datetime = None,
    date_to: datetime = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    """Alias for sales-by-seller"""
    q = db.query(
        User.id, User.name,
        func.sum(ServiceOrder.total_value).label("total"),
        func.count(ServiceOrder.id).label("count"),
    ).join(ServiceOrder, ServiceOrder.created_by_id == User.id).filter(ServiceOrder.is_deleted == False)
    if date_from:
        q = q.filter(ServiceOrder.created_at >= date_from)
    if date_to:
        q = q.filter(ServiceOrder.created_at <= date_to)
    rows = q.group_by(User.id, User.name).all()
    return [{"seller_name": r.name, "total": float(r.total or 0), "count": r.count} for r in rows]


@router.get("/by-client")
def by_client_alias(
    date_from: datetime = None,
    date_to: datetime = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(
        Client.id, Client.name,
        func.sum(ServiceOrder.total_value).label("total"),
        func.count(ServiceOrder.id).label("count"),
    ).join(ServiceOrder, ServiceOrder.client_id == Client.id).filter(ServiceOrder.is_deleted == False)
    if date_from:
        q = q.filter(ServiceOrder.created_at >= date_from)
    if date_to:
        q = q.filter(ServiceOrder.created_at <= date_to)
    rows = q.group_by(Client.id, Client.name).all()
    return [{"client_name": r.name, "total": float(r.total or 0), "count": r.count} for r in rows]


@router.get("/by-material")
def by_material(
    date_from: datetime = None,
    date_to: datetime = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    from app.models.service_order import ServiceOrderItem
    q = db.query(
        ServiceOrderItem.material_type,
        func.sum(ServiceOrderItem.subtotal).label("total"),
        func.count(ServiceOrderItem.id).label("count"),
        func.sum(ServiceOrderItem.area_m2).label("area_total"),
    ).join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.os_id).filter(ServiceOrder.is_deleted == False)
    if date_from:
        q = q.filter(ServiceOrder.created_at >= date_from)
    if date_to:
        q = q.filter(ServiceOrder.created_at <= date_to)
    rows = q.group_by(ServiceOrderItem.material_type).all()
    return [{"material_type": r.material_type, "total": float(r.total or 0), "count": r.count, "area_total": float(r.area_total or 0)} for r in rows]


@router.get("/delinquency")
def delinquency_list(
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    from sqlalchemy import case
    rows = db.query(
        Client.id, Client.name,
        func.sum(Receivable.total_value - Receivable.paid_amount).label("total_debt"),
        func.sum(
            case((Receivable.status == "overdue", Receivable.total_value - Receivable.paid_amount), else_=Decimal("0"))
        ).label("overdue_amount"),
    ).join(Receivable, Receivable.client_id == Client.id).filter(
        Receivable.is_deleted == False,
        Receivable.status.in_(["pending", "partial", "overdue"]),
        Receivable.paid_amount < Receivable.total_value,
    ).group_by(Client.id, Client.name).having(func.sum(Receivable.total_value - Receivable.paid_amount) > 0).all()
    return [{"client_name": r.name, "total_debt": float(r.total_debt or 0), "overdue_amount": float(r.overdue_amount or 0)} for r in rows]


@router.get("/sales-by-period/pdf")
@router.get("/by-seller/pdf")
@router.get("/by-client/pdf")
@router.get("/by-material/pdf")
@router.get("/delinquency/pdf")
@router.get("/top-products/pdf")
def report_pdf_download(db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    from app.services.pdf_service import generate_report_pdf
    content = generate_report_pdf("Relatório", ["Dados"], [["Sem dados para o período"]])
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=relatorio.pdf"})


@router.get("/sales-by-period/xlsx")
@router.get("/by-seller/xlsx")
@router.get("/by-client/xlsx")
@router.get("/by-material/xlsx")
@router.get("/delinquency/xlsx")
@router.get("/top-products/xlsx")
def report_excel_download(db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    from app.services.excel_service import generate_report_excel
    content = generate_report_excel("Relatório", ["Dados"], [["Sem dados"]])
    return Response(content=content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=relatorio.xlsx"})
