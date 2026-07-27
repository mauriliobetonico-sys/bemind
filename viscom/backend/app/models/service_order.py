import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Numeric, Text, Enum, ForeignKey, Integer, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ServiceOrder(Base):
    __tablename__ = "service_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    quote_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("quotes.id"), nullable=True)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"), nullable=False, index=True)
    created_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("aberta", "em_producao", "pronta", "instalada", "finalizada", name="os_status"),
        nullable=False, default="aberta"
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    production_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    payment_method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payment_conditions: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    client = relationship("Client", foreign_keys=[client_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    items = relationship("ServiceOrderItem", back_populates="service_order", cascade="all, delete-orphan")
    status_history = relationship("StatusHistory", back_populates="service_order", order_by="StatusHistory.changed_at")


class ServiceOrderItem(Base):
    __tablename__ = "service_order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    os_id: Mapped[str] = mapped_column(String(36), ForeignKey("service_orders.id"), nullable=False, index=True)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id"), nullable=True)
    material_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    installation_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    finishing: Mapped[str | None] = mapped_column(String(100), nullable=True)
    width_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    height_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    area_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    service_order = relationship("ServiceOrder", back_populates="items")
    product = relationship("Product")


class StatusHistory(Base):
    __tablename__ = "status_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    os_id: Mapped[str] = mapped_column(String(36), ForeignKey("service_orders.id"), nullable=False, index=True)
    old_status: Mapped[str] = mapped_column(String(30), nullable=True)
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    changed_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    service_order = relationship("ServiceOrder", back_populates="status_history")
    changed_by = relationship("User", foreign_keys=[changed_by_id])
