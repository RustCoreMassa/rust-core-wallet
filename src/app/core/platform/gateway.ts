import { InjectionToken } from '@angular/core';

/** The wallet's official gateway: the same on-chain site (`wrustcore.massa`) as every other. */
export const OFFICIAL_URL = 'https://wrustcore.massa.net';

/**
 * Gateways that served the wallet before Massa's official one. Browser storage
 * belongs to the address it was written on, so a wallet created there stays
 * there: those pages ask the user to move it by hand (back up, import).
 */
const OLD_GATEWAY_HOSTS: readonly string[] = ['wrustcore.deweb.half-red.net'];

export function isOldGateway(hostname: string): boolean {
  return OLD_GATEWAY_HOSTS.includes(hostname.toLowerCase());
}

/** The official URL when this page runs on an old gateway, otherwise `null`. */
export const MOVED_TO = new InjectionToken<string | null>('MOVED_TO', {
  providedIn: 'root',
  factory: () => (isOldGateway(location.hostname) ? OFFICIAL_URL : null),
});
