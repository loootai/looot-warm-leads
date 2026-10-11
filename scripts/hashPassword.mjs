// Prints a WARM_ADMIN_PASSWORD_HASH value. Usage: npm run hash-password -- 'your long password'
// The password is read from the argument, or from the WARM_NEW_PASSWORD variable, so it need not sit in shell history.
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2] ?? process.env.WARM_NEW_PASSWORD;
if (!password || password.length < 12) {
  console.error("Give a password of at least 12 characters: npm run hash-password -- 'your long password'");
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`WARM_ADMIN_PASSWORD_HASH=scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`);
