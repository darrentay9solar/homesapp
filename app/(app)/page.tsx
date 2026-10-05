"use client";

import { Header } from "@/components/shell";
import { Pill, Sec } from "@/components/ui";
import { useMe } from "@/lib/client/app-state";

/**
 * Home. Homeowners get "My Project"; everyone else the project list.
 * (Filled in by the Projects function; this is the shell's landing screen.)
 */
export default function Home() {
  const me = useMe();
  if (!me) return null;

  if (me.role === "homeowner") {
    return (
      <>
        <Header title="My Project" sub={me.fullName} />
        <div className="scroll">
          <div className="empty">No project is linked to your account yet.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={me.role === "project_manager" ? "All Projects" : "Assigned Projects"}
        sub={`${me.roleLabel} · ${me.fullName ?? me.email}`}
      />
      <div className="scroll">
        <div className="row wrap" style={{ gap: 8, margin: "14px 0 4px" }}>
          <Pill>0 active</Pill>
          <Pill tone="ok">All on track</Pill>
        </div>
        <Sec title="Projects" />
        <div className="empty">No projects yet.</div>
      </div>
    </>
  );
}
