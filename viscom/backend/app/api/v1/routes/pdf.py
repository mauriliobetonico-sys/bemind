from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
import traceback

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.services.pdf_service import generate_quote_pdf, generate_os_pdf, generate_receipt_pdf

router = APIRouter(prefix="/pdf", tags=["pdf"])


@router.get("/quote/{quote_id}")
def download_quote_pdf(quote_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    try:
        content = generate_quote_pdf(quote_id, db)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": f"attachment; filename=orcamento-{quote_id}.pdf"})
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/service-order/{os_id}")
def download_os_pdf(os_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    try:
        content = generate_os_pdf(os_id, db)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": f"attachment; filename=os-{os_id}.pdf"})
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/receipt/{receipt_id}")
def download_receipt_pdf(receipt_id: str, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    try:
        content = generate_receipt_pdf(receipt_id, db)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": f"attachment; filename=recibo-{receipt_id}.pdf"})
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@router.get("/test")
def test_pdf(_=Depends(get_current_active_user)):
    """Diagnóstico — testa se WeasyPrint funciona."""
    try:
        from weasyprint import HTML
        content = HTML(string="<html><body><h1>Teste PDF OK</h1></body></html>").write_pdf()
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": "attachment; filename=teste.pdf"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WeasyPrint falhou: {type(e).__name__}: {e}")
