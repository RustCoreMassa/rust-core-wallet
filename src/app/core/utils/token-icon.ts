import { MEDIA_HOSTS, mediaUrl } from './media-hosts';

/**
 * Icons for custom tokens: a link the user enters, loaded every time the
 * token is shown — only from the media servers the wallet allows
 * (MEDIA_HOSTS: the IPFS gateway for `ipfs://` links, or RustCore's server),
 * which then see the user's IP address. The UI says so.
 */

const MAX_ICON_LINK_LENGTH = 2048;

const INVALID_LINK = 'Enter an https:// or ipfs:// link';
const OTHER_SERVER = 'Icons can come only from an ipfs:// link or nft.rustcoremassa.com';

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
  // The CSPs let images load from these servers only (media-hosts.ts).
  if (!MEDIA_HOSTS.includes(url.hostname)) throw new Error(OTHER_SERVER);
  return url.href;
}

/** What an `<img>` loads for a saved icon link; '' (the symbol badge) when it isn't allowed. */
export function iconSource(link: string): string {
  return mediaUrl(link);
}
