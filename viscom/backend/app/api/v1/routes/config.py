from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.product import ConfigList
from app.schemas.product import ConfigListCreate, ConfigListUpdate, ConfigListResponse

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=List[ConfigListResponse])
def list_config(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(ConfigList).filter(ConfigList.is_active == True)
    if category:
        q = q.filter(ConfigList.category == category)
    return q.order_by(ConfigList.value).all()


@router.post("", response_model=ConfigListResponse, status_code=201)
def create_config(body: ConfigListCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = ConfigList(id=str(uuid.uuid4()), **body.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{config_id}", response_model=ConfigListResponse)
def update_config(config_id: str, body: ConfigListUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = db.query(ConfigList).filter(ConfigList.id == config_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{config_id}", status_code=204)
def delete_config(config_id: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = db.query(ConfigList).filter(ConfigList.id == config_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    item.is_active = False
    db.commit()
