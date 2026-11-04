// First: starts listening for the browser's install event before Angular boots.
import './app/core/platform/install-prompt';
// Then massa-web3's package entry, before any app code touches it. The package has an import
// cycle (JsonRpcProvider extends JsonRpcPublicProvider, which imports the package index back);
// with the production build's code splitting, esbuild otherwise orders the two classes wrongly
// and the app dies on load with "class extends undefined". Entering through the index gives
// the correct order. `npm run smoke` (also run by the release workflow) guards against a relapse.
import '@massalabs/massa-web3';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Never inside another page's frame: that page could lay its own content over the wallet's
// buttons (clickjacking). A <meta> CSP can't say frame-ancestors; the extension's manifest does.
if (window.top !== window.self) {
  document.body.textContent = "RustCore Wallet can't run inside another page — open it directly.";
} else {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
