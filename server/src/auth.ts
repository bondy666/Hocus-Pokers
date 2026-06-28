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
}

export interface AuthOptions {
  /** Lower-cased allow-list of organiser emails. Empty = any signed-in user. */
  adminEmails: string[];
  /** Local-dev: treat requests as a signed-in user when no header is present. */
  allowDevAuth: boolean;
  /** Email to use for the simulated dev user. */
  devUserEmail: string;
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
