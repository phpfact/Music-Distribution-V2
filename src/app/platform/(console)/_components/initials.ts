/**
 * Description: Compute up to two letters for an avatar.
 * Input: A name.
 * Output: The first letters of the first two parts ("jane.doe" → "JD"), the first
 *   two letters of a one-part name ("owner" → "OW"), or "?". Split by code
 *   point, so letters outside the BMP stay whole.
 * Use case: Avatar's fallback.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function getInitials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter((part) => part !== "");
  const [first, second] = parts;
  if (first === undefined) return "?";
  // Spread by code point, so a letter outside the BMP is not cut in half.
  if (second === undefined) return [...first].slice(0, 2).join("").toUpperCase();
  return `${[...first][0]}${[...second][0]}`.toUpperCase();
}
