/**
 * A contract's own text (a token's name, an NFT collection's name, NFT
 * metadata…), made safe to show: control and invisible characters
 * (zero-width spaces, right-to-left overrides…) removed — they can make one
 * name look like another — whitespace collapsed, length capped (code points,
 * cut with "…").
 */
export function cleanContractText(text: string, maxLength: number): string {
  const clean = text
    .normalize('NFC')
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...clean];
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : clean;
}
