import { expect, it } from "vitest";
import { hitekManagedService } from "./hitek-managed.ts";

it("enables operator-managed onboarding independently of hosting provider", () => {
  expect(hitekManagedService({})).toBe(false);
  expect(hitekManagedService({ HITEK_SUPABASE_URL: "https://identity.example.test" })).toBe(true);
  expect(hitekManagedService({ HITEK_MANAGED_SERVICE: "true" })).toBe(true);
  expect(hitekManagedService({ HITEK_MANAGED_SERVICE: "1" })).toBe(true);
  expect(hitekManagedService({ HITEK_MANAGED_SERVICE: "0", HITEK_SUPABASE_URL: "https://identity.example.test" })).toBe(false);
  expect(hitekManagedService({ HITEK_MANAGED_SERVICE: "false" })).toBe(false);
});
