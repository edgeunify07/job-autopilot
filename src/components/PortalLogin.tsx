"use client";

import { useState, useTransition } from "react";
import { openPortalLoginAction } from "@/app/actions";

const TONE: Record<string, string> = {
  ok: "bg-good/15 text-good",
  needs_login: "bg-warn/15 text-warn",
  locked: "bg-bad/15 text-bad",
  unknown: "bg-slate-700/40 text-slate-400",
};

export function PortalLogin({
  id,
  label,
  loginUrl,
  tosNote,
  status,
  enabled,
}: {
  id: string;
  label: string;
  loginUrl: string;
  tosNote: string;
  status: string;
  enabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState(status);

  return (
    <div className="rounded-lg border border-ink-line bg-ink p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm text-slate-200">
            {label}
            <span className={`pill ${TONE[current] ?? TONE.unknown}`}>{current.replace("_", " ")}</span>
            {!enabled ? <span className="pill bg-slate-700/40 text-slate-500">not enabled</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{tosNote}</p>
        </div>
        <div className="flex gap-2">
          <a href={loginUrl} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
            Open login page
          </a>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await openPortalLoginAction(id);
                setMessage(res.message);
                setCurrent(res.ok ? "ok" : "needs_login");
              })
            }
          >
            {pending ? "Checking…" : "Check session"}
          </button>
        </div>
      </div>
      {message ? <p className="mt-2 text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
