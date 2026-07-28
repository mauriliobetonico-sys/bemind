from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from typing import List, Optional
from decimal import Decimal
import uuid
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.quote import Quote, QuoteItem
from app.models.service_order import ServiceOrder, ServiceOrderItem, StatusHistory
from app.schemas.quote import QuoteCreate, QuoteUpdate, QuoteResponse

router = APIRouter(prefix="/quotes", tags=["quotes"])


def _next_quote_number(db: Session) -> int:
    result = db.execute(select(func.max(Quote.number))).scalar()
    return (result or 0) + 1


def _compute_item_subtotal(item_data: dict) -> Decimal:
    qty = Decimal(str(item_data.get("quantity", 1)))
    unit_price = Decimal(str(item_data.get("unit_price", 0)))
    discount_pct = Decimal(str(item_data.get("discount_pct", 0)))
    area = item_data.get("area_m2")
    if area:
        base = Decimal(str(area)) * qty * unit_price
    else:
        base = qty * unit_price
    return base * (1 - discount_pct / 100)


@router.get("", response_model=List[QuoteResponse])
def list_quotes(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    q = db.query(Quote).filter(Quote.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Quote.created_by_id == current_user.id)
    if status:
        q = q.filter(Quote.status == status)
    if client_id:
        q = q.filter(Quote.client_id == client_id)
    return q.order_by(Quote.number.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=QuoteResponse, status_code=201)
def create_quote(body: QuoteCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    number = _next_quote_number(db)
    quote = Quote(
        id=str(uuid.uuid4()),
        number=number,
        client_id=body.client_id,
        created_by_id=current_user.id,
        valid_until=body.valid_until,
        installation_deadline=body.installation_deadline,
        discount_general=body.discount_general,
        notes=body.notes,
    )
    db.add(quote)
    db.flush()

    for item_data in body.items:
        d = item_data.model_dump()
        subtotal = _compute_item_subtotal(d)
        item = QuoteItem(
            id=str(uuid.uuid4()),
            quote_id=quote.id,
            product_id=d.get("product_id"),
            material_type=d.get("material_type"),
            installation_type=d.get("installation_type"),
            finishing=d.get("finishing"),
            width_m=d.get("width_m"),
            height_m=d.get("height_m"),
            area_m2=d.get("area_m2"),
            quantity=d["quantity"],
            unit_price=d["unit_price"],
            discount_pct=d.get("discount_pct", 0),
            subtotal=subtotal,
        )
        db.add(item)

    db.commit()
    db.refresh(quote)
    return quote


@router.get("/{quote_id}", response_model=QuoteResponse)
def get_quote(quote_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Quote).filter(Quote.id == quote_id, Quote.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Quote.created_by_id == current_user.id)
    quote = q.first()
    if not quote:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    return quote


@router.put("/{quote_id}", response_model=QuoteResponse)
def update_quote(quote_id: str, body: QuoteUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Quote).filter(Quote.id == quote_id, Quote.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Quote.created_by_id == current_user.id)
    quote = q.first()
    if not quote:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")

    data = body.model_dump(exclude_unset=True)
    items_data = data.pop("items", None)
    for k, v in data.items():
        setattr(quote, k, v)

    if items_data is not None:
        for old_item in quote.items:
            db.delete(old_item)
        db.flush()
        for item_d in items_data:
            d = item_d if isinstance(item_d, dict) else item_d.model_dump()
            subtotal = _compute_item_subtotal(d)
            item = QuoteItem(
                id=str(uuid.uuid4()),
                quote_id=quote.id,
                product_id=d.get("product_id"),
                material_type=d.get("material_type"),
                installation_type=d.get("installation_type"),
                finishing=d.get("finishing"),
                width_m=d.get("width_m"),
                height_m=d.get("height_m"),
                area_m2=d.get("area_m2"),
                quantity=d["quantity"],
                unit_price=d["unit_price"],
                discount_pct=d.get("discount_pct", 0),
                subtotal=subtotal,
            )
            db.add(item)

    db.commit()
    db.refresh(quote)
    return quote


@router.delete("/{quote_id}", status_code=204)
def delete_quote(quote_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Quote).filter(Quote.id == quote_id, Quote.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Quote.created_by_id == current_user.id)
    quote = q.first()
    if not quote:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    quote.is_deleted = True
    db.commit()


@router.post("/{quote_id}/convert-to-os")
def convert_to_os(quote_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    from app.models.service_order import ServiceOrder, ServiceOrderItem, StatusHistory
    from sqlalchemy import func, select as sa_select

    q = db.query(Quote).filter(Quote.id == quote_id, Quote.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Quote.created_by_id == current_user.id)
    quote = q.first()
    if not quote:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")

    result = db.execute(sa_select(func.max(ServiceOrder.number))).scalar()
    os_number = (result or 0) + 1

    total = sum(Decimal(str(item.subtotal)) for item in quote.items)
    discount = Decimal(str(quote.discount_general or 0))
    total_final = total * (1 - discount / 100)

    os = ServiceOrder(
        id=str(uuid.uuid4()),
        number=os_number,
        quote_id=quote.id,
        client_id=quote.client_id,
        created_by_id=current_user.id,
        total_value=total_final,
    )
    db.add(os)
    db.flush()

    for qi in quote.items:
        si = ServiceOrderItem(
            id=str(uuid.uuid4()),
            os_id=os.id,
            product_id=qi.product_id,
            material_type=qi.material_type,
            installation_type=qi.installation_type,
            finishing=qi.finishing,
            width_m=qi.width_m,
            height_m=qi.height_m,
            area_m2=qi.area_m2,
            quantity=qi.quantity,
            unit_price=qi.unit_price,
            subtotal=qi.subtotal,
        )
        db.add(si)

    history = StatusHistory(
        id=str(uuid.uuid4()),
        os_id=os.id,
        old_status=None,
        new_status="aberta",
        changed_by_id=current_user.id,
        notes="Criada a partir do orçamento #" + str(quote.number),
    )
    db.add(history)
    db.commit()
    db.refresh(os)
    return {"os_id": str(os.id), "os_number": os.number}
