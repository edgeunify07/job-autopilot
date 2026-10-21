export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next = "/" } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <div className="card">
        <h1 className="text-lg font-semibold text-white">Job Autopilot</h1>
        <p className="mt-1 text-sm text-slate-500">
          This dashboard holds your resume and contact details. Enter the password from your server&apos;s{" "}
          <code className="text-slate-400">.env</code>.
        </p>
        <form action="/api/login" method="post" className="mt-5 space-y-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" className="input" autoFocus required />
          </div>
          {error ? <p className="text-sm text-bad">Wrong password.</p> : null}
          <button type="submit" className="btn-primary w-full">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
