"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/prepare", label: "Prepare for a role" },
  { href: "/market", label: "Market & gaps" },
  { href: "/plan", label: "Weekly plan" },
  { href: "/practice", label: "Practice" },
  { href: "/report", label: "Weekly report" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/resume", label: "Resume" },
];

const MeContext = createContext<{ me: Me; refresh: () => Promise<void> } | null>(null);
export const useMe = () => {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe outside Shell");
  return ctx;
};

export function Shell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = async () => setMe(await api<Me>("/auth/me"));
  useEffect(() => {
    refresh().catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!me) return <div className="p-8 text-ink-faint">Loading…</div>;

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  return (
    <MeContext.Provider value={{ me, refresh }}>
      <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
        <aside className="border-b border-rule bg-surface md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-5 py-4 md:block md:pt-6">
            <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
              <Logo />
              CareerPilot
            </Link>
            <button className="btn-quiet btn md:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              Menu
            </button>
          </div>
          <nav className={`${menuOpen ? "block" : "hidden"} px-3 pb-4 md:block`} aria-label="Main">
            <ul className="space-y-0.5">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active(n.href) ? "page" : undefined}
                    className={`block rounded-[6px] px-3 py-1.5 text-[14.5px] ${
                      active(n.href) ? "bg-proof-wash font-medium text-proof-4" : "text-ink-soft hover:bg-paper hover:text-ink"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-rule px-3 pt-4 text-sm text-ink-faint">
              <p className="truncate" title={me.email}>{me.name ?? me.email}</p>
              <button onClick={logout} className="mt-1 text-action hover:underline">Sign out</button>
            </div>
          </nav>
        </aside>
        <main className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-8 md:py-10">{children}</main>
      </div>
    </MeContext.Provider>
  );
}

/** Mark: a proof ladder, fully climbed. */
export function Logo() {
  return (
    <span aria-hidden className="inline-flex items-end gap-[2px]" style={{ height: 18 }}>
      {[7, 10, 14, 18].map((h, i) => (
        <span key={h} style={{ width: 4, height: h, borderRadius: 1, background: `var(--color-proof-${i + 1})` }} />
      ))}
    </span>
  );
}
