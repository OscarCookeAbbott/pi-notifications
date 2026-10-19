import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { test, type TestContext } from "node:test";
import { createEventBus, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension, { PI_NOTIFICATIONS_KEY, type NotificationPayload, type NotificationsService } from "../src/index.ts";
import { terminal } from "./helpers.ts";

const globals = globalThis as Record<symbol, unknown>;

function harness(t: TestContext, settings: unknown = {}) {
  const previous = globals[PI_NOTIFICATIONS_KEY];
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const events = createEventBus();
  const notices: string[] = [];
  let command!: { handler(args: string, ctx: ExtensionCommandContext): Promise<void> };
  const ctx = { mode: "tui", ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionContext;
  extension({
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => handlers.set(name, handler),
    getSettings: () => settings,
    events,
    registerCommand: (_name: string, definition: typeof command) => { command = definition; },
  } as unknown as ExtensionAPI);
  const service = globals[PI_NOTIFICATIONS_KEY] as NotificationsService;
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  t.after(() => {
    emit("session_shutdown");
    if (previous === undefined) delete globals[PI_NOTIFICATIONS_KEY];
    else globals[PI_NOTIFICATIONS_KEY] = previous;
  });
  emit("session_start");
  return { events, notices, ctx, service, emit, command: (args: string) => command.handler(args, ctx as ExtensionCommandContext) };
}

test("defaults notify only when fully settled, with no tool input or output", async (t) => {
  const writes = terminal(t);
  const h = harness(t);
  await h.emit("agent_end", { messages: [] });
  await h.emit("tool_execution_start", { toolName: "bash", args: { command: "SECRET" } });
  await h.emit("tool_execution_end", { toolName: "bash", isError: false, result: "SECRET" });
  assert.equal(writes.length, 0);
  await h.emit("turn_end");
  await h.emit("tool_execution_end", { toolName: "bash", isError: true, result: "SECRET" });
  h.events.emit("permissions:ask", { toolName: "write", input: "SECRET" });
  assert.equal(writes.length, 0);
  await h.emit("agent_settled");
  assert.equal(writes.length, 1);
  assert.match(writes[0], /Agent finished:/);
  assert.ok(writes.every((text) => !text.includes("SECRET")));
});

test("configured lifecycle triggers and optional extension API share event filters", async (t) => {
  const writes = terminal(t);
  const h = harness(t, { notifications: { events: { agent_settled: false, turn_end: true, agent_end: true, tool_call: true, tool_result: true, "tasks.add": false } } });
  await h.emit("agent_settled");
  await h.emit("turn_end");
  await h.emit("agent_end", { messages: [] });
  await h.emit("tool_execution_start", { toolName: "read" });
  await h.emit("tool_execution_end", { toolName: "read", isError: false });
  assert.equal(writes.length, 4);
  h.events.emit("notifications:notify", { event: "tasks.add", message: "Hidden task" });
  assert.equal(writes.length, 4);
  h.events.emit("notifications:notify", { event: "tasks.complete", title: "Pi Tasks", message: "Finished" });
  assert.match(writes[4], /Pi Tasks;Finished/);
  assert.deepEqual(await h.service.notify({ event: "custom", message: "Custom notification" }), { success: true });
  assert.match(writes[5], /Custom notification/);
  for (const payload of [null, {}, { event: "", message: "hi" }, { event: "test", message: " " }, { event: "test", message: "hi", title: 3 }, { event: "test", message: "hi", detail: 3 }]) {
    assert.equal((await h.service.notify(payload as NotificationPayload)).success, false);
  }
  assert.equal(writes.length, 6);
});

test("commands control the session and headless mode cannot emit terminal escapes", async (t) => {
  const writes = terminal(t);
  const h = harness(t);
  await h.command("off");
  assert.deepEqual(await h.service.notify({ event: "custom", message: "hello" }), { success: true, skipped: true });
  await h.command("test");
  assert.match(h.notices.at(-1)!, /skipped/);
  await h.command("on");
  await h.command("test");
  assert.equal(writes.length, 1);
  await h.command("");
  assert.match(h.notices.at(-1)!, /Notifications on/);
  await h.command("invalid");
  assert.match(h.notices.at(-1)!, /Usage:/);
  Reflect.set(h.ctx, "mode", "json");
  await h.emit("agent_settled");
  assert.equal(writes.length, 1);
});

test("invalid settings disable notifications and shutdown cleans up listeners safely", async (t) => {
  const writes = terminal(t);
  const h = harness(t, { notifications: { enabled: "yes" } });
  assert.match(h.notices[0], /disabled/);
  await h.emit("agent_settled");
  assert.equal(writes.length, 0);
  const replacement = { ...h.service };
  globals[PI_NOTIFICATIONS_KEY] = replacement;
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  assert.equal(globals[PI_NOTIFICATIONS_KEY], replacement);
  assert.equal((await h.service.notify({ event: "test", message: "hi" })).success, false);
  h.events.emit("notifications:notify", { event: "test", message: "hi" });
  assert.equal(writes.length, 0);
  h.emit("session_start");
  assert.equal(globals[PI_NOTIFICATIONS_KEY], h.service);
  h.emit("session_shutdown");
  assert.equal(globals[PI_NOTIFICATIONS_KEY], undefined);
});

test("shutdown aborts native delivery; backend errors warn once without interrupting work", async (t) => {
  const h = harness(t, { notifications: { backend: "native" } });
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    (args[3] as (error: Error) => void)(new Error("missing notification command"));
    return { stdin: { on() {}, end() {} } };
  });
  await h.emit("agent_settled");
  await h.emit("agent_settled");
  assert.equal(h.notices.length, 1);
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    const { signal } = args[2] as { signal: AbortSignal };
    signal.addEventListener("abort", () => (args[3] as (error: Error) => void)(new Error("aborted")), { once: true });
    return { stdin: { on() {}, end() {} } };
  });
  const pending = h.service.notify({ event: "custom", message: "hello" });
  h.emit("session_shutdown");
  assert.deepEqual(await pending, { success: false, error: "Notifications service is shut down." });
});

