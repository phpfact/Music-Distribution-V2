import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeProfileImage } from "@/lib/storage/normalize-image";
import { validateProfileImage } from "@/lib/storage/image";
import { storeProfileImage } from "@/lib/storage/profile-images";
import * as files from "@/lib/storage/files";
import { VALID_JPEG, VALID_PNG, VALID_WEBP } from "./support/image-fixtures";

describe("AUD-020 actual profile image decoding", () => {
  it.each([["png", VALID_PNG], ["jpeg", VALID_JPEG], ["webp", VALID_WEBP]] as const)(
    "fully decodes and re-encodes valid %s pixels", async (kind, bytes) => {
      const result = await normalizeProfileImage(bytes);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.image.kind).toBe(kind);
      const decoded = await sharp(result.value.bytes).raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info).toMatchObject({ width: 2, height: 2, channels: 3 });
      expect((await sharp(result.value.bytes).metadata()).exif).toBeUndefined();
    },
  );

  it.each([VALID_PNG.subarray(0, 8), VALID_JPEG.subarray(0, 3), VALID_WEBP.subarray(0, 12)])(
    "rejects signature-only files in both preliminary and decoding checks", async (bytes) => {
      expect(validateProfileImage(bytes).ok).toBe(false);
      expect((await normalizeProfileImage(bytes)).ok).toBe(false);
    },
  );

  it("refuses damaged PNG pixels even with a complete container", async () => {
    const damaged = Buffer.from(VALID_PNG);
    damaged.fill(0xff, 65, 75);
    expect(validateProfileImage(damaged).ok).toBe(true);
    expect((await normalizeProfileImage(damaged)).ok).toBe(false);
    const save = vi.spyOn(files, "saveFile");
    try {
      expect((await storeProfileImage(randomUUID(), damaged)).ok).toBe(false);
      expect(save).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
  });

  it("refuses excessive decompression dimensions before storing bytes", async () => {
    const huge = await sharp({ create: { width: 4_001, height: 4_000, channels: 3, background: "white" } }).png().toBuffer();
    expect(huge.length).toBeLessThan(2_097_152);
    expect((await normalizeProfileImage(huge)).ok).toBe(false);
  });
});
