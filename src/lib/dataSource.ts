import {
  GRIPFORGE_CHARACTERISTIC_UUID,
  GRIPFORGE_DEVICE_NAME,
  GRIPFORGE_SERVICE_UUID
} from "./bleConstants";
import { ForceSample, Units } from "../utils/types";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type ForceStreamHandlers = {
  onSample: (sample: ForceSample) => void;
  onStatus: (status: ConnectionStatus) => void;
  onError: (message: string) => void;
  onMeta?: (meta: { batteryVoltage?: number; isConnected?: boolean }) => void;
};

export type ForceSource = {
  connect: (handlers: ForceStreamHandlers) => Promise<() => void>;
  startSession?: () => Promise<void>;
  stopSession?: () => Promise<void>;
};

const getWsUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
};

export const createWifiSource = (): ForceSource => ({
  connect: async (handlers) => {
    handlers.onStatus("connecting");
    let active = true;
    let ws: WebSocket | null = null;
    let pollId: number | null = null;
    let connected = false;

    const cleanup = () => {
      active = false;
      if (ws) {
        ws.close();
      }
      if (pollId) {
        window.clearInterval(pollId);
      }
      handlers.onStatus("disconnected");
    };

    const handleSample = (sample: ForceSample) => {
      if (!connected) {
        connected = true;
        handlers.onStatus("connected");
      }
      handlers.onSample(sample);
    };

    const startPolling = () => {
      pollId = window.setInterval(async () => {
        try {
          const response = await fetch("/api/force", { cache: "no-store" });
          if (!response.ok) {
            throw new Error("Polling failed");
          }
          const data = (await response.json()) as {
            force: number;
            units: Units;
            timestamp_ms: number;
            battery_v?: number;
            is_connected?: boolean;
          };
          handlers.onMeta?.({
            batteryVoltage: data.battery_v,
            isConnected: data.is_connected
          });
          handleSample({
            force: data.force ?? 0,
            units: data.units ?? "kg",
            timestamp_ms: data.timestamp_ms ?? Date.now()
          });
        } catch (error) {
          if (!active) {
            return;
          }
          handlers.onError("Device not reachable — switch to Demo Mode");
          cleanup();
        }
      }, 150);
    };

    try {
      await new Promise<void>((resolve, reject) => {
        ws = new WebSocket(getWsUrl());
        const timer = window.setTimeout(() => {
          ws?.close();
          reject(new Error("WebSocket timeout"));
        }, 1500);
        ws.addEventListener("open", () => {
          window.clearTimeout(timer);
          resolve();
        });
        ws.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("WebSocket error"));
        });
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string) as {
            force: number;
            units: Units;
            timestamp_ms?: number;
          };
          handleSample({
            force: data.force ?? 0,
            units: data.units ?? "kg",
            timestamp_ms: data.timestamp_ms ?? Date.now()
          });
        } catch {
          // Ignore malformed data
        }
      });

      ws.addEventListener("close", () => {
        if (active) {
          handlers.onStatus("disconnected");
        }
      });

      return cleanup;
    } catch (error) {
      startPolling();
      return cleanup;
    }
  },
  startSession: async () => {
    await fetch("/api/session/start", { method: "POST" });
  },
  stopSession: async () => {
    await fetch("/api/session/stop", { method: "POST" });
  }
});

export const createBluetoothSource = (): ForceSource => ({
  connect: async (handlers) => {
    if (!("bluetooth" in navigator)) {
      throw new Error(
        "Bluetooth mode requires Desktop Chrome or Bluefy on iOS."
      );
    }

    handlers.onStatus("connecting");
    let active = true;
    let characteristic: BluetoothRemoteGATTCharacteristic | null = null;

    const cleanup = () => {
      active = false;
      if (characteristic) {
        characteristic.removeEventListener(
          "characteristicvaluechanged",
          handleValue
        );
      }
      handlers.onStatus("disconnected");
    };

    const handleValue = (event: Event) => {
      if (!active) {
        return;
      }
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) {
        return;
      }
      const decoder = new TextDecoder();
      const decoded = decoder.decode(target.value.buffer);
      const parsed = Number.parseFloat(decoded);
      if (Number.isNaN(parsed)) {
        return;
      }
      handlers.onStatus("connected");
      handlers.onSample({
        force: parsed,
        units: "lbf",
        timestamp_ms: Date.now()
      });
    };

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: GRIPFORGE_DEVICE_NAME, services: [GRIPFORGE_SERVICE_UUID] }
      ]
    });

    device.addEventListener("gattserverdisconnected", () => {
      if (active) {
        handlers.onStatus("disconnected");
      }
    });

    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error("Unable to connect to GripForge device.");
    }

    const service = await server.getPrimaryService(GRIPFORGE_SERVICE_UUID);
    characteristic = await service.getCharacteristic(
      GRIPFORGE_CHARACTERISTIC_UUID
    );

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleValue);
    handlers.onStatus("connected");

    return cleanup;
  }
});

export const createDemoSource = (): ForceSource => ({
  connect: async (handlers) => {
    handlers.onStatus("connecting");
    let active = true;

    const start = Date.now();
    const interval = window.setInterval(() => {
      if (!active) {
        return;
      }
      const t = Date.now() - start;
      const base = 18 + 6 * Math.sin(t / 1400);
      const peak = 45 + 18 * Math.sin(t / 700 + Math.sin(t / 2000));
      const hold = Math.max(0, Math.sin(t / 2300));
      const noise = 1.5 * Math.sin(t / 120) + Math.random() * 1.2;
      const force = Math.max(0, base + peak * hold + noise);
      handlers.onStatus("connected");
      handlers.onSample({
        force,
        units: "kg",
        timestamp_ms: Date.now()
      });
    }, 150);

    const cleanup = () => {
      active = false;
      window.clearInterval(interval);
      handlers.onStatus("disconnected");
    };

    return cleanup;
  }
});
