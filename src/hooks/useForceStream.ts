import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionStatus,
  createBluetoothSource,
  createWifiSource,
  ForceSource
} from "../lib/dataSource";
import { ForceSample } from "../utils/types";

export type ConnectionMode = "wifi" | "bluetooth";

type UseForceStreamOptions = {
  mode: ConnectionMode;
  onFallbackMode?: (mode: ConnectionMode, reason: string) => void;
};

export const useForceStream = ({
  mode,
  onFallbackMode
}: UseForceStreamOptions) => {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<ForceSample>({
    force: 0,
    units: "kg",
    timestamp_ms: Date.now()
  });
  const [batteryVoltage, setBatteryVoltage] = useState<number | null>(null);
  const sourceRef = useRef<ForceSource | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const source = useMemo(() => {
    if (mode === "wifi") {
      return createWifiSource();
    }
    if (mode === "bluetooth") {
      return createBluetoothSource();
    }
    return createWifiSource();
  }, [mode]);

  const disconnect = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    disconnect();
    setError(null);
    sourceRef.current = source;
    try {
      const cleanup = await source.connect({
        onSample: setSample,
        onStatus: setStatus,
        onError: (message) => {
          setError(message);
          setStatus("disconnected");
          onFallbackMode?.("wifi", message);
        },
        onMeta: ({ batteryVoltage }) => {
          if (typeof batteryVoltage === "number") {
            setBatteryVoltage(batteryVoltage);
          }
        }
      });
      cleanupRef.current = cleanup;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to connect.";
      setError(message);
      setStatus("disconnected");
      onFallbackMode?.("wifi", message);
    }
  }, [disconnect, mode, onFallbackMode, source]);

  const startSession = useCallback(async () => {
    await sourceRef.current?.startSession?.();
  }, []);

  const stopSession = useCallback(async () => {
    await sourceRef.current?.stopSession?.();
  }, []);

  useEffect(() => {
    disconnect();
  }, [connect, disconnect, mode]);

  return {
    status,
    error,
    sample,
    batteryVoltage,
    connect,
    disconnect,
    startSession,
    stopSession
  };
};
