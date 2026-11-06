import { Component, inject, signal, viewChild } from '@angular/core';
import { BIOMETRIC_UNLOCK } from '../../../core/platform/biometric-unlock';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { toUserMessage } from '../../../core/utils/user-error';
import { SecretEntry } from '../../../shared/ui/secret-entry/secret-entry';

/**
 * Settings → Unlock with Face ID / Touch ID (the apps): turning it on asks for the PIN — the
 * secret that will be kept behind the biometrics — then for Face ID once, to confirm it works.
 * Turning it off needs nothing (Settings does it directly).
 */
@Component({
  selector: 'app-biometric-unlock-modal',
  imports: [SecretEntry],
  templateUrl: './biometric-unlock-modal.html',
})
export class BiometricUnlockModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly biometric = inject(BIOMETRIC_UNLOCK);
  private readonly toast = inject(Toast);

  protected readonly secretName = secretNoun(inject(UNLOCK_SECRET));
  /** "Face ID" / "Touch ID", from Settings. */
  protected readonly label = this.modal.payload<string>() ?? 'Face ID';
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);

  private readonly entry = viewChild(SecretEntry);

  protected async confirmSecret(secret: string): Promise<void> {
    const biometric = this.biometric;
    if (!biometric) return;
    this.error.set(null);
    this.isBusy.set(true);
    try {
      if (!(await this.authStore.verifySecret(secret))) {
        this.error.set(`Incorrect ${this.secretName}`);
        this.entry()?.clear();
        return;
      }
      try {
        await biometric.enable(secret);
      } catch {
        this.error.set(`${this.label} wasn't confirmed, so it stays off`);
        this.entry()?.clear();
        return;
      }
      this.modal.close();
      this.toast.show(`${this.label} unlock is on`);
    } catch (err) {
      // TooManyAttemptsError: its message says how long to wait.
      this.error.set(toUserMessage(err));
      this.entry()?.clear();
    } finally {
      this.isBusy.set(false);
    }
  }
}
