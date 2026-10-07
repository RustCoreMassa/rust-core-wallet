/// <reference types="chrome" />
// Opens the approval window (the wallet app, ?view=approve) for the background worker, and
// tells it when the user closed it. One window at a time: a new request brings it to the front.

/** The popup's size (src/extension/views.scss), so the app looks the same in both. */
const WIDTH = 380;
const HEIGHT = 600;

export class ApprovalWindow {
  private windowId: number | null = null;
  /** Firefox for Android has no windows API: there the approval opens as a tab. */
  private tabId: number | null = null;
  private opening: Promise<void> | null = null;

  constructor(private readonly onClosed: () => void) {
    chrome.windows?.onRemoved.addListener((id) => {
      if (id !== this.windowId) return;
      this.windowId = null;
      this.onClosed();
    });
    chrome.tabs.onRemoved.addListener((id) => {
      if (id !== this.tabId) return;
      this.tabId = null;
      this.onClosed();
    });
  }

  show(): void {
    this.opening ??= this.open()
      .catch((err) => console.error('Opening the approval window failed', err))
      .finally(() => (this.opening = null));
  }

  private async open(): Promise<void> {
    if (this.windowId !== null) {
      try {
        await chrome.windows.update(this.windowId, { focused: true });
        return;
      } catch {
        this.windowId = null; // closed without us hearing about it
      }
    }
    if (this.tabId !== null) {
      try {
        await chrome.tabs.update(this.tabId, { active: true });
        return;
      } catch {
        this.tabId = null;
      }
    }
    const url = chrome.runtime.getURL('index.html?view=approve');
    if (chrome.windows?.create) {
      const created = await chrome.windows.create({
        url,
        type: 'popup',
        width: WIDTH,
        height: HEIGHT,
        focused: true,
      });
      this.windowId = created?.id ?? null;
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      this.tabId = tab.id ?? null;
    }
  }
}
