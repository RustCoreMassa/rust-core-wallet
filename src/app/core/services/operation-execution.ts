import { Operation, OperationStatus } from '@massalabs/massa-web3';
import { OperationFailedError, OperationResult, OperationTimeoutError } from './massa-provider';

/**
 * Waits until the chain has executed `operation` (speculatively — in a
 * block, not yet final; a few seconds) and turns its outcome into a
 * result or a typed error. Every write in the app goes through this, so
 * nothing is reported as done before the chain has actually done it.
 */
export async function waitExecuted(operation: Operation): Promise<OperationResult> {
  const status = await operation.waitSpeculativeExecution();
  switch (status) {
    case OperationStatus.SpeculativeSuccess:
    case OperationStatus.Success:
      return { operationId: operation.id };
    case OperationStatus.SpeculativeError:
    case OperationStatus.Error:
      throw new OperationFailedError(operation.id, await failureReason(operation));
    default:
      throw new OperationTimeoutError(operation.id);
  }
}

/**
 * The execution error the node reported for a failed operation, e.g.
 * `{"massa_execution_error":"…insufficient balance…"}` → the inner text.
 */
async function failureReason(operation: Operation): Promise<string> {
  try {
    const events = await operation.getSpeculativeEvents();
    const error = events.find((e) => e.context?.is_error) ?? events.at(-1);
    if (!error?.data) return 'rejected by the network';
    try {
      const parsed = JSON.parse(error.data) as { massa_execution_error?: string };
      return (parsed.massa_execution_error ?? error.data).slice(0, 200);
    } catch {
      return error.data.slice(0, 200);
    }
  } catch {
    return 'rejected by the network';
  }
}
