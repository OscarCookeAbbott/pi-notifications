import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { test } from "node:test";
import { terminal } from "./helpers.ts";
import { deliverNotification } from "../src/delivery.ts";

test("terminal backends escape untrusted content, support Kitty and tmux, and bound text", async (t) => {
  const writes = terminal(t);
  const signal = new AbortController().signal;
  assert.deepEqual(await deliverNotification({ event: "test", title: "Pi;title\x07", message: "bad\x1b]777;injection\x07\nmessage" }, "terminal", signal), { success: true });
  assert.equal(writes[0], "\x1b]777;notify;Pi,title ;bad message\x07");
  process.env.KITTY_WINDOW_ID = "1";
  process.env.TMUX = "tmux";
  await deliverNotification({ event: "test", message: "Summary", detail: "x".repeat(2000) }, "terminal", signal);
  assert.equal(writes[1], `\x1b]99;i=pi-notifications:d=0;Pi\x1b\\\x1b]99;i=pi-notifications:p=body;Summary ${"x".repeat(992)}\x1b\\\x07`);
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
  assert.deepEqual(await deliverNotification({ event: "test", message: "hi" }, "auto", signal), { success: true, skipped: true });
  assert.equal(writes.length, 2);
});

test("native notifications pass text as data and bound subprocess execution", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const wt = process.env.WT_SESSION;
  delete process.env.WT_SESSION;
  t.after(() => {
    Object.defineProperty(process, "platform", platform);
    if (wt !== undefined) process.env.WT_SESSION = wt;
  });
  const calls: unknown[][] = [];
  const input: string[] = [];
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    calls.push(args.slice(0, 3));
    (args[3] as (error: null) => void)(null);
    return { stdin: { on() {}, end(text: string) { input.push(text); } } };
  });
  const signal = new AbortController().signal;
  const payload = { event: "test", title: 'Title "quoted"', message: 'Message " & $HOME' };
  for (const os of ["darwin", "linux", "win32"]) {
    Object.defineProperty(process, "platform", { configurable: true, value: os });
    assert.deepEqual(await deliverNotification(payload, "native", signal), { success: true });
  }
  assert.deepEqual(calls.map(([command]) => command), ["osascript", "notify-send", "powershell.exe"]);
  assert.deepEqual((calls[0][1] as string[]).slice(-2), [payload.title, payload.message]);
  assert.deepEqual(calls[1][1], ["--app-name=Pi", "--", payload.title, payload.message]);
  assert.ok(!(calls[2][1] as string[]).join(" ").includes(payload.message));
  assert.deepEqual(JSON.parse(input[2]), { title: payload.title, message: payload.message });
  for (const [, , options] of calls) assert.deepEqual(options, { timeout: 5000, maxBuffer: 16384, signal });
});

test("command failures and shutdown return structured errors without leaking process output", async (t) => {
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    (args[3] as (error: Error) => void)(new Error("private process output"));
    return { stdin: { on() {}, end() {} } };
  });
  const shutdown = new AbortController();
  const payload = { event: "test", message: "hello" };
  assert.deepEqual(await deliverNotification(payload, "native", shutdown.signal), {
    success: false, error: "Notification delivery failed; check backend availability and OS notification permissions.",
  });
  shutdown.abort();
  assert.deepEqual(await deliverNotification(payload, "native", shutdown.signal), { success: false, error: "Notifications service is shut down." });
});
