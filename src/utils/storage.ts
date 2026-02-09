import { ProfileConfig, ProfileData, SessionSummary } from "./types";

const STORAGE_KEY = "gripforge-profiles";
const ACTIVE_KEY = "gripforge-active-profile";

const defaultProfile: ProfileConfig = {
  name: "bryce",
  endurance: { targetForce: 35 },
  pyramid: { steps: [20, 30, 40, 30, 20] },
  preferredUnits: "kg"
};

export const loadProfiles = (): ProfileData[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial: ProfileData[] = [{ profile: defaultProfile, sessions: [] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    localStorage.setItem(ACTIVE_KEY, defaultProfile.name);
    return initial;
  }
  try {
    const parsed = JSON.parse(raw) as ProfileData[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ profile: defaultProfile, sessions: [] }];
    }
    return parsed;
  } catch {
    return [{ profile: defaultProfile, sessions: [] }];
  }
};

export const saveProfiles = (profiles: ProfileData[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
};

export const loadActiveProfileName = (): string => {
  return localStorage.getItem(ACTIVE_KEY) || defaultProfile.name;
};

export const saveActiveProfileName = (name: string) => {
  localStorage.setItem(ACTIVE_KEY, name);
};

export const updateProfile = (
  profiles: ProfileData[],
  updated: ProfileConfig
): ProfileData[] => {
  return profiles.map((entry) =>
    entry.profile.name === updated.name
      ? { ...entry, profile: updated }
      : entry
  );
};

export const addProfile = (profiles: ProfileData[], profile: ProfileConfig) => {
  const exists = profiles.some((entry) => entry.profile.name === profile.name);
  if (exists) {
    return profiles;
  }
  return [...profiles, { profile, sessions: [] }];
};

export const addSession = (
  profiles: ProfileData[],
  profileName: string,
  session: SessionSummary
): ProfileData[] => {
  return profiles.map((entry) =>
    entry.profile.name === profileName
      ? { ...entry, sessions: [session, ...entry.sessions] }
      : entry
  );
};
