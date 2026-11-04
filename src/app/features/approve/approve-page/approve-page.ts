import { Component, DestroyRef, InjectionToken, computed, inject, signal } from '@angular/core';
import { ApprovalResult, ApprovalView } from '../../../../extension/dapp/approval';
import { DappRequest, WalletNetwork, parseRequest } from '../../../../extension/dapp/protocol';
import { VaultAccount } from '../../../core/models/vault.model';
import { DAPP_APPROVALS, DappApprovals } from '../../../core/platform/dapp-approvals';
import {
  OperationFailedError,
  OperationTimeoutError,
  ROLL_PRICE_MAS,
} from '../../../core/services/massa-provider';
import { AuthStore } from '../../../core/state/auth-store';
import { AutoLock } from '../../../core/state/auto-lock';
import { DappCall, WalletStore, dappFee } from '../../../core/state/wallet-store';
import { CallDescription, describeCall } from '../../../core/utils/describe-call';
import { formatUnits, toUnits } from '../../../core/utils/token-amount';
import { rejectedCallMessage, toUserMessage } from '../../../core/utils/user-error';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';

type Phase = 'loading' | 'review' | 'busy' | 'notice';

const MAS = 9;
const ROLL_UNITS = toUnits(ROLL_PRICE_MAS, MAS);

/** When Approve may answer: after the window has been in front, untouched, for `delayMs`. */
export interface ApproveArming {
  readonly delayMs: number;
  /** The window is visible and has the focus. */
  inFront(): boolean;
}

/**
 * Against click- and tap-jacking: a site can make its request pop up the approval window right
 * under a click the user is about to make ("click here, fast, several times"). Approve stays off
 * until the window has been in front for a second without being clicked or typed in — every
 * press before that starts the second again, and a press that began before it never approves.
 */
export const APPROVE_ARMING = new InjectionToken<ApproveArming>('APPROVE_ARMING', {
  providedIn: 'root',
  factory: () => ({
    delayMs: 1000,
    inFront: () => document.visibilityState === 'visible' && document.hasFocus(),
  }),
});

