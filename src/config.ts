export interface NotificationConfig {
  enabled: boolean;
  backend: "auto" | "terminal" | "native";
  events: Record<string, boolean>;
}

export function readConfig(settings: unknown): NotificationConfig {
  const config: NotificationConfig = {
    enabled: true,
    backend: "auto",
    events: {
      agent_settled: true,
      agent_end: false,
      turn_end: false,
      tool_call: false,
      tool_result: false,
      tool_error: false,
      permission_ask: false,
    },
  };
  const raw = (settings as { notifications?: unknown } | undefined)?.notifications;
  if (raw === undefined) return config;
  if (!isObject(raw)) throw new Error("notifications must be an object.");
  for (const key of Object.keys(raw)) {
    if (!["enabled", "backend", "events"].includes(key)) throw new Error(`Unknown notifications setting: ${key}`);
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new Error("notifications.enabled must be a boolean.");
    config.enabled = raw.enabled;
  }
  if (raw.backend !== undefined) {
    if (raw.backend !== "auto" && raw.backend !== "terminal" && raw.backend !== "native") throw new Error("notifications.backend must be auto, terminal, or native.");
    config.backend = raw.backend;
  }
  if (raw.events !== undefined) {
    if (!isObject(raw.events) || Object.entries(raw.events).some(([key, value]) => !key.trim() || typeof value !== "boolean")) {
      throw new Error("notifications.events must map nonempty event names to booleans.");
    }
    config.events = { ...config.events, ...raw.events as Record<string, boolean> };
  }
  return config;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
