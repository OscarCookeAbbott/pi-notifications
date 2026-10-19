# pi-notifications

Configurable desktop notifications for [Pi](https://pi.dev), with an optional API for other extensions. No third-party runtime dependencies, background processes, or extra agent tools.

## Install

Requires Node 22.19 or newer and Pi 1.2.0.

```sh
pi install git:github.com/OscarCookeAbbott/pi-notifications
```

Then `/reload`. For local development, run `pi -e ./pi-notifications/src/index.ts` from the parent directory.

Disable or remove `npm:@pi-lab/notify` before using this replacement to avoid running two independent notifiers. This package does not modify or remove the other extension or reuse its `pi-lab/notify.json` configuration.

Run `/notifications test` to check delivery. `/notifications` shows status; `/notifications on` and `/notifications off` toggle notifications for this session only. Reload restores the configured preference.

## Configure

Merge a `notifications` object into `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`, then `/reload`:

```json
{
  "notifications": {
    "enabled": true,
    "backend": "auto",
    "events": {
      "agent_settled": true,
      "agent_end": false,
      "turn_end": false,
      "tool_call": false,
      "tool_result": false,
      "tool_error": false,
      "permission_ask": false
    }
  }
}
```

Pi supplies merged global/project settings. Omitted settings use defaults. Only `agent_settled` is enabled by default, with the summary `Agent finished:` followed by the last nonblank line of the final assistant message, when available. **Custom API event names are accepted unless explicitly set to `false`**; task and job integrations are separately opt-in at the sender. Invalid configuration warns and disables delivery rather than accidentally enabling it.

- `agent_settled`: ready for input after all automatic continuations and queued work.
- `agent_end`: each agent run ends; queued work can still follow.
- `turn_end`: each model/tool turn ends, not necessarily the end of the user's request.
- `tool_call`: actual tool execution starts (`tool_execution_start`), including nested calls, not merely a proposed call that permissions may block.
- `tool_result`: successful tool execution ends. Failures use `tool_error` instead, avoiding duplicate notifications when both are enabled.
- `permission_ask`: consumes the `permissions:ask` event from compatible permission extensions.

Tool notifications contain only the tool name and status, never arguments or output. Per-tool notifications can be noisy and are opt-in. Turn-end notifications occur after each model/tool turn and are off by default; `agent_settled` waits until the agent is fully done, including queued work and automatic continuations.

The final-output preview uses only text blocks from the latest run's final assistant message, never thinking or tool output. Empty/textless final messages omit the preview, and a new run or session clears previous text. The preview may contain sensitive output and may appear on your lock screen. It shares the existing 1,000-character notification limit with the summary.

### Backends

- **`auto`** (default): matches the existing extension's transport: Windows/Windows Terminal uses PowerShell toast; Kitty uses OSC 99; other terminals use OSC 777. Requires Pi TUI mode. Unsupported terminals may ignore notifications; a successful result means dispatched, not necessarily displayed.
- **`terminal`**: Kitty OSC 99 or OSC 777, with a tmux bell. Requires Pi TUI mode and a TTY. Terminal notification support and OS permissions must be enabled.
- **`native`**: macOS `osascript`, Linux `notify-send`, Windows/WSL `powershell.exe`. Commands must exist and OS notifications must be allowed. Linux requires a desktop notification service. Also works in non-TUI modes when the OS desktop/session is available.

The `auto`/`terminal` backends skip non-interactive modes, never inserting terminal escapes into JSON/RPC/print output. Native commands receive text as data, not shell-interpolated code, and have a five-second timeout. Shutdown aborts active commands. Notification text is stripped of control sequences, flattened to one line, and limited to 100 title characters and 1,000 message characters. Native/terminal backends do not promise click-to-focus behavior.

Errors return structured results and warn at most once per session. Notifications never intentionally block tool execution or change its result; automatic handlers wait for dispatch to finish (at most five seconds for native commands). No retries or durable queue are used.

## Extension API

### Fire-and-forget event bus

Use Pi's shared event bus. No dependency, import or installed-package check is needed; with no consumer, the event is ignored:

```ts
pi.events.emit("notifications:notify", {
  event: "build.complete",
  title: "Pi Build",
  message: "Build succeeded",
});
```

Event names are routing/filter keys. Consumers can disable this example with `notifications.events["build.complete"] = false`. The event bus does not return a delivery result.

### Await a result

The service is published synchronously at `globalThis[Symbol.for("pi.notifications")]`. Resolve it when needed, not once at module load, so extension load order and reloads do not matter:

```ts
interface NotificationsService {
  notify(payload: {
    event: string;
    title?: string;
    message: string;
    detail?: string;
  }): Promise<{ success: boolean; skipped?: boolean; error?: string }>;
}

const notifications = (globalThis as Record<symbol, unknown>)[
  Symbol.for("pi.notifications")
] as NotificationsService | undefined;

const result = await notifications?.notify({
  event: "build.complete",
  message: "Build succeeded",
});
```

`success: true, skipped: true` means disabled, filtered, not started, or unavailable terminal/mode. Failures have `success: false` and an `error`. The title defaults to `Pi`. Optional `detail` text is appended after the message and shares its sanitisation and length limits. The symbol and types are exported from `src/index.ts`. On shutdown the extension unsubscribes event listeners and removes only its own singleton; stale service calls fail until that runtime starts another session.

### Prepare notification text

Immediately before dispatch, `notifications:prepare` receives a mutable draft `{ event, title, message, detail? }`. Synchronous listeners may replace `title`, `message` and `detail`; no additional notification is sent:

```ts
const off = pi.events.on("notifications:prepare", (value) => {
  const draft = value as { event: string; title: string; message: string; detail?: string };
  if (draft.event === "agent_settled") draft.message = "Agent finished: Background work remains.";
});
```

Scope listeners to your extension/session lifecycle and call `off()` during cleanup. Listeners must complete synchronously: asynchronous preparation is not awaited. Do not send another notification from a preparation listener. Event filters run first and cannot be bypassed by changing the draft's event. The caller's payload is not mutated. Replacing `message` leaves `detail` intact, so running-job summaries preserve the final-output preview. Invalid prepared text falls back to the original notification, and all prepared text still passes through backend sanitisation and length limits.

## Task and job integrations

`pi-tasks` and `pi-async-jobs` declare this package as an optional Git dependency. Load `pi-notifications` once as a Pi package: installing a dependency does not automatically register its extension, and dependency copies should not be added as duplicate extension entries.

Task/job-change notifications default to **off**. Opt in through Pi settings:

```json
{
  "tasks": { "notifications": "all" },
  "asyncJobs": { "notifications": "completed" }
}
```

- `tasks.notifications`: `none` (default), `tasks`, `notes`, or `all`. Emits after persisted task/note mutations and saved visibility changes. Events: `tasks.add`, `tasks.edit`, `tasks.move`, `tasks.complete`, `tasks.cancel`, `tasks.visibility`, `task_notes.record`, `task_notes.retract`, `task_notes.visibility`.
- `asyncJobs.notifications`: `none` (default), `started`, `completed`, or `all`. `all` also includes input sends and explicit termination. Events: `jobs.started`, `jobs.completed`, `jobs.input`, `jobs.terminated`. Job output is not streamed into notifications.

Independently of job-change settings, `pi-async-jobs` augments an enabled `agent_settled` notification while jobs run: `Agent finished: Jobs running: [ab], [cd].` It replaces the default text before dispatch rather than sending a duplicate, and leaves the default unchanged with no running jobs. Up to ten live job IDs are listed, with a remaining count for larger sets. Command text is intentionally excluded.

Task messages contain IDs, titles and status, not descriptions or outcomes. Note recording/retraction messages also include the original note text, subject to backend length and desktop display limits. A task operation includes any automatically closed ancestors; parents with unfinished children are described as waiting. Job messages contain IDs and status, never command text, input or logs. Reads, lists, restoration and failed mutations do not notify. Normal task results and the existing agent-facing async-job completion messages are unaffected by desktop notification settings or failures.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Tests mock terminal/subprocess boundaries; no desktop notifications, external services or credentials are required. Native command completion cannot confirm that an OS actually displayed a notification.
