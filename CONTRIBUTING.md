# Contributing

Use Node 22.19 or newer. Run `npm ci --ignore-scripts`, `npm run check`, `npm test`, and `npm pack --dry-run` before submitting a change.

Keep Pi as a host-provided peer dependency and avoid third-party notification SDKs. Tests must mock terminal and subprocess boundaries rather than displaying notifications. Treat notification text as untrusted data; never interpolate it into shell commands or terminal control sequences without sanitising it.

Keep lifecycle hooks notification-only. Missing or broken notification delivery must not block tool execution or change persisted task state. Document new event names and defaults, and cover filtering, invalid configuration, headless output, and cleanup.
