import Link from "next/link";
import { managementNavigation, type UserRole } from "@lake-tech/core";
import type { Viewer } from "../lib/auth";

export function AppShell({ viewer, title, eyebrow, children }: { viewer: Viewer; title: string; eyebrow: string; children: React.ReactNode }) {
  const nav = managementNavigation(viewer.role);
  return <div className="app-layout">
    <aside className="app-sidebar" aria-label="Management navigation">
      <Link className="brand app-brand" href="/"><span className="brand-mark">T</span><span>LAKE TECH<small>ESTATES</small></span></Link>
      <div className="identity"><strong>{viewer.display_name}</strong><span className="role-badge">{roleLabel(viewer.role)}</span></div>
      <nav>{nav.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}</nav>
      <form action="/api/auth/logout" method="post"><button className="button secondary wide">Sign out</button></form>
    </aside>
    <div className="app-main">
      <details className="mobile-nav"><summary>Menu · {roleLabel(viewer.role)}</summary><nav>{nav.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}</nav></details>
      <header className="app-page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div><span className="role-badge">{roleLabel(viewer.role)}</span></header>
      <div className="app-content">{children}</div>
    </div>
  </div>;
}

function roleLabel(role: UserRole): string { return role.charAt(0) + role.slice(1).toLowerCase(); }
