"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { type Role, useApp, useMe } from "@/lib/client/app-state";

import { I, Logo } from "./icons";
import { initials } from "./ui";

type Tab = { href: string; label: string; icon: (p: { size?: number }) => ReactNode };

/**
 * Tabs per role, from the prototype. One change from it: Audit is project
 * managers only, per the later decision that only PMs may read the log.
 */
const TABS: Record<Role, Tab[]> = {
  homeowner: [
    { href: "/", label: "My Project", icon: I.home },
    { href: "/alerts", label: "Alerts", icon: I.bell },
    { href: "/account", label: "Account", icon: I.user },
  ],
  project_manager: [
    { href: "/", label: "Projects", icon: I.list },
    { href: "/people", label: "People", icon: I.people },
    { href: "/alerts", label: "Alerts", icon: I.bell },
    { href: "/audit", label: "Audit", icon: I.shield },
    { href: "/account", label: "Account", icon: I.user },
  ],
  contractor: [
    { href: "/", label: "Projects", icon: I.list },
    { href: "/alerts", label: "Alerts", icon: I.bell },
    { href: "/account", label: "Account", icon: I.user },
  ],
  epc_team: [
    { href: "/", label: "Projects", icon: I.list },
    { href: "/sites", label: "Sites", icon: I.pin },
    { href: "/alerts", label: "Alerts", icon: I.bell },
    { href: "/account", label: "Account", icon: I.user },
  ],
};

function isOn(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/projects");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { me: state } = useApp();
  const pathname = usePathname();
  if (!me) return null;
  const tabs = TABS[me.role];
  const unread = state?.unread ?? 0;

  return (
    <div className="shell">
      <aside className="side" aria-label="Main">
        <Link href="/" className="logo">
          <Logo size={34} />
          <span>
            <b>GETHOMEAPPS</b>
            <small>9 SOLAR HOME · 九太阳家</small>
          </span>
        </Link>
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={isOn(pathname, t.href) ? "on" : ""}>
            <t.icon />
            {t.label}
            {t.href === "/alerts" && unread > 0 && <i className="dot" />}
          </Link>
        ))}
        <div className="me">
          <span className={`ava ${me.role === "project_manager" ? "brand" : ""}`}>{initials(me.fullName ?? me.email)}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {me.fullName ?? me.email}
            </span>
            <span className="tiny">{me.roleLabel}</span>
          </span>
        </div>
      </aside>

      <div className="main">{children}</div>

      <nav className="nav" aria-label="Main">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={isOn(pathname, t.href) ? "on" : ""}>
            <t.icon />
            {t.href === "/alerts" && unread > 0 && <i className="dot" />}
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The screen header from the prototype: optional back, title/sub, actions, bell. */
export function Header({
  title,
  sub,
  back,
  right,
  bell = true,
}: {
  title: string;
  sub?: string | null;
  back?: string | true;
  right?: ReactNode;
  bell?: boolean;
}) {
  const router = useRouter();
  const { me } = useApp();
  const unread = me?.unread ?? 0;
  return (
    <header className="hd">
      {back && (
        <button
          className="icobtn"
          aria-label="Back"
          onClick={() => (back === true ? router.back() : router.push(back))}
        >
          <I.back size={19} />
        </button>
      )}
      <div className="grow">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
      {bell && (
        <Link href="/alerts" className="icobtn" aria-label={unread ? `${unread} unread alerts` : "Alerts"}>
          <I.bell />
          {unread > 0 && <i className="dot" />}
        </Link>
      )}
    </header>
  );
}
