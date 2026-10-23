import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import { HelperIntro } from "./HelperIntro";
import { setupAction } from "./HelperSetup";
import { draftOf, AgentWelcomeCard, agentWelcomeDue, welcomeName, welcomePatch } from "./AgentWelcome";

const agent = { id: "hitek-agent", threadId: "t1", name: "HITEK Agent", title: "", description: "", notifications: true, color: "chrome", mascotBody: null,
  avatarUrl: null, unread: false, modelSelection: { instanceId: "claude", model: "sonnet" }, createdAt: 1, defaultBot: {} } as unknown as Bot;

describe("HITEK Agent's first-launch welcome", () => {
  it("shows once, after onboarding and its tour, and never again after either choice", () => {
    const due = (bot: Pick<Bot, "welcomed" | "hidden"> | undefined, more: Partial<Parameters<typeof agentWelcomeDue>[0]> = {}) =>
      agentWelcomeDue({ bot, onboardingDue: false, welcomeOpen: false, tourOpen: false, ...more });
    expect(due({})).toBe(true);
    expect(due({ welcomed: true })).toBe(false);
    expect(due({}, { onboardingDue: true })).toBe(false);
    expect(due({}, { welcomeOpen: true })).toBe(false);
    expect(due({}, { tourOpen: true })).toBe(false);
    expect(due(undefined)).toBe(false);
    expect(due({ hidden: true })).toBe(false);
  });

  it("Add saves the person's changes, pins HITEK Agent and keeps it in the sidebar", () => {
    expect(welcomePatch(agent, { ...draftOf(agent), name: " Jarvis ", color: "blue", mascotBody: "blob" }, true))
      .toEqual({ name: "Jarvis", color: "blue", mascotBody: "blob", welcomed: true, sidebarHidden: false, pinned: true });
  });

  it("Add with the panel never opened keeps the chrome-steel defaults", () => {
    expect(welcomePatch(agent, draftOf(agent), true)).toEqual({ welcomed: true, sidebarHidden: false, pinned: true });
  });

  it("Not now turns Show HITEK Agent in the sidebar off, keeping what was changed, and nothing unchanged is sent", () => {
    expect(welcomePatch(agent, draftOf(agent), false)).toEqual({ welcomed: true, sidebarHidden: true });
    expect(welcomePatch(agent, { ...draftOf(agent), mascotBody: "star" }, false)).toEqual({ mascotBody: "star", welcomed: true, sidebarHidden: true });
  });

  it("saves an empty name as HITEK Agent and caps a long one at the bot-name limit", () => {
    const jarvis = { ...agent, name: "Jarvis" };
    expect(welcomePatch(jarvis, { ...draftOf(jarvis), name: "   " }, true).name).toBe("HITEK Agent");
    expect(welcomeName("x".repeat(300))).toHaveLength(100);
    expect(welcomeName("  Ada ")).toBe("Ada");
  });

  it("saves an uploaded picture as the bot's own edit screen would, and a colour picked after it goes back to the shape", () => {
    const uploaded = { ...draftOf(agent), avatarUrl: "/api/attachments/abc.png", avatarCrop: "circle" as const };
    expect(welcomePatch(agent, uploaded, true)).toEqual({ avatarUrl: "/api/attachments/abc.png", avatarCrop: "circle", welcomed: true, sidebarHidden: false, pinned: true });
    expect(welcomePatch(agent, { ...uploaded, color: "blue", avatarCrop: "mascot" }, true))
      .toEqual({ avatarUrl: "/api/attachments/abc.png", color: "blue", welcomed: true, sidebarHidden: false, pinned: true });
    const pictured = { ...agent, avatarUrl: "/api/attachments/abc.png", avatarCrop: "circle" } as Bot;
    expect(welcomePatch(pictured, { ...draftOf(pictured), avatarUrl: null, avatarCrop: "mascot" }, true))
      .toEqual({ avatarUrl: null, avatarCrop: "mascot", welcomed: true, sidebarHidden: false, pinned: true });
  });

  it("opens on HITEK Agent's picture alone: the customise panel stays closed until the picture is clicked", () => {
    const html = renderToStaticMarkup(createElement(StoreProvider, null, createElement(AgentWelcomeCard, { bot: agent, onClose: () => {} })));
    expect(html).toContain(`aria-label="${t("agentWelcome.customize", { name: "HITEK Agent" })}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-agent-welcome-panel="closed"');
    expect(html).toMatch(/data-agent-welcome-panel="closed"[^>]*|inert=""[^>]*data-agent-welcome-panel="closed"/);
    expect(html).toContain(t("agentWelcome.title", { name: "HITEK Agent" }));
    expect(html).toContain(t("agentWelcome.add", { name: "HITEK Agent" }));
  });
});

describe("HITEK Agent's intro in the chat", () => {
  const intro: Message = { id: "intro", role: "bot", kind: "options", at: 1, helperIntro: true, text: "Hi, I'm HITEK Agent.",
    card: { title: "Hi, I'm HITEK Agent, your helper for everything here.", subtitle: "", options: ["What are my bots up to?"] } };
  const render = (asksDone: boolean) => renderToStaticMarkup(createElement(StoreProvider, null,
    createElement(HelperIntro, { botId: "maus", threadId: "t1", message: intro, asksDone })));

  it("says who it is in the viewer's language, with asks and, on a fresh install, only the setup still to do", () => {
    const html = render(false);
    expect(html).toContain(t("helperIntro.title", { name: "HITEK Agent" }).replace("'", "&#x27;"));
    expect(html).toContain('data-helper-ask="helperIntro.ask.overview"');
    for (const step of ["ai", "bots", "apps", "phone", "cloud"]) expect(html).toContain(`data-helper-step="${step}"`);
  });

  it("drops the asks and setup once they were answered or dismissed, keeping what it said", () => {
    const html = render(true);
    expect(html).toContain('data-helper-intro="intro"');
    expect(html).not.toContain("data-helper-ask");
    expect(html).not.toContain("data-helper-step");
  });

  it("opens the app's own flow for each setup step", () => {
    expect(setupAction("ai")).toEqual({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(setupAction("bots")).toEqual({ type: "toggleNewBot", open: true });
    expect(setupAction("apps")).toEqual({ type: "togglePlugins", open: true, surface: "apps" });
    expect(setupAction("phone")).toMatchObject({ type: "toggleAppSettings", section: "companion", phonePairing: true });
    expect(setupAction("cloud")).toEqual({ type: "openCloudAdd", source: "app_onboarding" });
  });
});
