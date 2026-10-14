import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_ACCEPT,
  sniffImage,
  validateProfileImage,
} from "@/lib/storage/image";

// A complete 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// SOI + the start of a JFIF APP0 segment.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
// RIFF <size> WEBP VP8L ...
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8L"),
  Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00]),
]);

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("sniffImage", () => {
  it("recognizes PNG, JPEG and WebP from their first bytes", () => {
    expect(sniffImage(PNG)).toEqual({ kind: "png", contentType: "image/png", extension: "png" });
    expect(sniffImage(JPEG)).toEqual({ kind: "jpeg", contentType: "image/jpeg", extension: "jpg" });
    expect(sniffImage(WEBP)).toEqual({ kind: "webp", contentType: "image/webp", extension: "webp" });
  });

  it.each([
    ["SVG", text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["SVG with an XML declaration", text('<?xml version="1.0"?><svg></svg>')],
    ["GIF", text("GIF89a\x01\x00\x01\x00")],
    ["plain text", text("hello, world")],
    ["HTML", text("<!doctype html><html></html>")],
    ["a RIFF file that is not WebP (WAV)", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])],
    ["a truncated PNG signature", PNG.subarray(0, 7)],
    ["a truncated WebP header", WEBP.subarray(0, 11)],
    ["two JPEG bytes", JPEG.subarray(0, 2)],
    ["empty", new Uint8Array()],
  ])("rejects %s", (_, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });
});

describe("validateProfileImage", () => {
  it("allows up to 2 MiB", () => {
    expect(MAX_PROFILE_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    const atLimit = new Uint8Array(MAX_PROFILE_IMAGE_BYTES);
    atLimit.set(PNG);
    expect(validateProfileImage(atLimit)).toEqual({
      ok: true,
      value: { kind: "png", contentType: "image/png", extension: "png" },
    });
  });

  it("rejects an image over 2 MiB", () => {
    const tooBig = new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 1);
    tooBig.set(PNG);
    expect(validateProfileImage(tooBig)).toEqual({
      ok: false,
      error: "The image is larger than 2 MB. Choose a smaller image.",
    });
  });

  it("rejects an empty file", () => {
    const result = validateProfileImage(new Uint8Array());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty");
  });

  it("rejects other types", () => {
    expect(validateProfileImage(text("<svg></svg>"))).toEqual({
      ok: false,
      error: "Use a PNG, JPEG or WebP image.",
    });
  });

  it("offers the three types to the file picker", () => {
    expect(PROFILE_IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/webp");
  });
});
