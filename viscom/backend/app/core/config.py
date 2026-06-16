from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://viscom:viscom_secret@localhost:5432/viscom"
    SECRET_KEY: str = "dev_secret_key_change_in_production_32bytes"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    COMPANY_NAME: str = "VisCom Comunicação Visual"
    COMPANY_CNPJ: str = "00.000.000/0001-00"
    COMPANY_ADDRESS: str = "Rua Exemplo, 100 - Centro - São Paulo/SP"
    COMPANY_PHONE: str = "(11) 99999-9999"
    COMPANY_EMAIL: str = "contato@viscom.com.br"
    LOGO_PATH: str = "/app/static/logo.png"
    CORS_ORIGINS: str = "http://localhost,http://localhost:80,http://localhost:5173"


settings = Settings()
