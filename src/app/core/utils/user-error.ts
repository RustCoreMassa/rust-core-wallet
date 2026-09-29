/**
 * Turns any thrown error into a short message fit for the screen.
 *
 * The app's own validation errors ("Enter a valid Massa address",
 * "Insufficient balance — …") are already written for users and pass
 * through unchanged. Raw node / VM / network errors — like
 * "readonly call failed: VM Error in ReadOnlyExecutionTarget::FunctionCall
 * … at ~lib/@massalabs/…/token.ts:197" — are mapped to a plain sentence;
 * the original goes to the console for debugging, never to the user.
 */

interface Rule {
  readonly test: RegExp;
  readonly message: string;
}

/** Most specific first. */
const RULES: readonly Rule[] = [
  {
    test: /insufficient (funds|balance)|not enough (funds|balance)|failed to transfer .* insufficient/i,
    message: "You don't have enough funds for this transaction, including fees.",
  },
  {
    test: /insufficient allowance/i,
    message: "The token wasn't approved for this swap. Please try again.",
  },
  {
    test: /NotEnoughCoinsSent|storage/i,
    message: 'Not enough MAS to cover the storage cost of this transaction.',
  },
  {
    test: /InsufficientAmountOut|AmountOutMin|slippage|too little received/i,
    message: 'The price moved beyond your slippage tolerance. Try again or allow more slippage.',
  },
  {
    test: /deadline|expired/i,
    message: 'The transaction expired before it was processed. Please try again.',
  },
  {
    test: /InsufficientLiquidity|no liquidity|No quote/i,
    message: 'There is not enough liquidity for this amount right now.',
  },
  {
    test: /invalid address|address.*invalid|Invalid (owner|spender|contract) address/i,
    message: 'That address is not valid.',
  },
  {
    test: /Failed to fetch|NetworkError|Network request failed|ECONN|ETIMEDOUT|Unexpected token '<'|is not valid JSON|status code 5\d\d|responded 5\d\d/i,
    message: "Couldn't reach the Massa network. Check your connection and try again.",
  },
];

/** Tell-tale signs of a raw, technical error that must never be shown as-is. */
const TECHNICAL =
  /VM Error|Runtime error|readonly call|ReadOnlyExecution|~lib\/|\.ts:\d+|at [\w$.]+ \(|Depth error|massa_execution_error|JSON|fetch|RPC|status code|[{}[\]]/i;

const GENERIC = "Something went wrong and the transaction wasn't completed. Please try again.";

/** Longest a pass-through message may be; anything longer is treated as technical. */
const MAX_PLAIN_LENGTH = 140;

export function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return GENERIC;

  const rule = RULES.find((r) => r.test.test(raw));
  const isTechnical = TECHNICAL.test(raw) || raw.length > MAX_PLAIN_LENGTH;

  if (isTechnical || rule) console.error('[wallet error]', err);
  if (rule && isTechnical) return rule.message;
  if (isTechnical) return GENERIC;
  return raw; // already user-facing
}
