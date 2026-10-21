"use client";

import { useEffect, useRef, useState } from "react";

interface Entry {
  id: string;
  level: string;
  scope: string;
  message: string;
  createdAt: string;
}

const LEVEL_TONE: Record<string, string> = {
  error: "text-bad",
  warn: "text-warn",
  info: "text-slate-300",
  debug: "text-slate-600",
};

export function LiveLog({ pollMs = 4000 }: { pollMs?: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (paused) return;
      try {
        const res = await fetch("/api/logs", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { entries: Entry[] };
        if (alive) setEntries(data.entries);
      } catch {
        /* the worker may simply not be running */
      }
    };
    void pull();
    const t = setInterval(pull, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs, paused]);

  useEffect(() => {
    if (!paused && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [entries, paused]);

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Activity</h2>
        <button type="button" onClick={() => setPaused((p) => !p)} className="text-xs text-slate-500 hover:text-white">
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div ref={boxRef} className="min-h-72 flex-1 overflow-y-auto rounded-lg bg-ink p-3 font-mono text-xs leading-relaxed">
        {entries.length === 0 ? (
          <p className="text-slate-600">Nothing yet. Start the worker with `npm run worker`.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="shrink-0 text-slate-700">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="shrink-0 text-slate-600">{e.scope}</span>
              <span className={LEVEL_TONE[e.level] ?? "text-slate-300"}>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
