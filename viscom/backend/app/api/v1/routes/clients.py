from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import httpx

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models.client import Client
from app.schemas.client import ClientCreate, ClientUpdate, ClientResponse

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("/", response_model=List[ClientResponse])
def list_clients(
    search: Optional[str] = None,
    is_reseller: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    q = db.query(Client).filter(Client.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Client.created_by_id == current_user.id)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            Client.name.ilike(pattern) |
            Client.cpf_cnpj.ilike(pattern) |
            Client.email.ilike(pattern)
        )
    if is_reseller is not None:
        q = q.filter(Client.is_reseller == is_reseller)
    return q.offset(skip).limit(limit).all()


@router.post("/", response_model=ClientResponse, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    client = Client(**body.model_dump(), id=uuid.uuid4(), created_by_id=current_user.id)
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.get("/cep/{cep}")
def lookup_cep(cep: str, _=Depends(get_current_active_user)):
    cep_digits = cep.replace("-", "")
    if len(cep_digits) != 8:
        raise HTTPException(status_code=400, detail="CEP inválido")
    try:
        resp = httpx.get(f"https://viacep.com.br/ws/{cep_digits}/json/", timeout=5)
        data = resp.json()
        if "erro" in data:
            raise HTTPException(status_code=404, detail="CEP não encontrado")
        return {
            "cep": data.get("cep"),
            "logradouro": data.get("logradouro"),
            "bairro": data.get("bairro"),
            "cidade": data.get("localidade"),
            "uf": data.get("uf"),
        }
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Serviço ViaCEP indisponível")


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(client_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Client).filter(Client.id == client_id, Client.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Client.created_by_id == current_user.id)
    client = q.first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return client


@router.put("/{client_id}", response_model=ClientResponse)
def update_client(client_id: uuid.UUID, body: ClientUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Client).filter(Client.id == client_id, Client.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Client.created_by_id == current_user.id)
    client = q.first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(client, k, v)
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=204)
def delete_client(client_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(get_current_active_user)):
    q = db.query(Client).filter(Client.id == client_id, Client.is_deleted == False)
    if current_user.role == "vendedor":
        q = q.filter(Client.created_by_id == current_user.id)
    client = q.first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    client.is_deleted = True
    db.commit()
