from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.security import get_current_active_user, require_admin
from app.models.financial import Receivable, Payment, CashFlow
from app.models.client import Client
from app.schemas.financial import (
    ReceivableCreate, ReceivableResponse,
    PaymentCreate, PaymentResponse,
    CashFlowCreate, CashFlowResponse,
    ClientDebtResponse,
)

router = APIRouter(prefix="/financial", tags=["financial"])


@router.get("/receivables", response_model=List[ReceivableResponse])
def list_receivables(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    overdue_only: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(Receivable).filter(Receivable.is_deleted == False)
    if status:
        q = q.filter(Receivable.status == status)
    if client_id:
        q = q.filter(Receivable.client_id == client_id)
    if overdue_only:
        q = q.filter(Receivable.due_date < datetime.utcnow(), Receivable.status.in_(["pending", "partial"]))
    return q.order_by(Receivable.due_date).offset(skip).limit(limit).all()


@router.post("/receivables", response_model=ReceivableResponse, status_code=201)
def create_receivable(body: ReceivableCreate, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    rec = Receivable(**body.model_dump(), id=str(uuid.uuid4()))
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/receivables/{rec_id}", response_model=ReceivableResponse)
def get_receivable(rec_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    rec = db.query(Receivable).filter(Receivable.id == rec_id, Receivable.is_deleted == False).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Conta a receber não encontrada")
    return rec


@router.delete("/receivables/{rec_id}", status_code=204)
def delete_receivable(rec_id: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    rec = db.query(Receivable).filter(Receivable.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Conta a receber não encontrada")
    rec.is_deleted = True
    db.commit()


@router.post("/payments", response_model=PaymentResponse, status_code=201)
def register_payment(body: PaymentCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    rec = db.query(Receivable).filter(Receivable.id == body.receivable_id, Receivable.is_deleted == False).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Conta a receber não encontrada")

    payment = Payment(
        id=str(uuid.uuid4()),
        receivable_id=body.receivable_id,
        amount=body.amount,
        payment_date=body.payment_date,
        payment_method=body.payment_method,
        notes=body.notes,
        created_by_id=current_user.id,
    )
    db.add(payment)
    db.flush()

    # Update receivable
    new_paid = Decimal(str(rec.paid_amount)) + Decimal(str(body.amount))
    rec.paid_amount = new_paid
    total = Decimal(str(rec.total_value))
    if new_paid >= total:
        rec.status = "paid"
    elif new_paid > 0:
        rec.status = "partial"

    db.commit()
    db.refresh(payment)
    return payment


@router.get("/payments/{receivable_id}", response_model=List[PaymentResponse])
def list_payments(receivable_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    return db.query(Payment).filter(Payment.receivable_id == receivable_id).all()


@router.get("/cash-flow", response_model=List[CashFlowResponse])
def list_cash_flow(
    type: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(CashFlow)
    if type:
        q = q.filter(CashFlow.type == type)
    if date_from:
        q = q.filter(CashFlow.date >= date_from)
    if date_to:
        q = q.filter(CashFlow.date <= date_to)
    return q.order_by(CashFlow.date.desc()).offset(skip).limit(limit).all()


@router.post("/cash-flow", response_model=CashFlowResponse, status_code=201)
def create_cash_flow(body: CashFlowCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    cf = CashFlow(**body.model_dump(), id=str(uuid.uuid4()), created_by_id=current_user.id)
    db.add(cf)
    db.commit()
    db.refresh(cf)
    return cf


@router.get("/client-debt/{client_id}", response_model=ClientDebtResponse)
def get_client_debt(client_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    client = db.query(Client).filter(Client.id == client_id, Client.is_deleted == False).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    receivables = db.query(Receivable).filter(
        Receivable.client_id == client_id,
        Receivable.is_deleted == False,
        Receivable.status.in_(["pending", "partial", "overdue"])
    ).all()
    total_debt = sum(Decimal(str(r.total_value)) - Decimal(str(r.paid_amount)) for r in receivables)
    overdue = sum(
        Decimal(str(r.total_value)) - Decimal(str(r.paid_amount))
        for r in receivables if r.due_date < datetime.utcnow()
    )
    return ClientDebtResponse(
        client_id=client_id,
        client_name=client.name,
        total_debt=total_debt,
        overdue_debt=overdue,
        receivables=receivables,
    )


@router.get("/inadimplentes")
def list_inadimplentes(
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    """List clients with overdue receivables."""
    overdue = db.query(Receivable).filter(
        Receivable.is_deleted == False,
        Receivable.due_date < datetime.utcnow(),
        Receivable.status.in_(["pending", "partial"]),
    ).all()
    # Update statuses
    for r in overdue:
        r.status = "overdue"
    db.commit()

    from collections import defaultdict
    by_client = defaultdict(list)
    for r in overdue:
        by_client[r.client_id].append(r)

    result = []
    for cid, recs in by_client.items():
        client = db.query(Client).filter(Client.id == cid).first()
        total = sum(Decimal(str(r.total_value)) - Decimal(str(r.paid_amount)) for r in recs)
        result.append({
            "client_id": str(cid),
            "client_name": client.name if client else "N/A",
            "overdue_amount": float(total),
            "receivables_count": len(recs),
        })
    return sorted(result, key=lambda x: x["overdue_amount"], reverse=True)
