import { addressFromQr } from './massa-address';

const ADDRESS = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

describe('addressFromQr', () => {
  it('takes a plain address, as the Receive screen shows it', () => {
    expect(addressFromQr(ADDRESS)).toBe(ADDRESS);
    expect(addressFromQr(`  ${ADDRESS}\n`)).toBe(ADDRESS);
  });

  it('takes the address out of a massa: link', () => {
    expect(addressFromQr(`massa:${ADDRESS}`)).toBe(ADDRESS);
    expect(addressFromQr(`MASSA://${ADDRESS}?amount=1.5`)).toBe(ADDRESS);
  });

  it('refuses anything else', () => {
    expect(addressFromQr('https://example.com')).toBeNull();
    expect(addressFromQr(`https://evil.example/${ADDRESS}`)).toBeNull();
    expect(addressFromQr('S12bcdLnKvZqWbjNXFrUqgJvBUsxz6Fd3ap7uyt6wXQwEEAVsyQ8')).toBeNull(); // a private key
    expect(addressFromQr(`${ADDRESS}0O`)).toBeNull(); // not base58
    expect(addressFromQr('')).toBeNull();
  });
});
