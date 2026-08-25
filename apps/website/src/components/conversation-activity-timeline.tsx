"use client";

import type { ConversationActivity } from "@agents/contracts";
import {
  Brain,
  Check,
  ChevronDown,
  CircleX,
  LoaderCircle,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownMessage } from "@/components/markdown-message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ActivityDisplayMode,
  activityDisclosureIndicator,
  activityTimelineExpanded,
  readActivityDisplayPreference,
  writeActivityDisplayMode,
  writeActivityExpanded,
} from "@/lib/conversation-activity-display";

const activityIcon = (activity: ConversationActivity) => {
  if (activity.status === "running" || activity.status === "waiting") {
    return (
      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
    );
  }
  if (activity.status === "failed" || activity.status === "incomplete") {
    return <CircleX className="size-3.5 text-[#a35d52]" />;
  }
  if (activity.kind === "reasoning_summary")
    return <Brain className="size-3.5" />;
  if (activity.kind === "tool") return <Wrench className="size-3.5" />;
  if (activity.kind === "automation") return <Sparkles className="size-3.5" />;
  return <Check className="size-3.5" />;
};

export function ConversationActivityTimeline({
  activities,
  active = false,
}: {
  activities: readonly ConversationActivity[];
  active?: boolean;
}) {
  const [mode, setMode] = useState<ActivityDisplayMode>("auto");
  const [remembered, setRemembered] = useState(false);
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    const preference = readActivityDisplayPreference(window.localStorage);
    setMode(preference.mode);
    setRemembered(preference.remembered);
    setExpanded(activityTimelineExpanded({ active, ...preference }));
  }, [active]);

  if (activities.length === 0) return null;

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    setRemembered(next);
    writeActivityExpanded(window.localStorage, next);
  };

  const changeMode = (nextMode: ActivityDisplayMode) => {
    setMode(nextMode);
    writeActivityDisplayMode(window.localStorage, nextMode);
    setExpanded(
      activityTimelineExpanded({
        mode: nextMode,
        active,
        remembered,
      }),
    );
  };

  return (
    <section className="mb-5 text-[#77746e]" aria-label="Conversation activity">
      <div className="flex items-center justify-between gap-3">
        <button
          aria-expanded={expanded}
          className="flex h-8 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-[#696761] transition-colors hover:text-[#2f2e2b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
          onClick={toggle}
          type="button"
        >
          {activities.length} {activities.length === 1 ? "step" : "steps"}
          {active ? (
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <span aria-hidden="true" className="font-mono text-xs">
              {activityDisclosureIndicator(expanded)}
            </span>
          )}
        </button>
        <Select
          onValueChange={(value) => changeMode(value as ActivityDisplayMode)}
          value={mode}
        >
          <SelectTrigger
            aria-label="Activity display"
            className="h-7 border-0 bg-transparent px-2 text-[11px] text-[#8c8982] shadow-none hover:bg-black/[0.035]"
          >
            <SelectValue>
              {mode === "always_expanded"
                ? "Always expanded"
                : mode === "remember_last"
                  ? "Remember last"
                  : "Auto"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="always_expanded">Always expanded</SelectItem>
            <SelectItem value="remember_last">Remember last</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {expanded ? (
        <ol className="mt-2 ml-2 border-l border-black/[0.1] pl-5">
          {activities.map((activity) => (
            <li className="relative pb-4 last:pb-0" key={activity.id}>
              <span className="absolute -left-[1.55rem] top-1 flex size-3 items-center justify-center rounded-full bg-white text-[#9a9790]">
                <span className="size-1.5 rounded-full bg-[#bbb8b1]" />
              </span>
              {activity.kind === "reasoning_summary" ? (
                <details open={active && activity.status === "running"}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[#74716b] [&::-webkit-details-marker]:hidden">
                    {activityIcon(activity)}
                    <span>{activity.title}</span>
                    <ChevronDown className="size-3.5" />
                  </summary>
                  {activity.content ? (
                    <MarkdownMessage
                      className="mt-2 text-[14px] leading-6 text-[#77746e] [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_p]:mb-3"
                      content={activity.content}
                    />
                  ) : null}
                </details>
              ) : (
                <div className="flex items-start gap-2 text-sm leading-5">
                  <span className="mt-0.5">{activityIcon(activity)}</span>
                  <span
                    className={
                      activity.status === "failed" ||
                      activity.status === "incomplete"
                        ? "text-[#9a5e55]"
                        : "text-[#6f6c66]"
                    }
                  >
                    {activity.title}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
