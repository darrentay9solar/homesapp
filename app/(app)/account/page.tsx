"use client";

import { SignOutButton } from "@clerk/nextjs";

import { Header } from "@/components/shell";
import { ThemeToggle } from "@/components/theme-button";
import { Sec, initials } from "@/components/ui";
import { type Role, useMe } from "@/lib/client/app-state";

const ACCESS: Record<Role, string> = {
  homeowner:
    "View your own project only. Approve or decline the project and e-sign the handover certificate.",
  project_manager:
    "Full system administrator. Create projects, override any field, schedule EPC visits, manage accounts and close projects. Every action you take is written to the audit log.",
  contractor:
    "Fill and edit every milestone field for your contractor groups' projects, and schedule EPC site visits. No access to project creation or project details.",
  epc_team:
    "Everything the contractor admin can do — every milestone field and site scheduling — plus GPS check-in and check-out with crew counts.",
};

export default function AccountPage() {
  const me = useMe();
  if (!me) return null;
  return (
    <>
      <Header title="Account" />
      <div className="scroll" style={{ maxWidth: 720 }}>
        <div className="card row" style={{ gap: 13, marginTop: 14 }}>
          <span className="avs">
            <span style={{ width: 46, height: 46, fontSize: 15, margin: 0 }}>{initials(me.fullName ?? me.email)}</span>
          </span>
          <div className="grow">
            <div style={{ fontFamily: "var(--ff-d)", fontSize: 16, fontWeight: 640 }}>{me.fullName ?? "—"}</div>
            <div className="tiny">{me.roleLabel} · 9 Solar Home</div>
            <div className="tiny">{me.email}</div>
            {me.contactNo && <div className="tiny">{me.contactNo}</div>}
          </div>
        </div>

        <Sec title="Appearance" />
        <ThemeToggle />
        <div className="tiny" style={{ marginTop: 8 }}>
          Light is easier to read on a rooftop in daylight; black saves battery indoors.
        </div>

        <Sec title="Your access" />
        <div className="card">
          <div className="tiny" style={{ lineHeight: 1.7 }}>
            {ACCESS[me.role]}
          </div>
        </div>

        <Sec title="Commercial" />
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", paddingBottom: 9, borderBottom: "1px solid var(--line-soft)" }}>
            <span className="tiny">Admin fee</span>
            <b className="mono">S$3,500.00</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between", paddingTop: 9 }}>
            <span className="tiny">Export credit</span>
            <b className="mono">SP Group · monthly</b>
          </div>
        </div>

        <SignOutButton redirectUrl="/sign-in">
          <button className="btn g full" style={{ marginTop: 18 }}>
            Sign out
          </button>
        </SignOutButton>
        <div className="tiny" style={{ textAlign: "center", marginTop: 14 }}>
          GetHomeApps · 9 Solar Home
        </div>
      </div>
    </>
  );
}
