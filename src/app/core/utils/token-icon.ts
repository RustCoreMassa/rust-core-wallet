/**
 * Icons for custom tokens: a link the user enters, loaded straight from
 * that server (or, for `ipfs://`, from a public IPFS gateway) every time the
 * token is shown — so the server sees the user's IP address. The UI says so.
 */

/** Where `ipfs://<cid>/<path>` is loaded from — browsers can't open ipfs:// themselves. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

const MAX_ICON_LINK_LENGTH = 2048;

const INVALID_LINK = 'Enter an https:// or ipfs:// link';

/** A CIDv0 (Qm…, base58) or CIDv1 (base32/base36…), then an optional path. */
const IPFS_LINK = /^ipfs:\/\/([A-Za-z0-9]{46,100})((?:\/[A-Za-z0-9._~%-]+)*)\/?$/;

/**
 * Checks an icon link as typed; returns it normalised, `null` for an empty
 * field, or throws a user-facing message. `https://` and `ipfs://` only —
 * never plain `http://`, which anyone on the network could read or swap.
 */
export function parseIconLink(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (text.length > MAX_ICON_LINK_LENGTH) throw new Error('This icon link is too long');

  const ipfs = IPFS_LINK.exec(text);
  if (ipfs) return `ipfs://${ipfs[1]}${ipfs[2]}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(INVALID_LINK);
  }
  if (url.protocol !== 'https:' || !url.hostname) throw new Error(INVALID_LINK);
  // user:password@host links are a phishing classic and never needed for an image.
  if (url.username || url.password) throw new Error("An icon link can't contain a login");
  return url.href;
}

/** What an `<img>` loads for a saved icon link. */
export function iconSource(link: string): string {
  return link.startsWith('ipfs://') ? IPFS_GATEWAY + link.slice('ipfs://'.length) : link;
}
