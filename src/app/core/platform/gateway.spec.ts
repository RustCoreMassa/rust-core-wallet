import { OFFICIAL_URL, isOldGateway } from './gateway';

describe('isOldGateway', () => {
  it('recognises the community gateway the wallet used to live on', () => {
    expect(isOldGateway('wrustcore.deweb.half-red.net')).toBe(true);
    expect(isOldGateway('WRustCore.DeWeb.Half-Red.net')).toBe(true);
  });

  it('does not match the official gateway, other sites or local development', () => {
    expect(isOldGateway(new URL(OFFICIAL_URL).hostname)).toBe(false);
    expect(isOldGateway('rustcore.deweb.half-red.net')).toBe(false);
    expect(isOldGateway('wrustcore.deweb.half-red.net.evil.example')).toBe(false);
    expect(isOldGateway('localhost')).toBe(false);
  });
});
