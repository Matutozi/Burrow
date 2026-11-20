import { CAPTURE_PERMISSIONS } from '../archive/capture';

/** Asks Chrome for page access. Must be called from a click, before any other await. */
export function requestCaptureAccess(): Promise<boolean> {
  return chrome.permissions.request(CAPTURE_PERMISSIONS);
}

/** Gives page access back when the user turns capture off. */
export async function releaseCaptureAccess(): Promise<void> {
  await chrome.permissions.remove(CAPTURE_PERMISSIONS);
}

/** Lets the service worker schedule automatic archiving. Must be called from a click. Shows no prompt. */
export function requestAlarmAccess(): Promise<boolean> {
  return chrome.permissions.request({ permissions: ['alarms'] });
}

export async function hasAlarmAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ['alarms'] });
  } catch {
    return false;
  }
}

/** Saves a JSON file through the browser's normal download flow. No permission or network needed. */
export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
