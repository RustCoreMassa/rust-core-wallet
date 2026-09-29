/** Gradient pairs ([from, to]) for the letter avatars used across the app. */
export const AVATAR_COLORS: readonly (readonly [string, string])[] = [
  ['#ff2d42', '#7a0f1c'],
  ['#4361ff', '#1c2a8f'],
  ['#ff8a3d', '#a84f10'],
  ['#33d17a', '#0f6b3a'],
];

/** Stable pick for a string key (e.g. a domain name) — same key, same colors. */
export function avatarColorsFor(key: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
