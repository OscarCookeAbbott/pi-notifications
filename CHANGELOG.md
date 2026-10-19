# Changelog

## 0.3.0

- Append the last nonblank line of the final assistant text to agent-finished notifications; never use thinking, tool output or stale text from earlier runs.
- Add optional detail text to the notification API/preparation draft, preserving final-output previews when running jobs replace the summary and sharing existing sanitisation/length limits.

## 0.2.1

- Document note-content previews in task notification integrations; notification transport and preview limits are unchanged.

## 0.2.0

- Notify only on agent_settled by default, with `Agent finished.`, instead of notifying after every model/tool turn.
- Add the synchronous notifications:prepare hook for replacing notification text before one dispatch, with original-payload isolation and invalid-text fallback.

## 0.1.0

- Add configurable agent, turn, tool, permission and custom desktop notifications; enable only turn end by default.
- Expose the `pi.notifications` global service and `notifications:notify` event-bus interface.
- Support terminal and native OS backends, bounded commands, safe text, headless-mode guards and lifecycle cleanup.
