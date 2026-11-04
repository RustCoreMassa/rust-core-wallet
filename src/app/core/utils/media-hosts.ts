/**
 * The only servers the wallet loads remote media from — NFT metadata, NFT
 * pictures, collection logos and custom token icons, on the web and in the
 * extension: the public IPFS gateway (for ipfs:// links) and RustCore's NFT
 * server. Anything else is never requested: NFTs then show only what's
 * on-chain (collection name, symbol, token id), tokens a badge with their
 * symbol.
 *
 * Both CSPs list exactly these hosts in `connect-src` and `img-src`
 * (src/index.html for the web app, src/extension/manifest.json for the
 * extension — csp.spec.ts checks both), and the README's list of network
 * destinations names them.
 */
export const MEDIA_HOSTS: readonly string[] = ['ipfs.io', 'nft.rustcoremassa.com'];

/** Where `ipfs://<cid>/<path>` is loaded from — browsers can't open ipfs:// themselves. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

const MAX_LINK_LENGTH = 2048;

/**
 * What the browser may load for a remote media link: `ipfs://<cid>/<path>`
 * through the IPFS gateway, or an `https://` link on MEDIA_HOSTS. Anything else
 * (other servers, plain http, data:, javascript:, links with a login…) gives
 * ''. Every remote media request goes through here.
 */
export function mediaUrl(link: string): string {
  const text = link.trim();
  if (!text || text.length > MAX_LINK_LENGTH) return '';
  const href = text.startsWith('ipfs://')
    ? IPFS_GATEWAY + text.slice('ipfs://'.length).replace(/^ipfs\//, '')
    : text;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  if (!MEDIA_HOSTS.includes(url.hostname)) return '';
  return url.href;
}
