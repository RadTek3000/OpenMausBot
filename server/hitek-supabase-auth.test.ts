import { describe, expect, it, vi } from "vitest";
import { createEmailSignIn } from "./account-signin.ts";
import { createSupabaseEmailIdentity } from "./hitek-supabase-auth.ts";

const env = { HITEK_SUPABASE_URL: "https://identity.example.test", HITEK_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" };
const allow = { admins: ["owner@example.test"], members: ["member@example.test"] };
const session = (email = "owner@example.test") => ({ access_token: "private-session", refresh_token: "private-refresh", user: {
  id: "verified-user", email, email_confirmed_at: "2026-10-26T12:00:00Z",
} });

describe("HITEK-owned Supabase email identity", () => {
  it("uses the configured identity service and returns only the verified identity and local role", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      new URL(String(input)).pathname.endsWith("/verify") ? Response.json(session()) : new Response(null, { status: 204 }));
    const signIn = createEmailSignIn({ allow, env, fetchImpl });
    expect(await signIn.start("OWNER@example.test")).toEqual({ ok: true });
    expect(await signIn.verify("owner@example.test", "123456")).toEqual({ ok: true, email: "owner@example.test", userId: "verified-user", scopes: ["admin", "client"] });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://identity.example.test/auth/v1/otp", "https://identity.example.test/auth/v1/verify", "https://identity.example.test/auth/v1/logout?scope=local",
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toEqual({ email: "owner@example.test", create_user: true });
    expect(JSON.parse(fetchImpl.mock.calls[1][1]!.body as string)).toEqual({ email: "owner@example.test", token: "123456", type: "email" });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { apikey: env.HITEK_SUPABASE_PUBLISHABLE_KEY } });
  });

  it("never requests a code for a person outside this dealer's allow-list", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const signIn = createEmailSignIn({ allow, env, fetchImpl });
    expect(await signIn.start("other-dealer@example.test")).toMatchObject({ ok: false, status: 403 });
    expect(await signIn.verify("other-dealer@example.test", "123456")).toMatchObject({ ok: false, status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechecks membership after the identity exchange and never returns provider tokens", async () => {
    let current = allow;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = { admins: [], members: [] };
      return Response.json(session());
    });
    const signIn = createEmailSignIn({ allow: () => current, env, fetchImpl });
    const result = await signIn.verify("owner@example.test", "123456");
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it.each(["wrong@example.test", "member@example.test"])("refuses a verified identity different from the requested email (%s)", async (email) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(session(email)));
    expect(await createEmailSignIn({ allow, env, fetchImpl }).verify("owner@example.test", "123456")).toMatchObject({ ok: false, status: 502 });
  });

  it("refuses an unverified identity", async () => {
    const data = session();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...data, user: { ...data.user, email_confirmed_at: null } }));
    expect(await createEmailSignIn({ allow, env, fetchImpl }).verify("owner@example.test", "123456")).toMatchObject({ ok: false, status: 502 });
  });

  it.each([400, 401, 403, 422, 429, 500])("redacts upstream failures (%s)", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: "private-provider-error", token: "private-token" }, { status }));
    const result = await createEmailSignIn({ allow, env, fetchImpl }).verify("owner@example.test", "123456");
    expect(result).toMatchObject({ ok: false, status: status === 429 ? 429 : status === 500 ? 502 : 401 });
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("fails closed on partial configuration instead of falling back to an upstream service", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const signIn = createEmailSignIn({ allow, env: { HITEK_SUPABASE_URL: env.HITEK_SUPABASE_URL }, fetchImpl });
    expect(await signIn.start("owner@example.test")).toMatchObject({ ok: false, status: 502 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["http://identity.example.test", "https://user:pass@identity.example.test", "https://identity.example.test/path", "https://identity.example.test?secret=value"])("rejects an unsafe service origin %s", (url) => {
    expect(() => createSupabaseEmailIdentity({ ...env, HITEK_SUPABASE_URL: url })).toThrow();
  });

  it("rejects elevated keys and invalid OTPs before any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const key of ["", "sb_secret_private", `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`]) {
      expect(() => createSupabaseEmailIdentity({ ...env, HITEK_SUPABASE_PUBLISHABLE_KEY: key }, fetchImpl)).toThrow();
    }
    const signIn = createEmailSignIn({ allow, env, fetchImpl });
    for (const code of ["123", "12345678901", "abcdef", "123-456"]) {
      expect(await signIn.verify("owner@example.test", code)).toMatchObject({ ok: false, status: 400 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
