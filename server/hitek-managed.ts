/** Operator-owned service mode. Provider credentials and installation stay outside dealer onboarding. */
export function hitekManagedService(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.HITEK_MANAGED_SERVICE?.trim().toLowerCase();
  if (value === "0" || value === "false") return false;
  return value === "1" || value === "true" || Boolean(env.HITEK_SUPABASE_URL?.trim());
}
