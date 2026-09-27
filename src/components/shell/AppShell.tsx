"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, GithubLogo, ListChecks, MagnifyingGlass, Pulse, TelegramLogo, Crosshair, Wallet } from "@phosphor-icons/react";
import { usePoll } from "../usePoll";

const HEX = /^0x[a-fA-F0-9]{40}$/;
const LAST_KEY = "exitwindow:lastAddress";

interface Ledger {
  totalNetwork: number;
  totalCacheHits: number;
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 h-16 no-underline text-ink">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-lume-wash text-lume">
        <Crosshair size={18} weight="bold" />
      </span>
      <span className="text-[16px] font-semibold tracking-tight">Exit Window</span>
    </Link>
  );
}

function useLastAddress(): string | null {
  const path = usePathname();
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const m = path.match(/^\/me\/(0x[a-fA-F0-9]{40})/);
    if (m) localStorage.setItem(LAST_KEY, m[1]);
    setAddr(localStorage.getItem(LAST_KEY));
  }, [path]);
  return addr;
}

function NavItem({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 h-10 px-3 rounded-lg no-underline text-[14px] transition-[background-color,color] duration-150 ${
        active ? "bg-lume-wash text-lume font-medium" : "text-ink-2 hover:bg-bezel hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function Sidebar() {
  const path = usePathname();
  const last = useLastAddress();
  const { data } = usePoll<Ledger>("/api/ledger", 60_000);
  const items = [
    { href: "/", label: "Exiting now", icon: <Pulse size={18} />, active: path === "/" },
    { href: last ? `/me/${last}` : "/me", label: "Your trades", icon: <Wallet size={18} />, active: path.startsWith("/me") },
    { href: "/wallets", label: "Top wallets", icon: <ListChecks size={18} />, active: path.startsWith("/wallets") || path.startsWith("/w/") },
    { href: "/calls", label: "Nansen calls", icon: <Bell size={18} />, active: path.startsWith("/calls") },
  ];
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-rule bg-dial sticky top-0 h-dvh">
      <Wordmark />
      <nav className="flex flex-col gap-1 px-3 pt-2" aria-label="Main">
        {items.map((i) => (
          <NavItem key={i.label} {...i} />
        ))}
      </nav>
      <div className="mt-auto px-3 pb-4 flex flex-col gap-1 border-t border-rule pt-3">
        <a href="https://t.me/nansen_meridian_bot" target="_blank" rel="noreferrer" className="flex items-center gap-3 h-10 px-3 rounded-lg no-underline text-[14px] text-ink-2 hover:bg-bezel hover:text-ink transition-[background-color,color] duration-150">
          <TelegramLogo size={18} /> Alarm bot
        </a>
        <a href="https://github.com/kamalbuilds/exit-window" target="_blank" rel="noreferrer" className="flex items-center gap-3 h-10 px-3 rounded-lg no-underline text-[14px] text-ink-2 hover:bg-bezel hover:text-ink transition-[background-color,color] duration-150">
          <GithubLogo size={18} /> Source
        </a>
        <p className="px-3 pt-2 text-[12px] text-ink-3">
          Data: Nansen API
          {data ? (
            <span className="fig block">
              {data.totalNetwork} live · {data.totalCacheHits} cached
            </span>
          ) : null}
        </p>
      </div>
    </aside>
  );
}

function UtcClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const t = () => setNow(new Date().toISOString().slice(11, 19));
    t();
    const id = setInterval(t, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="fig text-[12px] text-ink-3 hidden md:inline">{now ?? "--:--:--"} UTC</span>;
}

function TopBar() {
  const router = useRouter();
  const last = useLastAddress();
  const [q, setQ] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <header className="h-16 border-b border-rule bg-paper/95 backdrop-blur sticky top-0 z-30">
      <div className="h-full flex items-center gap-4 px-4 lg:px-8">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const v = q.trim();
            if (HEX.test(v)) router.push(`/me/${v}`);
            else setBad(true);
          }}
          className="flex-1 max-w-xl"
        >
          <label htmlFor="global-search" className="sr-only">
            Hyperliquid address
          </label>
          <div className={`flex items-center gap-2 h-10 px-3 rounded-lg border bg-dial ${bad ? "border-late" : "border-rule"} focus-within:border-accent`}>
            <MagnifyingGlass size={16} className="text-ink-3 shrink-0" />
            <input
              id="global-search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setBad(false);
              }}
              placeholder="Paste your Hyperliquid address"
              spellCheck={false}
              autoComplete="off"
              className="fig flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-3 outline-none"
              aria-invalid={bad}
            />
          </div>
        </form>
        <div className="ml-auto flex items-center gap-4">
          <UtcClock />
          <Link href={last ? `/me/${last}` : "/me"} className="btn-primary h-9 px-4 inline-flex items-center gap-2 text-[13px] no-underline whitespace-nowrap">
            <TelegramLogo size={16} weight="bold" /> Arm exit alarm
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        {children}
      </div>
    </div>
  );
}
