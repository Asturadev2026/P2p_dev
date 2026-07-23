"""Run once: applies migrations/015_treds_bidding.sql to Neon."""
import asyncio
import os
from pathlib import Path
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
SQL = (Path(__file__).parent / "migrations" / "015_treds_bidding.sql").read_text(encoding="utf-8")


async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute(SQL)
        print("OK: migration 015 applied")
    finally:
        await conn.close()

asyncio.run(main())
