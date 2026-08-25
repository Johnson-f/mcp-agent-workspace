export type ActivityDisplayMode = "auto" | "always_expanded" | "remember_last";

export const ACTIVITY_DISPLAY_MODE_KEY = "agents:activity-display-mode:v1";
export const ACTIVITY_LAST_EXPANDED_KEY = "agents:activity-last-expanded:v1";

export const normalizeActivityDisplayMode = (
  value: string | null | undefined,
): ActivityDisplayMode =>
  value === "always_expanded" || value === "remember_last" ? value : "auto";

export const activityDisclosureIndicator = (expanded: boolean) =>
  expanded ? "<" : ">";

export const activityTimelineExpanded = (input: {
  mode: ActivityDisplayMode;
  active: boolean;
  remembered: boolean;
}) => {
  if (input.active) return true;
  if (input.mode === "always_expanded") return true;
  if (input.mode === "remember_last") return input.remembered;
  return false;
};

export const readActivityDisplayPreference = (storage: Storage) => ({
  mode: normalizeActivityDisplayMode(
    storage.getItem(ACTIVITY_DISPLAY_MODE_KEY),
  ),
  remembered: storage.getItem(ACTIVITY_LAST_EXPANDED_KEY) === "true",
});

export const writeActivityDisplayMode = (
  storage: Storage,
  mode: ActivityDisplayMode,
) => storage.setItem(ACTIVITY_DISPLAY_MODE_KEY, mode);

export const writeActivityExpanded = (storage: Storage, expanded: boolean) =>
  storage.setItem(ACTIVITY_LAST_EXPANDED_KEY, String(expanded));
