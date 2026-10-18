import bcrypt from "bcryptjs";

/**
 * Password verification uses bcrypt, the same library the seed uses to hash
 * demo credentials. Plaintext passwords are never stored or logged - this
 * module only ever compares a candidate against the stored hash.
 */

/**
 * Verify a candidate password against a stored bcrypt hash. Returns `false`
 * rather than throwing on a malformed/unknown hash format so callers can treat
 * it as a normal authentication failure.
 */
export async function verifyPassword(
  candidate: string,
  storedHash: string,
): Promise<boolean> {
  if (!candidate || !storedHash) return false;
  try {
    return await bcrypt.compare(candidate, storedHash);
  } catch {
    return false;
  }
}
