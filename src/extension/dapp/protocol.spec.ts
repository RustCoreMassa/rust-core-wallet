import {
  CHANNEL,
  DappError,
  DappErrorCode,
  MAX_PARAMETER_BYTES,
  MAX_SIGN_BYTES,
  fromBase64,
  isPageRequest,
  needsApproval,
  needsSignature,
  parseRequest,
  toBase64,
} from './protocol';

const USER = 'AU12dG5xP1RDEB5ocdHkymNVvvSJmUL9BgHwCksDowqmGWxfpm93x';
const CONTRACT = 'AS12UMSUxgpRBB6ArZDJ19arHoxNkkpdfofQGekAiAJqsuE6PEFJy';

/** The DappError code parseRequest throws, or 'ok'. */
function codeOf(method: string, params?: unknown): number | 'ok' {
  try {
    parseRequest(method, params);
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(DappError);
    return (e as DappError).code;
  }
}

const b64 = (bytes: number[]) => toBase64(Uint8Array.from(bytes));

describe('isPageRequest', () => {
  it('accepts a request on our channel', () => {
    expect(isPageRequest({ channel: CHANNEL, id: 'a1', method: 'connect' })).toBe(true);
  });

  it('ignores other messages', () => {
    expect(isPageRequest(null)).toBe(false);
    expect(isPageRequest('connect')).toBe(false);
    expect(isPageRequest({ channel: 'other', id: 'a1', method: 'connect' })).toBe(false);
    expect(isPageRequest({ channel: CHANNEL, id: '', method: 'connect' })).toBe(false);
    expect(isPageRequest({ channel: CHANNEL, id: 'a b', method: 'connect' })).toBe(false);
    expect(isPageRequest({ channel: CHANNEL, id: 'a1', method: 42 })).toBe(false);
    expect(isPageRequest({ channel: CHANNEL, id: 'a1', method: 'x'.repeat(65) })).toBe(false);
  });
});

describe('parseRequest', () => {
  it('refuses raw bytecode and account management, like other Massa wallets', () => {
    for (const method of ['executeSC', 'deploySC', 'importAccount', 'deleteAccount']) {
      expect(codeOf(method, {})).toBe(DappErrorCode.UnsupportedMethod);
    }
    expect(codeOf('generateNewAccount')).toBe(DappErrorCode.UnsupportedMethod);
    expect(codeOf('setRpcUrl', { url: 'https://evil.example' })).toBe(
      DappErrorCode.UnsupportedMethod,
    );
    expect(codeOf('eth_sendTransaction', {})).toBe(DappErrorCode.UnsupportedMethod);
  });

  it('takes no params for connection methods', () => {
    expect(parseRequest('connect', undefined)).toEqual({ method: 'connect' });
    expect(parseRequest('account', { anything: true })).toEqual({ method: 'account' });
  });

  it('parses a transfer with an exact bigint amount', () => {
    expect(parseRequest('transfer', { to: USER, amount: '123456789012345678901' })).toEqual({
      method: 'transfer',
      to: USER,
      amount: 123456789012345678901n,
    });
  });

  it('rejects malformed transfer params', () => {
    const bad = [
      undefined,
      [],
      { to: USER },
      { to: USER, amount: 5 }, // a number loses precision: strings only
      { to: USER, amount: '1.5' },
      { to: USER, amount: '-1' },
      { to: USER, amount: '0' },
      { to: USER, amount: '01' },
      { to: USER, amount: '1'.repeat(40) },
      { to: 'AU123', amount: '1' },
      { to: 'not an address', amount: '1' },
    ];
    for (const params of bad) expect(codeOf('transfer', params)).toBe(DappErrorCode.InvalidParams);
  });

  it('parses rolls as a positive count', () => {
    expect(parseRequest('buyRolls', { rolls: '3' })).toEqual({ method: 'buyRolls', rolls: 3n });
    expect(codeOf('sellRolls', { rolls: '0' })).toBe(DappErrorCode.InvalidParams);
  });

  it('parses callSC with defaults for parameter and coins', () => {
    expect(parseRequest('callSC', { target: CONTRACT, func: 'increaseAllowance' })).toEqual({
      method: 'callSC',
      target: CONTRACT,
      func: 'increaseAllowance',
      parameter: new Uint8Array(),
      coins: 0n,
    });
    const full = parseRequest('callSC', {
      target: CONTRACT,
      func: 'swap',
      parameter: b64([1, 2, 3]),
      coins: '100000000',
      fee: '10000000',
      maxGas: '4000000',
    });
    expect(full).toEqual({
      method: 'callSC',
      target: CONTRACT,
      func: 'swap',
      parameter: Uint8Array.from([1, 2, 3]),
      coins: 100000000n,
      fee: 10000000n,
      maxGas: 4000000n,
    });
  });

  it('rejects calls to anything but a contract, odd function names and huge parameters', () => {
    expect(codeOf('callSC', { target: USER, func: 'f' })).toBe(DappErrorCode.InvalidParams);
    expect(codeOf('callSC', { target: CONTRACT, func: '' })).toBe(DappErrorCode.InvalidParams);
    expect(codeOf('callSC', { target: CONTRACT, func: 'a b' })).toBe(DappErrorCode.InvalidParams);
    expect(codeOf('callSC', { target: CONTRACT, func: 'f', parameter: 'not base64!' })).toBe(
      DappErrorCode.InvalidParams,
    );
    const huge = toBase64(new Uint8Array(MAX_PARAMETER_BYTES + 1));
    expect(codeOf('callSC', { target: CONTRACT, func: 'f', parameter: huge })).toBe(
      DappErrorCode.InvalidParams,
    );
    expect(codeOf('callSC', { target: CONTRACT, func: 'f', maxGas: '0' })).toBe(
      DappErrorCode.InvalidParams,
    );
  });

  it('parses a message to sign, within limits', () => {
    expect(parseRequest('sign', { data: b64([104, 105]) })).toEqual({
      method: 'sign',
      data: Uint8Array.from([104, 105]),
    });
    expect(codeOf('sign', { data: '' })).toBe(DappErrorCode.InvalidParams);
    expect(codeOf('sign', { data: 'hi' })).toBe(DappErrorCode.InvalidParams); // not base64
    const huge = toBase64(new Uint8Array(MAX_SIGN_BYTES + 1));
    expect(codeOf('sign', { data: huge })).toBe(DappErrorCode.InvalidParams);
  });
});

describe('approval rules', () => {
  it('asks the user for connecting and for every signature, never for status reads', () => {
    expect(needsApproval('connect')).toBe(true);
    for (const m of ['sign', 'transfer', 'buyRolls', 'sellRolls', 'callSC'] as const) {
      expect(needsApproval(m)).toBe(true);
      expect(needsSignature(m)).toBe(true);
    }
    for (const m of ['disconnect', 'connected', 'account', 'network'] as const) {
      expect(needsApproval(m)).toBe(false);
    }
    expect(needsSignature('connect')).toBe(false);
  });
});

describe('base64', () => {
  it('round-trips bytes', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('rejects text that is not base64', () => {
    expect(fromBase64('abc')).toBeNull();
    expect(fromBase64('ab$=')).toBeNull();
  });
});

describe('DappError', () => {
  it('serializes to code and message only', () => {
    const e = new DappError(DappErrorCode.UserRejected, 'Rejected by the user');
    expect(JSON.parse(JSON.stringify(e))).toEqual({ code: 4001, message: 'Rejected by the user' });
  });
});
