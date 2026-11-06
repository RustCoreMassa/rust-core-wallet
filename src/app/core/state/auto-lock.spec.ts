import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SESSION_KEY_STORE } from '../services/session-key-store';
import { APP_BACKGROUND_LOCK_MS, AUTO_LOCK_MS } from '../utils/auto-lock-time';
import { AuthStore } from './auth-store';
import { AutoLock, BACKGROUND_LOCK_MS } from './auto-lock';

describe('AutoLock — away from the app', () => {
  let hidden = false;

  /** Starts AutoLock as the unlocked shell does; `backgroundLockMs` as the build provides it. */
  function start(backgroundLockMs?: number | null) {
    let unlocked = true;
    const lock = vi.fn(() => (unlocked = false));
    const navigateByUrl = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isUnlocked: () => unlocked, lock } },
        { provide: Router, useValue: { navigateByUrl } },
        {
          provide: SESSION_KEY_STORE,
          useValue: { keepsKey: false, touch: () => {}, watch: () => () => {} },
        },
        ...(backgroundLockMs === undefined
          ? []
          : [{ provide: BACKGROUND_LOCK_MS, useValue: backgroundLockMs }]),
      ],
    });
    TestBed.runInInjectionContext(() => TestBed.inject(AutoLock).start());
    return { lock, navigateByUrl };
  }

  const fire = (type: string) => document.dispatchEvent(new Event(type));
  const wait = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const setHidden = (value: boolean) => {
    hidden = value;
    fire('visibilitychange');
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    TestBed.resetTestingModule(); // stops listening
    vi.useRealTimers();
  });

  it('app: locks when it comes back after a minute in the background', () => {
    const { lock, navigateByUrl } = start(APP_BACKGROUND_LOCK_MS);
    fire('pause');
    wait(APP_BACKGROUND_LOCK_MS);
    fire('resume');
    expect(lock).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('app: stays unlocked after a short trip to another app', () => {
    const { lock } = start(APP_BACKGROUND_LOCK_MS);
    fire('pause');
    wait(APP_BACKGROUND_LOCK_MS - 1_000);
    fire('resume');
    setHidden(false); // the page's own "shown again" right after
    expect(lock).not.toHaveBeenCalled();

    // Ten minutes later, another short trip: the earlier one doesn't count again.
    wait(10 * 60_000);
    fire('pause');
    wait(5_000);
    fire('resume');
    expect(lock).not.toHaveBeenCalled();
  });

  it('app: counts from whichever came first — the page hidden or `pause`', () => {
    const { lock } = start(APP_BACKGROUND_LOCK_MS);
    setHidden(true);
    wait(40_000);
    fire('pause');
    wait(30_000);
    fire('resume');
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('app: the page being hidden and shown is enough without Capacitor events', () => {
    const { lock } = start(APP_BACKGROUND_LOCK_MS);
    setHidden(true);
    wait(APP_BACKGROUND_LOCK_MS);
    setHidden(false);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('web and extension: time away only counts towards the idle lock', () => {
    const { lock } = start(); // BACKGROUND_LOCK_MS default: null
    fire('pause');
    setHidden(true);
    wait(2 * 60_000);
    fire('resume');
    setHidden(false);
    expect(lock).not.toHaveBeenCalled();

    setHidden(true);
    wait(AUTO_LOCK_MS);
    setHidden(false);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
