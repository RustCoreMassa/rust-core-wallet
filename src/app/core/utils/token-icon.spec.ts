import { IPFS_GATEWAY, iconSource, parseIconLink } from './token-icon';

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('parseIconLink', () => {
  it('accepts https:// links, normalised', () => {
    expect(parseIconLink('  https://example.com/logo.png ')).toBe('https://example.com/logo.png');
    expect(parseIconLink('HTTPS://Example.com/a b.svg')).toBe('https://example.com/a%20b.svg');
  });

  it('accepts ipfs:// links, with or without a path', () => {
    expect(parseIconLink(`ipfs://${CID}`)).toBe(`ipfs://${CID}`);
    expect(parseIconLink(`ipfs://${CID}/icons/token.png`)).toBe(`ipfs://${CID}/icons/token.png`);
    expect(() => parseIconLink('ipfs://short')).toThrow(/https:\/\/ or ipfs:\/\//);
  });

  it('never takes plain http://', () => {
    expect(() => parseIconLink('http://localhost:8080/x.png')).toThrow(/https:\/\/ or ipfs:\/\//);
    expect(() => parseIconLink('http://example.com/x.png')).toThrow(/https:\/\/ or ipfs:\/\//);
  });

  it('refuses every other kind of link', () => {
    for (const link of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      'file:///etc/passwd',
      'ftp://example.com/x.png',
      'example.com/logo.png',
      'https://',
    ]) {
      expect(() => parseIconLink(link), link).toThrow();
    }
  });

  it('refuses links with a login in them', () => {
    expect(() => parseIconLink('https://user:pass@example.com/x.png')).toThrow(/login/);
  });

  it('treats an empty field as "no icon"', () => {
    expect(parseIconLink('   ')).toBeNull();
  });
});

describe('iconSource', () => {
  it('loads ipfs:// through the public gateway, anything else as is', () => {
    expect(iconSource(`ipfs://${CID}/a.png`)).toBe(`${IPFS_GATEWAY}${CID}/a.png`);
    expect(iconSource('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});
