import { IPFS_GATEWAY } from './media-hosts';
import { iconSource, parseIconLink } from './token-icon';

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('parseIconLink', () => {
  it('accepts https:// links on the allowed media servers, normalised', () => {
    expect(parseIconLink('  https://nft.rustcoremassa.com/logo.png ')).toBe(
      'https://nft.rustcoremassa.com/logo.png',
    );
    expect(parseIconLink('HTTPS://NFT.RustCoreMassa.com/a b.svg')).toBe(
      'https://nft.rustcoremassa.com/a%20b.svg',
    );
    expect(parseIconLink(`https://ipfs.io/ipfs/${CID}`)).toBe(`https://ipfs.io/ipfs/${CID}`);
  });

  it('refuses https links on any other server (the CSPs would block them)', () => {
    for (const link of [
      'https://example.com/logo.png',
      'https://nft.rustcoremassa.com.evil.example/logo.png',
      'https://cloudflare-ipfs.com/ipfs/x.png',
    ]) {
      expect(() => parseIconLink(link), link).toThrow(
        /only from an ipfs:\/\/ link or nft\.rustcoremassa\.com/,
      );
    }
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
    expect(() => parseIconLink('https://user:pass@nft.rustcoremassa.com/x.png')).toThrow(/login/);
  });

  it('treats an empty field as "no icon"', () => {
    expect(parseIconLink('   ')).toBeNull();
  });
});

describe('iconSource', () => {
  it('loads ipfs:// through the public gateway, https on the allowed servers as is', () => {
    expect(iconSource(`ipfs://${CID}/a.png`)).toBe(`${IPFS_GATEWAY}${CID}/a.png`);
    expect(iconSource('https://nft.rustcoremassa.com/a.png')).toBe(
      'https://nft.rustcoremassa.com/a.png',
    );
  });

  it('loads nothing (the symbol badge) for a saved link on another server', () => {
    expect(iconSource('https://example.com/a.png')).toBe('');
  });
});
