import { CLIPBOARD_CLEAR_MS, copySecret } from './secret-clipboard';

describe('copySecret', () => {
  it('copies the secret, then empties the clipboard after a minute', async () => {
    const writes: string[] = [];
    const clipboard = { writeText: vi.fn(async (text: string) => void writes.push(text)) };
    let scheduled: { run: () => void; ms: number } | null = null;

    await copySecret('S1secret', clipboard, (run, ms) => (scheduled = { run, ms }));

    expect(writes).toEqual(['S1secret']);
    expect(scheduled!.ms).toBe(CLIPBOARD_CLEAR_MS);
    expect(CLIPBOARD_CLEAR_MS).toBe(60_000);
    scheduled!.run();
    expect(writes).toEqual(['S1secret', '']);
  });

  it('fails like the clipboard does, and schedules nothing then', async () => {
    const later = vi.fn();
    const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
    await expect(copySecret('S1secret', clipboard, later)).rejects.toThrow('denied');
    expect(later).not.toHaveBeenCalled();
  });

  it('ignores a refused clear (the page lost focus)', async () => {
    let clear: () => void = () => {};
    const clipboard = {
      writeText: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('not focused')),
    };
    await copySecret('S1secret', clipboard, (run) => (clear = run));
    expect(() => clear()).not.toThrow();
  });
});
