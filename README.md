# GripForge Dashboard

A modern, responsive dashboard for the GripForge smart grip dynamometer. Built with Vite + React + TypeScript and Tailwind CSS, optimized for offline use on an ESP32 (LittleFS). Works in iPhone Safari and avoids Web Bluetooth entirely.

## Quick Start

```bash
npm install
```

### Run locally (laptop)

```bash
npm run dev
```

The dev server runs at `http://localhost:5173` and proxies requests directly to `/api/*` on the same origin. In production, the ESP32 will serve the static files directly at `http://192.168.4.1`.

### Build static assets

```bash
npm run build
```

The build output lands in `dist/` and is ready to be copied to the ESP32 filesystem.

## ESP32 LittleFS Upload Instructions

1. Build the project:
   ```bash
   npm run build
   ```
2. Create (or open) your Arduino sketch folder and add a `data/` directory next to your `.ino` file.
3. Copy **all contents** of the `dist/` folder into the Arduino `data/` folder.
4. Use the **Arduino ESP32 LittleFS Upload** tool to upload the `data/` folder to the ESP32.
5. Ensure your ESP32 sketch serves LittleFS at `http://192.168.4.1`.

## Device API Contract

The frontend supports two data transport options:

### A) Polling (required)
- `GET /api/force`
  ```json
  {
    "force": 32.5,
    "units": "kg",
    "timestamp_ms": 1730000000000,
    "battery_v": 4.05,
    "is_connected": true
  }
  ```
- `GET /api/session/latest` (optional)
- `POST /api/session/start` (optional)
- `POST /api/session/stop` (optional)

### B) WebSocket (optional)
- `ws://<host>/ws`
  ```json
  { "force": 32.5, "units": "kg", "timestamp_ms": 1730000000000 }
  ```

The app tries WebSocket first; if it fails, it falls back to polling every 150ms.

## Demo Mode

If the API is not available, Demo Mode auto-enables to generate realistic force data. You can also toggle Demo Mode manually in the UI.

## Project Structure

```
public/
  gripforge-icon.svg
src/
  App.tsx
  index.css
  main.tsx
  utils/
    storage.ts
    types.ts
```

## Notes
- Offline-first: no Web Bluetooth; Wi-Fi only.
- Optimized for ESP32 LittleFS hosting (small dependencies, static build).
