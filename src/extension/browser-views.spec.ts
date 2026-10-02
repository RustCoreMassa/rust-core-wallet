import { BrowserViewApis, canOpenView, viewFromUrl } from './browser-views';

const opener = { open: async () => {} };

describe('browser views', () => {
  it('reads the view from the page URL, popup by default', () => {
    expect(viewFromUrl('')).toBe('popup');
    expect(viewFromUrl('?view=side-panel')).toBe('side-panel');
    expect(viewFromUrl('?view=tab')).toBe('tab');
    expect(viewFromUrl('?view=approve')).toBe('approve');
    expect(viewFromUrl('?view=anything-else')).toBe('popup');
  });

  it("offers a side panel through Chrome's or Firefox's API, or not at all", () => {
    const chrome: BrowserViewApis = { sidePanel: opener, isMobile: false };
    const firefox: BrowserViewApis = { sidebarAction: opener, isMobile: false };
    const neither: BrowserViewApis = { isMobile: false };
    expect(canOpenView('side-panel', chrome)).toBe(true);
    expect(canOpenView('side-panel', firefox)).toBe(true);
    expect(canOpenView('side-panel', neither)).toBe(false);
    expect(canOpenView('tab', neither)).toBe(true);
  });

  it('offers no other view on a phone, where the popup already fills the screen', () => {
    const android: BrowserViewApis = { sidebarAction: opener, isMobile: true };
    expect(canOpenView('tab', android)).toBe(false);
    expect(canOpenView('side-panel', android)).toBe(false);
  });
});
