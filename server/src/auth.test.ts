import { describe, it, expect } from "vitest";
import {
  parseEmailList,
  parsePrincipalHeader,
  resolvePrincipal,
  canWrite,
  evaluateWriteAccess,
  type AuthOptions,
  type Principal,
} from "./auth";

// Encode a principal object the way Azure Easy Auth does (base64 JSON).
function encodePrincipal(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

const baseOpts: AuthOptions = {
  adminEmails: [],
  allowDevAuth: false,
  devUserEmail: "dev@hocuspokers.local",
};

const googlePrincipal = {
  identityProvider: "google",
  userDetails: "Player@Gmail.com",
  claims: [
    { typ: "name", val: "Poker Player" },
    { typ: "email", val: "Player@Gmail.com" },
  ],
};

const microsoftPrincipal = {
  identityProvider: "aad",
  userDetails: "boss@outlook.com",
  claims: [
    { typ: "name", val: "The Boss" },
    { typ: "preferred_username", val: "boss@outlook.com" },
  ],
};

describe("parseEmailList", () => {
  it("trims, lower-cases and drops blanks", () => {
    expect(parseEmailList(" A@x.com , B@Y.com ,, ")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("returns [] for undefined or empty", () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList("")).toEqual([]);
  });
});

describe("parsePrincipalHeader", () => {
  it("parses a Google principal and lower-cases the email", () => {
    const p = parsePrincipalHeader(encodePrincipal(googlePrincipal));
    expect(p).toEqual<Principal>({
      email: "player@gmail.com",
      name: "Poker Player",
      provider: "google",
    });
  });

  it("parses a Microsoft principal via preferred_username", () => {
    const p = parsePrincipalHeader(encodePrincipal(microsoftPrincipal));
    expect(p?.email).toBe("boss@outlook.com");
    expect(p?.provider).toBe("aad");
  });

  it("falls back to userDetails when no email claim exists", () => {
    const p = parsePrincipalHeader(
      encodePrincipal({ identityProvider: "google", userDetails: "x@gmail.com", claims: [] })
    );
    expect(p?.email).toBe("x@gmail.com");
  });

  it("returns null for missing, empty or malformed headers", () => {
    expect(parsePrincipalHeader(undefined)).toBeNull();
    expect(parsePrincipalHeader("")).toBeNull();
    expect(parsePrincipalHeader("not-base64-json!!")).toBeNull();
    expect(parsePrincipalHeader(encodePrincipal({ claims: [] }))).toBeNull();
  });
});

describe("resolvePrincipal", () => {
  it("uses the header when present", () => {
    const p = resolvePrincipal(encodePrincipal(googlePrincipal), baseOpts);
    expect(p?.email).toBe("player@gmail.com");
  });

  it("returns null when anonymous and dev auth is off", () => {
    expect(resolvePrincipal(undefined, baseOpts)).toBeNull();
  });

  it("returns a dev user when anonymous and dev auth is on", () => {
    const p = resolvePrincipal(undefined, {
      ...baseOpts,
      allowDevAuth: true,
      devUserEmail: "Organiser@Local",
    });
    expect(p).toEqual<Principal>({
      email: "organiser@local",
      name: "Dev User",
      provider: "dev",
    });
  });
});

describe("canWrite", () => {
  const player: Principal = { email: "player@gmail.com", name: "P", provider: "google" };

  it("allows any signed-in user", () => {
    expect(canWrite(player, [])).toBe(true);
  });

  it("allows any signed-in user regardless of the allow-list", () => {
    expect(canWrite(player, ["player@gmail.com"])).toBe(true);
    expect(canWrite(player, ["boss@outlook.com"])).toBe(true);
  });

  it("denies a null principal", () => {
    expect(canWrite(null, [])).toBe(false);
  });
});

describe("evaluateWriteAccess", () => {
  it("401s an anonymous request", () => {
    const r = evaluateWriteAccess(undefined, baseOpts);
    expect(r).toEqual({ ok: false, status: 401, error: "Sign in required" });
  });

  it("allows a signed-in user when no allow-list is set", () => {
    const r = evaluateWriteAccess(encodePrincipal(googlePrincipal), baseOpts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.email).toBe("player@gmail.com");
  });

  it("allows any signed-in user even when an allow-list is set", () => {
    const r = evaluateWriteAccess(encodePrincipal(googlePrincipal), {
      ...baseOpts,
      adminEmails: ["boss@outlook.com"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.email).toBe("player@gmail.com");
  });

  it("allows an allow-listed user", () => {
    const r = evaluateWriteAccess(encodePrincipal(microsoftPrincipal), {
      ...baseOpts,
      adminEmails: ["boss@outlook.com"],
    });
    expect(r.ok).toBe(true);
  });

  it("allows the dev user when dev auth is enabled", () => {
    const r = evaluateWriteAccess(undefined, {
      ...baseOpts,
      allowDevAuth: true,
      devUserEmail: "dev@hocuspokers.local",
    });
    expect(r.ok).toBe(true);
  });
});
