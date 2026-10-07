import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { VaultAccount } from '../../../core/models/vault.model';
import { UNLOCK_SECRET, UnlockSecret, secretNoun } from '../../../core/platform/unlock-secret';
import { MASSA_PROVIDER } from '../../../core/services/massa-provider';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { SecretEntry } from '../../../shared/ui/secret-entry/secret-entry';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../../../core/utils/password-rules';
import { toUserMessage } from '../../../core/utils/user-error';

type Step =
  'unlock' | 'create' | 'confirm-pin' | 'upgrade' | 'key-choice' | 'import-key' | 'generating';

/**
 * Single self-contained auth flow: unlock (vault already exists) or
 * register (no vault yet) → create the secret → generate a new key
 * or import an existing one → vault saved, session unlocked.
 *
 * The secret is the web app's 6-digit PIN (entered twice) or the
 * extension's password (two fields), see UNLOCK_SECRET. In the extension,
 * a vault still opened with a PIN-like secret must move to a password
 * before going on (`upgrade`).
 *
 * Which branch you land on is decided once, from `authStore.hasVault()`
 * — not a manual "log in / sign up" toggle, since that state is a fact
 * about the device, not a choice the user makes each time.
 */
@Component({
  selector: 'app-pin-lock-page',
  imports: [SecretEntry, FormsModule],
  templateUrl: './pin-lock-page.html',
  styleUrl: './pin-lock-page.scss',
})
export class PinLockPage {
  private readonly authStore = inject(AuthStore);
  private readonly walletStore = inject(WalletStore);
  private readonly provider = inject(MASSA_PROVIDER);
  private readonly router = inject(Router);
  /** Where to go once unlocked: the extension's approval window returns to its request. */
  private readonly destination =
    inject(ActivatedRoute).snapshot.queryParamMap.get('next') === 'approve' ? '/approve' : '/home';

  protected readonly kind = inject(UNLOCK_SECRET);
  private readonly noun = secretNoun(this.kind);

  protected readonly step = signal<Step>(this.authStore.hasVault() ? 'unlock' : 'create');
  protected readonly error = signal<string | null>(null);
  protected readonly importKeyValue = signal('');
  protected readonly isBusy = signal(false);
  protected readonly importNameValue = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly showPassword = signal(false);
  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  private firstSecret = '';
  private readonly entry = viewChild(SecretEntry);

  /** PIN pad or password field: unlocking, or creating a PIN. */
  protected readonly showEntry = computed(
    () =>
      this.step() === 'unlock' ||
      (this.kind === 'pin' && (this.step() === 'create' || this.step() === 'confirm-pin')),
  );

  /** Choosing a password: when creating the vault, or moving a PIN vault to a password. */
  protected readonly choosingPassword = computed(
    () => this.kind === 'password' && (this.step() === 'create' || this.step() === 'upgrade'),
  );

  protected readonly title = computed(() => {
    switch (this.step()) {
      case 'unlock':
        return `Enter your ${this.noun}`;
      case 'create':
        return `Create a ${this.noun}`;
      case 'confirm-pin':
        return 'Confirm your PIN';
      case 'upgrade':
        return 'Set a password';
      case 'key-choice':
        return 'Set up your wallet';
      case 'import-key':
        return 'Import a private key';
      case 'generating':
        return 'Creating your wallet';
    }
  });

  protected readonly subtitle = computed(() => {
    switch (this.step()) {
      case 'unlock':
        // Extension vaults made before passwords still open with their PIN (then move on).
        return this.kind === 'pin'
          ? 'Unlock your wallet'
          : 'Unlock your wallet. Made it with a PIN? Type the PIN here.';
      case 'create':
        return this.kind === 'pin'
          ? 'Set a 6-digit code to secure your wallet'
          : "It encrypts your wallet on this device. It can't be recovered, so keep it safe.";
      case 'confirm-pin':
        return 'Enter it again to confirm';
      case 'upgrade':
        return 'The extension now protects your wallet with a password instead of a PIN. Your wallets stay as they are.';
      case 'key-choice':
        return 'Generate a brand new wallet, or import one you already have';
      case 'import-key':
        return 'Paste an existing Massa private key';
      case 'generating':
        return 'One moment…';
    }
  });

