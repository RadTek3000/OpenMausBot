import { z } from "zod";
import { ControlPlaneError, type ControlPlaneClient } from "../electron/control-plane-client.mjs";

export type EmailIdentityProvider = Pick<ControlPlaneClient, "requestOTP" | "verifyOTP" | "signOut">;

export function supabaseAuthConfigured(env: NodeJS.ProcessEnv): boolean {
  return env.HITEK_SUPABASE_URL !== undefined || env.HITEK_SUPABASE_PUBLISHABLE_KEY !== undefined;
}

const verifiedSession = z.object({
  access_token: z.string().min(1),
  user: z.object({ id: z.string().min(1), email: z.email(), email_confirmed_at: z.iso.datetime() }),
});

export function createSupabaseEmailIdentity(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): EmailIdentityProvider {
  const url = new URL(env.HITEK_SUPABASE_URL ?? "");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("HITEK_SUPABASE_URL must be an HTTPS origin (loopback HTTP is allowed for development).");
  }
  const key = env.HITEK_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  let anonymous = false;
  try { anonymous = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "anon"; } catch { anonymous = false; }
  if ((!key.startsWith("sb_publishable_") && !anonymous) || /\s/.test(key)) {
    throw new Error("Use a Supabase publishable or legacy anon key, never a service-role/secret key, in the dealer runtime.");
  }

  async function post(path: string, body?: unknown, token?: string): Promise<Response> {
    const response = await fetchImpl(new URL(`/auth/v1/${path}`, url), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ControlPlaneError(path === "verify" ? "invalid_otp" : "auth_unavailable", response.status);
    }
    return response;
  }

  return {
    async requestOTP(email) {
      const response = await post("otp", { email, create_user: true });
      await response.body?.cancel();
    },
    async verifyOTP(email, rawCode) {
      const token = rawCode.replace(/\s/g, "");
      if (!/^\d{6,10}$/.test(token)) throw new ControlPlaneError("invalid_otp");
      const response = await post("verify", { email, token, type: "email" });
      const parsed = verifiedSession.safeParse(await response.json());
      if (!parsed.success || parsed.data.user.email.toLowerCase() !== email.toLowerCase()) {
        throw new ControlPlaneError("invalid_identity", 502);
      }
      return { accountToken: parsed.data.access_token, user: { id: parsed.data.user.id, email: parsed.data.user.email.toLowerCase(), emailVerified: true } };
    },
    async signOut(token) {
      const response = await post("logout?scope=local", undefined, token);
      await response.body?.cancel();
    },
  };
}
