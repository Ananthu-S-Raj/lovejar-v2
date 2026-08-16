// Generate a VAPID keypair (P-256 ECDSA) and append VAPID_* entries to backend/.dev.vars.
// Web Push (RFC 8292) uses these credentials to sign push payloads.
import { generateKeyPair } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const varsPath = join(root, "backend", ".dev.vars");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

generateKeyPair(
  "ec",
  { namedCurve: "prime256v1", publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "der" } },
  (err, publicDer, privateDer) => {
    if (err) {
      console.error("Failed to generate keypair:", err);
      process.exit(1);
    }
    // SPKI DER: 30 59 30 13 06 07 2a 86 48 ce 3d 02 01 06 08 2a 86 48 ce 3d 03 01 07 03 42 00 <X||Y>
    const publicRaw = publicDer.subarray(publicDer.length - 65);
    // PKCS8 DER: extract the trailing 32-byte scalar (last ECPrivateKey field).
    const privateRaw = privateDer.subarray(privateDer.length - 32);
    const publicB64 = b64url(publicRaw);
    const privateB64 = b64url(privateRaw);
    const subject = "mailto:lovejar@localhost.local"; // no outbound mail; contact string for the VAPID token

    const block = `VAPID_PUBLIC_KEY=${publicB64}\nVAPID_PRIVATE_KEY=${privateB64}\nVAPID_SUBJECT=${subject}\n`;
    appendFileSync(varsPath, block);
    console.log("Appended VAPID_* entries to backend/.dev.vars");
  }
);
