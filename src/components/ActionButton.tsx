"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/actions";

export function ActionButton({
  action,
  children,
  className = "btn-ghost",
  confirm,
  pendingLabel = "Working…",
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            setResult(await action());
            router.refresh();
          });
        }}
      >
        {pending ? pendingLabel : children}
      </button>
      {result ? (
        <span className={`text-xs ${result.ok ? "text-good" : "text-bad"}`}>{result.message}</span>
      ) : null}
    </span>
  );
}
