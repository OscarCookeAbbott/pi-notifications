import childProcess from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { NotificationConfig } from "./config.ts";

export interface NotificationPayload {
  event: string;
  title?: string;
  message: string;
}

export interface NotificationResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

export interface NotificationsService {
  notify(payload: NotificationPayload): Promise<NotificationResult>;
}

export const PI_NOTIFICATIONS_KEY = Symbol.for("pi.notifications");

function safeText(text: string, limit: number): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replaceAll(";", ",").slice(0, limit);
}

function run(command: string, args: string[], signal: AbortSignal, input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = childProcess.execFile(command, args, { timeout: 5000, maxBuffer: 16384, signal }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    // The process can exit before consuming stdin; its callback reports delivery failure.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

const windowsScript = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$nodes = $xml.GetElementsByTagName('text')
$nodes.Item(0).InnerText = $payload.title
$nodes.Item(1).InnerText = $payload.message
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi').Show($toast)
`;

export async function deliverNotification(payload: NotificationPayload, backend: NotificationConfig["backend"], signal: AbortSignal): Promise<NotificationResult> {
  if (signal.aborted) return { success: false, error: "Notifications service is shut down." };
  const title = safeText(payload.title ?? "Pi", 100);
  const message = safeText(payload.message, 1000);
  try {
    if (backend === "native" || (backend === "auto" && (process.platform === "win32" || process.env.WT_SESSION))) {
      if (process.platform === "darwin") {
        await run("osascript", ["-e", "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run", "--", title, message], signal);
      } else if (process.platform === "win32" || process.env.WT_SESSION) {
        await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript], signal, JSON.stringify({ title, message }));
      } else if (process.platform === "linux") {
        await run("notify-send", ["--app-name=Pi", "--", title, message], signal);
      } else {
        return { success: false, error: "Native notifications are not supported on this OS." };
      }
    } else {
      if (!process.stdout.isTTY) return { success: true, skipped: true };
      const sequence = process.env.KITTY_WINDOW_ID
        ? `\x1b]99;i=pi-notifications:d=0;${title}\x1b\\\x1b]99;i=pi-notifications:p=body;${message}\x1b\\`
        : `\x1b]777;notify;${title};${message}\x07`;
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(sequence + (process.env.TMUX ? "\x07" : ""), (error) => error ? reject(error) : resolve());
      });
    }
    return { success: true };
  } catch {
    return { success: false, error: signal.aborted ? "Notifications service is shut down." : "Notification delivery failed; check backend availability and OS notification permissions." };
  }
}
