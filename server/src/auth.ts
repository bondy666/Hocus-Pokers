import crypto from "crypto";

// Pure, testable authentication helpers for Hocus Pokers.
//
// In production, Azure App Service "Easy Auth" handles the Google / Microsoft
// OAuth flow and forwards a base64 'x-ms-client-principal' header. We never see
// passwords or tokens — we just decode the principal. These functions contain
// no Express/HTTP coupling so they can be unit-tested directly.

export interface Principal {
  email: string;
  name: string;
  provider: string;
  memberId?: string;
}

export interface AuthOptions {
  /** Lower-cased allow-list of organiser emails. Empty = any signed-in user. */
  adminEmails: string[];
  /** Local-dev: treat requests as a signed-in user when no header is present. */
  allowDevAuth: boolean;
  /** Email to use for the simulated dev user. */
  devUserEmail: string;
}

export const CLUB_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

/** Compare a submitted shared password without leaking matching prefix length. */
export function verifyClubPassword(candidate: unknown, configuredPassword: string | undefined): boolean {
  if (typeof candidate !== "string" || !configuredPassword || candidate.length > 1024) {
    return false;
  }
  const candidateHash = crypto.createHash("sha256").update(candidate).digest();
  const configuredHash = crypto.createHash("sha256").update(configuredPassword).digest();
  return crypto.timingSafeEqual(candidateHash, configuredHash);
}

/** Create a signed, expiring token for the selected club member. */
export function createClubSessionToken(
  secret: string,
  principal: Pick<Principal, "email" | "name" | "memberId">,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      expiresAt: Math.floor(now / 1000) + CLUB_SESSION_DURATION_SECONDS,
      email: principal.email,
      name: principal.name,
      memberId: principal.memberId,
    }),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Resolve a valid shared-password session token into its member principal. */
export function resolveClubSession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Principal | null {
  if (!token || !secret) return null;
  const [payload, signature, ...extra] = token.split(".");
  if (extra.length > 0 || !payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as {
      expiresAt?: unknown;
      email?: unknown;
      name?: unknown;
      memberId?: unknown;
    };
    const nowSeconds = Math.floor(now / 1000);
    if (
      typeof session.expiresAt !== "number" ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= nowSeconds ||
      session.expiresAt > nowSeconds + CLUB_SESSION_DURATION_SECONDS ||
      typeof session.email !== "string" ||
      !session.email ||
      typeof session.name !== "string" ||
      !session.name ||
      typeof session.memberId !== "string" ||
      !session.memberId
    ) {
      return null;
    }
    return {
      email: session.email,
      name: session.name,
      memberId: session.memberId,
      provider: "club-password",
    };
  } catch {
    return null;
  }
}

/** Parse a comma-separated env value into a lower-cased, trimmed list. */
export function parseEmailList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Decode an Easy Auth 'x-ms-client-principal' header value into a Principal.
 * Returns null when the header is missing or malformed.
 */
export function parsePrincipalHeader(header: string | undefined): Principal | null {
  if (typeof header !== "string" || header.length === 0) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    const claims: { typ: string; val: string }[] = parsed.claims || [];
    const find = (...types: string[]) => claims.find((c) => types.includes(c.typ))?.val;
    const email =
      find(
        "preferred_username",
        "email",
        "emails",
        "upn",
        // Easy Auth runtime ~1 emits email/name under the long WS-Fed claim URIs.
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      ) ||
      parsed.userDetails ||
      "";
    const name =
      find("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
      parsed.userDetails ||
      email;
    if (!email) return null;
    return {
      email: String(email).toLowerCase(),
      name: String(name),
      provider: parsed.identityProvider || parsed.auth_typ || "unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the signed-in user from the request header, falling back to a
 * simulated dev user when allowDevAuth is enabled.
 */
export function resolvePrincipal(
  header: string | undefined,
  opts: AuthOptions
): Principal | null {
  const fromHeader = parsePrincipalHeader(header);
  if (fromHeader) return fromHeader;
  if (opts.allowDevAuth) {
    return { email: opts.devUserEmail.toLowerCase(), name: "Dev User", provider: "dev" };
  }
  return null;
}

/**
 * Whether a principal is allowed to perform writes.
 *
 * Policy: every signed-in account is an admin and may change anything. The
 * `adminEmails` allow-list is retained for backwards compatibility but no
 * longer restricts access.
 */
export function canWrite(principal: Principal | null, _adminEmails: string[]): boolean {
  return !!(principal && principal.email);
}

export type AccessResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Evaluate whether a request may perform a write. Returns a discriminated
 * result with the HTTP status to send on failure.
 */
export function evaluateWriteAccess(
  header: string | undefined,
  opts: AuthOptions
): AccessResult {
  const principal = resolvePrincipal(header, opts);
  if (!principal || !principal.email) {
    return { ok: false, status: 401, error: "Sign in required" };
  }
  if (!canWrite(principal, opts.adminEmails)) {
    return { ok: false, status: 403, error: "Your account is not permitted to make changes" };
  }
  return { ok: true, principal };
}
