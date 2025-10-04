# Chat Project (Full)

This project implements the full requirements for the interview task.

Frontend:
- Vite + React 19 + Tailwind
- Features: recent conversations fetch, SSE streaming, attachments upload, theme toggle, command palette, keyboard shortcuts, copy/retry, persisted scroll.

Backend:
- Express endpoints: POST /api/chat, GET /api/conversations, GET /api/conversations/:id, POST /api/conversations/:id/title, POST /api/upload
- SSE streaming at /api/chat/sse (mocked streaming tokens)
- Upload supports .txt and .pdf (uses pdf-parse)

How to run:
1. Install Node.js (>=18)
2. Backend:
   cd backend
   npm install
   node index.js
3. Frontend:
   cd frontend
   npm install
   npm run dev

Open the frontend URL shown by Vite (default http://localhost:5173).
