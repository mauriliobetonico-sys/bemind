from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import shutil
import uuid
import os

from app.core.database import get_db
from app.core.security import get_current_active_user, require_admin
from app.models.company import Company

router = APIRouter(prefix="/company", tags=["company"])

LOGO_DIR = "/app/media"


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    cnpj: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@router.get("")
def get_company(db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    company = db.query(Company).first()
    if not company:
        return {"id": None, "name": "", "cnpj": "", "address": "", "phone": "", "email": "", "logo_path": None, "has_logo": False}
    return {
        "id": company.id,
        "name": company.name or "",
        "cnpj": company.cnpj or "",
        "address": company.address or "",
        "phone": company.phone or "",
        "email": company.email or "",
        "logo_path": company.logo_path,
        "has_logo": bool(company.logo_path and os.path.exists(company.logo_path)),
    }


@router.put("")
def update_company(body: CompanyUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    company = db.query(Company).first()
    if not company:
        company = Company(id=str(uuid.uuid4()), name=body.name or "", cnpj=body.cnpj or "")
        db.add(company)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(company, k, v)
    db.commit()
    db.refresh(company)
    return {
        "id": company.id,
        "name": company.name or "",
        "cnpj": company.cnpj or "",
        "address": company.address or "",
        "phone": company.phone or "",
        "email": company.email or "",
        "has_logo": bool(company.logo_path and os.path.exists(company.logo_path)),
    }


@router.post("/logo")
def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_db), _=Depends(require_admin)):
    os.makedirs(LOGO_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "logo.png")[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        ext = ".png"
    filepath = os.path.join(LOGO_DIR, f"logo{ext}")
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    company = db.query(Company).first()
    if not company:
        company = Company(id=str(uuid.uuid4()), name="", cnpj="")
        db.add(company)
    company.logo_path = filepath
    db.commit()
    return {"logo_path": filepath, "has_logo": True}


@router.get("/logo")
def get_logo(db: Session = Depends(get_db)):
    company = db.query(Company).first()
    if not company or not company.logo_path or not os.path.exists(company.logo_path):
        raise HTTPException(status_code=404, detail="Logo não encontrado")
    return FileResponse(company.logo_path)
