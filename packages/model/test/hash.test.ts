import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex, utf8Encode } from '@gamex/model';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the FIPS test vector for %j', (input, digest) => {
    expect(sha256Hex(input)).toBe(digest);
  });

  it('matches node:crypto on arbitrary strings, including multi-block and non-ASCII input (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
      }),
    );
  });

  it('hashes bytes directly', () => {
    expect(sha256Hex(new Uint8Array([97, 98, 99]))).toBe(sha256Hex('abc'));
  });
});

describe('utf8Encode', () => {
  it('matches TextEncoder (property)', () => {
    const encoder = new TextEncoder();
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect([...utf8Encode(s)]).toEqual([...encoder.encode(s)]);
      }),
    );
  });
});
