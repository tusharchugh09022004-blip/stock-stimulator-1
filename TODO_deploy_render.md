# Render Deployment Steps

## Backend API (Web Service)
1. render.com → New Web Service → Connect GitHub repo
2. Auto-detects render.yaml → Deploys `stock-simulator/server/fixed_server.js`
3. Note API URL: `https://your-app.onrender.com`
4. Add env var: `JWT_SECRET` (generate)

## Frontend (Static Site)  
1. New Static Site → Connect same repo
2. Root: `/stock-simulator/client`
3. Build: `npm install && npm run build`
4. Publish: `dist`
5. Update proxy in `vite.config.js` → Render API URL → redeploy

## Test
- Frontend URL → login/register
- API calls work via proxy
- Socket.io realtime updates

**Note:** Uses SQLite (file-based DB) - data resets on restarts (free tier).
