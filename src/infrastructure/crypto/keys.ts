/**
 * Keys and signatures (architecture §2.12): Ed25519, through Node's own crypto. A public key travels as base64 of
 * its DER form (`MCowBQYDK2VwAyEA…`), a private key as base64 of PKCS#8; a signature is over the value's canonical
 * JSON — its keys in order — so both sides sign and check the same bytes whatever order a message was built in.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto';

export interface KeyPair { publicKey: string; privateKey: string }

export function newKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

/** JSON with every object's keys in order, and nothing for a value that isn't there. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The signature of a value, said to be `what` it is — so a signature made for one kind of message can't be
 *  shown as another. */
export function sign(what: string, value: unknown, privateKey: string): string {
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return signBytes(null, Buffer.from(`${what}\n${canonical(value)}`), key).toString('base64');
}

/** Is this the signature of that value by the key's owner? A key or signature that can't be read: no. */
export function verify(what: string, value: unknown, signature: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verifyBytes(null, Buffer.from(`${what}\n${canonical(value)}`), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** The public half of a private key. */
export function publicOf(privateKey: string): string {
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
}

/** A key in a form people can compare: `3F2A-9C41-07BE-D255`. */
export function fingerprint(publicKey: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}
