/**
 * Protection against "sign this message" requests that are really a Massa
 * transaction in disguise.
 *
 * A Massa node checks every signed object — operations (transfers, contract
 * calls, rolls…), endorsements, block headers — against the signature of
 * `chainId (8 bytes, big-endian) ‖ public key ‖ content`, and massa-web3
 * signs messages with the very same function, on the raw bytes. So a site
 * asking to sign exactly those bytes would get a valid signature for a
 * transfer of its choosing, which it could then send to any node. These
 * checks refuse any message with that layout; ordinary messages (text,
 * login challenges…) never have it.
 *
 * No imports: the extension's background worker uses it too (dapp/protocol.ts).
 */

/** Shown to the user, and to the site, when a message is refused. */
export const REFUSED_SIGN_MESSAGE =
  "This message is shaped like a Massa operation that could move your funds — RustCore Wallet won't sign it.";

const CHAIN_ID_BYTES = 8;
/** massa-web3's CHAIN_ID.Mainnet and CHAIN_ID.Buildnet (sign-guard.spec.ts checks they match). */
export const KNOWN_CHAIN_IDS: readonly bigint[] = [77658377n, 77658366n];

/** Starts with the chain id of a Massa network (the first part of every signed object). */
export function startsWithChainId(data: Uint8Array): boolean {
  if (data.length < CHAIN_ID_BYTES) return false;
  const chainId = new DataView(data.buffer, data.byteOffset, CHAIN_ID_BYTES).getBigUint64(0, false);
  return KNOWN_CHAIN_IDS.includes(chainId);
}

/**
 * Has the layout of a Massa object signed by `publicKey` (its versioned
 * bytes): 8 bytes of any chain id, then that public key. Catches networks
 * whose chain id the wallet doesn't know, too.
 */
export function carriesPublicKey(data: Uint8Array, publicKey: Uint8Array): boolean {
  if (data.length < CHAIN_ID_BYTES + publicKey.length) return false;
  return publicKey.every((byte, i) => data[CHAIN_ID_BYTES + i] === byte);
}

/** Whether a message must never be signed by the key whose public key is given. */
export function isRefusedMessage(data: Uint8Array, publicKey: Uint8Array): boolean {
  return startsWithChainId(data) || carriesPublicKey(data, publicKey);
}

/** Thrown instead of signing a message with an operation's layout. */
export class RefusedSignError extends Error {
  constructor() {
    super(REFUSED_SIGN_MESSAGE);
    this.name = 'RefusedSignError';
  }
}
