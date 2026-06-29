from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import router as api_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="AstonomiQ Procure-to-Pay",
    description="Intelezen Microfin Limited · AP Automation & Invoice Discounting · AstonomiQ product suite",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok", "product": "AstonomiQ P2P", "version": "1.0.0"}
