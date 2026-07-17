import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Numeric, Text, Enum, ForeignKey, Integer, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Quote(Base):
    __tablename__ = "quotes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"), nullable=False, index=True)
    created_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("aberto", "aprovado", "recusado", "expirado", name="quote_status"),
        nullable=False, default="aberto"
    )
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    installation_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    discount_general: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    client = relationship("Client", foreign_keys=[client_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    items = relationship("QuoteItem", back_populates="quote", cascade="all, delete-orphan")


class QuoteItem(Base):
    __tablename__ = "quote_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    quote_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotes.id"), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id"), nullable=False)
    width_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    height_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    area_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    quote = relationship("Quote", back_populates="items")
    product = relationship("Product")
