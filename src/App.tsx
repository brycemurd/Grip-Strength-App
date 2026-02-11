import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Battery,
  Bluetooth,
  BluetoothOff,
  ChevronDown,
  Download,
  Gauge,
  LineChart as LineChartIcon,
  Plus,
  Play,
  Signal,
  Square,
  Timer
} from "lucide-react";
import { useForceStream, ConnectionMode } from "./hooks/useForceStream";
import { SessionSample, SessionSummary, TrainingMode, Units } from "./utils/types";
import {
  addProfile,
  addSession,
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
    description: "Ascending + descending intensity"
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

const connectionCopy: Record<ConnectionMode, string> = {
  wifi: "Connect via Wi-Fi to your GripForge device",
  bluetooth: "Connect via Bluetooth (Web Bluetooth)"
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

const downloadCsv = (sessions: SessionSummary[], profileName: string) => {
  const blob = new Blob([buildCsv(sessions)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gripforge-${profileName}-sessions.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const convertForce = (value: number, from: Units, to: Units) => {
  if (from === to) {
    return value;
  }
  const asKg =
    from === "kg"
      ? value
      : from === "lbf"
        ? value / 2.20462
        : value / 9.80665;
  if (to === "kg") {
    return asKg;
  }
  if (to === "lbf") {
    return asKg * 2.20462;
  }
  return asKg * 9.80665;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const useAnimatedNumber = (value: number, duration = 280) => {
  const [animated, setAnimated] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const fromRef = useRef(value);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    fromRef.current = animated;
    startRef.current = performance.now();

    const step = (now: number) => {
      const progress = clamp((now - startRef.current) / duration, 0, 1);
      const next = fromRef.current + (value - fromRef.current) * progress;
      setAnimated(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value, duration]);

  return animated;
};

const GaugeArc = ({ value, max }: { value: number; max: number }) => {
  const clamped = clamp(value, 0, max);
  const percentage = clamped / max;
  const radius = 80;
  const circumference = Math.PI * radius;
  const dash = circumference * percentage;

  return (
    <svg viewBox="0 0 200 120" className="h-32 w-full">
      <defs>
        <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path
        d="M 20 100 A 80 80 0 0 1 180 100"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M 20 100 A 80 80 0 0 1 180 100"
        fill="none"
        stroke="url(#gaugeGradient)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        className="transition-all duration-500"
      />
    </svg>
  );
};

const ForceChart = ({ data }: { data: number[] }) => {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        No data yet
      </div>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1 || 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <defs>
        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke="url(#lineGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const App = () => {
  const [profiles, setProfiles] = useState(() => {
    const initial = loadProfiles();
    saveProfiles(initial);
    return initial;
  });
  const [activeProfileName, setActiveProfileName] = useState(() =>
    loadActiveProfileName()
  );
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("wifi");
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [activeMode, setActiveMode] = useState<TrainingMode>("max");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionHand, setSessionHand] = useState<"Right" | "Left">("Right");
  const [connectionNote, setConnectionNote] = useState<string | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const sessionSamplesRef = useRef<SessionSample[]>([]);
  const [sessionSamples, setSessionSamples] = useState<SessionSample[]>([]);
  const sessionStartRef = useRef<number | null>(null);

  const activeProfile = useMemo(
    () =>
      profiles.find((entry) => entry.profile.name === activeProfileName) ||
      profiles[0],
    [activeProfileName, profiles]
  );

  const { status, error, sample, batteryVoltage, connect, disconnect, startSession, stopSession } =
    useForceStream({
      mode: connectionMode,
      onFallbackMode: (mode, reason) => {
        setConnectionMode(mode);
        setConnectionNote(reason);
      }
    });

  const preferredUnits = activeProfile.profile.preferredUnits;
  const convertedForce = useMemo(
    () => convertForce(sample.force, sample.units, preferredUnits),
    [sample.force, sample.units, preferredUnits]
  );
  const animatedForce = useAnimatedNumber(convertedForce);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    const now = Date.now();
    const sessionStart = sessionStartRef.current ?? now;
    sessionStartRef.current = sessionStart;
    const nextSample = {
      t_ms: now - sessionStart,
      force: convertedForce,
      units: preferredUnits
    };
    sessionSamplesRef.current = [...sessionSamplesRef.current, nextSample].slice(
      -800
    );
    setSessionSamples(sessionSamplesRef.current);
  }, [convertedForce, preferredUnits, sessionActive]);

  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  const profileSessions = activeProfile?.sessions ?? [];
  const recentSessions = profileSessions.slice(0, 4);

  const stats = useMemo(() => {
    const maxGrip = Math.max(...profileSessions.map((s) => s.maxForce), 0);
    const avgForce =
      profileSessions.reduce((sum, session) => sum + session.avgForce, 0) /
      (profileSessions.length || 1);
    const longestHold = Math.max(
      ...profileSessions.map((s) => s.longestHoldMs),
      0
    );
    return {
      maxGrip,
      avgForce,
      longestHold,
      sessions: profileSessions.length
    };
  }, [profileSessions]);

  const gaugeMax = preferredUnits === "kg" ? 100 : preferredUnits === "lbf" ? 220 : 980;

  const connectionLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting"
        : "Disconnected";

  const connectionColor =
    status === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : status === "connecting"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-500";

  const startSessionHandler = async () => {
    sessionSamplesRef.current = [];
    setSessionSamples([]);
    sessionStartRef.current = Date.now();
    setSessionActive(true);
    await startSession();
  };

  const stopSessionHandler = async () => {
    setSessionActive(false);
    await stopSession();
    const samples = sessionSamplesRef.current;
    if (samples.length === 0) {
      return;
    }
    const maxForce = Math.max(...samples.map((s) => s.force));
    const avgForce =
      samples.reduce((sum, s) => sum + s.force, 0) / samples.length;
    const durationMs = samples[samples.length - 1].t_ms;
    const target = activeProfile.profile.endurance.targetForce;
    let longestHoldMs = 0;
    let currentHold = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const delta = samples[i].t_ms - samples[i - 1].t_ms;
      if (samples[i].force >= target) {
        currentHold += delta;
        longestHoldMs = Math.max(longestHoldMs, currentHold);
      } else {
        currentHold = 0;
      }
    }
    const summary: SessionSummary = {
      id: createId(),
      mode: activeMode,
      hand: sessionHand,
      startedAt: Date.now() - durationMs,
      durationMs,
      maxForce,
      avgForce,
      longestHoldMs,
      units: preferredUnits
    };
    setProfiles((current) =>
      addSession(current, activeProfile.profile.name, summary)
    );
  };

  const handleProfileChange = (name: string) => {
    setActiveProfileName(name);
    saveActiveProfileName(name);
  };

  const handleAddProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) {
      return;
    }
    const updatedProfile = {
      ...activeProfile.profile,
      name: trimmed
    };
    setProfiles((current) => addProfile(current, updatedProfile));
    setActiveProfileName(trimmed);
    saveActiveProfileName(trimmed);
    setNewProfileName("");
    setShowAddProfile(false);
  };

  const handleUnitChange = (units: Units) => {
    const updated = { ...activeProfile.profile, preferredUnits: units };
    setProfiles((current) => updateProfile(current, updated));
  };

  const handleTargetChange = (value: number) => {
    const updated = {
      ...activeProfile.profile,
      endurance: { targetForce: value }
    };
    setProfiles((current) => updateProfile(current, updated));
  };

  const handlePyramidChange = (value: string) => {
    const steps = value
      .split(",")
      .map((step) => Number.parseFloat(step.trim()))
      .filter((step) => !Number.isNaN(step));
    const updated = {
      ...activeProfile.profile,
      pyramid: { steps }
    };
    setProfiles((current) => updateProfile(current, updated));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 px-6 py-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-white/10 p-3">
                <Gauge className="h-6 w-6 text-teal-300" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">GripForge</h1>
                <p className="text-sm text-white/70">
                  Smart grip dynamometer dashboard
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${connectionColor} ${status === "connected" ? "shadow-[0_0_16px_rgba(16,185,129,0.35)]" : ""}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === "connected"
                      ? "bg-emerald-500 animate-pulse"
                      : status === "connecting"
                        ? "bg-amber-500"
                        : "bg-slate-400"
                  }`}
                />
                {connectionLabel}
              </span>
              <div className="relative">
                <select
                  value={activeProfile.profile.name}
                  onChange={(event) => handleProfileChange(event.target.value)}
                  className="appearance-none rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white outline-none backdrop-blur"
                >
                  {profiles.map((entry) => (
                    <option key={entry.profile.name} value={entry.profile.name}>
                      {entry.profile.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-white/60" />
              </div>
              <button
                onClick={() => setShowAddProfile(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white/80 transition hover:text-white"
              >
                <Plus className="h-4 w-4" />
                Add Profile
              </button>
              <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
                {([
                  { value: "wifi", label: "Wi-Fi", icon: <Signal className="h-4 w-4" /> },
                  { value: "bluetooth", label: "Bluetooth", icon: <Bluetooth className="h-4 w-4" /> }
                ] as const).map((item) => (
                  <button
                    key={item.value}
                    onClick={() => {
                      setConnectionMode(item.value);
                      setConnectionNote(null);
                    }}
                    className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${
                      connectionMode === item.value
                        ? "bg-white text-slate-900"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {connectionNote && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white/80">
              {connectionNote}
            </div>
          )}
        </header>

        {(error || connectionMode === "bluetooth") && (
          <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            {error ? (
              <span>{error}</span>
            ) : (
              <div className="flex items-center gap-2">
                <BluetoothOff className="h-4 w-4 text-indigo-500" />
                <span>
                  Bluetooth mode requires Desktop Chrome or Bluefy on iOS. Normal
                  iPhone Safari/Chrome does not support Web Bluetooth.
                </span>
              </div>
            )}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur">
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-indigo-500">
                  Live dashboard
                </p>
                <h2 className="text-2xl font-semibold text-slate-900">
                  Track Grip Force in Real Time
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {connectionCopy[connectionMode]}
                </p>
              </div>
              <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
                <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-500">Live Force</div>
                    {batteryVoltage !== null && (
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Battery className="h-4 w-4" />
                        {batteryVoltage.toFixed(2)}v
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                      {animatedForce.toFixed(1)}
                      <span className="ml-2 text-lg font-medium text-slate-400">
                        {unitsLabel[preferredUnits]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {status === "connected"
                        ? "Streaming live grip data"
                        : "Awaiting connection"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={status === "connected" ? disconnect : connect}
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-400 via-indigo-400 to-purple-400 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.02]"
                    >
                      {status === "connected" ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {status === "connected"
                        ? "Disconnect"
                        : connectionMode === "bluetooth"
                          ? "Connect Bluetooth"
                          : "Connect Wi-Fi"}
                    </button>
                    <button
                      onClick={sessionActive ? stopSessionHandler : startSessionHandler}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      {sessionActive ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {sessionActive ? "Stop Session" : "Start Session"}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-5 py-6 shadow-sm">
                  <GaugeArc value={animatedForce} max={gaugeMax} />
                  <div className="-mt-2 text-sm text-slate-500">
                    {gaugeMax} {unitsLabel[preferredUnits]} max
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Max Grip", value: stats.maxGrip, icon: <Activity className="h-4 w-4" /> },
                  { label: "Avg Force", value: stats.avgForce, icon: <LineChartIcon className="h-4 w-4" /> },
                  { label: "Longest Hold", value: stats.longestHold / 1000, suffix: "s", icon: <Timer className="h-4 w-4" /> },
                  {
                    label: "Sessions",
                    value: stats.sessions,
                    icon: <Signal className="h-4 w-4" />,
                    format: (value: number) => value.toString()
                  }
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{stat.label}</span>
                      {stat.icon}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {stat.format ? stat.format(stat.value) : stat.value.toFixed(1)}
                      {stat.suffix ? (
                        <span className="ml-1 text-sm font-medium text-slate-400">
                          {stat.suffix}
                        </span>
                      ) : (
                        <span className="ml-1 text-sm font-medium text-slate-400">
                          {stat.label === "Sessions" ? "" : unitsLabel[preferredUnits]}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur">
              <h3 className="text-lg font-semibold text-slate-900">
                Training Modes
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Customize sessions and targets per profile.
              </p>
              <div className="mt-4 grid gap-4">
                {(Object.keys(modeDetails) as TrainingMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setActiveMode(mode)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      activeMode === mode
                        ? "border-indigo-400 bg-indigo-50 shadow"
                        : "border-slate-100 bg-white hover:border-indigo-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {modeDetails[mode].title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {modeDetails[mode].description}
                        </p>
                      </div>
                      <div
                        className={`h-8 w-8 rounded-full ${
                          activeMode === mode
                            ? "bg-gradient-to-br from-teal-400 via-indigo-400 to-purple-400"
                            : "bg-slate-100"
                        }`}
                      />
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-6 space-y-4 rounded-2xl border border-slate-100 bg-white px-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Hand</span>
                  <div className="flex gap-2">
                    {(["Right", "Left"] as const).map((hand) => (
                      <button
                        key={hand}
                        onClick={() => setSessionHand(hand)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          sessionHand === hand
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {hand}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Units</span>
                  <select
                    value={preferredUnits}
                    onChange={(event) =>
                      handleUnitChange(event.target.value as Units)
                    }
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  >
                    {Object.keys(unitsLabel).map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Endurance Target</span>
                  <input
                    type="number"
                    value={activeProfile.profile.endurance.targetForce}
                    onChange={(event) =>
                      handleTargetChange(Number(event.target.value))
                    }
                    className="w-24 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                </div>
                <div>
                  <span className="text-sm text-slate-500">Pyramid Steps</span>
                  <input
                    type="text"
                    value={activeProfile.profile.pyramid.steps.join(", ")}
                    onChange={(event) => handlePyramidChange(event.target.value)}
                    className="mt-2 w-full rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="grid gap-6">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Progress Overview
                  </h3>
                  <p className="text-sm text-slate-500">
                    Session max force over time
                  </p>
                </div>
                <LineChartIcon className="h-5 w-5 text-indigo-400" />
              </div>
              <div className="mt-4 h-40">
                <ForceChart
                  data={[...profileSessions]
                    .reverse()
                    .map((session) => session.maxForce)}
                />
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Live Session Trace
                  </h3>
                  <p className="text-sm text-slate-500">
                    Force vs time in current session
                  </p>
                </div>
                <Activity className="h-5 w-5 text-indigo-400" />
              </div>
              <div className="mt-4 h-40">
                <ForceChart data={sessionSamples.map((sample) => sample.force)} />
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Recent Sessions
                </h3>
                <p className="text-sm text-slate-500">
                  Latest training highlights
                </p>
              </div>
              <button
                onClick={() => setShowAllSessions(true)}
                className="text-xs font-semibold text-indigo-500"
              >
                View All
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {recentSessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  No sessions yet. Start your first session to see stats.
                </div>
              ) : (
                recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {modeDetails[session.mode].title}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(session.startedAt).toLocaleDateString()} · {session.hand}
                        </p>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-900">
                        {session.maxForce.toFixed(1)} {unitsLabel[session.units]}
                        <p className="text-xs text-slate-400">
                          {formatDuration(session.durationMs)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => downloadCsv(profileSessions, activeProfile.profile.name)}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </section>
      </div>

      {showAllSessions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  All Sessions
                </h3>
                <p className="text-sm text-slate-500">
                  Full history for {activeProfile.profile.name}
                </p>
              </div>
              <button
                onClick={() => setShowAllSessions(false)}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {profileSessions.length === 0 ? (
                <p className="text-sm text-slate-400">No sessions yet.</p>
              ) : (
                <div className="space-y-3">
                  {profileSessions.map((session) => (
                    <div
                      key={session.id}
                      className="rounded-2xl border border-slate-100 bg-white px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {modeDetails[session.mode].title}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(session.startedAt).toLocaleString()} · {session.hand}
                          </p>
                        </div>
                        <div className="text-right text-sm font-semibold text-slate-900">
                          {session.maxForce.toFixed(1)} {unitsLabel[session.units]}
                          <p className="text-xs text-slate-400">
                            {formatDuration(session.durationMs)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => downloadCsv(profileSessions, activeProfile.profile.name)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-teal-400 via-indigo-400 to-purple-400 px-4 py-2 text-sm font-semibold text-white"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Add Profile
                </h3>
                <p className="text-sm text-slate-500">
                  Create a new athlete profile.
                </p>
              </div>
              <button
                onClick={() => setShowAddProfile(false)}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="text-xs font-semibold text-slate-500">
                Profile name
              </label>
              <input
                type="text"
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                placeholder="e.g. bryce"
                className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700"
              />
              <button
                onClick={handleAddProfile}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-teal-400 via-indigo-400 to-purple-400 px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
