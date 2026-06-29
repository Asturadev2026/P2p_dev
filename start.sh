#!/usr/bin/env bash
# AstonomiQ Procure-to-Pay · Intelezen Microfin — start backend (8002) + frontend (5175)
set -e
cd "$(dirname "$0")"

echo "▸ Backend → http://localhost:8002 (docs at /docs)"
(cd backend && ./.venv/bin/uvicorn main:app --port 8002 --reload &)

echo "▸ Frontend → http://localhost:5175"
(cd frontend && npm run dev &)

wait
