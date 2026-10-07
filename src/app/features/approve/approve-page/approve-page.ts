import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ApprovalResult, ApprovalView } from '../../../../extension/dapp/approval';
import { DappRequest, parseRequest } from '../../../../extension/dapp/protocol';
import { VaultAccount } from '../../../core/models/vault.model';
import { DAPP_APPROVALS, DappApprovals } from '../../../core/platform/dapp-approvals';
import {
  NETWORK_FEE_MAS,
  OperationFailedError,
  OperationTimeoutError,
  ROLL_PRICE_MAS,
} from '../../../core/services/massa-provider';
import { AuthStore } from '../../../core/state/auth-store';
import { DappCall, WalletStore, dappCallFee } from '../../../core/state/wallet-store';
import { CallDescription, describeCall } from '../../../core/utils/describe-call';
import { formatUnits, toUnits } from '../../../core/utils/token-amount';
import { rejectedCallMessage, toUserMessage } from '../../../core/utils/user-error';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';

type Phase = 'loading' | 'review' | 'busy' | 'notice';

const MAS = 9;
const FEE_UNITS = toUnits(NETWORK_FEE_MAS, MAS);
const ROLL_UNITS = toUnits(ROLL_PRICE_MAS, MAS);

const TITLES: Record<DappRequest['method'], string> = {
  connect: 'Connect to this site?',
  disconnect: '',
  connected: '',
  account: '',
  network: '',
  sign: 'Sign a message',
  transfer: 'Send MAS',
  buyRolls: 'Buy rolls',
  sellRolls: 'Sell rolls',
  callSC: 'Contract call',
};

/**
 * The extension's approval window (?view=approve): shows the dApp requests waiting in the
 * background worker one at a time, and carries out the approved ones with the wallet's own
 * code — the same checks, fees and history as its own screens (docs/DAPP-CONNECTION.md).
 * Requests are for the site's connected account; the active wallet is never switched.
 */
@Component({
  selector: 'app-approve-page',
  imports: [ConfirmDetails, Dropdown],
  templateUrl: './approve-page.html',
  styleUrl: './approve-page.scss',
})
export class ApprovePage {
  private readonly approvals: DappApprovals = inject(DAPP_APPROVALS)!;
  private readonly auth = inject(AuthStore);
  private readonly store = inject(WalletStore);

  protected readonly view = signal<ApprovalView | null>(null);
  protected readonly request = signal<DappRequest | null>(null);
  protected readonly phase = signal<Phase>('loading');
  /** A failed attempt; the request stays, so the user can retry or reject. */
  protected readonly error = signal<string | null>(null);
  /** Why the request can't be approved as asked (e.g. not enough MAS); Approve stays off. */
  protected readonly blocker = signal<string | null>(null);
  /** The wallet's checks (and a contract call's test run) are still running; Approve waits. */
  protected readonly checking = signal(false);
  /** Shown after an answer that needs a word (the operation failed, the site went away). */
  protected readonly notice = signal<string | null>(null);
  /** For `connect`: the account the user chooses to share. */
  protected readonly chosenId = signal('');

  protected readonly accountOptions = computed<DropdownOption[]>(() =>
    this.auth.accounts().map((a) => ({ value: a.id, label: a.name, sublabel: short(a.address) })),
  );

  /** Who signs: the site's connected account, or the one chosen for `connect`. */
  protected readonly account = computed<VaultAccount | null>(() => {
    const view = this.view();
    if (!view) return null;
    const accounts = this.auth.accounts();
    return view.address === null
      ? (accounts.find((a) => a.id === this.chosenId()) ?? null)
      : (accounts.find((a) => a.address === view.address) ?? null);
  });

  /** For `callSC`: what the call does, as far as the wallet can read it. */
  protected readonly callInfo = computed<CallDescription | null>(() => {
    const request = this.request();
    const account = this.account();
    if (request?.method !== 'callSC' || !account) return null;
    return describeCall(request, account.address, this.store.network());
  });

  protected readonly title = computed(() => {
    const request = this.request();
    return request ? TITLES[request.method] : '';
  });

