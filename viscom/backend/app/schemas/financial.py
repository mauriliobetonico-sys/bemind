from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel


class PaymentCreate(BaseModel):
    receivable_id: str
    amount: Decimal
    payment_date: date
    payment_method: str
    notes: Optional[str] = None


class PaymentResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    receivable_id: str
    amount: Decimal
    payment_date: date
    payment_method: str
    notes: Optional[str]
    created_at: Optional[datetime] = None


class ReceivableCreate(BaseModel):
    os_id: Optional[str] = None
    client_id: str
    description: str
    total_value: Decimal
    due_date: date
    installment_number: int = 1
    total_installments: int = 1
    interest_rate: Decimal = Decimal("0")
    fine_rate: Decimal = Decimal("0")


class ClientBasic(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str


class ReceivableResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    os_id: Optional[str]
    client_id: str
    client: Optional[ClientBasic] = None
    description: str
    total_value: Decimal
    due_date: date
    paid_amount: Decimal
    status: str
    installment_number: int
    total_installments: int
    interest_rate: Decimal
    fine_rate: Decimal
    created_at: Optional[datetime] = None
    payments: List[PaymentResponse] = []


class CashFlowCreate(BaseModel):
    type: str
    category: str
    description: str
    amount: Decimal
    date: date


class CashFlowResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    type: str
    category: str
    description: str
    amount: Decimal
    date: date
    created_at: Optional[datetime] = None


class ClientDebtResponse(BaseModel):
    client_id: str
    client_name: str
    total_debt: Decimal
    overdue_amount: Decimal
    receivable_count: int
