import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionStatus,
  createBluetoothSource,
  createWifiSource,
  ForceSource
} from "../lib/dataSource";
import { ForceSample, Units } from "../utils/types";

export type ConnectionMode = "wifi" | "bluetooth";

type UseForceStreamOptions = {
  mode: ConnectionMode;
  incomingUnits?: Units;
  onConnectionIssue?: (reason: string) => void;
};

export const useForceStream = ({
  mode,
  incomingUnits = "kg",
  onConnectionIssue
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
    return createBluetoothSource({ incomingUnits });
  }, [incomingUnits, mode]);

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
          onConnectionIssue?.(message);
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
      onConnectionIssue?.(message);
    }
  }, [disconnect, onConnectionIssue, source]);

  const startSession = useCallback(async () => {
    await sourceRef.current?.startSession?.();
  }, []);

  const stopSession = useCallback(async () => {
    await sourceRef.current?.stopSession?.();
  }, []);

  useEffect(() => {
    disconnect();
  }, [disconnect, mode]);

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
