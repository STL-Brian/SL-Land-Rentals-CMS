import Link from "next/link";
import { managementNavigation, type UserRole } from "@lake-tech/core";
import type { Viewer } from "../lib/auth";

export function AppShell({ viewer, title, eyebrow, children }: { viewer: Viewer; title: string; eyebrow: string; children: React.ReactNode }) {
  const nav = managementNavigation(viewer.role);
  return <div className="app-layout container-fluid px-0">
    <aside className="app-sidebar d-flex flex-column" aria-label="Management navigation">
      <Link className="brand app-brand" href="/"><span className="brand-mark" aria-hidden="true">LTE</span><span>LAKE TECH<small>ESTATES</small></span></Link>
      <div className="identity"><strong>{viewer.display_name}</strong><span className="role-badge">{roleLabel(viewer.role)}</span></div>
      <nav className="nav flex-column gap-1">{nav.map(item => <Link className="nav-link" key={item.href} href={item.href}>{item.label}</Link>)}<Link className="nav-link" href="/account/password">Change password</Link></nav>
      <form action="/api/auth/logout" method="post"><button className="button btn btn-outline-light secondary wide">Sign out</button></form>
    </aside>
    <div className="app-main">
      <details className="mobile-nav d-md-none"><summary>Menu · {roleLabel(viewer.role)}</summary><nav className="nav flex-column">{nav.map(item => <Link className="nav-link" key={item.href} href={item.href}>{item.label}</Link>)}<Link className="nav-link" href="/account/password">Change password</Link></nav></details>
      <header className="app-page-head d-flex justify-content-between"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div><span className="role-badge">{roleLabel(viewer.role)}</span></header>
      <div className="app-content">{children}</div>
    </div>
  </div>;
}

function roleLabel(role: UserRole): string { return role.charAt(0) + role.slice(1).toLowerCase(); }
