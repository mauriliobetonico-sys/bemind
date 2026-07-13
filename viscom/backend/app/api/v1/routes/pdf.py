from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
import uuid

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.services.pdf_service import generate_quote_pdf, generate_os_pdf, generate_receipt_pdf

router = APIRouter(prefix="/pdf", tags=["pdf"])


@router.get("/quote/{quote_id}")
def download_quote_pdf(quote_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    content = generate_quote_pdf(str(quote_id), db)
    if not content:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=orcamento-{quote_id}.pdf"})


@router.get("/service-order/{os_id}")
def download_os_pdf(os_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    content = generate_os_pdf(str(os_id), db)
    if not content:
        raise HTTPException(status_code=404, detail="OS não encontrada")
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=os-{os_id}.pdf"})


@router.get("/receipt/{receipt_id}")
def download_receipt_pdf(receipt_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    content = generate_receipt_pdf(str(receipt_id), db)
    if not content:
        raise HTTPException(status_code=404, detail="Recibo não encontrado")
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=recibo-{receipt_id}.pdf"})
