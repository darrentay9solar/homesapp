"use client";

import { useActionState } from "react";

import { requestAccount } from "./actions";

export function RequestForm({ defaultName, defaultPhone }: { defaultName: string; defaultPhone: string }) {
  const [state, action, pending] = useActionState(requestAccount, null);
  return (
    <form action={action} className="form">
      <div className="pair">
        <label className="field">
          Full name
          <input name="fullName" required defaultValue={defaultName} autoComplete="name" />
        </label>
        <label className="field">
          I am a…
          <select name="requestedType" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option value="homeowner">Homeowner</option>
            <option value="contractor">Contractor Admin</option>
            <option value="epc_team">EPC Team</option>
            <option value="project_manager">Project Manager (9 Solar Home staff)</option>
          </select>
        </label>
      </div>
      <div className="pair">
        <label className="field">
          Mobile
          <input
            name="contactNo"
            type="tel"
            defaultValue={defaultPhone}
            placeholder="+65 9123 4567"
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
        <label className="field">
          Postal code
          <input name="postalCode" inputMode="numeric" maxLength={6} autoComplete="postal-code" />
        </label>
      </div>
      <label className="field">
        Address
        <input name="address" autoComplete="street-address" placeholder="Filled in from the postal code if left blank" />
      </label>
      <label className="field">
        NRIC last 4 <span className="hint">(homeowners only — e.g. 567D. Never the full NRIC.)</span>
        <input name="icLast4" maxLength={4} autoComplete="off" />
      </label>
      <label className="field">
        Anything the project manager should know
        <textarea name="note" rows={2} maxLength={500} placeholder="e.g. I'm with ABC Electrical" />
      </label>
      {state && (
        <p className={state.ok ? "flash" : "flash bad"} role="status">
          {state.message}
        </p>
      )}
      <div className="actions">
        <button className="btn" disabled={pending}>
          {pending ? "Sending…" : "Request access"}
        </button>
      </div>
    </form>
  );
}
