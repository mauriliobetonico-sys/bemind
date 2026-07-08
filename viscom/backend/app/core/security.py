from datetime import datetime, timezone
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password[:72])


# alias for compatibility
get_password_hash = hash_password


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain[:72], hashed)


def _encode(data: dict) -> str:
    from datetime import timedelta
    to_encode = data.copy()
    expire_delta = timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        if data.get("type") == "access"
        else settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60
    )
    to_encode["exp"] = datetime.now(timezone.utc) + expire_delta
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(data: dict) -> str:
    return _encode({**data, "type": "access"})


def create_refresh_token(data: dict) -> str:
    return _encode({**data, "type": "refresh"})


def verify_token(token: str, token_type: str = "access") -> dict | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != token_type:
            return None
        return payload
    except JWTError:
        return None


class _MockAdmin:
    """Fallback user when auth is disabled and no DB user exists."""
    id = "00000000-0000-0000-0000-000000000001"
    name = "Administrador"
    email = "admin@viscom.com"
    role = "admin"
    is_active = True


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from app.models.user import User
    if token:
        payload = verify_token(token, "access")
        if payload:
            user_id: str = payload.get("sub")
            user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
            if user:
                return user
    # Auth disabled: return first admin from DB, or mock admin
    user = db.query(User).filter(User.role == "admin", User.is_active == True).first()
    return user or _MockAdmin()


# alias used by some routes
get_current_active_user = get_current_user


def require_admin(current_user=Depends(get_current_user)):
    return current_user
