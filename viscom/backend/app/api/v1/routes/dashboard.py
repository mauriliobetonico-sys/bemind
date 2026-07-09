from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone
from decimal import Decimal

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.service_order import ServiceOrder
from app.models.client import Client
from app.models.financial import Receivable

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def get_dashboard(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    os_q = db.query(ServiceOrder).filter(ServiceOrder.is_deleted == False)
    if current_user.role == "vendedor":
        os_q = os_q.filter(ServiceOrder.created_by_id == current_user.id)

    os_abertas = os_q.filter(ServiceOrder.status == "aberta").count()
    os_em_producao = os_q.filter(ServiceOrder.status == "em_producao").count()
    os_prontas = os_q.filter(ServiceOrder.status == "pronta").count()

    clients_q = db.query(Client).filter(Client.is_deleted == False)
    if current_user.role == "vendedor":
        clients_q = clients_q.filter(Client.created_by_id == current_user.id)
    clientes_total = clients_q.count()

    fat_q = db.query(func.coalesce(func.sum(ServiceOrder.total_value), 0)).filter(
        ServiceOrder.is_deleted == False,
        ServiceOrder.created_at >= month_start,
    )
    if current_user.role == "vendedor":
        fat_q = fat_q.filter(ServiceOrder.created_by_id == current_user.id)
    faturamento_mes = float(fat_q.scalar() or 0)

    result = {
        "os_abertas": os_abertas,
        "os_em_producao": os_em_producao,
        "os_prontas": os_prontas,
        "clientes_total": clientes_total,
        "faturamento_mes": faturamento_mes,
    }

    if current_user.role == "admin":
        inadimplencia = db.query(
            func.coalesce(
                func.sum(Receivable.total_value - Receivable.paid_amount), 0
            )
        ).filter(
            Receivable.is_deleted == False,
            Receivable.status.in_(["pending", "partial", "overdue"]),
        ).scalar() or Decimal("0")
        result["inadimplencia_total"] = float(inadimplencia)

    # Recent OS
    recent_os = os_q.order_by(ServiceOrder.created_at.desc()).limit(10).all()
    result["recent_os"] = [
        {
            "id": str(os.id),
            "number": os.number,
            "client_name": os.client.name if os.client else "",
            "status": os.status,
            "total_value": float(os.total_value),
            "opened_at": os.opened_at.isoformat(),
        }
        for os in recent_os
    ]

    return result
