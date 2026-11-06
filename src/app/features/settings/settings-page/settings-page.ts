import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { VaultAccount } from '../../../core/models/vault.model';
import { APP_PLATFORM, AppPlatform, EXTENSION_VIEWS } from '../../../core/platform/app-platform';
import { BIOMETRIC_UNLOCK, biometryName } from '../../../core/platform/biometric-unlock';
import { APP_VERSION } from '../../../core/platform/app-version';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { SITE_ACCESS } from '../../../core/platform/site-access';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { AuthStore } from '../../../core/state/auth-store';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { TokenCatalog } from '../../../core/state/token-catalog';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { AVATAR_COLORS } from '../../../shared/ui/avatar-colors';

/** After the version number at the bottom of Settings: which build this is. */
const PLATFORM_SUFFIX: Record<AppPlatform, string> = {
  web: '',
  extension: ' · browser extension',
  ios: ' · iOS app',
  android: ' · Android app',
};

@Component({
  selector: 'app-settings-page',
  imports: [ShortAddressPipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);
  protected readonly authStore = inject(AuthStore);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  /** The apps: unlocking with Face ID / Touch ID. */
  protected readonly biometric = inject(BIOMETRIC_UNLOCK);
  /** "Face ID" / "Touch ID" when the phone offers it — the row shows only then. */
  protected readonly biometryLabel = signal<string | null>(null);
  /** Extension only: switch between popup, side panel and full-screen tab. */
  protected readonly views = inject(EXTENSION_VIEWS);
  /** Extension only: sites connected through the dApp bridge. */
  protected readonly connectedSites = inject(CONNECTED_SITES);

  private readonly siteAccess = inject(SITE_ACCESS);
  protected readonly secretName = secretNoun(inject(UNLOCK_SECRET));

  constructor() {
    void this.biometric?.available().then((kind) => {
      this.biometryLabel.set(kind ? biometryName(kind) : null);
    });
  }

  private readonly customTokens = inject(TokenCatalog).custom;
  protected readonly customTokensLabel = computed(() => {
    const count = this.customTokens().length;
    return count === 0 ? 'Add an MRC-20 token by its contract' : `${count} on this network`;
  });

  protected readonly connectedSitesLabel = computed(() => {
    if (this.siteAccess?.granted() === false) return 'Site access off — sites can’t connect';
    const count = this.connectedSites?.sites().length ?? 0;
    return count === 0 ? 'None' : `${count} site${count > 1 ? 's' : ''}`;
  });

  /** For information only, at the bottom: which build is running. */
  protected readonly versionLabel = `RustCore Wallet ${APP_VERSION}${PLATFORM_SUFFIX[inject(APP_PLATFORM)]}`;

  protected readonly walletsCountLabel = computed(() => {
    const count = this.authStore.accounts().length;
    return `${count} wallet${count > 1 ? 's' : ''}`;
  });

  protected readonly isBuildnet = computed(() => this.store.network() === 'buildnet');

  protected readonly activeAccount = computed(
    () => this.authStore.accounts().find((a) => a.id === this.store.activeWalletId()) ?? null,
  );

  protected avatarColors(index: number): readonly [string, string] {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  protected openRename(account: VaultAccount): void {
    this.modal.open('rename-account', account);
  }

  /** On: asks for the PIN first (modal). Off: at once — it only takes a convenience away. */
  protected async toggleBiometric(label: string): Promise<void> {
    const biometric = this.biometric;
    if (!biometric) return;
    if (!biometric.enabled()) {
      this.modal.open('biometric-unlock', label);
      return;
    }
    await biometric.disable();
    this.toast.show(`${label} unlock is off`);
  }

  protected lockWallet(): void {
    this.authStore.lock();
    this.router.navigateByUrl('/login');
  }

  protected backupPhrase(): void {
    this.modal.open('backup-phrase');
  }

  protected toggleNetwork(): void {
    const next = this.isBuildnet() ? 'mainnet' : 'buildnet';
    this.store.setNetwork(next);
    this.toast.show(`Switched to ${next === 'mainnet' ? 'Mainnet' : 'Buildnet'}`);
  }

  protected logOut(): void {
    this.modal.open('logout');
  }
}
