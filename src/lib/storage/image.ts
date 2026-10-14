/**
 * Profile image checks (docs/tenant-management.md §8.6).
 *
 * The type is decided from the file's first bytes only: the client's content
 * type and file name are under the uploader's control. SVG is deliberately
 * not supported, since it can carry scripts. Pure, so the form can run the
 * same size check before uploading.
 */
import type { RuleResult } from "@/lib/tenants/rules";

export const MAX_PROFILE_IMAGE_BYTES = 2_097_152;
/** For the file input's `accept` attribute; only a hint, the server sniffs. */
export const PROFILE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export type SniffedImage = {
  kind: "png" | "jpeg" | "webp";
  contentType: string;
  extension: "png" | "jpg" | "webp";
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWithAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return (
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  );
}

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWithAt(bytes, 0, PNG_SIGNATURE)) {
    return { kind: "png", contentType: "image/png", extension: "png" };
  }
  if (startsWithAt(bytes, 0, JPEG_SIGNATURE)) {
    return { kind: "jpeg", contentType: "image/jpeg", extension: "jpg" };
  }
  // RIFF <4-byte size> WEBP
  if (startsWithAt(bytes, 0, RIFF) && startsWithAt(bytes, 8, WEBP)) {
    return { kind: "webp", contentType: "image/webp", extension: "webp" };
  }
  return null;
}

export function validateProfileImage(bytes: Uint8Array): RuleResult<SniffedImage> {
  if (bytes.length === 0) return { ok: false, error: "The file is empty. Choose an image file." };
  if (bytes.length > MAX_PROFILE_IMAGE_BYTES) {
    return { ok: false, error: "The image is larger than 2 MB. Choose a smaller image." };
  }
  const image = sniffImage(bytes);
  if (!image) return { ok: false, error: "Use a PNG, JPEG or WebP image." };
  return { ok: true, value: image };
}
