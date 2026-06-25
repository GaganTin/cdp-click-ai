# Meritma (Node.js Local App)

This app is fully decoupled from vendor-managed SDK/runtime and runs locally with:
- React + Vite frontend
- Node.js + Express backend
- Postgres read access (for analytics queries)
- Local JSON persistence for app entities and conversations

## Prerequisites
- Node.js 18+
- npm
- Optional: `POSTGRESQL_CONN` in `.env` for SQL query features

## Environment
Create `.env` in project root:

```env
POSTGRESQL_CONN=postgresql://user:pass@host/db?sslmode=require
PORT=3001
```

## Install
```bash
npm install
```

## Run locally
```bash
npm run dev
```

This starts:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

## Build
```bash
npm run build
npm run start
```

## Notes
- Entity data is persisted in `server/data/store.json`.
- Uploaded files are stored in `server/uploads/`.
- SQL endpoint allows **SELECT-only** queries.
