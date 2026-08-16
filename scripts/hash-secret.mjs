// Generates a PBKDF2 hash in the same format the backend expects
// (salt_hex:derived_key_hex), for use with `wrangler secret put`.
//
// Usage:
//   node scripts/hash-secret.mjs 123456
//   node scripts/hash-secret.mjs "MyAdminPassword123"
//
// Requires Node 18+ (uses the built-in Web Crypto API).

const secret = process.argv[2];
if (!secret) {
  console.error("Usage: node scripts/hash-secret.mjs <pin-or-password>");
  process.exit(1);
}

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `${toHex(salt.buffer)}:${toHex(bits)}`;
}

const hash = await hashSecret(secret);
console.log("\nGenerated hash (copy this value):\n");
console.log(hash);
console.log("\nNow run one of:");
console.log("  wrangler secret put USER_PIN_HASH");
console.log("  wrangler secret put ADMIN_PASSWORD_HASH");
console.log("and paste the hash above when prompted.\n");
