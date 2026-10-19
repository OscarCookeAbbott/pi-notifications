import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";

test("defaults enable only turn end; partial settings preserve other defaults", () => {
  assert.deepEqual(Object.entries(readConfig({}).events).filter(([, enabled]) => enabled).map(([event]) => event), ["turn_end"]);
  const config = readConfig({ notifications: { backend: "native", events: { turn_end: true, "tasks.add": false } } });
  assert.equal(config.enabled, true);
  assert.equal(config.backend, "native");
  assert.equal(config.events.agent_settled, false);
  assert.equal(config.events.turn_end, true);
  assert.equal(config.events.tool_call, false);
  assert.equal(config.events.tool_error, false);
  assert.equal(config.events["tasks.add"], false);
  assert.equal(readConfig({ notifications: { enabled: false } }).enabled, false);
});

test("invalid configuration is rejected rather than accidentally enabling notifications", () => {
  for (const notifications of [null, [], true, { enabled: "false" }, { backend: "shell" }, { events: [] }, { events: { turn_end: 1 } }, { events: { " ": true } }, { unexpected: true }]) {
    assert.throws(() => readConfig({ notifications }), /notifications/i);
  }
});
