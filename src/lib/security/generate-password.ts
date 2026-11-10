/**
 * Random password for an admin to hand to a user. Leaves out characters
 * that are easy to misread (0/O, 1/l/I) and always mixes lower case,
 * upper case, digits and symbols. Uses crypto.getRandomValues, so it runs
 * in the browser and on the server.
 */
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?+=";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Unbiased random index below max (rejection sampling). */
function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

function pick(set: string): string {
  return set[randomIndex(set.length)];
}

export function generatePassword(length = 16): string {
  const size = Math.min(72, Math.max(8, Math.floor(length)));
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(ALL));
  // Fisher-Yates, so the guaranteed characters are not always up front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
