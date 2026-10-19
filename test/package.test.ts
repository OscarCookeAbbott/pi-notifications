import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

test("Pi discovers the notification extension without adding agent tools", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-notifications-package-"));
  const globals = globalThis as Record<symbol, unknown>;
  const key = Symbol.for("pi.notifications");
  const previous = globals[key];
  t.after(async () => {
    if (previous === undefined) delete globals[key];
    else globals[key] = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: join(directory, "agent"),
    settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
    disabledBuiltinExtensions: ["mcp"],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.deepEqual([...result.extensions[0].tools.keys()], []);
  assert.deepEqual([...result.extensions[0].commands.keys()], ["notifications"]);
  assert.equal(typeof (globals[key] as { notify: unknown }).notify, "function");
});
