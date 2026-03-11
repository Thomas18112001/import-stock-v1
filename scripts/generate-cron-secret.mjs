import { randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("hex");
console.log(secret);
