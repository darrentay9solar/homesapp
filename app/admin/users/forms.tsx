"use client";

import { useActionState } from "react";

import type { UserType } from "@/db/schema";

import { type ActionState, approveRequest, createUser, rejectRequest } from "./actions";

const ROLES: Array<[UserType, string]> = [
  ["homeowner", "Homeowner"],
  ["contractor", "Contractor Admin"],
  ["epc_team", "EPC Team"],
  ["project_manager", "Project Manager"],
];

function Flash({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={state.ok ? "flash" : "flash bad"} role="status">
      {state.message}
    </p>
  );
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, null);
  return (
    <form action={action} className="form">
      <div className="pair">
        <label className="field">
          Full name
          <input name="fullName" required autoComplete="off" />
        </label>
        <label className="field">
          Role
          <select name="userType" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pair">
        <label className="field">
          Email
          <input name="email" type="email" required autoComplete="off" inputMode="email" />
        </label>
        <label className="field">
          Mobile (for WhatsApp)
          <input name="contactNo" type="tel" placeholder="+65 9123 4567" inputMode="tel" />
        </label>
      </div>
      <div className="pair">
        <label className="field">
          Postal code
          <input name="postalCode" inputMode="numeric" maxLength={6} placeholder="6 digits" />
        </label>
        <label className="field">
          NRIC last 4 <span className="hint">(homeowners only)</span>
          <input name="icLast4" maxLength={4} placeholder="567D" autoComplete="off" />
        </label>
      </div>
      <label className="field">
        Address
        <input name="address" placeholder="Filled in from the postal code if left blank" />
      </label>
      <Flash state={state} />
      <div className="actions">
        <button className="btn" disabled={pending}>
          {pending ? "Creating…" : "Create account and notify"}
        </button>
      </div>
    </form>
  );
}

export function DecideRequestForm({
  requestId,
  requestedType,
}: {
  requestId: number;
  requestedType: UserType;
}) {
  const [approveState, approve, approving] = useActionState(approveRequest, null);
  const [rejectState, reject, rejecting] = useActionState(rejectRequest, null);
  const busy = approving || rejecting;
  return (
    <form className="form">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="pair">
        <label className="field">
          Grant role
          <select name="userType" defaultValue={requestedType}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Note <span className="hint">(sent if declined)</span>
          <input name="note" autoComplete="off" />
        </label>
      </div>
      <Flash state={approveState ?? rejectState} />
      <div className="actions">
        <button className="btn" formAction={approve} disabled={busy}>
          {approving ? "Approving…" : "Approve"}
        </button>
        <button className="btn danger" formAction={reject} disabled={busy}>
          {rejecting ? "Declining…" : "Decline"}
        </button>
      </div>
    </form>
  );
}
