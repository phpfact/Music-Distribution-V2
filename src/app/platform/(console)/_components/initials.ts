/**
 * Up to two letters for an avatar: the first letter of the first two parts of
 * the name ("jane.doe" → "JD"), or the first two letters of a one-part name
 * ("owner" → "OW").
 */
export function getInitials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter((part) => part !== "");
  const [first, second] = parts;
  if (first === undefined) return "?";
  // Spread by code point, so a letter outside the BMP is not cut in half.
  if (second === undefined) return [...first].slice(0, 2).join("").toUpperCase();
  return `${[...first][0]}${[...second][0]}`.toUpperCase();
}
