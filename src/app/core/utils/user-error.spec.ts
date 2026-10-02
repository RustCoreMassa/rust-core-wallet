import { rejectedCallMessage, toUserMessage } from './user-error';

describe('toUserMessage', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('passes the app’s own, user-facing messages through unchanged', () => {
    for (const message of [
      'Enter a valid Massa address',
      'Insufficient balance — 0.01 MAS is kept for the network fee',
      'Not confirmed yet — it may still go through. Check History in a minute.',
    ]) {
      expect(toUserMessage(new Error(message))).toBe(message);
    }
  });

  it('never shows raw VM errors, mapping known causes to a plain sentence', () => {
    const vm =
      'readonly call failed: VM Error in ReadOnlyExecutionTarget::FunctionCall context: Depth error: ' +
      'Runtime error: error: Transfer failed: insufficient funds at ~lib/@massalabs/sc-standards/' +
      'assembly/contracts/FT/token.ts:197 col: 3';
    expect(toUserMessage(new Error(vm))).toBe(
      "You don't have enough funds for this transaction, including fees.",
    );
    expect(
      toUserMessage(
        new Error('VM Error: transferFrom failed: insufficient allowance at ~lib/token.ts:322'),
      ),
    ).toMatch(/approved/);
    expect(
      toUserMessage(
        new Error('Transaction failed: VM Error LBRouter__InsufficientAmountOut at ~lib/r.ts:1'),
      ),
    ).toMatch(/slippage/);
  });

  it('maps network failures, including an HTML page where JSON was expected', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'))).toMatch(
      /Couldn't reach the Massa network/,
    );
    expect(toUserMessage(new Error(`Unexpected token '<', "<html>" is not valid JSON`))).toMatch(
      /Couldn't reach/,
    );
  });

  it('falls back to a generic sentence for unknown technical errors', () => {
    const message = toUserMessage(new Error('VM Error: something odd at ~lib/x.ts:9'));
    expect(message).toMatch(/Something went wrong/);
    expect(message).not.toMatch(/VM Error|~lib/);
  });

  it('treats overly long messages as technical', () => {
    expect(toUserMessage(new Error('x'.repeat(300)))).toMatch(/Something went wrong/);
  });

  it('handles non-Error throwables', () => {
    expect(toUserMessage('Plain text')).toBe('Plain text');
    expect(toUserMessage(undefined)).toMatch(/Something went wrong/);
  });

  it('logs technical errors to the console for debugging', () => {
    const err = new Error('VM Error at ~lib/x.ts:1');
    toUserMessage(err);
    expect(console.error).toHaveBeenCalledWith('[wallet error]', err);
  });
});

describe('rejectedCallMessage', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('explains a failed test run in plain words, never with the raw VM error', () => {
    const raw =
      'readonly call failed: VM Error in ReadOnlyExecutionTarget::FunctionCall context: VM execution error: VM instance error: error: Transfer fail';
    expect(rejectedCallMessage(raw)).toBe(
      'The contract rejected this call in a test run, so it would fail.',
    );
    expect(rejectedCallMessage('VM Error … Storage__NotEnoughCoinsSent: 1200000')).toMatch(
      /storage cost/,
    );
  });
});
