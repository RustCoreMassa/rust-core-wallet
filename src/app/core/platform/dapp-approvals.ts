import { InjectionToken } from '@angular/core';
import { ApprovalResult, ApprovalView } from '../../../extension/dapp/approval';

/**
 * The approval window's line to the extension's background worker, which holds the dApp
 * requests waiting for the user (docs/DAPP-CONNECTION.md). Extension build only.
 */
export interface DappApprovals {
  /** The request to show now, or null when none is waiting. */
  next(): Promise<ApprovalView | null>;
  /** Reports what the wallet did for an approved request; false if the request is gone. */
  resolve(approvalId: string, result: ApprovalResult): Promise<boolean>;
  /** The user rejected the request. */
  reject(approvalId: string): Promise<boolean>;
  /** Keeps the background worker alive while the window is open; returns the stop function. */
  keepAlive(): () => void;
  /** Closes the approval window. */
  close(): void;
}

/** `null` in the web app, which has no dApp connections. */
export const DAPP_APPROVALS = new InjectionToken<DappApprovals | null>('DAPP_APPROVALS', {
  providedIn: 'root',
  factory: () => null,
});
