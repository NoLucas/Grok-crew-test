import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export const ENVELOPE_SCHEMA = 'grok-crew.encrypted-envelope/v1';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function createIdentity(id) {
  const signing = generateKeyPairSync('ed25519');
  const encryption = generateKeyPairSync('x25519');
  return {
    id,
    signingPublicKey: signing.publicKey.export({ type: 'spki', format: 'pem' }),
    signingPrivateKey: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    encryptionPublicKey: encryption.publicKey.export({ type: 'spki', format: 'pem' }),
    encryptionPrivateKey: encryption.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

export function publicIdentity(identity) {
  return {
    id: identity.id,
    signing_public_key: identity.signingPublicKey,
    encryption_public_key: identity.encryptionPublicKey,
  };
}

function deriveKey(privatePem, publicPem, salt) {
  const shared = diffieHellman({ privateKey: createPrivateKey(privatePem), publicKey: createPublicKey(publicPem) });
  return Buffer.from(hkdfSync('sha256', shared, salt, Buffer.from('grok-crew-relay-v1'), 32));
}

export function sealEnvelope(payload, sender, recipient) {
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const key = deriveKey(sender.encryptionPrivateKey, recipient.encryption_public_key ?? recipient.encryptionPublicKey, salt);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = Buffer.from(canonicalJson(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const unsigned = {
    schema: ENVELOPE_SCHEMA,
    sender_id: sender.id,
    recipient_id: recipient.id,
    algorithm: 'X25519+HKDF-SHA256+AES-256-GCM+Ed25519',
    salt: salt.toString('base64url'),
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalJson(unsigned)), createPrivateKey(sender.signingPrivateKey)).toString('base64url') };
}

export function openEnvelope(envelope, recipient, senderPublic) {
  if (!envelope || envelope.schema !== ENVELOPE_SCHEMA || envelope.recipient_id !== recipient.id || envelope.sender_id !== senderPublic.id) throw new Error('Envelope identity or schema mismatch.');
  const { signature, ...unsigned } = envelope;
  const authentic = verify(null, Buffer.from(canonicalJson(unsigned)), createPublicKey(senderPublic.signing_public_key ?? senderPublic.signingPublicKey), Buffer.from(signature, 'base64url'));
  if (!authentic) throw new Error('Envelope signature verification failed.');
  const salt = Buffer.from(envelope.salt, 'base64url');
  const key = deriveKey(recipient.encryptionPrivateKey, senderPublic.encryption_public_key ?? senderPublic.encryptionPublicKey, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
