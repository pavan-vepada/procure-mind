"""All configuration comes from .env (see .env.example)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    app_password: str = "change-me"
    data_dir: str = "data"  # one SQLite file per RFx lives in <data_dir>/events
    fx_usd_inr: float = 88.0


settings = Settings()
