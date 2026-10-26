import { X } from "lucide-react";

import { assistantName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore, type Message } from "@/state/store";
import { HelperSetup } from "./HelperSetup";
import { SHOP_STARTER_PROMPTS, shopAssistantIntro } from "../../shared/hitek-onboarding";

export const HELPER_ASK_KEYS: readonly LocaleKey[] = [
  "helperIntro.ask.overview", "helperIntro.ask.inbox", "helperIntro.ask.routine", "helperIntro.ask.howto",
];

/** The HITEK Agent's first message, in the viewer's language. Its asks go once one is tapped, it is dismissed, or the person
 * writes anything after it (`asksDone`). */
export function HelperIntro({ botId, threadId, message, asksDone }: { botId: string; threadId: string; message: Message; asksDone: boolean }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const name = bot?.name ?? assistantName();
  const team = bot?.defaultBot?.person ? state.config?.team?.name : undefined;
  const managed = state.config?.hitekManaged === true;
  const intro = shopAssistantIntro(name);
  const prompts = managed ? SHOP_STARTER_PROMPTS.map((text, index) => ({ key: `shop-${index}`, text })) : HELPER_ASK_KEYS.map(key => ({ key, text: t(key) }));
  const ask = (answer: string) => dispatch({ type: "answerCard", botId, threadId, messageId: message.id, answer });
  return (
    <div data-helper-intro={message.id} className="flex w-full flex-col items-start gap-2">
      <div className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        <p className="font-medium">{managed ? intro.title : t("helperIntro.title", { name })}</p>
        <p className="mt-1">{managed ? intro.subtitle : t("helperIntro.body")}</p>
        {!managed && bot?.chiefOfStaff && <p className="mt-1">{t("helperIntro.chief")}</p>}
        {team && <p className="mt-1">{t("helperIntro.team", { team })}</p>}
        {!managed && !asksDone && <p className="mt-1 text-ink-secondary">{t("helperIntro.try")}</p>}
      </div>
      {!asksDone && <HelperSetup />}
      {!asksDone && (
        <div role="group" aria-label={t("helperIntro.asks")} className="flex max-w-full flex-wrap items-center gap-1.5">
          {prompts.map(({ key, text }) => (
            <button
              key={key}
              type="button"
              data-helper-ask={key}
              onClick={() => ask(text)}
              className="rounded-full border border-hairline/60 bg-app px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            data-helper-dismiss=""
            onClick={() => dispatch({ type: "dismissCard", botId, threadId, messageId: message.id })}
            aria-label={t("helperIntro.dismiss")}
            title={t("helperIntro.dismiss")}
            className="flex size-7 items-center justify-center rounded-full text-ink-tertiary hover:bg-raised-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
