import { describe, expect, it } from 'vitest';
import { canonical, fingerprint, newKeyPair, publicOf, sign, verify } from '../../../src/trust/keys';

describe('§2.12 keys and signatures', () => {
  const teacher = newKeyPair();
  const other = newKeyPair();
  it('a signature checks with its own key, on the same value, whatever order it was built in', () => {
    const sig = sign('beacon', { title: 'Term 1', port: 47800, nested: { b: 1, a: [1, { y: 2, x: 1 }] } }, teacher.privateKey);
    expect(verify('beacon', { nested: { a: [1, { x: 1, y: 2 }], b: 1 }, port: 47800, title: 'Term 1' }, sig, teacher.publicKey)).toBe(true);
  });
  it('not with another key, on another value, or as another kind of message', () => {
    const sig = sign('beacon', { title: 'Term 1' }, teacher.privateKey);
    expect(verify('beacon', { title: 'Term 1' }, sig, other.publicKey)).toBe(false);
    expect(verify('beacon', { title: 'Term 2' }, sig, teacher.publicKey)).toBe(false);
    expect(verify('message', { title: 'Term 1' }, sig, teacher.publicKey)).toBe(false);
  });
  it('a key or a signature that can\'t be read checks nothing', () => {
    const sig = sign('x', 1, teacher.privateKey);
    expect(verify('x', 1, sig, 'not a key')).toBe(false);
    expect(verify('x', 1, 'not a signature', teacher.publicKey)).toBe(false);
    expect(verify('x', 1, '', teacher.publicKey)).toBe(false);
  });
  it('the canonical form: keys in order, a missing value left out, in a list null', () => {
    expect(canonical({ b: 1, a: 'x', c: undefined, d: null, e: [undefined, true, { z: 1, y: 's' }] })).toBe('{"a":"x","b":1,"d":null,"e":[null,true,{"y":"s","z":1}]}');
    expect(canonical('a "quoted" word')).toBe('"a \\"quoted\\" word"');
  });
  it('the public half comes back from the private half; a fingerprint is short and the same each time', () => {
    expect(publicOf(teacher.privateKey)).toBe(teacher.publicKey);
    expect(fingerprint(teacher.publicKey)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(fingerprint(teacher.publicKey)).toBe(fingerprint(teacher.publicKey));
    expect(fingerprint(teacher.publicKey)).not.toBe(fingerprint(other.publicKey));
  });
});