  protected readonly rows = computed<ConfirmRow[]>(() => {
    const request = this.request();
    const account = this.account();
    if (!request) return [];
    const rows: ConfirmRow[] = [];
    if (account && request.method !== 'connect') {
      rows.push({ label: 'Account', value: `${account.name} · ${short(account.address)}` });
    }
    rows.push({
      label: 'Network',
      value: this.store.network() === 'buildnet' ? 'Buildnet' : 'Mainnet',
    });
    const fee = { label: 'Network fee', value: `${NETWORK_FEE_MAS} MAS` };
    switch (request.method) {
      case 'transfer':
        rows.push(
          { label: 'To', value: request.to, mono: true },
          { label: 'Amount', value: `${formatUnits(request.amount, MAS)} MAS` },
          fee,
          {
            label: 'Total',
            value: `${formatUnits(request.amount + FEE_UNITS, MAS)} MAS`,
            strong: true,
          },
        );
        break;
      case 'buyRolls': {
        const cost = request.rolls * ROLL_UNITS;
        rows.push(
          { label: 'Rolls', value: request.rolls.toString() },
          { label: 'Cost', value: `${formatUnits(cost, MAS)} MAS` },
          fee,
          { label: 'Total', value: `${formatUnits(cost + FEE_UNITS, MAS)} MAS`, strong: true },
        );
        break;
      }
      case 'sellRolls':
        rows.push(
          { label: 'Rolls', value: request.rolls.toString() },
          {
            label: 'You receive',
            value: `${formatUnits(request.rolls * ROLL_UNITS, MAS)} MAS, after about 3 cycles`,
          },
          fee,
        );
        break;
      case 'callSC': {
        const info = this.callInfo();
        rows.push(
          { label: 'Contract', value: info?.contract ?? 'Unknown contract' },
          { label: 'Address', value: request.target, mono: true },
          { label: 'Function', value: request.func },
          ...(info?.rows ?? []),
        );
        if (request.coins > 0n) {
          rows.push({ label: 'MAS sent', value: `${formatUnits(request.coins, MAS)} MAS` });
        }
        rows.push({
          label: 'Network fee',
          value: `${formatUnits(dappCallFee(dappCall(request)), MAS)} MAS`,
        });
        break;
      }
    }
    return rows;
  });

  /** For `sign`: the message as text when it reads as text, otherwise as hex. */
  protected readonly message = computed(() => {
    const request = this.request();
    return request?.method === 'sign' ? describeBytes(request.data) : null;
  });

