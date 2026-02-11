export type Units = "kg" | "N" | "lbf";

export type ForceSample = {
  force: number;
  units: Units;
  timestamp_ms: number;
};

export type SessionSample = {
  t_ms: number;
  force: number;
  units: Units;
};

export type TrainingMode = "max" | "endurance" | "pyramid" | "free";

export type SessionSummary = {
  id: string;
  mode: TrainingMode;
  hand: "Right" | "Left";
  startedAt: number;
  durationMs: number;
  maxForce: number;
  avgForce: number;
  longestHoldMs: number;
  units: Units;
};

export type EnduranceConfig = {
  targetForce: number;
};

export type PyramidConfig = {
  steps: number[];
};

export type ProfileConfig = {
  name: string;
  endurance: EnduranceConfig;
  pyramid: PyramidConfig;
  preferredUnits: Units;
  password?: string;
  friends: string[];
};

export type ProfileData = {
  profile: ProfileConfig;
  sessions: SessionSummary[];
};
