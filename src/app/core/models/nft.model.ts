/** A Massa Name System domain owned by an address — shown as `<name>.massa`. */
export interface MnsDomain {
  readonly name: string;
  /** Address the domain resolves to; `null` when it doesn't point anywhere. */
  readonly target: string | null;
}
