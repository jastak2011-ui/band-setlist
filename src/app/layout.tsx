import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  title: "Band Setlist",
  description: "Songs, smart sets, venue history, and BPM lookup",
};

const nav = [
  { href: "/", label: "Home" },
  { href: "/songs", label: "Songs" },
  { href: "/bands", label: "Bands" },
  { href: "/venues", label: "Venues" },
  { href: "/builder", label: "Set builder" },
  { href: "/history", label: "Set History" },
  { href: "/reports", label: "Reports" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="pb-16">
        <header className="no-print sticky top-0 z-10 border-b border-[var(--border)] bg-[#0c0f14]/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight text-[var(--accent)]">
              Band Setlist
            </Link>
            <nav className="flex flex-wrap gap-2">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  {n.label}
                </Link>
              ))}
              <LogoutButton />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
