import type {
  AutomationSummary,
  ProductAutomationState,
} from "@agents/contracts";

const priorities: Record<ProductAutomationState, number> = {
  needs_reconfiguration: 0,
  pending_approval: 1,
  draft: 2,
  paused: 3,
  live: 4,
  archived: 5,
};

export const automationStatePriority = (state: ProductAutomationState) =>
  priorities[state];

export type AutomationSection = "needs_attention" | "active" | "inactive";

export const automationSection = (
  state: ProductAutomationState,
): AutomationSection => {
  if (state === "needs_reconfiguration") return "needs_attention";
  if (state === "live") return "active";
  return "inactive";
};

export const formatAutomationSchedule = (schedule: string) => {
  if (/^(?:no schedule|manual)$/i.test(schedule.trim())) return "Run manually";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = schedule.split(" ");
  const numericMinute = Number(minute);
  const numericHour = Number(hour);
  if (
    Number.isInteger(numericMinute) &&
    numericMinute >= 0 &&
    numericMinute < 60 &&
    Number.isInteger(numericHour) &&
    numericHour >= 0 &&
    numericHour < 24 &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const displayHour = numericHour % 12 || 12;
    const meridiem = numericHour < 12 ? "AM" : "PM";
    return `Daily at ${displayHour}:${String(numericMinute).padStart(2, "0")} ${meridiem}`;
  }

  return "Custom schedule";
};

export const sortAutomationSummaries = <
  T extends Pick<AutomationSummary, "id" | "state" | "updatedAt">,
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const stateOrder =
      automationStatePriority(left.state) -
      automationStatePriority(right.state);
    return stateOrder || right.updatedAt.localeCompare(left.updatedAt);
  });