const TITLES: Record<DappRequest['method'], string> = {
  connect: 'Connect to this site?',
  disconnect: '',
  connected: '',
  account: '',
  accounts: '',
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
 * Requests are signed by the account the background named (the site's choice among its
 * accounts, else its current one); the active wallet is never switched.
 */
@Component({
  selector: 'app-approve-page',
  imports: [ConfirmDetails],
  templateUrl: './approve-page.html',
  styleUrl: './approve-page.scss',
})
export class ApprovePage {
  private readonly approvals: DappApprovals = inject(DAPP_APPROVALS)!;
  private readonly auth = inject(AuthStore);
  private readonly store = inject(WalletStore);
  private readonly arming = inject(APPROVE_ARMING);

  /** Approve may answer now (APPROVE_ARMING). */
  protected readonly armed = signal(false);
  private armTimer: ReturnType<typeof setTimeout> | undefined;
  /** The press (pointer or key) now under way began while Approve was armed. */
  private pressArmed = true;

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
  /** For `connect`: the accounts the user chooses to share (ids). */
  protected readonly chosenIds = signal<ReadonlySet<string>>(new Set());

  /** For `connect`: every wallet, to tick the ones the site may see. */
  protected readonly accountChoices = computed(() =>
    this.auth.accounts().map((a) => ({
      id: a.id,
      name: a.name,
      address: short(a.address),
      chosen: this.chosenIds().has(a.id),
    })),
  );

  /**
   * For `connect`: the chosen accounts' addresses, the active wallet first when chosen — it
   * becomes the account the site uses.
   */
  protected readonly chosenAddresses = computed(() => {
    const chosen = this.auth.accounts().filter((a) => this.chosenIds().has(a.id));
    const active = this.store.activeWalletId();
    return [...chosen.filter((a) => a.id === active), ...chosen.filter((a) => a.id !== active)].map(
      (a) => a.address,
    );
  });

  /** Who signs: the account the background named; null for `connect`. */
  protected readonly account = computed<VaultAccount | null>(() => {
    const address = this.view()?.address;
    return address ? (this.auth.accounts().find((a) => a.address === address) ?? null) : null;
  });

  /** Approve is possible: an account chosen for `connect`, the signing account found otherwise. */
  protected readonly ready = computed(() =>
    this.request()?.method === 'connect' ? this.chosenAddresses().length > 0 : !!this.account(),
  );

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
    // What the operation pays: the site's fee, if it set one above the wallet's own.
    const paid = 'fee' in request ? dappFee(request.fee) : dappFee();
    const fee = {
      label: 'Network fee',
      value: `${formatUnits(paid, MAS)} MAS`,
      strong: paid > dappFee(),
    };
    switch (request.method) {
      case 'transfer':
        rows.push(
          { label: 'To', value: request.to, mono: true },
          { label: 'Amount', value: `${formatUnits(request.amount, MAS)} MAS` },
          fee,
          {
            label: 'Total',
            value: `${formatUnits(request.amount + paid, MAS)} MAS`,
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
          { label: 'Total', value: `${formatUnits(cost + paid, MAS)} MAS`, strong: true },
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
        rows.push(fee);
        break;
      }
    }
    return rows;
  });

  /** The site set a network fee above the wallet's own 0.01 MAS: said out loud, not just a row. */
  protected readonly feeWarning = computed(() => {
    const request = this.request();
    if (!request || !('fee' in request) || request.fee === undefined) return null;
    const fee = dappFee(request.fee);
    if (fee <= dappFee()) return null;
    return `This site set a network fee of ${formatUnits(fee, MAS)} MAS — the wallet's own is ${formatUnits(dappFee(), MAS)} MAS. The fee is paid even if the operation fails.`;
  });

  /** For `sign`: the message as text when it reads as text, otherwise as hex. */
  protected readonly message = computed(() => {
    const request = this.request();
    return request?.method === 'sign' ? describeBytes(request.data) : null;
  });

  protected readonly note = computed(() => {
    switch (this.request()?.method) {
      case 'connect':
        return 'The site will see these addresses and can ask you to approve transactions from them. It can never move funds without your approval.';
      case 'sign':
        return 'Only sign messages from sites you trust: a signature can prove you agreed to something.';
      default:
        return null;
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.approvals.keepAlive());
    // Locked elsewhere or left alone: back to the lock screen, then to this request.
    inject(AutoLock).start('/login?next=approve');
    this.watchAttention();
    for (const a of this.auth.accounts()) this.store.ensureWallet(a.id, a.name, a.address);
    void this.showNext();
  }

  protected toggleAccount(id: string): void {
    this.chosenIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async approve(): Promise<void> {
    const view = this.view();
    const request = this.request();
    if (!view || !request || !this.ready() || this.blocker() || this.checking()) return;
    if (!this.armed() || !this.pressArmed) return;
    if (this.phase() !== 'review') return;
    this.phase.set('busy');
    this.error.set(null);

    // The network the wallet sends on (it reads it as it starts): the site follows the operation
    // there, even if the user switches network before the answer reaches it.
    const network = this.store.network();
    let result: ApprovalResult;
    let notice: string | null = null;
    try {
      result = await this.carryOut(request, network);
    } catch (err) {
      // Sent, but it failed on-chain or isn't confirmed yet: the site still gets the operation,
      // to follow its status itself. Anything else (checks, network) sent nothing — retry or reject.
      if (!(err instanceof OperationFailedError || err instanceof OperationTimeoutError)) {
        this.error.set(toUserMessage(err));
        this.phase.set('review');
        return;
      }
      result = { operationId: err.operationId, network };
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
    this.disarm();
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
    // Like MetaMask: the active wallet is offered; the user can tick others.
    const active = this.store.activeWalletId();
    const known = this.auth.accounts().some((a) => a.id === active);
    this.chosenIds.set(new Set([known ? active : (this.auth.accounts()[0]?.id ?? '')]));
    this.phase.set('review');
    this.rearm();
    await this.check(request);
  }

  /** Approve waits for the window to be in front, untouched, for a while (APPROVE_ARMING). */
  private watchAttention(): void {
    const rearm = () => this.rearm();
    const disarm = () => this.disarm();
    const onPress = () => {
      this.pressArmed = this.armed();
      if (!this.armed()) this.rearm();
    };
    window.addEventListener('focus', rearm);
    window.addEventListener('blur', disarm);
    document.addEventListener('visibilitychange', rearm);
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onPress, true);
    inject(DestroyRef).onDestroy(() => {
      this.disarm();
      window.removeEventListener('focus', rearm);
      window.removeEventListener('blur', disarm);
      document.removeEventListener('visibilitychange', rearm);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onPress, true);
    });
  }

  private rearm(): void {
    this.disarm();
    if (this.phase() !== 'review' || !this.arming.inFront()) return;
    this.armTimer = setTimeout(() => this.armed.set(true), this.arming.delayMs);
  }

  private disarm(): void {
    clearTimeout(this.armTimer);
    this.armed.set(false);
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
        this.store.validateDappTransfer(account.id, request.to, request.amount, request.fee);
      } else if (request.method === 'buyRolls' || request.method === 'sellRolls') {
        const kind = request.method === 'buyRolls' ? 'buy' : 'sell';
        this.store.validateDappRolls(account.id, kind, request.rolls, request.fee);
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

  private async carryOut(request: DappRequest, network: WalletNetwork): Promise<ApprovalResult> {
    if (request.method === 'connect') return { addresses: this.chosenAddresses() };
    const account = this.account();
    if (!account) throw new Error('The signing account is not in this wallet');
    switch (request.method) {
      case 'sign':
        return this.store.dappSign(account.id, request.data);
      case 'transfer':
        return {
          operationId: await this.store.dappTransfer(
            account.id,
            request.to,
            request.amount,
            request.fee,
          ),
          network,
        };
      case 'buyRolls':
      case 'sellRolls': {
        const kind = request.method === 'buyRolls' ? 'buy' : 'sell';
        const operationId = await this.store.dappRolls(
          account.id,
          kind,
          request.rolls,
          request.fee,
        );
        return { operationId, network };
      }
      case 'callSC':
        return { operationId: await this.store.dappCall(account.id, dappCall(request)), network };
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

/** Invisible characters (zero-width, bidi overrides, soft hyphen…) and odd line separators. */
const HIDDEN_CHARS = /[\p{Cf}\u2028\u2029]/gu;

/**
 * Text if the bytes are readable UTF-8 (no control characters but tabs and newlines), else hex.
 * Invisible characters, which could make a message read differently from what it says (a
 * right-to-left override reverses what follows), are shown as ⟨U+202E⟩ and flagged.
 */
export function describeBytes(data: Uint8Array): { text: string; hex: boolean; hidden: boolean } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      const shown = text.replace(
        HIDDEN_CHARS,
        (c) => `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`,
      );
      return { text: shown, hex: false, hidden: shown !== text };
    }
  } catch {
    // not UTF-8
  }
  return {
    text: `0x${Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')}`,
    hex: true,
    hidden: false,
  };
}
