from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


class ReceiptCreate(BaseModel):
    os_id: Optional[str] = None
    client_id: str
    payer_name: str
    amount: Decimal
    reference: str
    payment_method: str
    receipt_date: date


class ReceiptResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    number: int
    os_id: Optional[str]
    client_id: str
    payer_name: str
    amount: Decimal
    amount_words: str
    reference: str
    payment_method: str
    receipt_date: date
    created_at: Optional[datetime] = None
