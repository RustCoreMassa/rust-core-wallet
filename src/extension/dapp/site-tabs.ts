/// <reference types="chrome" />
// Which browser tab shows which site, for the background worker — see docs/DAPP-CONNECTION.md.
//
// Events (accountChanged, networkChanged, disconnect) go to a site's tabs with
// chrome.tabs.sendMessage. The worker learns a tab when its page opens a port (the browser fills
// in port.sender.tab), and keeps the list in chrome.storage.session: the browser stops an idle
// worker, and the list must outlive it. A tab id stands for one site at a time — a page on
// another site replaces it when it opens its own port.

/** chrome.storage.session item: tab id → origin. */
export const SITE_TABS_ITEM = 'rustcore:dapp-tabs';

/** More tabs than anyone keeps open; past this the lowest (oldest) tab ids go. */
const MAX_TABS = 500;

type SessionArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
type TabMap = Readonly<Record<string, string>>;

export class SiteTabs {
  /** Writes one at a time: two pages opening ports together must not drop each other. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: SessionArea) {}

  /** Tab `tabId` now shows `origin`. */
  remember(tabId: number, origin: string): Promise<void> {
    return this.update((tabs) => {
      if (tabs[tabId] === origin) return null;
      const { [tabId]: _, ...others } = tabs;
      const kept = Object.entries(others).slice(-(MAX_TABS - 1));
      return { ...Object.fromEntries(kept), [tabId]: origin };
    });
  }

  /** The tab was closed, or no longer listens. */
  forget(tabId: number): Promise<void> {
    return this.update((tabs) => {
      if (!(tabId in tabs)) return null;
      const { [tabId]: _, ...others } = tabs;
      return others;
    });
  }

  /** Tabs last seen showing `origin`. */
  async of(origin: string): Promise<number[]> {
    await this.writes;
    return Object.entries(await this.read())
      .filter(([, o]) => o === origin)
      .map(([tabId]) => Number(tabId));
  }

  private update(change: (tabs: TabMap) => TabMap | null): Promise<void> {
    const next = this.writes.then(async () => {
      const changed = change(await this.read());
      if (changed) await this.area.set({ [SITE_TABS_ITEM]: changed });
    });
    this.writes = next.catch(() => {});
    return next;
  }

  private async read(): Promise<TabMap> {
    const stored: unknown = (await this.area.get(SITE_TABS_ITEM))[SITE_TABS_ITEM];
    if (typeof stored !== 'object' || stored === null) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([tabId, origin]) => /^\d{1,10}$/.test(tabId) && typeof origin === 'string',
      ),
    );
  }
}
