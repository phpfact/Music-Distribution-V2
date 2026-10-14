import { createHash, createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { scramSha256Verifier } from "@/lib/provisioning/scram";
import { connectTo } from "./support/postgres";

function hmac(key: Buffer, text: string): Buffer {
  return createHmac("sha256", key).update(text).digest();
}

function xor(a: Buffer, b: Buffer): Buffer {
  return Buffer.from(a.map((byte, i) => byte ^ (b[i] ?? 0)));
}

function parseVerifier(verifier: string) {
  const match = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(verifier);
  if (!match) throw new Error(`not a SCRAM verifier: ${verifier}`);
  return {
    iterations: Number(match[1]),
    salt: Buffer.from(match[2] ?? "", "base64"),
    storedKey: Buffer.from(match[3] ?? "", "base64"),
    serverKey: Buffer.from(match[4] ?? "", "base64"),
  };
}

describe("scramSha256Verifier", () => {
  it("has PostgreSQL's format with a fresh 16-byte salt and 4096 iterations", () => {
    const first = parseVerifier(scramSha256Verifier("correct horse battery staple"));
    const second = parseVerifier(scramSha256Verifier("correct horse battery staple"));
    expect(first.iterations).toBe(4096);
    expect(first.salt).toHaveLength(16);
    expect(first.storedKey).toHaveLength(32);
    expect(first.serverKey).toHaveLength(32);
    expect(first.salt.equals(second.salt)).toBe(false);
  });

  // RFC 7677 §3: user "user", password "pencil". The verifier is checked
  // against the exchange in the RFC: the client's proof must recover StoredKey
  // and the server's signature must come from ServerKey.
  it("matches the RFC 7677 example exchange", () => {
    const verifier = scramSha256Verifier("pencil", {
      iterations: 4096,
      salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64"),
    });
    const { storedKey, serverKey } = parseVerifier(verifier);

    const clientFirstBare = "n=user,r=rOprNGfwEbeRWgbNEkqO";
    const serverFirst =
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
    const clientFinalWithoutProof = "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
    const clientProof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const serverSignature = "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=";

    const clientKey = xor(clientProof, hmac(storedKey, authMessage));
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
    expect(hmac(serverKey, authMessage).toString("base64")).toBe(serverSignature);
  });

  it("honours the iteration count", () => {
    expect(scramSha256Verifier("password-1234", { iterations: 10000 })).toMatch(/^SCRAM-SHA-256\$10000:/);
  });

  it.each([
    ["non-ASCII", "pässwörd-1234"],
    ["a control character", "pass\tword-1234"],
    ["a NUL", "pass\0word"],
  ])("refuses %s (SASLprep would change it)", (_, password) => {
    expect(() => scramSha256Verifier(password)).toThrow(RangeError);
  });

  it("is accepted by PostgreSQL for a real login", async () => {
    const role = `t_test_scram_${randomBytes(6).toString("hex")}`;
    const password = randomBytes(24).toString("base64url");
    const verifier = scramSha256Verifier(password);
    const admin = await connectTo("postgres");
    try {
      // The role name is generated above ([a-z0-9_]) and the verifier is base64 plus "$:-".
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${verifier}'`);
      const stored = await admin.query<{ rolpassword: string }>(
        "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
        [role],
      );
      expect(stored.rows[0]?.rolpassword).toBe(verifier);

      const connect = async (secret: string): Promise<void> => {
        const client = new Client({
          host: process.env.POSTGRES_HOST,
          port: Number(process.env.POSTGRES_PORT?.trim() || "5432"),
          user: role,
          password: secret,
          database: "postgres",
          connectionTimeoutMillis: 5_000,
        });
        client.on("error", () => undefined);
        await client.connect();
        try {
          const who = await client.query<{ user: string }>("SELECT current_user AS user");
          expect(who.rows[0]?.user).toBe(role);
        } finally {
          await client.end();
        }
      };

      await connect(password);
      await expect(connect(`${password}x`)).rejects.toMatchObject({ code: "28P01" });
    } finally {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  });
});
