"use client";

import { useActionState } from "react";
import { saveAcademySettings } from "@/app/academy/actions";
import { initialActionState } from "@/lib/action-state";
import type { AcademyLocale, DigestFrequency } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { ACADEMY_TIME_ZONES } from "@/lib/academy/time";
import { Field, FormMessage, Select } from "@/components/ui/field";
import { actionClasses } from "@/components/academy/ui";

export function AcademySettingsForm({
  locale,
  timeZone,
  digest,
  disabled,
}: {
  locale: AcademyLocale;
  timeZone: string;
  digest: DigestFrequency;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveAcademySettings, initialActionState);
  return (
    <form action={action} className="space-y-5">
      <FormMessage error={state.error} success={state.message} />
      <Field label={t(locale, "settings.language")} htmlFor="locale">
        <Select id="locale" name="locale" defaultValue={locale} disabled={disabled}>
          <option value="nl">{t(locale, "locale.nl")}</option>
          <option value="en">{t(locale, "locale.en")}</option>
        </Select>
      </Field>
      <Field label={t(locale, "settings.timeZone")} htmlFor="time_zone" hint={t(locale, "settings.timeZoneHint")}>
        <Select id="time_zone" name="time_zone" defaultValue={(ACADEMY_TIME_ZONES as readonly string[]).includes(timeZone) ? timeZone : "Europe/Amsterdam"} disabled={disabled}>
          {ACADEMY_TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {t(locale, `tz.${zone}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t(locale, "settings.digest")} htmlFor="digest_frequency">
        <Select id="digest_frequency" name="digest_frequency" defaultValue={digest} disabled={disabled}>
          <option value="daily">{t(locale, "settings.digest.daily")}</option>
          <option value="weekly">{t(locale, "settings.digest.weekly")}</option>
          <option value="off">{t(locale, "settings.digest.off")}</option>
        </Select>
      </Field>
      <button type="submit" disabled={pending || disabled} className={actionClasses("primary")}>
        {t(locale, "settings.save")}
      </button>
    </form>
  );
}
