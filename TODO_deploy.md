# Stock Simulator Deployment Guide

## Prerequisites
- GitHub account
- Netlify account
- Railway.app account

## 1. GitHub Repo
```
git init
git add .
git commit -m "Deploy ready"
git branch -M main
git remote add origin https://github.com/tusharchugh09022004-blip/stock-simulator.git
git push -u origin main
```

## 2. Netlify (Client Frontend)
1. netlify.com → New site from Git
2. Connect GitHub repo `stock-simulator`
3. Root dir: `/client`
4. Build command: `npm run build`
5. Publish dir: `dist`
6. Deploy → https://*.netlify.app

## 3. Railway (Server Backend - SQLite)
1. railway.app → New Project → Deploy from GitHub `stock-simulator`
2. Root dir: `/server`
3. Build: `npm install`
4. Start: `node fixed_server.js`
5. Note API URL: https://*.railway.app

## 4. Connect Frontend to Backend
Update client vite.config.js:
```
server: {
  proxy: {
    '/api': 'https://your-railway-server.up.railway.app'
  }
}
```
Redeploy Netlify.

## 5. Test
- Login at Netlify URL
- SQLite login_history logs activity (view in Railway metrics/logs)

**Live URLs after deploy:**
Frontend: Netlify
Backend: Railway
Login tracking: ✅ SQLite `login_history` table
