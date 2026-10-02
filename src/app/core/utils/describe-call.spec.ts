import { Args, ArrayTypes } from '@massalabs/massa-web3';
import { TOKEN_REGISTRY } from '../models/token.model';
import { DUSA } from '../services/dusa-contracts';
import { describeCall } from './describe-call';

const OWNER = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const OTHER = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const UNKNOWN_CONTRACT = 'AS12UMSUxgpRBB6ArZDJ19arHoxNkkpdfofQGekAiAJqsuE6PEFJy';
const USDC = TOKEN_REGISTRY['USDC.e'].contract;
const DAI = TOKEN_REGISTRY['DAI.e'].contract;

const call = (target: string, func: string, args: Args = new Args(), coins = 0n) => ({
  target,
  func,
  parameter: args.serialize(),
  coins,
});

describe('describeCall — tokens', () => {
  it('reads an MRC-20 transfer, in the token’s own decimals', () => {
    const d = describeCall(
      call(USDC, 'transfer', new Args().addString(OTHER).addU256(12_500_000n)),
      OWNER,
      'mainnet',
    );
    expect(d.contract).toBe('USDC.e token');
    expect(d.summary).toBe('Send 12.5 USDC.e');
    expect(d.rows).toContainEqual({ label: 'To', value: OTHER, mono: true });
    expect(d.warnings).toEqual([]);
  });

  it('reads an allowance for the Dusa router', () => {
    const d = describeCall(
      call(DAI, 'increaseAllowance', new Args().addString(DUSA.v2Router).addU256(10n ** 18n)),
      OWNER,
      'mainnet',
    );
    expect(d.summary).toBe('Allow Dusa router to spend 1 DAI.e');
    expect(d.warnings).toEqual([]);
  });

  it('warns about unlimited allowances and unknown spenders', () => {
    const d = describeCall(
      call(
        DAI,
        'increaseAllowance',
        new Args().addString(UNKNOWN_CONTRACT).addU256(2n ** 256n - 1n),
      ),
      OWNER,
      'mainnet',
    );
    expect(d.summary).toBe(`Allow ${UNKNOWN_CONTRACT} to spend unlimited DAI.e`);
    expect(d.warnings).toHaveLength(2);
    expect(d.warnings[0]).toMatch(/spend all your DAI\.e/);
    expect(d.warnings[1]).toMatch(/doesn’t know this spender/);
  });

  it('warns when tokens move from someone else', () => {
    const d = describeCall(
      call(USDC, 'transferFrom', new Args().addString(OTHER).addString(OWNER).addU256(1_000_000n)),
      OWNER,
      'mainnet',
    );
    expect(d.summary).toBe('Move 1 USDC.e between two addresses');
    expect(d.warnings).toEqual(['The tokens move from an address other than yours.']);
  });

  it('treats parameters that don’t decode completely as unknown', () => {
    const extra = new Args().addString(OTHER).addU256(1n).addU8(0n);
    const odd = new Args().addU256(1n);
    for (const args of [extra, odd]) {
      const d = describeCall(call(USDC, 'transfer', args), OWNER, 'mainnet');
      expect(d.summary).toBeNull();
      expect(d.warnings[0]).toMatch(/can't read what this call does/);
    }
  });

  it('decodes nothing on buildnet, where the registry contracts don’t exist', () => {
    const d = describeCall(
      call(USDC, 'transfer', new Args().addString(OTHER).addU256(1n)),
      OWNER,
      'buildnet',
    );
    expect(d.contract).toBeNull();
    expect(d.summary).toBeNull();
  });
});

describe('describeCall — Dusa swaps', () => {
  // The layout DusaSwap.swapCall (and @dusalabs/sdk) sends.
  const swapTokens = (to: string, withLegacy = true) => {
    const args = new Args()
      .addU256(5_000_000n) // 5 USDC.e in
      .addU256(1_000_000_000_000n) // ≥ 1000 MAS out
      .addArray([20n], ArrayTypes.U64);
    if (withLegacy) args.addArray([false], ArrayTypes.BOOL);
    return args
      .addArray([USDC, DUSA.wmas], ArrayTypes.STRING)
      .addString(to)
      .addU64(1_800_000_000_000n);
  };

  it('reads a token → MAS swap, with or without the legacy flags', () => {
    for (const withLegacy of [true, false]) {
      const d = describeCall(
        call(DUSA.v2Router, 'swapExactTokensForMAS', swapTokens(OWNER, withLegacy)),
        OWNER,
        'mainnet',
      );
      expect(d.contract).toBe('Dusa router');
      expect(d.summary).toBe('Swap 5 USDC.e for at least 1,000 MAS');
      expect(d.rows).toContainEqual({ label: 'Route', value: 'USDC.e → MAS' });
      expect(d.warnings).toEqual([]);
    }
  });

  it('reads a MAS → token swap: what you pay is the coins minus the storage deposit', () => {
    const args = new Args()
      .addU256(2_000_000n)
      .addArray([20n], ArrayTypes.U64)
      .addArray([false], ArrayTypes.BOOL)
      .addArray([DUSA.wmas, USDC], ArrayTypes.STRING)
      .addString(OWNER)
      .addU64(1_800_000_000_000n)
      .addU64(100_000_000n);
    const d = describeCall(
      call(DUSA.v2Router, 'swapExactMASForTokens', args, 50_100_000_000n),
      OWNER,
      'mainnet',
    );
    expect(d.summary).toBe('Swap 50 MAS for at least 2 USDC.e');
  });

  it('warns when the swapped tokens go to another address', () => {
    const d = describeCall(
      call(DUSA.v2Router, 'swapExactTokensForMAS', swapTokens(OTHER)),
      OWNER,
      'mainnet',
    );
    expect(d.warnings).toEqual(['The swapped tokens go to another address, not to this wallet.']);
  });
});

describe('describeCall — unknown calls', () => {
  it('names nothing it doesn’t know and warns', () => {
    const d = describeCall(call(UNKNOWN_CONTRACT, 'mint', new Args().addU64(1n)), OWNER, 'mainnet');
    expect(d).toEqual({
      contract: null,
      summary: null,
      rows: [],
      warnings: [
        "RustCore Wallet can't read what this call does. Approve it only if you trust this site.",
      ],
    });
  });

  it('still names a known contract when the function is unknown', () => {
    const d = describeCall(call(USDC, 'mint', new Args()), OWNER, 'mainnet');
    expect(d.contract).toBe('USDC.e token');
    expect(d.summary).toBeNull();
  });
});
