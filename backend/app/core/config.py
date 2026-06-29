from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    app_env: str = "development"
    secret_key: str = "dev-secret"
    allowed_origins: str = "http://localhost:5173"
    integration_mode_default: str = "simulated"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
