import type { TestContext } from "node:test";

export function terminal(t: TestContext) {
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  const env = { ...process.env };
  delete process.env.KITTY_WINDOW_ID;
  delete process.env.TMUX;
  delete process.env.WT_SESSION;
  t.after(() => {
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    process.env = env;
  });
  const writes: string[] = [];
  t.mock.method(process.stdout, "write", (text: string, callback?: (error?: Error) => void) => {
    writes.push(text);
    callback?.();
    return true;
  });
  return writes;
}
