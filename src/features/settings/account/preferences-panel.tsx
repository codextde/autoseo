"use client";

import { useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { Rows, SettingRow } from "@/features/admin/components/settings-kit";
import { updateLocaleAction } from "../actions";
import { Segmented } from "./segmented";

export function PreferencesPanel({ locale: initialLocale }: { locale: "en" | "de" }) {
  const { theme, setTheme } = useTheme();
  // Theme is only known on the client (localStorage) — avoid a hydration mismatch.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [locale, setLocale] = useState(initialLocale);

  return (
    <Panel title="Preferences" description="Personal settings — they only affect you.">
      <Rows>
        <SettingRow label="Language" description="Used for emails, the onboarding wizard and reports you create.">
          <Segmented
            value={locale}
            onChange={async (v) => {
              const prev = locale;
              setLocale(v);
              const res = await updateLocaleAction(v);
              if (!res.ok) {
                setLocale(prev);
                toast.error(res.error);
              } else toast.success(v === "de" ? "Sprache auf Deutsch gestellt" : "Language set to English");
            }}
            options={[
              { value: "en", label: "English", icon: <span aria-hidden>🇬🇧</span> },
              { value: "de", label: "Deutsch", icon: <span aria-hidden>🇩🇪</span> },
            ]}
            className="w-full sm:w-auto"
          />
        </SettingRow>
        <SettingRow label="Theme" description="Stored on this device.">
          <Segmented
            value={(mounted ? theme : "system") as "system" | "light" | "dark"}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "system", label: "System", icon: <Monitor className="size-3.5" /> },
              { value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
              { value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
            ]}
            className="w-full sm:w-auto"
          />
        </SettingRow>
      </Rows>
    </Panel>
  );
}
