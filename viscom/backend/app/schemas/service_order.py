from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, model_validator
from app.schemas.client import ClientResponse
from app.schemas.user import UserResponse
from app.schemas.product import ProductResponse


class ServiceOrderItemCreate(BaseModel):
    product_id: str
    material_type: Optional[str] = None
    installation_type: Optional[str] = None
    finishing: Optional[str] = None
    width_m: Optional[Decimal] = None
    height_m: Optional[Decimal] = None
    quantity: int = 1
    unit_price: Decimal

    @model_validator(mode="after")
    def compute(self):
        if self.width_m and self.height_m:
            self.area_m2 = (self.width_m * self.height_m).quantize(Decimal("0.0001"))
        else:
            self.area_m2 = None
        self.subtotal = (self.unit_price * self.quantity).quantize(Decimal("0.01"))
        return self

    area_m2: Optional[Decimal] = None
    subtotal: Optional[Decimal] = None


class ServiceOrderItemResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    product_id: str
    product: Optional[ProductResponse] = None
    material_type: Optional[str]
    installation_type: Optional[str]
    finishing: Optional[str]
    width_m: Optional[Decimal]
    height_m: Optional[Decimal]
    area_m2: Optional[Decimal]
    quantity: int
    unit_price: Decimal
    subtotal: Decimal


class StatusHistoryResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    old_status: Optional[str]
    new_status: str
    changed_by: Optional[UserResponse] = None
    changed_at: datetime
    notes: Optional[str]


class ServiceOrderCreate(BaseModel):
    client_id: str
    quote_id: Optional[str] = None
    deadline: Optional[date] = None
    production_notes: Optional[str] = None
    installation_notes: Optional[str] = None
    payment_method: Optional[str] = None
    payment_conditions: Optional[str] = None
    items: List[ServiceOrderItemCreate]


class ServiceOrderUpdate(BaseModel):
    client_id: Optional[str] = None
    deadline: Optional[date] = None
    production_notes: Optional[str] = None
    installation_notes: Optional[str] = None
    payment_method: Optional[str] = None
    payment_conditions: Optional[str] = None
    items: Optional[List[ServiceOrderItemCreate]] = None


class StatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class ServiceOrderResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    number: int
    quote_id: Optional[str]
    client_id: str
    client: Optional[ClientResponse] = None
    created_by_id: str
    created_by: Optional[UserResponse] = None
    status: str
    opened_at: Optional[datetime] = None
    deadline: Optional[date]
    production_notes: Optional[str]
    installation_notes: Optional[str]
    total_value: Decimal
    payment_method: Optional[str]
    payment_conditions: Optional[str]
    items: List[ServiceOrderItemResponse] = []
    status_history: List[StatusHistoryResponse] = []
    is_deleted: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
