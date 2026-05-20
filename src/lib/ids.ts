import { randomBytes } from "crypto";

export function newId(): string {
  return randomBytes(12).toString("hex");
}
