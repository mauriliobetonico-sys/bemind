from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.core.database import get_db
from app.core.security import get_current_active_user, require_admin
from app.models.product import Product, ConfigList
from app.schemas.product import (
    ProductCreate, ProductUpdate, ProductResponse,
    ConfigListCreate, ConfigListResponse
)

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=List[ProductResponse])
def list_products(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(Product)
    if active_only:
        q = q.filter(Product.is_active == True)
    return q.all()


@router.post("", response_model=ProductResponse, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    product = Product(**body.model_dump(), id=uuid.uuid4())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_active_user)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return product


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(product_id: uuid.UUID, body: ProductUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(product, k, v)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    product.is_active = False
    db.commit()


# Config list routes
@router.get("/config/list", response_model=List[ConfigListResponse])
def list_configs(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_active_user),
):
    q = db.query(ConfigList).filter(ConfigList.is_active == True)
    if category:
        q = q.filter(ConfigList.category == category)
    return q.all()


@router.post("/config/list", response_model=ConfigListResponse, status_code=201)
def create_config(body: ConfigListCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    config = ConfigList(**body.model_dump(), id=uuid.uuid4())
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/config/list/{config_id}", status_code=204)
def delete_config(config_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(require_admin)):
    config = db.query(ConfigList).filter(ConfigList.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    config.is_active = False
    db.commit()
