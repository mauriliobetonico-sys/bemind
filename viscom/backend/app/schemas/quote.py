from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, model_validator
from app.schemas.client import ClientResponse
from app.schemas.user import UserResponse
from app.schemas.product import ProductResponse


class QuoteItemCreate(BaseModel):
    product_id: str
    material_type: Optional[str] = None
    installation_type: Optional[str] = None
    finishing: Optional[str] = None
    width_m: Optional[Decimal] = None
    height_m: Optional[Decimal] = None
    quantity: int = 1
    unit_price: Decimal
    discount_pct: Decimal = Decimal("0")

    @model_validator(mode="after")
    def compute_area(self):
        if self.width_m and self.height_m:
            self.area_m2 = (self.width_m * self.height_m).quantize(Decimal("0.0001"))
        else:
            self.area_m2 = None
        self.subtotal = (self.unit_price * self.quantity * (1 - self.discount_pct / 100)).quantize(Decimal("0.01"))
        return self

    area_m2: Optional[Decimal] = None
    subtotal: Optional[Decimal] = None


class QuoteItemResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    product_id: str
    product: Optional[ProductResponse] = None
    material_type: Optional[str] = None
    installation_type: Optional[str] = None
    finishing: Optional[str] = None
    width_m: Optional[Decimal]
    height_m: Optional[Decimal]
    area_m2: Optional[Decimal]
    quantity: int
    unit_price: Decimal
    discount_pct: Decimal
    subtotal: Decimal


class QuoteCreate(BaseModel):
    client_id: str
    valid_until: Optional[date] = None
    installation_deadline: Optional[date] = None
    discount_general: Decimal = Decimal("0")
    notes: Optional[str] = None
    status: str = "aberto"
    items: List[QuoteItemCreate]


class QuoteUpdate(BaseModel):
    client_id: Optional[str] = None
    valid_until: Optional[date] = None
    installation_deadline: Optional[date] = None
    discount_general: Optional[Decimal] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    items: Optional[List[QuoteItemCreate]] = None


class QuoteResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    number: int
    client_id: str
    client: Optional[ClientResponse] = None
    created_by_id: str
    created_by: Optional[UserResponse] = None
    status: str
    valid_until: Optional[date]
    installation_deadline: Optional[date] = None
    discount_general: Decimal
    notes: Optional[str]
    items: List[QuoteItemResponse] = []
    is_deleted: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def total(self) -> Decimal:
        sub = sum(i.subtotal for i in self.items)
        return (sub * (1 - self.discount_general / 100)).quantize(Decimal("0.01"))
