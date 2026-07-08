from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from typing import List
import uuid

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.receipt import Receipt
from app.schemas.receipt import ReceiptCreate, ReceiptResponse
from app.utils.formatters import number_to_words

router = APIRouter(prefix="/receipts", tags=["receipts"])


def _next_receipt_number(db: Session) -> int:
    result = db.execute(select(func.max(Receipt.number))).scalar()
    return (result or 0) + 1


@router.get("", response_model=List[ReceiptResponse])
def list_receipts(
    client_id: uuid.UUID = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(Receipt)
    if client_id:
        q = q.filter(Receipt.client_id == client_id)
    return q.order_by(Receipt.number.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ReceiptResponse, status_code=201)
def create_receipt(body: ReceiptCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    number = _next_receipt_number(db)
    amount_words = number_to_words(body.amount)
    receipt = Receipt(
        id=uuid.uuid4(),
        number=number,
        os_id=body.os_id,
        client_id=body.client_id,
        payer_name=body.payer_name,
        amount=body.amount,
        amount_words=amount_words,
        reference=body.reference,
        payment_method=body.payment_method,
        receipt_date=body.receipt_date,
        created_by_id=current_user.id,
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    return receipt


@router.get("/amount-words")
def get_amount_words(value: float, _=Depends(get_current_active_user)):
    from decimal import Decimal
    return {"words": number_to_words(Decimal(str(value)))}


@router.get("/{receipt_id}", response_model=ReceiptResponse)
def get_receipt(receipt_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Recibo não encontrado")
    return receipt


@router.delete("/{receipt_id}", status_code=204)
def delete_receipt(receipt_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Recibo não encontrado")
    db.delete(receipt)
    db.commit()
