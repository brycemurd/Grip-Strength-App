import { useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  BluetoothOff,
  ChevronDown,
  CircleDot,
  Download,
  Gauge,
  LineChart,
  Play,
  Radio,
  Signal,
  Square,
  Timer
} from "lucide-react";
import {
  ForceSample,
  ProfileConfig,
  SessionSummary,
  TrainingMode,
  Units
} from "./utils/types";
import {
  addProfile,
  addSession,
  demoProfile,
  loadActiveProfileName,
  loadProfiles,
  saveActiveProfileName,
  saveProfiles,
  updateProfile
} from "./utils/storage";

const modeDetails: Record<TrainingMode, { title: string; description: string }> = {
  max: {
    title: "Max Strength",
    description: "Test your peak grip force"
  },
  endurance: {
    title: "Endurance",
    description: "Hold at target force"
  },
  pyramid: {
    title: "Pyramid",
    description: "Ascending/descending intensity"
  },
  free: {
    title: "Free Train",
    description: "Practice freely"
  }
};

const unitsLabel: Record<Units, string> = {
  kg: "kg",
  N: "N",
  lbf: "lbf"
};

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
};

const buildCsv = (sessions: SessionSummary[]) => {
  const header = [
    "id",
    "mode",
    "hand",
    "startedAt",
    "durationMs",
    "maxForce",
    "avgForce",
    "longestHoldMs",
    "units"
  ];
  const rows = sessions.map((session) =>
    [
      session.id,
      session.mode,
      session.hand,
      new Date(session.startedAt).toISOString(),
      session.durationMs,
      session.maxForce,
      session.avgForce,
      session.longestHoldMs,
      session.units
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const downloadCsv = (sessions: SessionSummary[], profileName: string) => {
  const blob = new Blob([buildCsv(sessions)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gripforge-${profileName}-sessions.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const generateDemoForce = (timeMs: number) => {
  const base = 18 + 8 * Math.sin(timeMs / 1200);
  const peak = 40 + 15 * Math.sin(timeMs / 600);
  const noise = 2 * Math.sin(timeMs / 180) + Math.random() * 1.5;
  return Math.max(0, base + peak * 0.5 + noise);
};

const getWsUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
};

const App = () => {
  const [profiles, setProfiles] = useState(() => {
    const initial = loadProfiles();
    const withDemo = addProfile(initial, demoProfile);
    saveProfiles(withDemo);
    return withDemo;
  });
  const [activeProfileName, setActiveProfileName] = useState(() =>
    loadActiveProfileName()
  );
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "Connected" | "Not connected"
  >("Not connected");
  const [forceData, setForceData] = useState<ForceSample>({
    force: 0,
    units: "kg",
    timestamp_ms: Date.now()
  });
  const [batteryVoltage, setBatteryVoltage] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeMode, setActiveMode] = useState<TrainingMode>("max");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionHand, setSessionHand] = useState<"Right" | "Left">("Right");
  const [sessionMetrics, setSessionMetrics] = useState({
    maxForce: 0,
    avgForce: 0,
    longestHoldMs: 0,
    durationMs: 0
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const sessionSamplesRef = useRef<ForceSample[]>([]);
  const sumRef = useRef(0);
  const maxRef = useRef(0);
  const holdStartRef = useRef<number | null>(null);
  const longestHoldRef = useRef(0);

  const activeProfileData = profiles.find(
    (entry) => entry.profile.name === activeProfileName
  );
  const activeProfile = activeProfileData?.profile;
  const sessions = activeProfileData?.sessions ?? [];

  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    saveActiveProfileName(activeProfileName);
  }, [activeProfileName]);

  useEffect(() => {
    if (!activeProfile) {
      const fallback = profiles[0]?.profile.name;
      if (fallback) {
        setActiveProfileName(fallback);
      }
    }
  }, [activeProfile, profiles]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollingId: number | null = null;
    let demoId: number | null = null;
    let cancelled = false;

    const updateForce = (data: ForceSample & { battery_v?: number }) => {
      if (cancelled) {
        return;
      }
      setForceData({
        force: data.force,
        units: data.units,
        timestamp_ms: data.timestamp_ms
      });
      if (typeof data.battery_v === "number") {
        setBatteryVoltage(data.battery_v);
      }
      setIsConnected(true);
      setConnectionStatus("Connected");
      setConnectionError(null);
    };

    const fetchForce = async () => {
      try {
        const response = await fetch("/api/force", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to reach device");
        }
        const data = (await response.json()) as ForceSample & {
          battery_v?: number;
        };
        updateForce(data);
      } catch (error) {
        setIsConnected(false);
        setConnectionStatus("Not connected");
        setConnectionError("Unable to reach device");
        if (!demoMode) {
          setDemoMode(true);
        }
      }
    };

    const startPolling = () => {
      if (pollingId) {
        return;
      }
      pollingId = window.setInterval(fetchForce, 150);
      fetchForce();
    };

    if (demoMode) {
      demoId = window.setInterval(() => {
        const now = Date.now();
        updateForce({
          force: generateDemoForce(now),
          units: activeProfile?.preferredUnits ?? "kg",
          timestamp_ms: now
        });
      }, 150);
    } else {
      try {
        ws = new WebSocket(getWsUrl());
        let wsOpened = false;
        ws.onopen = () => {
          wsOpened = true;
          setIsConnected(true);
          setConnectionStatus("Connected");
          setConnectionError(null);
        };
        ws.onmessage = (event) => {
          const parsed = JSON.parse(event.data) as ForceSample;
          updateForce(parsed);
        };
        ws.onerror = () => {
          if (!wsOpened) {
            startPolling();
          }
        };
        ws.onclose = () => {
          if (!wsOpened) {
            startPolling();
          }
        };
        window.setTimeout(() => {
          if (!wsOpened) {
            startPolling();
          }
        }, 1200);
      } catch (error) {
        startPolling();
      }
    }

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
      if (pollingId) {
        window.clearInterval(pollingId);
      }
      if (demoId) {
        window.clearInterval(demoId);
      }
    };
  }, [demoMode, activeProfile?.preferredUnits]);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    const sample: ForceSample = {
      force: forceData.force,
      units: forceData.units,
      timestamp_ms: forceData.timestamp_ms
    };
    sessionSamplesRef.current = [...sessionSamplesRef.current, sample];
    sumRef.current += sample.force;
    maxRef.current = Math.max(maxRef.current, sample.force);

    if (activeMode === "endurance") {
      const target = activeProfile?.endurance.targetForce ?? 0;
      if (sample.force >= target) {
        if (holdStartRef.current === null) {
          holdStartRef.current = sample.timestamp_ms;
        }
      } else if (holdStartRef.current !== null) {
        const holdMs = sample.timestamp_ms - holdStartRef.current;
        longestHoldRef.current = Math.max(longestHoldRef.current, holdMs);
        holdStartRef.current = null;
      }
    }

    const durationMs =
      sessionSamplesRef.current.length > 1
        ? sample.timestamp_ms -
          sessionSamplesRef.current[0].timestamp_ms
        : 0;
    const avgForce = sumRef.current / sessionSamplesRef.current.length;

    setSessionMetrics({
      maxForce: maxRef.current,
      avgForce,
      longestHoldMs: longestHoldRef.current,
      durationMs
    });
  }, [forceData, sessionActive, activeMode, activeProfile?.endurance.targetForce]);

  const stats = useMemo(() => {
    const allSessions = sessions;
    const baseMax = Math.max(0, ...allSessions.map((s) => s.maxForce));
    const baseAvg =
      allSessions.length === 0
        ? 0
        : allSessions.reduce((acc, s) => acc + s.avgForce, 0) /
          allSessions.length;
    const baseLongest = Math.max(0, ...allSessions.map((s) => s.longestHoldMs));
    const sessionCount = allSessions.length;

    if (!sessionActive) {
      return {
        maxGrip: baseMax,
        avgForce: baseAvg,
        longestHoldMs: baseLongest,
        sessions: sessionCount
      };
    }

    return {
      maxGrip: Math.max(baseMax, sessionMetrics.maxForce),
      avgForce:
        sessionCount === 0
          ? sessionMetrics.avgForce
          : (baseAvg * sessionCount + sessionMetrics.avgForce) /
            (sessionCount + 1),
      longestHoldMs: Math.max(baseLongest, sessionMetrics.longestHoldMs),
      sessions: sessionCount
    };
  }, [sessions, sessionActive, sessionMetrics]);

  const handleConnect = async () => {
    try {
      const response = await fetch("/api/force", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Device not reachable");
      }
      const data = (await response.json()) as ForceSample & {
        battery_v?: number;
      };
      setForceData(data);
      setConnectionStatus("Connected");
      setIsConnected(true);
      setConnectionError(null);
    } catch (error) {
      setConnectionError("Unable to reach device");
      setConnectionStatus("Not connected");
      setIsConnected(false);
      setDemoMode(true);
    }
  };

  const startSession = async () => {
    if (sessionActive) {
      return;
    }
    sessionSamplesRef.current = [];
    sumRef.current = 0;
    maxRef.current = 0;
    holdStartRef.current = null;
    longestHoldRef.current = 0;
    setSessionMetrics({ maxForce: 0, avgForce: 0, longestHoldMs: 0, durationMs: 0 });
    setSessionActive(true);
    try {
      await fetch("/api/session/start", { method: "POST" });
    } catch {
      // optional endpoint
    }
  };

  const stopSession = async () => {
    if (!sessionActive) {
      return;
    }
    setSessionActive(false);
    try {
      await fetch("/api/session/stop", { method: "POST" });
    } catch {
      // optional endpoint
    }

    const samples = sessionSamplesRef.current;
    if (samples.length === 0) {
      return;
    }

    const durationMs = samples[samples.length - 1].timestamp_ms - samples[0].timestamp_ms;
    const avgForce = sumRef.current / samples.length;
    const maxForce = maxRef.current;

    let longestHoldMs = longestHoldRef.current;
    if (activeMode === "endurance" && holdStartRef.current !== null) {
      longestHoldMs = Math.max(
        longestHoldMs,
        samples[samples.length - 1].timestamp_ms - holdStartRef.current
      );
      holdStartRef.current = null;
    }

    const session: SessionSummary = {
      id: createId(),
      mode: activeMode,
      hand: sessionHand,
      startedAt: samples[0].timestamp_ms,
      durationMs,
      maxForce,
      avgForce,
      longestHoldMs,
      units: samples[0].units
    };

    const updated = addSession(profiles, activeProfileName, session);
    setProfiles(updated);
  };

  const updateProfileConfig = (updates: Partial<ProfileConfig>) => {
    if (!activeProfile) {
      return;
    }
    const updatedProfile: ProfileConfig = { ...activeProfile, ...updates };
    const updatedProfiles = updateProfile(profiles, updatedProfile);
    setProfiles(updatedProfiles);
  };

  const handleAddProfile = (name: string) => {
    if (!name.trim()) {
      return;
    }
    const newProfile: ProfileConfig = {
      name: name.trim(),
      endurance: { targetForce: 32 },
      pyramid: { steps: [18, 28, 38, 28, 18] },
      preferredUnits: "kg"
    };
    const updated = addProfile(profiles, newProfile);
    setProfiles(updated);
    setActiveProfileName(newProfile.name);
  };

  const chartPoints = sessions
    .slice()
    .reverse()
    .map((session, index) => ({
      x: index,
      y: session.maxForce
    }));

  const maxChartValue = Math.max(1, ...chartPoints.map((p) => p.y));
  const chartPath = chartPoints
    .map((point, index) => {
      const x = (index / Math.max(1, chartPoints.length - 1)) * 240 + 10;
      const y = 140 - (point.y / maxChartValue) * 110;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const recentSessions = sessions.slice(0, 4);

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-16 pt-6 sm:px-8">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-soft">
            <Gauge className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
              GripForge
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              Smart Grip Dashboard
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {demoMode && (
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
              Demo Mode
            </span>
          )}
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-soft">
            <CircleDot className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-slate-600">{connectionStatus}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-soft">
            <select
              className="text-sm font-medium text-slate-700 focus:outline-none"
              value={activeProfileName}
              onChange={(event) => setActiveProfileName(event.target.value)}
            >
              {profiles.map((entry) => (
                <option key={entry.profile.name} value={entry.profile.name}>
                  {entry.profile.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </div>
          <ProfileCreator onCreate={handleAddProfile} />
        </div>
      </header>

      {connectionError && !demoMode && (
        <div className="mx-auto mt-6 w-full max-w-6xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {connectionError}. Demo Mode enabled for offline testing.
        </div>
      )}

      <main className="mx-auto mt-8 flex w-full max-w-6xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  Connect Your Grip Trainer
                </h2>
                <p className="mt-2 max-w-xl text-sm text-slate-500">
                  Connect via Wi-Fi to track your grip force in real-time.
                </p>
              </div>
              <button
                onClick={handleConnect}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-slate-800"
              >
                Connect Device
              </button>
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
              <GaugeDisplay force={forceData.force} units={forceData.units} />
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Device Status
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {isConnected ? "Connected" : "Not connected"}
                      </p>
                    </div>
                    {isConnected ? (
                      <Signal className="h-6 w-6 text-emerald-500" />
                    ) : (
                      <BluetoothOff className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  {batteryVoltage !== null && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                      <Battery className="h-4 w-4" />
                      Battery {batteryVoltage.toFixed(2)}V
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Session Controls
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      onClick={startSession}
                      disabled={sessionActive}
                      className="flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-200"
                    >
                      <Play className="h-4 w-4" />
                      Start
                    </button>
                    <button
                      onClick={stopSession}
                      disabled={!sessionActive}
                      className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </button>
                    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-600">
                      <Timer className="h-4 w-4" />
                      {formatDuration(sessionMetrics.durationMs)}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
                    <span>Hand:</span>
                    {(["Right", "Left"] as const).map((hand) => (
                      <button
                        key={hand}
                        onClick={() => setSessionHand(hand)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          sessionHand === hand
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-500"
                        }`}
                      >
                        {hand}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Demo Mode
                  </p>
                  <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                    <span>Simulate grip force data offline.</span>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={demoMode}
                        onChange={(event) => setDemoMode(event.target.checked)}
                      />
                      <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:bg-sky-500 peer-checked:after:translate-x-5" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Active Mode
                </p>
                <h3 className="text-xl font-semibold text-slate-900">
                  {modeDetails[activeMode].title}
                </h3>
              </div>
              <Radio className="h-6 w-6 text-sky-500" />
            </div>
            <p className="text-sm text-slate-500">
              {modeDetails[activeMode].description}
            </p>

            {activeMode === "max" && (
              <ModeInsight
                label="Peak This Session"
                value={`${sessionMetrics.maxForce.toFixed(1)} ${unitsLabel[forceData.units]}`}
              />
            )}

            {activeMode === "endurance" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Target Force ({unitsLabel[forceData.units]})
                </label>
                <input
                  type="number"
                  min={0}
                  value={activeProfile?.endurance.targetForce ?? 0}
                  onChange={(event) =>
                    updateProfileConfig({
                      endurance: {
                        targetForce: Number(event.target.value)
                      }
                    })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <ModeInsight
                  label="Time Above Target"
                  value={formatDuration(sessionMetrics.longestHoldMs)}
                />
              </div>
            )}

            {activeMode === "pyramid" && (
              <div className="flex flex-col gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Pyramid Steps ({unitsLabel[forceData.units]})
                </label>
                <input
                  type="text"
                  value={(activeProfile?.pyramid.steps ?? []).join(", ")}
                  onChange={(event) =>
                    updateProfileConfig({
                      pyramid: {
                        steps: event.target.value
                          .split(",")
                          .map((step) => Number(step.trim()))
                          .filter((value) => !Number.isNaN(value))
                      }
                    })
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  {(activeProfile?.pyramid.steps ?? []).map((step, index) => (
                    <span
                      key={`${step}-${index}`}
                      className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-600"
                    >
                      {step} {unitsLabel[forceData.units]}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {activeMode === "free" && (
              <ModeInsight
                label="Live Average"
                value={`${sessionMetrics.avgForce.toFixed(1)} ${unitsLabel[forceData.units]}`}
              />
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Max Grip"
            value={`${stats.maxGrip.toFixed(1)} ${unitsLabel[forceData.units]}`}
          />
          <StatCard
            title="Avg Force"
            value={`${stats.avgForce.toFixed(1)} ${unitsLabel[forceData.units]}`}
          />
          <StatCard
            title="Longest Hold"
            value={formatDuration(stats.longestHoldMs)}
          />
          <StatCard title="Sessions" value={stats.sessions.toString()} />
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Training Modes</h3>
            <span className="text-sm text-slate-500">
              Tap a mode to configure your session.
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(modeDetails) as TrainingMode[]).map((mode) => (
              <ModeCard
                key={mode}
                active={activeMode === mode}
                title={modeDetails[mode].title}
                description={modeDetails[mode].description}
                onClick={() => setActiveMode(mode)}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Progress (Strength)
                </p>
                <h3 className="text-xl font-semibold text-slate-900">
                  Performance Trend
                </h3>
              </div>
              <LineChart className="h-6 w-6 text-sky-500" />
            </div>
            <div className="mt-6">
              <svg viewBox="0 0 260 160" className="h-40 w-full">
                <defs>
                  <linearGradient id="chart" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="260" height="160" rx="16" fill="#f8fafc" />
                {chartPoints.length > 1 ? (
                  <>
                    <path d={chartPath} stroke="#0ea5e9" strokeWidth="3" fill="none" />
                    <path
                      d={`${chartPath} L 250 150 L 10 150 Z`}
                      fill="url(#chart)"
                    />
                  </>
                ) : (
                  <text x="50%" y="50%" textAnchor="middle" fill="#94a3b8">
                    Start a session to see progress.
                  </text>
                )}
              </svg>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>Session history</span>
                <span>Max: {maxChartValue.toFixed(1)} {unitsLabel[forceData.units]}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Recent Sessions
                </p>
                <h3 className="text-xl font-semibold text-slate-900">Latest Workouts</h3>
              </div>
              <button
                onClick={() => setShowAllSessions(true)}
                className="text-sm font-semibold text-sky-600"
              >
                View All
              </button>
            </div>
            <div className="mt-6 flex flex-col gap-4">
              {recentSessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  Sessions appear here once you start training.
                </div>
              ) : (
                recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {modeDetails[session.mode].title} · {session.hand}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(session.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        {session.maxForce.toFixed(1)} {unitsLabel[session.units]}
                      </p>
                      <p className="text-xs text-slate-500">
                        Hold {formatDuration(session.longestHoldMs)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {showAllSessions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">
                  All Sessions
                </h3>
                <p className="text-sm text-slate-500">
                  Export your training data as CSV.
                </p>
              </div>
              <button
                onClick={() => setShowAllSessions(false)}
                className="text-sm font-semibold text-slate-500"
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => downloadCsv(sessions, activeProfileName)}
                className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
            <div className="mt-6 flex flex-col gap-3">
              {sessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  No sessions yet.
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {modeDetails[session.mode].title} · {session.hand}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(session.startedAt).toLocaleString()} · Duration {formatDuration(
                          session.durationMs
                        )}
                      </p>
                    </div>
                    <div className="text-sm text-slate-600">
                      Max {session.maxForce.toFixed(1)} {unitsLabel[session.units]} · Avg {session.avgForce.toFixed(
                        1
                      )}{" "}
                      {unitsLabel[session.units]}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const GaugeDisplay = ({ force, units }: { force: number; units: Units }) => {
  const clamped = Math.min(100, Math.max(0, force));
  const angle = (clamped / 100) * 180;
  const radius = 120;
  const center = 140;
  const x = center + radius * Math.cos(Math.PI - (angle * Math.PI) / 180);
  const y = center - radius * Math.sin(Math.PI - (angle * Math.PI) / 180);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 280 160" className="h-48 w-full">
        <path
          d="M20 140 A120 120 0 0 1 260 140"
          stroke="#e2e8f0"
          strokeWidth="16"
          fill="none"
        />
        <path
          d="M20 140 A120 120 0 0 1 260 140"
          stroke="#0ea5e9"
          strokeWidth="16"
          fill="none"
          strokeDasharray={`${(angle / 180) * 377} 377`}
        />
        <circle cx={x} cy={y} r="10" fill="#0ea5e9" />
        <text x="50%" y="120" textAnchor="middle" fill="#0f172a" fontSize="36" fontWeight="600">
          {force.toFixed(1)}
        </text>
        <text x="50%" y="145" textAnchor="middle" fill="#94a3b8" fontSize="14">
          {unitsLabel[units]} / 0-100
        </text>
      </svg>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
        Live Force
      </div>
    </div>
  );
};

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <div className="rounded-2xl bg-white p-4 shadow-soft">
    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</p>
    <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
  </div>
);

const ModeCard = ({
  title,
  description,
  active,
  onClick
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`rounded-2xl border px-4 py-5 text-left shadow-soft transition ${
      active
        ? "border-sky-200 bg-sky-50"
        : "border-slate-100 bg-white hover:border-sky-100"
    }`}
  >
    <h4 className="text-base font-semibold text-slate-900">{title}</h4>
    <p className="mt-2 text-sm text-slate-500">{description}</p>
  </button>
);

const ModeInsight = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
    <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
  </div>
);

const ProfileCreator = ({ onCreate }: { onCreate: (name: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-soft"
      >
        Manage
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-10 w-56 rounded-2xl border border-slate-100 bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Add Profile
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              onCreate(name);
              setName("");
              setOpen(false);
            }}
            className="mt-3 w-full rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
