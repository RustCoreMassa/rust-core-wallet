// Sets the iOS and Android apps' version to package.json's, so a version bump never leaves an
// app behind. Run by `npm run build:ios` / `npm run build:android`.
// - iOS: MARKETING_VERSION in the Xcode project.
// - Android: versionName, and versionCode = major·10000 + minor·100 + patch (1.7.1 → 10701) —
//   Google Play needs it to grow with every release.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!parts || Number(parts[2]) > 99 || Number(parts[3]) > 99) {
  console.error(`sync-app-version: "${version}" must be X.Y.Z with Y and Z under 100`);
  process.exit(1);
}
const versionCode = Number(parts[1]) * 10000 + Number(parts[2]) * 100 + Number(parts[3]);

/** Applies `edits` ([pattern, replacement]) to `file`; every pattern must match. */
function sync(file, edits) {
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [pattern, replacement] of edits) {
    if (!pattern.test(after)) {
      console.error(`sync-app-version: ${pattern} not found in ${file}`);
      process.exit(1);
    }
    after = after.replace(pattern, replacement);
  }
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`sync-app-version: ${file} → ${version}`);
  }
}

sync('ios/App/App.xcodeproj/project.pbxproj', [
  [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
]);
sync('android/app/build.gradle', [
  [/versionCode \d+/, `versionCode ${versionCode}`],
  [/versionName "[^"]*"/, `versionName "${version}"`],
]);
