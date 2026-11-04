import { IPFS_GATEWAY, MEDIA_HOSTS, mediaUrl } from './media-hosts';

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('mediaUrl', () => {
  it('allows the IPFS gateway and RustCore only', () => {
    expect(MEDIA_HOSTS).toEqual(['ipfs.io', 'nft.rustcoremassa.com']);
    expect(IPFS_GATEWAY).toBe('https://ipfs.io/ipfs/');
  });

  it('opens ipfs:// links through the IPFS gateway', () => {
    expect(mediaUrl(`ipfs://${CID}/7.json`)).toBe(`https://ipfs.io/ipfs/${CID}/7.json`);
    expect(mediaUrl(`ipfs://ipfs/${CID}/7.json`)).toBe(`https://ipfs.io/ipfs/${CID}/7.json`);
  });

  it("keeps https links to RustCore's NFT server and the IPFS gateway", () => {
    expect(mediaUrl(' https://nft.rustcoremassa.com/metadata/1 ')).toBe(
      'https://nft.rustcoremassa.com/metadata/1',
    );
    expect(mediaUrl(`https://ipfs.io/ipfs/${CID}/1.png`)).toBe(`https://ipfs.io/ipfs/${CID}/1.png`);
  });

  it('refuses every other server, look-alikes included', () => {
    for (const link of [
      'https://nft.example.com/meta/1',
      'https://evil.example/1.png',
      'https://nft.rustcoremassa.com.evil.example/1',
      'https://evil-nft.rustcoremassa.com/1',
      'https://rustcoremassa.com/1',
      'https://cloudflare-ipfs.com/ipfs/' + CID,
      'https://ipfs.io.evil.example/ipfs/' + CID,
    ]) {
      expect(mediaUrl(link), link).toBe('');
    }
  });

  it('refuses anything that is not https', () => {
    for (const link of [
      '',
      'http://nft.rustcoremassa.com/1.json',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://user:pass@nft.rustcoremassa.com/1.json',
      'ftp://nft.rustcoremassa.com/1.json',
      'blob:https://nft.rustcoremassa.com/x',
      'not a link',
      'https://nft.rustcoremassa.com/' + 'x'.repeat(2048),
    ]) {
      expect(mediaUrl(link), link).toBe('');
    }
  });
});
