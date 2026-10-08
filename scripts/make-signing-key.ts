// Makes the ES256 signing key for app tokens. Prints the PUBLIC key only.
// The private key goes to the Workers secret store through stdin. It is never printed or written to a file.
// Run: bun scripts/make-signing-key.ts
import { spawnSync } from "node:child_process";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const pub = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(pub);

const put = spawnSync("npx", ["wrangler", "secret", "put", "APP_JWT_PRIVATE_JWK"], {
	input: JSON.stringify(await exportJWK(privateKey)),
	stdio: ["pipe", "inherit", "inherit"],
});
if (put.status !== 0) throw new Error("The secret was not saved.");

// The accounts site serves this as its key file.
console.log(JSON.stringify({ keys: [{ ...pub, kid, alg: "ES256", use: "sig" }] }));