  protected readonly note = computed(() => {
    switch (this.request()?.method) {
      case 'connect':
        return 'The site will see this address and can ask you to approve transactions. It can never move funds without your approval.';
      case 'sign':
        return 'Only sign messages from sites you trust: a signature can prove you agreed to something.';
      default:
        return null;
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.approvals.keepAlive());
    for (const a of this.auth.accounts()) this.store.ensureWallet(a.id, a.name, a.address);
    void this.showNext();
  }

  protected async approve(): Promise<void> {
    const view = this.view();
    const request = this.request();
    const account = this.account();
    if (!view || !request || !account || this.blocker() || this.checking()) return;
    if (this.phase() !== 'review') return;
    this.phase.set('busy');
    this.error.set(null);

    let result: ApprovalResult;
    let notice: string | null = null;
    try {
      result = await this.carryOut(request, account);
    } catch (err) {
      // Sent, but it failed on-chain or isn't confirmed yet: the site still gets the operation,
      // to follow its status itself. Anything else (checks, network) sent nothing — retry or reject.
      if (!(err instanceof OperationFailedError || err instanceof OperationTimeoutError)) {
        this.error.set(toUserMessage(err));
        this.phase.set('review');
        return;
      }
      result = { operationId: err.operationId };
      notice = toUserMessage(err);
    }

    const delivered = await this.approvals.resolve(view.approvalId, result).catch(() => false);
    if (!delivered) {
      notice ??= 'The site closed, or the request expired, before the answer could reach it.';
    }
    if (notice) {
      this.notice.set(notice);
      this.phase.set('notice');
    } else {
      await this.showNext();
    }
  }

  protected async reject(): Promise<void> {
    const view = this.view();
    if (!view || this.phase() === 'busy') return;
    await this.approvals.reject(view.approvalId).catch(() => false);
    await this.showNext();
  }

  protected continue(): void {
    void this.showNext();
  }

  /** Shows the next waiting request, or closes the window when there is none. */
  private async showNext(): Promise<void> {
    this.phase.set('loading');
    this.error.set(null);
    this.blocker.set(null);
    this.checking.set(false);
    this.notice.set(null);
    this.request.set(null);

    const view = await this.approvals.next().catch((err) => {
      console.error('Reading the next dApp request failed', err);
      return null;
    });
    if (!view) {
      this.approvals.close();
      return;
    }
    let request: DappRequest;
    try {
      // The background checked it already; checking again costs nothing.
      request = parseRequest(view.method, view.params);
    } catch {
      await this.approvals.reject(view.approvalId).catch(() => false);
      return this.showNext();
    }
    this.view.set(view);
    this.request.set(request);
    this.chosenId.set(this.auth.activeAccount()?.id ?? '');
    this.phase.set('review');
    await this.check(request);
  }

  /**
   * Runs the wallet's own checks first, so a request that can't go through says so up front —
   * and a contract call is run read-only (simulated) before it can be approved.
   */
  private async check(request: DappRequest): Promise<void> {
    if (request.method === 'connect' || request.method === 'sign') {
      if (request.method === 'sign' && !this.account()) this.blockMissingAccount();
      return;
    }
    const account = this.account();
    if (!account) {
      this.blockMissingAccount();
      return;
    }
    this.checking.set(true);
    try {
      await this.store.prepareDappWallet(account.id);
      if (request.method === 'transfer') {
        this.store.validateDappTransfer(account.id, request.to, request.amount);
      } else if (request.method === 'buyRolls' || request.method === 'sellRolls') {
        const kind = request.method === 'buyRolls' ? 'buy' : 'sell';
        this.store.validateDappRolls(account.id, kind, request.rolls);
      } else if (request.method === 'callSC') {
        const call = dappCall(request);
        this.store.validateDappCall(account.id, call);
        const simulation = await this.store.simulateDappCall(account.id, call);
        if (simulation.error && this.request() === request) {
          this.blocker.set(rejectedCallMessage(simulation.error));
        }
      }
    } catch (err) {
      if (this.request() === request) this.blocker.set(toUserMessage(err));
    } finally {
      if (this.request() === request) this.checking.set(false);
    }
  }

  private blockMissingAccount(): void {
    this.blocker.set(
      "This site is connected to a wallet that's no longer in RustCore Wallet. Reject, then connect again.",
    );
  }

  private async carryOut(request: DappRequest, account: VaultAccount): Promise<ApprovalResult> {
    switch (request.method) {
      case 'connect':
        return { address: account.address };
      case 'sign':
        return this.store.dappSign(account.id, request.data);
      case 'transfer':
        return {
          operationId: await this.store.dappTransfer(account.id, request.to, request.amount),
        };
      case 'buyRolls':
        return { operationId: await this.store.dappRolls(account.id, 'buy', request.rolls) };
      case 'sellRolls':
        return { operationId: await this.store.dappRolls(account.id, 'sell', request.rolls) };
      case 'callSC':
        return { operationId: await this.store.dappCall(account.id, dappCall(request)) };
      default:
        throw new Error("This request isn't supported yet");
    }
  }
}

/** A `callSC` request as the wallet carries it out (fee and gas only when the site set them). */
function dappCall(request: Extract<DappRequest, { method: 'callSC' }>): DappCall {
  return {
    target: request.target,
    func: request.func,
    parameter: request.parameter,
    coins: request.coins,
    ...(request.fee !== undefined && { fee: request.fee }),
    ...(request.maxGas !== undefined && { maxGas: request.maxGas }),
  };
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Text if the bytes are readable UTF-8 (no control characters but tabs and newlines), else hex. */
export function describeBytes(data: Uint8Array): { text: string; hex: boolean } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { text, hex: false };
  } catch {
    // not UTF-8
  }
  return {
    text: `0x${Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')}`,
    hex: true,
  };
}
