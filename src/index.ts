import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isObject, readConfig } from "./config.ts";
import { deliverNotification, PI_NOTIFICATIONS_KEY, type NotificationPayload, type NotificationsService } from "./delivery.ts";

export { PI_NOTIFICATIONS_KEY } from "./delivery.ts";
export type { NotificationPayload, NotificationResult, NotificationsService } from "./delivery.ts";

export default function notificationsExtension(pi: ExtensionAPI): void {
  const globals = globalThis as Record<symbol, unknown>;
  let config = readConfig({});
  let context: ExtensionContext | undefined;
  let shutdown = new AbortController();
  let unsubscribe: Array<() => void> = [];
  let warned = false;

  function warn(message: string): void {
    if (warned) return;
    warned = true;
    try { context?.ui.notify(message, "warning"); } catch { /* Notifications must not interrupt agent work. */ }
  }

  const service: NotificationsService = {
    async notify(payload) {
      if (shutdown.signal.aborted) return { success: false, error: "Notifications service is shut down." };
      if (!isObject(payload) || typeof payload.event !== "string" || !payload.event.trim() || typeof payload.message !== "string" || !payload.message.trim() || (payload.title !== undefined && typeof payload.title !== "string")) {
        return { success: false, error: "A notification requires an event and nonblank message, with an optional string title." };
      }
      if (!context || !config.enabled || config.events[payload.event] === false) return { success: true, skipped: true };
      if (context.mode !== "tui" && config.backend !== "native") return { success: true, skipped: true };
      const draft = { event: payload.event, title: payload.title ?? "Pi", message: payload.message };
      try {
        pi.events.emit("notifications:prepare", draft);
      } catch {
        warn("Pi notifications: preparation failed; using the original notification.");
        draft.title = payload.title ?? "Pi";
        draft.message = payload.message;
      }
      if (typeof draft.title !== "string" || typeof draft.message !== "string" || !draft.message.trim()) {
        warn("Pi notifications: invalid prepared text; using the original notification.");
        draft.title = payload.title ?? "Pi";
        draft.message = payload.message;
      }
      const result = await deliverNotification({ event: payload.event, title: draft.title, message: draft.message }, config.backend, shutdown.signal);
      if (!result.success && !shutdown.signal.aborted) warn(`Pi notifications: ${result.error}`);
      return result;
    },
  };
  globals[PI_NOTIFICATIONS_KEY] = service;

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    warned = false;
    if (shutdown.signal.aborted) shutdown = new AbortController();
    globals[PI_NOTIFICATIONS_KEY] = service;
    try {
      config = readConfig(pi.getSettings());
    } catch (error) {
      config = { ...readConfig({}), enabled: false };
      warn(`Pi notifications disabled: ${error instanceof Error ? error.message : "Invalid configuration."}`);
    }
    unsubscribe.forEach((off) => off());
    unsubscribe = [
      pi.events.on("notifications:notify", (data) => { void service.notify(data as NotificationPayload); }),
      pi.events.on("permissions:ask", (data) => {
        const toolName = isObject(data) && typeof data.toolName === "string" ? data.toolName : "unknown";
        void service.notify({ event: "permission_ask", message: `Permission required: ${toolName}` });
      }),
    ];
  });
  pi.on("session_shutdown", () => {
    shutdown.abort();
    context = undefined;
    unsubscribe.forEach((off) => off());
    unsubscribe = [];
    if (globals[PI_NOTIFICATIONS_KEY] === service) delete globals[PI_NOTIFICATIONS_KEY];
  });

  pi.on("agent_settled", async () => { await service.notify({ event: "agent_settled", message: "Agent finished." }); });
  pi.on("agent_end", async () => { await service.notify({ event: "agent_end", message: "Agent run ended" }); });
  pi.on("turn_end", async () => { await service.notify({ event: "turn_end", message: "Turn completed" }); });
  pi.on("tool_execution_start", async (event) => {
    await service.notify({ event: "tool_call", message: `Tool started: ${event.toolName}` });
  });
  pi.on("tool_execution_end", async (event) => {
    await service.notify({ event: event.isError ? "tool_error" : "tool_result", message: `Tool ${event.isError ? "failed" : "completed"}: ${event.toolName}` });
  });

  pi.registerCommand("notifications", {
    description: "Notification status, on|off for this session, or test",
    async handler(args, ctx) {
      const action = args.trim();
      if (action === "test") {
        const result = await service.notify({ event: "test", message: "Pi notifications are working" });
        let message = "Test notification dispatched.";
        if (!result.success) message = result.error ?? "Notification delivery failed.";
        if (result.skipped) message = "Notification skipped: check mode, enabled setting, event filter, and TTY availability.";
        ctx.ui.notify(message, result.success ? "info" : "warning");
        return;
      }
      if (action === "on" || action === "off") config.enabled = action === "on";
      else if (action) {
        ctx.ui.notify("Usage: /notifications [on|off|test]", "warning");
        return;
      }
      ctx.ui.notify(`Notifications ${config.enabled ? "on" : "off"} · backend ${config.backend}\n${Object.entries(config.events).map(([event, enabled]) => `${event}: ${enabled ? "on" : "off"}`).join("\n")}\nUnlisted custom events: on`, "info");
    },
  });
}
