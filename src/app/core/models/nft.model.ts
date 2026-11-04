/** A Massa Name System domain owned by an address — shown as `<name>.massa`. */
export interface MnsDomain {
  readonly name: string;
  /** Address the domain resolves to; `null` when it doesn't point anywhere. */
  readonly target: string | null;
}

/**
 * An NFT collection listed on RustCore Launchpad and verified by its team —
 * the only collections the wallet shows NFTs from, so spam or phishing NFTs
 * sent to the wallet never appear.
 */
export interface NftCollection {
  /** The MRC-721 contract. */
  readonly address: string;
  readonly name: string;
  readonly symbol: string;
  /** The logo link set on the Launchpad (https:// or ipfs://); '' when none. */
  readonly logoUrl: string;
  /** Marked as verified by the Launchpad's team. */
  readonly verified: boolean;
}

/** The NFTs a wallet holds in one collection, lowest token id first. */
export interface NftHolding {
  readonly collection: NftCollection;
  readonly ids: readonly bigint[];
}

/** A wallet's NFTs as read; `complete` is false when a read limit cut the list short. */
export interface NftGallery {
  readonly holdings: readonly NftHolding[];
  readonly complete: boolean;
}

/** One NFT held by the wallet. */
export interface OwnedNft {
  readonly collection: NftCollection;
  readonly id: bigint;
}

export interface NftAttribute {
  readonly trait: string;
  readonly value: string;
}

/**
 * An NFT's metadata JSON, cleaned: written by the collection's creator, so
 * only known fields are kept, as plain text.
 */
export interface NftMetadata {
  readonly name: string;
  readonly description: string;
  /** A loadable https URL; '' when missing or unusable. */
  readonly image: string;
  readonly attributes: readonly NftAttribute[];
}
