/// <reference types="chrome" />
// The extension's DappApprovals: the approval window (the wallet app, ?view=approve) talking to
// the background worker's router — see docs/DAPP-CONNECTION.md.
import { DappApprovals } from '../../app/core/platform/dapp-approvals';
import {
  APPROVAL_KEEPALIVE_MS,
  APPROVAL_PORT,
  ApprovalMessage,
  ApprovalResult,
  ApprovalView,
} from './approval';

export class ChromeDappApprovals implements DappApprovals {
  async next(): Promise<ApprovalView | null> {
    return (await this.send({ type: 'rustcore:approval:next' })) as ApprovalView | null;
  }

  async resolve(approvalId: string, result: ApprovalResult): Promise<boolean> {
    return (await this.send({ type: 'rustcore:approval:resolve', approvalId, result })) === true;
  }

  async reject(approvalId: string): Promise<boolean> {
    return (await this.send({ type: 'rustcore:approval:reject', approvalId })) === true;
  }

  keepAlive(): () => void {
    let port: chrome.runtime.Port | null = chrome.runtime.connect({ name: APPROVAL_PORT });
    port.onDisconnect.addListener(() => (port = null));
    const timer = setInterval(() => {
      try {
        port ??= chrome.runtime.connect({ name: APPROVAL_PORT });
        port.postMessage('ping');
      } catch {
        port = null;
      }
    }, APPROVAL_KEEPALIVE_MS);
    return () => {
      clearInterval(timer);
      port?.disconnect();
      port = null;
    };
  }

  close(): void {
    window.close();
  }

  private send(message: ApprovalMessage): Promise<unknown> {
    return chrome.runtime.sendMessage(message);
  }
}
