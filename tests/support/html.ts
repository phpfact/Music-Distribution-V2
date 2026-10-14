/** Small helpers for reading server-rendered HTML and response cookies. */

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
};

export function decodeHtml(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity: string, body: string) => {
    if (/^#[xX]/.test(body)) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return NAMED_ENTITIES[body] ?? entity;
  });
}

/** Every `<form>...</form>` in the document. */
export function forms(html: string): string[] {
  return html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
}

/** The opening tags of one element type, e.g. every `<input ...>`. */
export function openingTags(html: string, element: string): string[] {
  return html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? [];
}

/** The decoded value of an attribute of an opening tag; "" for a bare attribute. */
export function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s/>])`).exec(tag);
  if (!match) return undefined;
  return decodeHtml(match[1] ?? "");
}

/** The `<input>` with this name inside a fragment. */
export function inputNamed(html: string, name: string): string | undefined {
  return openingTags(html, "input").find((tag) => attribute(tag, "name") === name);
}

/** Name and value of every hidden input, in document order. */
export function hiddenInputs(formHtml: string): [name: string, value: string][] {
  const pairs: [string, string][] = [];
  for (const tag of openingTags(formHtml, "input")) {
    if (attribute(tag, "type") !== "hidden") continue;
    const name = attribute(tag, "name");
    if (name !== undefined) pairs.push([name, attribute(tag, "value") ?? ""]);
  }
  return pairs;
}

export type ResponseCookie = {
  value: string;
  /** Attribute names in lower case; a flag such as HttpOnly maps to "". */
  attributes: Map<string, string>;
};

/** The `Set-Cookie` header for one cookie name, if the response has one. */
export function responseCookie(response: Response, name: string): ResponseCookie | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...rest] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;

    const attributes = new Map<string, string>();
    for (const part of rest) {
      const index = part.indexOf("=");
      const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
      attributes.set(key, index < 0 ? "" : part.slice(index + 1).trim());
    }
    return { value: pair.slice(separator + 1).trim(), attributes };
  }
  return undefined;
}
