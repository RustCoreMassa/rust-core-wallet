import { isIos } from './install-prompt';

describe('isIos', () => {
  it('recognises iPhone and iPad user agents (every iOS browser is WebKit)', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', 5)).toBe(
      true,
    );
    expect(
      isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/140.0 Mobile', 5),
    ).toBe(true);
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1', 5)).toBe(true);
  });

  it('recognises an iPad presenting itself as a Mac (touch screen)', () => {
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe(true);
  });

  it('does not match Android or a real Mac', () => {
    expect(
      isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile Safari/537.36', 5),
    ).toBe(false);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe(false);
  });
});
