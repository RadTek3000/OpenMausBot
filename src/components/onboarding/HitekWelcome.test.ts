// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, type WelcomeViewer } from "@/lib/onboarding";
import { applyBrand, DEFAULT_BRAND } from "@/lib/brand";
import type { ConfigStatus, InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({
  state: {} as { config: Partial<ConfigStatus>; instances: InstanceInfo[]; connected: boolean; bots: [] },
  api: vi.fn(), dispatch: vi.fn(), refreshInstances: vi.fn(),
}));
vi.mock("@/state/store", () => ({ api: f.api, useStore: () => f }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));
const { HitekWelcome, HITEK_WELCOME_HINT } = await import("./HitekWelcome");
const { NoEngines } = await import("../NoEngines");
const { HelperIntro } = await import("../HelperIntro");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const done = vi.fn();
const admin: WelcomeViewer = { hosted: false, canSave: true, email: "tester@example.test" };
const missing = { instanceId: "fixture", driverKind: "codex", displayName: "Fixture", models: { default: "m", options: [] }, snapshot: { state: "unavailable", authenticated: false } } as InstanceInfo;
const show = async (viewer = admin) => { await act(async () => root.render(createElement(HitekWelcome, { viewer, onDone: done }))); };
const text = () => host.textContent || "";
const press = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
beforeEach(() => {
  setLocale("en");
  f.state = { config: { hitekManaged: true, onboarding: { ...EMPTY_ONBOARDING, hintsSeen: ["existing-hint"] } }, connected: true, instances: [missing], bots: [] };
  f.api.mockReset(); f.dispatch.mockReset(); f.refreshInstances.mockReset(); done.mockReset();
  f.api.mockImplementation(async (path: string) => {
    if (path === "/api/hitek/connect") return { configured: false };
    if (path === "/api/mcp/servers") return { servers: [] };
    if (path === "/api/config") return f.state.config;
    throw new Error(`Unexpected request ${path}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); applyBrand({ brand: DEFAULT_BRAND, source: "default", file: "" }); });

it("shows the signed-in HITEK account and genuine setup gaps without provider or profile setup", async () => {
  await show();
  expect(text()).toContain("Welcome to HITEK Agent Desk");
  expect(text()).toContain("tester@example.test");
  expect(text()).toContain("Awaiting HITEK configuration");
  expect(text()).toContain("Awaiting service activation");
  expect(host.querySelector("input")).toBeNull();
  expect(text()).not.toMatch(/OpenMaus|MausBot|Claude|ChatGPT|npx|Connect an AI|Install a model provider/);
  expect(host.querySelector('button[disabled]')?.textContent).not.toBe("Explore workspace");
});

it("takes all managed welcome labels from the centralized brand", async () => {
  applyBrand({ brand: { ...DEFAULT_BRAND, name: "Example Desk", organizationName: "Example" }, source: "file", file: "fixture" });
  await show();
  expect(text()).toContain("Welcome to Example Desk");
  expect(text()).toContain("Example CRM");
  expect(text()).toContain("Example AI");
  expect(text()).toContain("Example manages activation");
  expect(text()).not.toContain("HITEK");
});

it("persists welcome acknowledgement without dropping existing hints", async () => {
  await show(); await press("Explore workspace");
  const write = f.api.mock.calls.find(([path, init]) => path === "/api/config" && init?.method === "PUT")!;
  expect(JSON.parse(write[1].body).onboarding.hintsSeen).toEqual(["existing-hint", HITEK_WELCOME_HINT]);
  expect(done).toHaveBeenCalledOnce();
});

it("keeps a failed save visible and permits a retry", async () => {
  await show();
  f.api.mockRejectedValueOnce(new Error("save failed"));
  await press("Explore workspace");
  expect(done).not.toHaveBeenCalled();
  expect(text()).toContain("Could not save your welcome progress");
  await press("Explore workspace");
  expect(done).toHaveBeenCalledOnce();
});

it("can close or replay without resetting account data", async () => {
  f.state.config.onboarding = { ...EMPTY_ONBOARDING, hintsSeen: [HITEK_WELCOME_HINT] };
  await show(); await press("Explore workspace");
  expect(f.api.mock.calls.some(([path]) => path === "/api/config")).toBe(false);
  expect(done).toHaveBeenCalledOnce();
});

it("never writes workspace settings or offers connection setup to a member", async () => {
  await show({ ...admin, canSave: false }); await press("Explore workspace");
  expect(f.api.mock.calls.some(([path]) => path === "/api/config")).toBe(false);
  expect(text()).toContain("Your shop administrator manages this connection");
});

it("uses a managed service state instead of the missing-engine installer", async () => {
  await act(async () => root.render(createElement(NoEngines)));
  expect(text()).toContain("Your workspace is open");
  expect(text()).toContain("Review setup");
  expect(text()).not.toMatch(/Install a model provider|API keys|Set CLI|Claude/);
});

it("replaces legacy first-chat setup and upsells with shop tasks", async () => {
  await act(async () => root.render(createElement(HelperIntro, { botId: "fixture", threadId: "thread", asksDone: false,
    message: { id: "welcome", at: 1, role: "bot", kind: "options", text: "Legacy intro", helperIntro: true } })));
  expect(text()).toContain("Show quotes awaiting follow-up");
  expect(text()).toContain("Review connection");
  expect(text()).not.toMatch(/Try HITEK Cloud|Connect an AI|Set up a bot for my inbox|know this app inside out/);
  await press("Summarize new inquiries in my shop.");
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "answerCard", answer: "Summarize new inquiries in my shop." }));
});
