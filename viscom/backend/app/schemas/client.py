from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, field_validator


def _validate_cpf(cpf: str) -> bool:
    digits = "".join(c for c in cpf if c.isdigit())
    if len(digits) != 11 or len(set(digits)) == 1:
        return False
    s = sum(int(digits[i]) * (10 - i) for i in range(9))
    d1 = 0 if (11 - s % 11) >= 10 else (11 - s % 11)
    if d1 != int(digits[9]):
        return False
    s = sum(int(digits[i]) * (11 - i) for i in range(10))
    d2 = 0 if (11 - s % 11) >= 10 else (11 - s % 11)
    return d2 == int(digits[10])


def _validate_cnpj(cnpj: str) -> bool:
    digits = "".join(c for c in cnpj if c.isdigit())
    if len(digits) != 14 or len(set(digits)) == 1:
        return False
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s = sum(int(digits[i]) * w1[i] for i in range(12))
    d1 = 0 if s % 11 < 2 else 11 - s % 11
    if d1 != int(digits[12]):
        return False
    w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s = sum(int(digits[i]) * w2[i] for i in range(13))
    d2 = 0 if s % 11 < 2 else 11 - s % 11
    return d2 == int(digits[13])


class ClientBase(BaseModel):
    name: str
    person_type: str
    cpf_cnpj: str
    ie: Optional[str] = None
    phone: str
    email: Optional[str] = None
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    observations: Optional[str] = None
    is_reseller: bool = False
    reseller_discount_pct: Optional[Decimal] = None

    @field_validator("person_type")
    @classmethod
    def validate_person_type(cls, v: str) -> str:
        if v not in ("PF", "PJ"):
            raise ValueError("Tipo de pessoa inválido. Use 'PF' ou 'PJ'")
        return v

    @field_validator("cpf_cnpj")
    @classmethod
    def validate_cpf_cnpj(cls, v: str) -> str:
        digits = "".join(c for c in v if c.isdigit())
        if len(digits) == 11:
            if not _validate_cpf(v):
                raise ValueError("CPF inválido")
        elif len(digits) == 14:
            if not _validate_cnpj(v):
                raise ValueError("CNPJ inválido")
        else:
            raise ValueError("CPF deve ter 11 dígitos e CNPJ 14 dígitos")
        return v


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    person_type: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    ie: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    observations: Optional[str] = None
    is_reseller: Optional[bool] = None
    reseller_discount_pct: Optional[Decimal] = None


class ClientResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    person_type: str
    cpf_cnpj: str
    ie: Optional[str]
    phone: str
    email: Optional[str]
    cep: Optional[str]
    logradouro: Optional[str]
    numero: Optional[str]
    bairro: Optional[str]
    cidade: Optional[str]
    uf: Optional[str]
    observations: Optional[str]
    is_reseller: bool
    reseller_discount_pct: Optional[Decimal]
    is_deleted: bool
    created_at: datetime
