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
    import uuid
    Base.metadata.create_all(bind=engine)
    # Ensure at least one admin user exists
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.role == "admin").first():
            db.add(User(
                id=str(uuid.uuid4()),
                name="Administrador",
                email="admin@viscom.com",
                hashed_password=hash_password("admin123"),
                role="admin",
            ))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
