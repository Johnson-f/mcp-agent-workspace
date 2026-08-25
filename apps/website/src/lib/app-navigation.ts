export interface AppPageMeta {
  section: "Automations" | "Runs" | "Configure";
  title: string;
  description: string;
  action: { href: string; label: string } | null;
}

export const getAppPageMeta = (pathname: string): AppPageMeta => {
  if (pathname === "/conversations/new") {
    return {
      section: "Automations",
      title: "New automation",
      description:
        "Chat naturally, then review and approve Automation proposals.",
      action: null,
    };
  }

  if (pathname.startsWith("/conversations/")) {
    return {
      section: "Automations",
      title: "Conversation",
      description: "",
      action: null,
    };
  }

  if (pathname === "/automations") {
    return {
      section: "Automations",
      title: "Automations",
      description: "Run approved work now or on an optional schedule.",
      action: { href: "/conversations/new", label: "New automation" },
    };
  }

  if (pathname.startsWith("/automations/")) {
    return {
      section: "Automations",
      title: "Automation",
      description: "Review configuration, schedule, and run history.",
      action: null,
    };
  }

  if (pathname.startsWith("/runs/")) {
    return {
      section: "Runs",
      title: "Run details",
      description: "Follow durable execution, evidence, and final output.",
      action: { href: "/conversations/new", label: "New automation" },
    };
  }

  if (pathname === "/settings") {
    return {
      section: "Configure",
      title: "Settings",
      description: "Control interactive Agent tool approvals.",
      action: null,
    };
  }

  return {
    section: "Configure",
    title: "Connections",
    description: "Connect MCP servers and control which tools agents may use.",
    action: { href: "/connections#connect-server", label: "Add server" },
  };
};
