"""Run once: creates kyc_documents table in Neon."""
import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")

SQL = """
CREATE TABLE IF NOT EXISTS kyc_documents (
    id          TEXT PRIMARY KEY,
    onb_id      TEXT NOT NULL REFERENCES vendor_onboarding(id) ON DELETE CASCADE,
    doc_type    TEXT NOT NULL,
    filename    TEXT NOT NULL,
    mime_type   TEXT,
    file_size   INTEGER,
    file_data   BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_docs_onb_id  ON kyc_documents(onb_id);
CREATE INDEX IF NOT EXISTS idx_kyc_docs_doc_type ON kyc_documents(doc_type);
"""

async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute(SQL)
        print("OK: kyc_documents table ready")
    finally:
        await conn.close()

asyncio.run(main())
