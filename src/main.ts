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

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
