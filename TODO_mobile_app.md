# Mobile App (Expo) — QR/Loading Fix Checklist

## Current status
- The Expo mobile project in `stock-simulator/mobile-app/` is running.
- `mobile-app/App.js` is still the default Expo starter placeholder.
- Repo currently has no QR/deep-link/scan handling implemented in the mobile app.

## Steps to implement next
1. Replace `stock-simulator/mobile-app/App.js` with real navigation + placeholder home UI.
2. Add Expo QR scan / deep-link handling (e.g., via `expo-barcode-scanner` or linking-based flow).
3. Wire QR payload to correct backend endpoints (avoid `localhost` on mobile; use PC IP or deployed API).
4. Add robust loading states: stop spinners on success/error and show errors.

## Key files
- `stock-simulator/mobile-app/App.js`
- `stock-simulator/mobile-app/app.json`
- `stock-simulator/server/server.js`
- `stock-simulator/client/src/App.jsx`

