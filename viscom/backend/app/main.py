import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="VisCom API",
    description="Sistema de Gestão para Comunicação Visual",
    version="1.0.0",
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def strip_trailing_slash(request, call_next):
    if request.url.path.endswith("/") and request.url.path != "/":
        from starlette.datastructures import URL
        scope = dict(request.scope)
        scope["path"] = request.url.path.rstrip("/")
        from starlette.requests import Request as StarletteRequest
        request = StarletteRequest(scope, request.receive, request._send)
    return await call_next(request)

app.include_router(api_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}", "trace": tb})


@app.on_event("startup")
def startup_event():
    from app.core.database import engine, SessionLocal
    from app.models import User, Company, Client, Product, ConfigList, Quote, QuoteItem
    from app.models import ServiceOrder, ServiceOrderItem, StatusHistory, Receivable, Payment, CashFlow, Receipt
    from app.core.database import Base
    from app.core.security import hash_password
    from sqlalchemy import text
    Base.metadata.create_all(bind=engine)

    # Safe column migrations — add missing columns without dropping data
    _migrations = [
        # company columns
        "ALTER TABLE company ADD COLUMN IF NOT EXISTS logo_path VARCHAR(500)",
        "ALTER TABLE company ADD COLUMN IF NOT EXISTS address VARCHAR(500)",
        "ALTER TABLE company ADD COLUMN IF NOT EXISTS phone VARCHAR(30)",
        "ALTER TABLE company ADD COLUMN IF NOT EXISTS email VARCHAR(200)",
        # clients columns
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by_id VARCHAR(36)",
        # quotes columns
        "ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        # service_orders columns
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS payment_conditions VARCHAR(200)",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS installation_notes TEXT",
        "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS production_notes TEXT",
        # service_order_items columns
        "ALTER TABLE service_order_items ADD COLUMN IF NOT EXISTS material_type VARCHAR(100)",
        "ALTER TABLE service_order_items ADD COLUMN IF NOT EXISTS installation_type VARCHAR(100)",
        "ALTER TABLE service_order_items ADD COLUMN IF NOT EXISTS finishing VARCHAR(100)",
        "ALTER TABLE service_order_items ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(10,4)",
        # receivables columns
        "ALTER TABLE receivables ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(5,2) DEFAULT 0",
        "ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fine_rate NUMERIC(5,2) DEFAULT 0",
    ]
    with engine.begin() as conn:
        for sql in _migrations:
            try:
                conn.execute(text(sql))
            except Exception:
                pass

    # Ensure at least one admin user exists
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.role == "admin").first():
            db.add(User(
                id="00000000-0000-0000-0000-000000000001",
                name="Administrador",
                email="admin@viscom.com",
                hashed_password=hash_password("admin123"),
                role="admin",
                is_active=True,
            ))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

    # Seed default config values if table is empty
    db = SessionLocal()
    try:
        from app.models.product import ConfigList
        import uuid as _uuid
        if not db.query(ConfigList).first():
            defaults = [
                ("material_type", "Lona"),
                ("material_type", "Adesivo Vinil"),
                ("material_type", "Adesivo Perfurado"),
                ("material_type", "Papel Fotográfico"),
                ("material_type", "Canvas"),
                ("material_type", "Backlight"),
                ("material_type", "Frontlight"),
                ("material_type", "Banner"),
                ("installation_type", "Com instalação"),
                ("installation_type", "Sem instalação"),
                ("installation_type", "Instalação externa"),
                ("installation_type", "Instalação interna"),
                ("finishing", "Ilhós"),
                ("finishing", "Moldura"),
                ("finishing", "Bastidor"),
                ("finishing", "Dobra e cola"),
                ("finishing", "Laminação fosca"),
                ("finishing", "Laminação brilho"),
                ("finishing", "Sem acabamento"),
                ("payment_method", "Dinheiro"),
                ("payment_method", "PIX"),
                ("payment_method", "Cartão de Crédito"),
                ("payment_method", "Cartão de Débito"),
                ("payment_method", "Boleto"),
                ("payment_method", "Transferência Bancária"),
            ]
            for cat, val in defaults:
                db.add(ConfigList(id=str(_uuid.uuid4()), category=cat, value=val, is_active=True))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
