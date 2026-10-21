import type { ReactNode } from "react";

export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-white";
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  submitted: "bg-good/15 text-good",
  applied: "bg-good/15 text-good",
  prepared: "bg-warn/15 text-warn",
  queued: "bg-accent/15 text-accent",
  needs_human: "bg-warn/20 text-warn",
  failed: "bg-bad/15 text-bad",
  rejected: "bg-slate-700/40 text-slate-400",
  skipped: "bg-slate-700/40 text-slate-400",
  new: "bg-slate-700/40 text-slate-300",
  scored: "bg-slate-700/40 text-slate-300",
  applying: "bg-accent/15 text-accent",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${STATUS_TONE[status] ?? "bg-slate-700/40 text-slate-300"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-600">—</span>;
  const tone = score >= 80 ? "text-good" : score >= 65 ? "text-warn" : "text-slate-400";
  return <span className={`font-mono text-sm font-semibold ${tone}`}>{score}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint ? <p className="max-w-md text-sm text-slate-500">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  hint,
  required,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        {required ? <span className="ml-1 text-bad">*</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="input"
      />
      {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-line bg-ink p-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-[#5b8cff]" />
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}
