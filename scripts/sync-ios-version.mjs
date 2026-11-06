// Sets the iOS app's version (MARKETING_VERSION in the Xcode project) to package.json's, so a
// version bump never leaves the app behind. Run by `npm run build:ios`.
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT = 'ios/App/App.xcodeproj/project.pbxproj';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `sync-ios-version: "${version}" is not X.Y.Z — App Store versions are numbers only`,
  );
  process.exit(1);
}
const before = readFileSync(PROJECT, 'utf8');
const found = before.match(/MARKETING_VERSION = [^;]+;/g) ?? [];
if (found.length === 0) {
  console.error(`sync-ios-version: no MARKETING_VERSION in ${PROJECT}`);
  process.exit(1);
}
const after = before.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
if (after !== before) {
  writeFileSync(PROJECT, after);
  console.log(`sync-ios-version: MARKETING_VERSION → ${version}`);
}
