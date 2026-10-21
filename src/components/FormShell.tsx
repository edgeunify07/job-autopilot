"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/app/actions";

export function SubmitButton({ children, className = "btn-primary" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function Banner({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        result.ok ? "border-good/30 bg-good/10 text-good" : "border-bad/30 bg-bad/10 text-bad"
      }`}
    >
      {result.message}
    </div>
  );
}

/** A <form> wired to a server action, with pending state and a result banner. */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "",
  encType,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} encType={encType} className={`space-y-4 ${className}`}>
      {children}
      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Banner result={state} />
      </div>
    </form>
  );
}
