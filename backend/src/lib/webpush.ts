// Minimal Web Push (RFC 8291 aes128gcm) + VAPID (RFC 8292) implementation
// built entirely on the platform WebCrypto API — no external dependencies.
// Used only to deliver push notifications to the admin (Web Push is disabled
// for the user by design).
//
// Secrets come from Worker bindings:
//   VAPID_PUBLIC_KEY   - base64url raw public point (0x04 || X || Y), 65 bytes
//   VAPID_PRIVATE_KEY  - base64url raw private key scalar (32 bytes)
//   VAPID_SUBJECT      - contact string for the VAPID token, e.g. mailto:admin@example.com

export type PushTarget = {
  endpoint: string;
  p256dh: string; // base64url client public key
  auth: string;   // base64url auth secret
};

function b64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const chunks = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt }, key, 256);
  return new Uint8Array(bits);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

// Build the VAPID Authorization header value: `vapid t=<jwt>, k=<public key>`.
async function vapidHeader(
  endpoint: string,
  publicKeyB64: string,
  privateKeyB64: string,
  subject: string
): Promise<string> {
  const d = b64UrlToBytes(privateKeyB64);
  const pub = b64UrlToBytes(publicKeyB64);
  // Recover the public coordinates for the JWT header key (k=) — the public
  // key point is used directly, and the private key is passed as a JWK.
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64Url(pub.slice(1, 33)),
    y: bytesToB64Url(pub.slice(33, 65)),
    d: bytesToB64Url(d),
  };
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const aud = new URL(endpoint).origin;
  const header = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" })).replace(/=+$/, "");
  const claims = btoa(
    JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject })
  ).replace(/=+$/, "");
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" } as SubtleCryptoSignAlgorithm,
    signingKey,
    utf8(signingInput)
  );
  return `vapid t=${signingInput}.${bytesToB64Url(new Uint8Array(sig))}, k=${publicKeyB64}`;
}

// Encrypt the payload per RFC 8291 (Content-Encoding: aes128gcm) using an
// ephemeral per-request ECDH keypair.
async function encryptPayload(
  target: PushTarget,
  payload: Uint8Array
): Promise<{ body: Uint8Array; serverPublicKeyB64: string }> {
  const clientPublic = await crypto.subtle.importKey(
    "raw",
    b64UrlToBytes(target.p256dh),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  // workers-types models the pair loosely (CryptoKey | CryptoKeyPair); the
  // runtime value is a standard CryptoKeyPair.
  const serverPair = serverKeys as unknown as { publicKey: CryptoKey; privateKey: CryptoKey };
  const exported = await crypto.subtle.exportKey("raw", serverPair.publicKey);
  const serverPublicRaw = new Uint8Array(exported as ArrayBuffer);

  // The runtime reads the standard `public` field; workers-types renamed it to
  // `$public`, so the standard shape is restored via an unchecked cast.
  const deriveParams = { name: "ECDH", public: clientPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const sharedBits = await crypto.subtle.deriveBits(deriveParams, serverPair.privateKey, 256);

  const authSecret = b64UrlToBytes(target.auth);
  const prk = await hkdfExtract(authSecret, new Uint8Array(sharedBits));
  const cek = await hkdfExpand(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8("Content-Encoding: nonce\0"), 12);

  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // Additional data per RFC 8188 §2.1: salt || keyid-len(65) || keyid || padding-len(0)
  const additionalData = concat(salt, [0x41], serverPublicRaw, [0x00, 0x00]);
  // Single record, padding delimiter only (no padding)
  const plaintext = concat(payload, [0x02]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 }, key, plaintext)
  );

  const body = concat(salt, [0x00, 0x00, 0x10, 0x00], serverPublicRaw, ciphertext); // record size 4096
  return { body, serverPublicKeyB64: bytesToB64Url(serverPublicRaw) };
}

// Send one push. Returns "ok" | "gone" (subscription invalid/expired) | "skip".
export async function sendPush(
  target: PushTarget,
  payload: string,
  env: {
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  }
): Promise<"ok" | "gone" | "skip"> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return "skip"; // Web Push not configured
  }
  try {
    const url = new URL(target.endpoint);
    if (url.protocol !== "https:" && url.protocol !== "wss:") return "skip";
    const { body } = await encryptPayload(target, utf8(payload));
    const auth = await vapidHeader(target.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Urgency: "normal",
        Authorization: auth,
      },
      body,
    });
    if (res.status === 201 || res.status === 202 || res.status === 204) return "ok";
    if (res.status === 404 || res.status === 410) return "gone"; // subscription expired/invalid
    return "skip"; // 429 / 5xx — transient, leave the subscription in place
  } catch {
    return "skip";
  }
}
