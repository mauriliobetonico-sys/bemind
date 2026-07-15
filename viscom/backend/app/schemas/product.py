from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, field_validator


class ProductCreate(BaseModel):
    name: str
    unit: str
    price_client: Decimal
    price_reseller: Decimal
    is_active: bool = True

    @field_validator("unit")
    @classmethod
    def validate_unit(cls, v: str) -> str:
        if v not in ("m2", "unidade", "metro_linear"):
            raise ValueError("Unidade inválida")
        return v


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    price_client: Optional[Decimal] = None
    price_reseller: Optional[Decimal] = None
    is_active: Optional[bool] = None


class ProductResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    unit: str
    price_client: Decimal
    price_reseller: Decimal
    is_active: bool
    created_at: Optional[datetime] = None


class ConfigListCreate(BaseModel):
    category: str
    value: str
    is_active: bool = True

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        valid = ("material_type", "installation_type", "finishing", "payment_method")
        if v not in valid:
            raise ValueError(f"Categoria inválida. Use: {', '.join(valid)}")
        return v


class ConfigListUpdate(BaseModel):
    value: Optional[str] = None
    is_active: Optional[bool] = None


class ConfigListResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    category: str
    value: str
    is_active: bool