test("synchronous preparation replaces one notification without mutating callers or bypassing filters", async (t) => {
  const writes = terminal(t);
  const h = harness(t);
  let prepared = 0;
  const off = h.events.on("notifications:prepare", (value) => {
    const draft = value as NotificationPayload;
    prepared++;
    draft.event = "tool_call";
    draft.message = "Agent finished: Jobs running: [ab], [cd].";
  });
  const payload = { event: "agent_settled", message: "Agent finished:" };
  assert.deepEqual(await h.service.notify(payload), { success: true });
  assert.equal(writes.length, 1);
  assert.match(writes[0], /Jobs running: \[ab\], \[cd\]\./);
  assert.equal(payload.message, "Agent finished:");
  assert.equal(payload.event, "agent_settled");
  await h.emit("turn_end");
  assert.equal(prepared, 1);
  assert.equal(writes.length, 1);
  off();
  await h.emit("agent_settled");
  assert.match(writes[1], /;Agent finished:\x07$/);
  h.events.on("notifications:prepare", (value) => { (value as NotificationPayload).message = " "; });
  await h.emit("agent_settled");
  assert.match(writes[2], /;Agent finished:\x07$/);
  assert.match(h.notices[0], /invalid prepared text/);
});

test("settled previews use the final assistant text and survive summary replacement without leaking stale output", async (t) => {
  const writes = terminal(t);
  const h = harness(t);
  const assistant = (content: unknown[]) => ({ role: "assistant", content });
  h.emit("agent_start");
  await h.emit("agent_end", { messages: [
    assistant([{ type: "text", text: "Earlier reply" }]),
    assistant([{ type: "thinking", thinking: "PRIVATE_THINKING" }, { type: "text", text: "First line\r\nLast visible line\x1b[0m \r\n\r\n" }]),
    { role: "toolResult", content: [{ type: "text", text: "PRIVATE_TOOL_OUTPUT" }] },
  ] });
  await h.emit("agent_settled");
  assert.equal(writes[0], "\x1b]777;notify;Pi;Agent finished: Last visible line\x07");
  const off = h.events.on("notifications:prepare", (value) => {
    (value as NotificationPayload).message = "Agent finished: Jobs running: [ab].";
  });
  await h.emit("agent_settled");
  assert.equal(writes[1], "\x1b]777;notify;Pi;Agent finished: Jobs running: [ab]. Last visible line\x07");
  off();
  h.emit("agent_start");
  await h.emit("agent_settled");
  assert.equal(writes[2], "\x1b]777;notify;Pi;Agent finished:\x07");
  for (const messages of [[], [assistant([{ type: "text", text: "Outdated reply" }]), assistant([{ type: "thinking", thinking: "PRIVATE_THINKING" }])]]) {
    await h.emit("agent_end", { messages });
    await h.emit("agent_settled");
    assert.equal(writes.at(-1), "\x1b]777;notify;Pi;Agent finished:\x07");
  }
  assert.ok(writes.every((text) => !text.includes("PRIVATE")));
});
