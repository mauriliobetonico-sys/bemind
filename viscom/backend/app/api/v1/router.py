from fastapi import APIRouter
from app.api.v1.routes import auth, users, clients, products, quotes, service_orders, financial, receipts, reports, company, dashboard, pdf, config

api_router = APIRouter(prefix="/v1")

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(clients.router)
api_router.include_router(products.router)
api_router.include_router(config.router)
api_router.include_router(quotes.router)
api_router.include_router(service_orders.router)
api_router.include_router(financial.router)
api_router.include_router(receipts.router)
api_router.include_router(reports.router)
api_router.include_router(company.router)
api_router.include_router(dashboard.router)
api_router.include_router(pdf.router)
