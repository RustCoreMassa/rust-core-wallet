// The version from package.json, set at build time — only this field ends up in the bundle.
import { version } from '../../../../package.json';

/** The running wallet's version, e.g. "1.1.1" (Settings shows it). */
export const APP_VERSION: string = version;
