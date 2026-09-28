import { Injectable } from '@angular/core';

// 20 consonants (all but 'q') + 5 vowels, arranged as consonant-vowel-
// consonant-vowel-consonant so every "word" reads roughly pronounceable.
// Capacity: 20 * 5 * 20 * 5 * 20 = 200,000 distinct values per word —
// comfortably more than the 65,792 a 2-byte chunk (see below) needs.
const CONSONANTS = 'bcdfghjklmnprstvwxyz'.split('');
const VOWELS = 'aeiou'.split('');
const WORD_CAPACITY =
  CONSONANTS.length * VOWELS.length * CONSONANTS.length * VOWELS.length * CONSONANTS.length;

// Second "byte" of 256 is used as a sentinel meaning "this chunk had only
// one real byte" (for odd-length keys) — see encode/decode below.
const CHUNK_RADIX = 257;

function wordFromValue(value: number): string {
  let remaining = value;
  const c1 = remaining % CONSONANTS.length;
  remaining = Math.floor(remaining / CONSONANTS.length);
  const v1 = remaining % VOWELS.length;
  remaining = Math.floor(remaining / VOWELS.length);
  const c2 = remaining % CONSONANTS.length;
  remaining = Math.floor(remaining / CONSONANTS.length);
  const v2 = remaining % VOWELS.length;
  remaining = Math.floor(remaining / VOWELS.length);
  const c3 = remaining % CONSONANTS.length;
  return CONSONANTS[c1] + VOWELS[v1] + CONSONANTS[c2] + VOWELS[v2] + CONSONANTS[c3];
}

function valueFromWord(word: string): number {
  const [c1, v1, c2, v2, c3] = word.toLowerCase().trim().split('');
  const ci = (ch: string) => CONSONANTS.indexOf(ch);
  const vi = (ch: string) => VOWELS.indexOf(ch);
  if ([c1, c2, c3].some((c) => ci(c) < 0) || [v1, v2].some((v) => vi(v) < 0)) {
    throw new Error(`"${word}" is not a valid backup word`);
  }
  return (
    ci(c1) +
    vi(v1) * CONSONANTS.length +
    ci(c2) * CONSONANTS.length * VOWELS.length +
    vi(v2) * CONSONANTS.length * VOWELS.length * CONSONANTS.length +
    ci(c3) * CONSONANTS.length * VOWELS.length * CONSONANTS.length * VOWELS.length
  );
}

/**
 * Reversible word-encoding for a single account's private key.
 *
 * This is deliberately NOT BIP-39: there is no wordlist standard here,
 * no checksum, and no master-seed derivation — every account has its
 * own independent private key (see WalletState), so each account gets
 * its own phrase, encoding exactly that key's bytes two at a time.
 * `decode(encode(key)) === key` for any key this app generates or
 * accepts on import.
 */
@Injectable({ providedIn: 'root' })
export class BackupPhrase {
  encode(privateKey: string): string[] {
    const bytes = Array.from(privateKey, (ch) => ch.charCodeAt(0));
    const words: string[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      const first = bytes[i];
      const second = i + 1 < bytes.length ? bytes[i + 1] : 256; // 256 = "no second byte"
      words.push(wordFromValue(first * CHUNK_RADIX + second));
    }
    return words;
  }

  decode(words: string[]): string {
    const chars: string[] = [];
    for (const word of words) {
      const value = valueFromWord(word);
      const first = Math.floor(value / CHUNK_RADIX);
      const second = value % CHUNK_RADIX;
      chars.push(String.fromCharCode(first));
      if (second !== 256) chars.push(String.fromCharCode(second));
    }
    return chars.join('');
  }
}

export { WORD_CAPACITY };
