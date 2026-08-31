// Erzeugt ein VAPID-Schlüsselpaar fürs Browser-Push (Web Push Standard).
// Braucht nur Node.js (kein npm-Paket) -- dasselbe Node, das du für die Supabase CLI
// sowieso schon installiert hast. Ausführen: node scripts/generate-vapid-keys.js
//
// Ausgabe:
//   - stdout: JSON zum Speichern als vapid.json (Secret für die Edge Function)
//   - stderr: der öffentliche Schlüssel für VAPID_PUBLIC_KEY in config.js
//
// Format kompatibel mit der Deno-Bibliothek jsr:@negrel/webpush, die die Edge
// Function zum Versenden nutzt (beide reden reines Web Crypto/JWK, kein Node-only-Format).

const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;

async function main(){
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);
  console.log(JSON.stringify({ publicKey: publicKeyJwk, privateKey: privateKeyJwk }, null, 2));

  const rawPublicKey = await subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyBase64Url = Buffer.from(rawPublicKey).toString("base64url");
  console.error("\nDein VAPID_PUBLIC_KEY (für config.js): " + publicKeyBase64Url + "\n");
}

main();