  protected async onSecret(secret: string): Promise<void> {
    this.error.set(null);

    if (this.step() === 'unlock') {
      this.isBusy.set(true);
      const ok = await this.authStore.unlock(secret);
      this.isBusy.set(false);
      if (!ok) {
        this.error.set(`Incorrect ${this.noun}`);
        this.entry()?.clear();
        return;
      }
      // Paint last-known balances/history instantly; the shell refreshes them.
      await this.walletStore.restoreCache();
      if (needsPasswordUpgrade(this.kind, secret)) {
        this.step.set('upgrade');
        return;
      }
      await this.router.navigateByUrl(this.destination);
      return;
    }

    if (this.step() === 'create') {
      this.firstSecret = secret;
      this.entry()?.clear();
      this.step.set('confirm-pin');
      return;
    }

    if (this.step() === 'confirm-pin') {
      this.entry()?.clear();
      if (secret === this.firstSecret) {
        this.step.set('key-choice');
      } else {
        this.error.set("PINs didn't match — start over");
        this.firstSecret = '';
        this.step.set('create');
      }
    }
  }

  protected async submitPassword(event: Event): Promise<void> {
    event.preventDefault();
    const password = this.newPassword();
    const problem = passwordProblem(password);
    if (problem) {
      this.error.set(problem);
      return;
    }
    if (password !== this.confirmPassword()) {
      this.error.set("Passwords don't match");
      return;
    }
    this.error.set(null);

    if (this.step() === 'create') {
      this.firstSecret = password;
      this.clearPasswordFields();
      this.step.set('key-choice');
      return;
    }

    this.isBusy.set(true);
    try {
      await this.authStore.changeSecret(password);
      this.clearPasswordFields();
      await this.router.navigateByUrl(this.destination);
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isBusy.set(false);
    }
  }

  private clearPasswordFields(): void {
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.showPassword.set(false);
  }

  protected async generateNewWallet(): Promise<void> {
    this.error.set(null);
    this.step.set('generating');
    try {
      const { privateKey, address } = await this.provider.generateAccount();
      const name = this.authStore.suggestWalletName();
      await this.completeRegistration({ id: 'main', name, address, privateKey });
    } catch (err) {
      this.error.set(toUserMessage(err));
      this.step.set('key-choice');
    }
  }

  protected startImportFlow(): void {
    this.error.set(null);
    this.importNameValue.set(this.authStore.suggestWalletName());
    this.step.set('import-key');
  }

  protected backToKeyChoice(): void {
    this.error.set(null);
    this.importKeyValue.set('');
    this.importNameValue.set('');
    this.step.set('key-choice');
  }

  protected async submitImportedKey(): Promise<void> {
    const privateKey = this.importKeyValue().trim();
    const name = this.importNameValue().trim();
    this.error.set(null);

    if (!privateKey) {
      this.error.set('Paste a private key first');
      return;
    }
    if (!name) {
      this.error.set('Give this wallet a name');
      return;
    }
    if (this.authStore.isNameTaken(name)) {
      this.error.set('That name is already used by another wallet');
      return;
    }

    this.isBusy.set(true);
    try {
      const address = await this.provider.resolveAddress(privateKey);
      if (!address) {
        this.error.set('That private key looks invalid');
        return;
      }
      await this.completeRegistration({ id: 'main', name, address, privateKey });
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isBusy.set(false);
    }
  }

  private async completeRegistration(account: VaultAccount): Promise<void> {
    await this.authStore.register(this.firstSecret, [account]);
    this.firstSecret = '';
    this.router.navigateByUrl(this.destination);
  }
}

/**
 * In the extension, a vault opened with something that isn't a valid password — a PIN from
 * before passwords — must be moved to a password before the wallet opens.
 */
export function needsPasswordUpgrade(kind: UnlockSecret, secret: string): boolean {
  return kind === 'password' && passwordProblem(secret) !== null;
}
