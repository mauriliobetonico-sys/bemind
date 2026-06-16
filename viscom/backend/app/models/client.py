import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Numeric, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    person_type: Mapped[str] = mapped_column(Enum("PF", "PJ", name="person_type"), nullable=False)
    cpf_cnpj: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    ie: Mapped[str | None] = mapped_column(String(30), nullable=True)
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cep: Mapped[str | None] = mapped_column(String(10), nullable=True)
    logradouro: Mapped[str | None] = mapped_column(String(200), nullable=True)
    numero: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bairro: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cidade: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uf: Mapped[str | None] = mapped_column(String(2), nullable=True)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_reseller: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reseller_discount_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
