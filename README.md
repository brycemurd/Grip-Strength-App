# GripForge Dashboard

A modern, colorful, responsive dashboard for the GripForge smart grip dynamometer. Built with Vite + React + TypeScript and Tailwind CSS for a Base44-style experience with gradients, rounded cards, and polished micro-interactions. Optimized for offline ESP32 hosting with an optional Web Bluetooth connection path.

## Quick Start

```bash
npm install
```

### Run locally

```bash
npm run dev
```

The dev server runs at `http://localhost:5173` and connects to `/api/*` on the same origin.

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

## Bluetooth Connection (Primary)

The dashboard now uses Bluetooth mode as the main connection flow.

### Bluetooth Mode
- Uses the Web Bluetooth API.
- Supported in **Desktop Chrome** and **Bluefy on iOS**.
- **Not supported in normal iPhone Safari or Chrome**.
- **Web Bluetooth requires a secure context** (`https://` or `http://localhost`).
- Click **Search for GripForge** or **Search & Connect Bluetooth** in the UI to open the device picker.

**BLE Details**
- Device name: `GripForge`
- Service UUID: `0b1b403e-1e94-4048-8468-2c6140047310`
- Characteristic UUID (Notify + Read): `6e31cb61-0acf-4001-acb3-abac9a94211d`
- Payload: ASCII numeric string like `"12.3"` (lbf), sent via notify ~5Hz

These UUIDs and the device name are defined in `src/lib/bleConstants.ts` and are already aligned with your ESP32 Arduino sketch values.

## Project Structure

```
public/
src/
  App.tsx
  index.css
  main.tsx
  hooks/
    useForceStream.ts
  lib/
    bleConstants.ts
    dataSource.ts
  utils/
    storage.ts
    types.ts
```

## Notes
- Built for static hosting on ESP32 LittleFS.
- Keep bundles light and dependencies minimal.
- Profiles support optional passwords, friends, and a local leaderboard.
