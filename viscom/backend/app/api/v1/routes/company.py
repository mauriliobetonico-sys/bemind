from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    cnpj: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@router.get("/")
def get_company(db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    company = db.query(Company).first()
    if not company:
        raise HTTPException(status_code=404, detail="Configurações da empresa não encontradas")
    return company


@router.put("/")
def update_company(body: CompanyUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    company = db.query(Company).first()
    if not company:
        company = Company(id=uuid.uuid4())
        db.add(company)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(company, k, v)
    db.commit()
    db.refresh(company)
    return company


@router.post("/logo")
def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_db), _=Depends(require_admin)):
    upload_dir = "uploads/logos"
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    filename = f"logo{ext}"
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    company = db.query(Company).first()
    if not company:
        company = Company(id=uuid.uuid4())
        db.add(company)
    company.logo_path = filepath
    db.commit()
    return {"logo_path": filepath}
