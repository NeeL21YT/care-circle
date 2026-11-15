"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useDisplaySettings, type Contrast, type TextSize } from "@/components/a11y/display-settings";
import { useAnnounce } from "@/components/a11y/announcer";
import { clearPin, hasPin, isValidPin, setPin } from "@/lib/client/pin";

function Radio<T extends string>({ name, value, current, onChange, label, hint }: { name: string; value: T; current: T; onChange: (v: T) => void; label: string; hint?: string }) {
  const id = `${name}-${value}`;
  return (
    <div className="flex items-start gap-3 rounded-xl border-2 border-border bg-surface p-4 has-[:checked]:border-primary has-[:checked]:bg-secondary">
      <input id={id} type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} className="mt-1 size-6 accent-[var(--primary)]" />
      <label htmlFor={id} className="text-base"><span className="font-semibold">{label}</span>{hint && <span className="block text-[0.95rem] text-muted-foreground">{hint}</span>}</label>
    </div>
  );
}

export function DisplaySettingsPanel({ showPin }: { showPin: boolean }) {
  const { settings, update } = useDisplaySettings();
  const announce = useAnnounce();
  const [pin, setPinValue] = useState("");
  const [pinSet, setPinSet] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage/APIs after mount; doing it during render would cause a hydration mismatch
  useEffect(() => { setPinSet(hasPin()); }, []);

  return (
    <div className="space-y-8">
      <Card>
        <fieldset className="space-y-3">
          <legend className="text-xl font-bold">Text size</legend>
          <p className="text-base text-muted-foreground">Applies everywhere in the app, on this device. You can also zoom the page with your browser.</p>
          <div className="grid gap-3">
            {([["normal", "Standard", "Comfortable reading size"], ["large", "Large", "About 17% bigger"], ["xlarge", "Extra large", "About 33% bigger"]] as [TextSize, string, string][]).map(([v, l, h]) => (
              <Radio key={v} name="textSize" value={v} current={settings.textSize} label={l} hint={h} onChange={(x) => { update({ textSize: x }); announce(`Text size set to ${l}.`); }} />
            ))}
          </div>
        </fieldset>
      </Card>
      <Card>
        <fieldset className="space-y-3">
          <legend className="text-xl font-bold">Contrast</legend>
          <div className="grid gap-3">
            {([["auto", "Match my device", "Uses your system's high-contrast setting if it has one"], ["normal", "Standard contrast", ""], ["high", "High contrast", "Black text on white with strong outlines"]] as [Contrast, string, string][]).map(([v, l, h]) => (
              <Radio key={v} name="contrast" value={v} current={settings.contrast} label={l} hint={h || undefined} onChange={(x) => { update({ contrast: x }); announce(`Contrast set to ${l}.`); }} />
            ))}
          </div>
        </fieldset>
      </Card>
      <Card>
        <CardTitle>Read-aloud speed</CardTitle>
        <p className="mt-1 text-base text-muted-foreground">Used by the “Read my day aloud” button. Screen readers use their own speed.</p>
        <Field id="speech-rate" label={`Speed: ${settings.speechRate.toFixed(1)}×`} className="mt-4">
          {(a) => <Input {...a} type="range" min={0.6} max={1.4} step={0.1} value={settings.speechRate} onChange={(e) => update({ speechRate: Number(e.target.value) })} onBlur={() => announce(`Read-aloud speed ${settings.speechRate.toFixed(1)} times.`)} />}
        </Field>
      </Card>
      {showPin && (
        <Card>
          <CardTitle>Screen lock PIN (optional)</CardTitle>
          <p className="mt-1 text-base text-muted-foreground">A quick lock for this device so others cannot open your medicines. It is stored only on this device and does not replace your password.</p>
          <div className="mt-4 space-y-4">
            {msg && <Alert variant={msg.kind} title={msg.text} />}
            {pinSet ? (
              <Button variant="outline" onClick={() => { clearPin(); setPinSet(false); setMsg({ kind: "success", text: "PIN removed." }); announce("PIN removed."); }}>Remove PIN</Button>
            ) : (
              <form className="space-y-4" noValidate onSubmit={async (e) => {
                e.preventDefault();
                if (!isValidPin(pin)) { setMsg({ kind: "error", text: "A PIN must be 4 to 6 digits." }); announce("A PIN must be 4 to 6 digits.", "assertive"); return; }
                await setPin(pin); setPinValue(""); setPinSet(true); setMsg({ kind: "success", text: "PIN set. It will be asked for the next time you open the app in a new session." }); announce("PIN set.");
              }}>
                <Field id="new-pin" label="Choose a PIN (4 to 6 digits)">
                  {(a) => <Input {...a} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))} />}
                </Field>
                <Button type="submit">Set PIN</Button>
              </form>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
