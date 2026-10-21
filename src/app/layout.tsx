import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Autopilot",
  description: "Finds jobs, tailors your resume, applies, and keeps the spreadsheet.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/setup", label: "Setup" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-line py-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white">
                JA
              </span>
              <span className="text-base font-semibold text-white">Job Autopilot</span>
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-slate-400 transition hover:bg-ink-soft hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 py-7">{children}</main>
          <footer className="border-t border-ink-line py-4 text-xs text-slate-600">
            Runs on your machine, under your accounts. You are responsible for every application it sends.
          </footer>
        </div>
      </body>
    </html>
  );
}
