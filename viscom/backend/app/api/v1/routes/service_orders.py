from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from typing import List, Optional
from decimal import Decimal
import uuid

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.service_order import ServiceOrder, ServiceOrderItem, StatusHistory
from app.schemas.service_order import (
    ServiceOrderCreate, ServiceOrderUpdate, ServiceOrderResponse, StatusUpdate
)

router = APIRouter(prefix="/service-orders", tags=["service-orders"])


def _next_os_number(db: Session) -> int:
    result = db.execute(select(func.max(ServiceOrder.number))).scalar()
    return (result or 0) + 1


@router.get("", response_model=List[ServiceOrderResponse])
def list_service_orders(
    status: Optional[str] = None,
    client_id: Optional[uuid.UUID] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    q = db.query(ServiceOrder).filter(ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(ServiceOrder.created_by_id == current_user.id)
    if status:
        q = q.filter(ServiceOrder.status == status)
    if client_id:
        q = q.filter(ServiceOrder.client_id == client_id)
    return q.order_by(ServiceOrder.number.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ServiceOrderResponse, status_code=201)
def create_service_order(body: ServiceOrderCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    number = _next_os_number(db)
    items_data = body.items

    total = Decimal("0")
    for item in items_data:
        qty = Decimal(str(item.quantity))
        price = Decimal(str(item.unit_price))
        area = item.area_m2
        if item.width_m and item.height_m and not area:
            area = Decimal(str(item.width_m)) * Decimal(str(item.height_m))
        if area:
            total += Decimal(str(area)) * qty * price
        else:
            total += qty * price

    os = ServiceOrder(
        id=str(uuid.uuid4()),
        number=number,
        quote_id=body.quote_id,
        client_id=body.client_id,
        created_by_id=current_user.id,
        deadline=body.deadline,
        production_notes=body.production_notes,
        installation_notes=body.installation_notes,
        payment_method=body.payment_method,
        payment_conditions=body.payment_conditions,
        total_value=total,
    )
    db.add(os)
    db.flush()

    for item in items_data:
        area = item.area_m2
        if item.width_m and item.height_m and not area:
            area = Decimal(str(item.width_m)) * Decimal(str(item.height_m))
        qty = Decimal(str(item.quantity))
        price = Decimal(str(item.unit_price))
        if area:
            subtotal = Decimal(str(area)) * qty * price
        else:
            subtotal = qty * price
        si = ServiceOrderItem(
            id=str(uuid.uuid4()),
            os_id=os.id,
            product_id=item.product_id,
            material_type=item.material_type,
            installation_type=item.installation_type,
            finishing=item.finishing,
            width_m=item.width_m,
            height_m=item.height_m,
            area_m2=area,
            quantity=item.quantity,
            unit_price=item.unit_price,
            subtotal=subtotal,
        )
        db.add(si)

    history = StatusHistory(
        id=str(uuid.uuid4()),
        os_id=os.id,
        old_status=None,
        new_status="aberta",
        changed_by_id=current_user.id,
    )
    db.add(history)
    db.commit()
    db.refresh(os)
    return os


@router.get("/{os_id}", response_model=ServiceOrderResponse)
def get_service_order(os_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(ServiceOrder).filter(ServiceOrder.id == os_id, ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(ServiceOrder.created_by_id == current_user.id)
    os = q.first()
    if not os:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    return os


@router.put("/{os_id}", response_model=ServiceOrderResponse)
def update_service_order(os_id: uuid.UUID, body: ServiceOrderUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(ServiceOrder).filter(ServiceOrder.id == os_id, ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(ServiceOrder.created_by_id == current_user.id)
    os = q.first()
    if not os:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    data = body.model_dump(exclude_unset=True)
    items_data = data.pop("items", None)
    for k, v in data.items():
        setattr(os, k, v)
    if items_data is not None:
        for old in os.items:
            db.delete(old)
        db.flush()
        total = Decimal("0")
        for item in items_data:
            area = item.get("area_m2")
            if item.get("width_m") and item.get("height_m") and not area:
                area = Decimal(str(item["width_m"])) * Decimal(str(item["height_m"]))
            qty = Decimal(str(item.get("quantity", 1)))
            price = Decimal(str(item["unit_price"]))
            subtotal = (Decimal(str(area)) * qty * price) if area else (qty * price)
            total += subtotal
            si = ServiceOrderItem(
                id=str(uuid.uuid4()),
                os_id=os.id,
                product_id=item["product_id"],
                material_type=item.get("material_type"),
                installation_type=item.get("installation_type"),
                finishing=item.get("finishing"),
                width_m=item.get("width_m"),
                height_m=item.get("height_m"),
                area_m2=area,
                quantity=qty,
                unit_price=price,
                subtotal=subtotal,
            )
            db.add(si)
        os.total_value = total
    db.commit()
    db.refresh(os)
    return os


@router.patch("/{os_id}/status", response_model=ServiceOrderResponse)
def update_status(os_id: uuid.UUID, body: StatusUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(ServiceOrder).filter(ServiceOrder.id == os_id, ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(ServiceOrder.created_by_id == current_user.id)
    os = q.first()
    if not os:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    old_status = os.status
    os.status = body.status
    history = StatusHistory(
        id=str(uuid.uuid4()),
        os_id=os.id,
        old_status=old_status,
        new_status=body.status,
        changed_by_id=current_user.id,
        notes=body.notes,
    )
    db.add(history)
    db.commit()
    db.refresh(os)
    return os


@router.delete("/{os_id}", status_code=204)
def delete_service_order(os_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(ServiceOrder).filter(ServiceOrder.id == os_id, ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(ServiceOrder.created_by_id == current_user.id)
    os = q.first()
    if not os:
        raise HTTPException(status_code=404, detail="Ordem de serviço não encontrada")
    os.is_deleted = True
    db.commit()
