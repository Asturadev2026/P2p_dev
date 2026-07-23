import socket
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from app.core.config import get_settings

settings = get_settings()

# This environment's IPv6 route is unreachable while IPv4 works fine, and asyncpg/asyncio
# resolve Neon's hostname to IPv6 first — every new connection attempt hangs on the dead
# route before ever trying the working IPv4 address. Forcing IPv4-only resolution here
# unblocks connection attempts app-wide (hostname/SNI is unaffected, so TLS still verifies).
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if family == 0:
        family = socket.AF_INET
    return _orig_getaddrinfo(host, port, family, type, proto, flags)


socket.getaddrinfo = _ipv4_only_getaddrinfo

engine = create_async_engine(
    settings.database_url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    echo=False,
    # Neon's pooled endpoint (-pooler) is a PgBouncer transaction pooler, which is
    # incompatible with asyncpg's server-side prepared-statement cache — any schema
    # change (e.g. an ALTER TABLE) invalidates cached plans on pooled backends and
    # every subsequent query on that statement text fails with InvalidCachedStatementError.
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def fetch_all(db: AsyncSession, sql: str, params: dict | None = None) -> list[dict]:
    result = await db.execute(text(sql), params or {})
    return [dict(r._mapping) for r in result.fetchall()]


async def fetch_one(db: AsyncSession, sql: str, params: dict | None = None) -> dict | None:
    result = await db.execute(text(sql), params or {})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def execute(db: AsyncSession, sql: str, params: dict | None = None):
    return await db.execute(text(sql), params or {})
