"use client";

import { useState, type ReactNode } from "react";
import { runCheck } from "@/lib/settings-actions";
import type { CheckName, CheckResult } from "@/lib/settings-checks";
import type { SecretState } from "@/lib/settings";

/**
 * The form vocabulary the setup guide is written in. Small on purpose: a
 * label over a control, a row of steps, a check button, a save bar. Every
 * section is these five things in some order.
 */

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`setup-field${wide ? " is-wide" : ""}`}>
      <span className="setup-field-label">{label}</span>
      {children}
      {hint && <span className="setup-field-hint">{hint}</span>}
    </label>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "url" | "number" | "email";
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <input
      className={`setup-input${mono ? " is-mono" : ""}`}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

/**
 * A credential. The page only ever holds `{ set, hint }` for one of these —
 * see publicSettings — so the control shows whether one is saved and lets you
 * replace it. Leaving it alone sends the object back, which applyPatch reads as
 * "keep what is on disk"; typing sends a string, which replaces it; clearing
 * sends "", which removes it.
 */
export function Secret({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: SecretState | string;
  onChange: (value: SecretState | string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(typeof value === "string");
  const [show, setShow] = useState(false);
  if (!editing && typeof value !== "string") {
    return (
      <span className="setup-secret">
        <span className={`setup-secret-state${value.set ? " is-set" : ""}`}>
          {value.set ? `saved ${value.hint}` : "not set"}
        </span>
        <button type="button" className="setup-btn is-small" disabled={disabled} onClick={() => setEditing(true)}>
          {value.set ? "Replace" : "Add"}
        </button>
        {value.set && (
          <button type="button" className="setup-btn is-small is-quiet" disabled={disabled} onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="setup-secret">
      <input
        className="setup-input is-mono"
        type={show ? "text" : "password"}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="setup-btn is-small is-quiet" onClick={() => setShow((s) => !s)}>
        {show ? "Hide" : "Show"}
      </button>
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="setup-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select className="setup-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** The things only a person can do, numbered, with the words they will see on screen in bold. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="setup-steps">{children}</ol>;
}

/** What a section gives you, in one or two sentences, before any field. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="setup-lead">{children}</p>;
}

export function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "good" }) {
  return <p className={`setup-note is-${tone}`}>{children}</p>;
}

/** A command to paste into PowerShell, with the copy button beside it. */
export function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="setup-command">
      <code>{children}</code>
      <button
        type="button"
        className="setup-btn is-small is-quiet"
        onClick={() => {
          void navigator.clipboard?.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Try the integration with what is on disk, and say what happened. */
export function CheckButton({ name, label = "Check", disabled }: { name: CheckName; label?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  return (
    <div className="setup-check">
      <button
        type="button"
        className="setup-btn"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            setResult(await runCheck(name));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : label}
      </button>
      {result && <span className={`setup-check-result${result.ok ? " is-ok" : " is-bad"}`}>{result.detail}</span>}
    </div>
  );
}

/**
 * Save, with the outcome beside it. `dirty` decides whether there is anything
 * to save; the section owns its draft and hands the bar a function that writes
 * it. `saved` is the word shown afterwards, so a section can say what happened.
 */
export function SaveBar({
  dirty,
  onSave,
  disabled,
  children,
}: {
  dirty: boolean;
  onSave: () => Promise<{ ok: boolean; error?: string }>;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="setup-savebar">
      <button
        type="button"
        className="setup-btn is-primary"
        disabled={!dirty || busy || disabled}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            const result = await onSave();
            setNote(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error ?? "That did not save." });
          } catch (err) {
            setNote({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {children}
      {note && <span className={`setup-check-result${note.ok ? " is-ok" : " is-bad"}`}>{note.text}</span>}
      {disabled && <span className="setup-check-result">Settings can only be changed on the machine the board runs on.</span>}
    </div>
  );
}

/** A list of short strings edited as one per line. */
export function Lines({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <textarea
      className="setup-input is-mono"
      rows={rows}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
