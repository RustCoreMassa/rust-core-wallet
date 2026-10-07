/// <reference types="chrome" />
import { ExtensionView, OpenableView } from '../app/core/platform/app-platform';

/**
 * The extension runs in Chrome, Edge, Brave, Opera and Firefox (desktop and
 * Android) from one build, so what each browser offers is detected, never
 * assumed:
 * - side panel: Chrome/Edge `chrome.sidePanel`, or Firefox's sidebar
 *   (`sidebarAction`); neither on phones;
 * - full-screen tab: everywhere except phones, where the popup already
 *   fills the screen.
 */
export interface BrowserViewApis {
  /** Chromium's side panel; needs the window id, known before the click. */
  readonly sidePanel?: { open(options: { windowId: number }): Promise<void> };
  /** Firefox's sidebar; opens in the current window. */
  readonly sidebarAction?: { open(): Promise<void> };
  readonly isMobile: boolean;
}

export function canOpenView(view: OpenableView, apis: BrowserViewApis): boolean {
  if (apis.isMobile) return false;
  return view === 'tab' || !!apis.sidePanel || !!apis.sidebarAction;
}

/** `popup` unless the page was opened with ?view=side-panel / ?view=tab / ?view=approve. */
export function viewFromUrl(search: string): ExtensionView {
  const view = new URLSearchParams(search).get('view');
  return view === 'side-panel' || view === 'tab' || view === 'approve' ? view : 'popup';
}

/** What this browser exposes (Firefox has `browser.*`; its `chrome.*` may lack extras). */
export function detectViewApis(isMobile: boolean): BrowserViewApis {
  const firefox = (globalThis as { browser?: { sidebarAction?: BrowserViewApis['sidebarAction'] } })
    .browser;
  const chromeApis = chrome as unknown as {
    sidePanel?: BrowserViewApis['sidePanel'];
    sidebarAction?: BrowserViewApis['sidebarAction'];
  };
  return {
    sidePanel: chromeApis.sidePanel,
    sidebarAction: firefox?.sidebarAction ?? chromeApis.sidebarAction,
    isMobile,
  };
}
