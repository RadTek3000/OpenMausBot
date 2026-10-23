import { useState, type RefObject } from "react";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { assistantName, brand } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { colorSwatch, MAUS_COLOR_LABEL, MAUS_COLOR_NAMES } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import type { AvatarPatch, useAvatarImage } from "./avatar-editing";

export const AVATAR_FILE_TYPES = "image/png,image/jpeg,image/gif,image/webp";
const LABEL = "text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary";

/** The welcome's own profile edit: name, colour, look, then a picture of the person's own or one made with AI. */
export function AgentCustomize({ preview, name, nameRef, image, onName, onPatch }: {
  preview: Bot;
  name: string;
  nameRef: RefObject<HTMLInputElement | null>;
  image: ReturnType<typeof useAvatarImage>;
  onName(name: string): void;
  onPatch(patch: AvatarPatch): void;
}) {
  const [generating, setGenerating] = useState(false);
  const picture = Boolean(preview.avatarUrl) && preview.avatarCrop !== "mascot";
  const shape = (patch: AvatarPatch) => onPatch({ ...patch, avatarCrop: "mascot" });
  return (
    <div className="space-y-3 rounded-2xl bg-ink/[0.03] p-3.5 text-left">
      <label className="block">
        <span className={LABEL}>{t("onboarding.bot.name")}</span>
        <input
          ref={nameRef}
          value={name}
          maxLength={BOT_PROFILE_LIMITS.name}
          placeholder={assistantName()}
          data-agent-welcome-name=""
          onChange={(event) => onName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink focus:outline-none"
        />
      </label>
      <div>
        <span className={LABEL}>{t("onboarding.bot.color")}</span>
        <div role="radiogroup" aria-label={t("onboarding.bot.color")} className="mt-1.5 flex flex-wrap gap-1.5">
          {MAUS_COLOR_NAMES.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={!picture && preview.color === color}
              aria-label={t(MAUS_COLOR_LABEL[color])}
              title={t(MAUS_COLOR_LABEL[color])}
              data-agent-welcome-color={color}
              onClick={() => shape({ color })}
              className={cn("size-6 rounded-full border-2 transition-transform hover:scale-110", !picture && preview.color === color ? "border-ink" : "border-transparent")}
              style={{ background: colorSwatch(color) }}
            />
          ))}
        </div>
      </div>
      <div>
        <span className={LABEL}>{t("agentWelcome.look")}</span>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-ink/[0.04] px-3 py-2">
          <img src={brand().favicon} alt="" className="size-8 rounded-full object-cover" />
          <span className="text-[13px] font-medium text-ink">{assistantName()}</span>
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <input ref={image.fileRef} type="file" accept={AVATAR_FILE_TYPES} className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(event) => void image.upload(event.target.files?.[0])} />
          <button type="button" data-agent-welcome-upload="" disabled={image.busy} onClick={() => image.fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-ink-secondary hover:bg-ink/[0.05] hover:text-ink disabled:opacity-50">
            {image.uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            {t("agentWelcome.upload")}
          </button>
          <span aria-hidden="true" className="text-ink-tertiary">·</span>
          <button type="button" data-agent-welcome-generate="" aria-expanded={generating} onClick={() => setGenerating(!generating)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-ink-secondary hover:bg-ink/[0.05] hover:text-ink">
            <Sparkles size={14} aria-hidden="true" />{t("agentWelcome.generate")}
          </button>
          {picture && (
            <div className="basis-full"><button type="button" data-agent-welcome-remove="" disabled={image.busy} onClick={image.removeImage}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary hover:bg-ink/[0.05] hover:text-ink disabled:opacity-50">
              <Trash2 size={13} aria-hidden="true" />{t("agentWelcome.removePicture")}
            </button></div>
          )}
        </div>
        {image.error && <p role="alert" data-agent-welcome-error="" className="mt-1 px-2 text-[12.5px] text-danger">{image.error}</p>}
        {generating && (
          <div className="mt-2">
            <AvatarImageGenerator botLabel={name || assistantName()} disabled={image.uploading} generating={image.generating} onGenerate={image.generate} onSavingChange={image.setSavingConnection} />
          </div>
        )}
      </div>
    </div>
  );
}
