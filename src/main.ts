// First: starts listening for the browser's install event before Angular boots.
import './app/core/platform/install-prompt';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
