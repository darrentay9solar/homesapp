import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { ROLE_LABEL, resolveAccount } from "@/lib/account";

import { RequestForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Where anyone signed in to Clerk without an active account ends up: ask for
 * one, see that a request is waiting, or learn it was declined.
 */
export default async function OnboardingPage() {
  const account = await resolveAccount();
  if (account.state === "active") redirect("/");
  if (account.state === "signed_out") redirect("/sign-in");

  return (
    <main>
      <header>
        <p className="eyebrow">9 Solar Home · GetHomeApps</p>
        {account.state === "pending" && (
          <>
            <h1>Waiting for approval</h1>
            <p className="lead">
              You asked to join as {ROLE_LABEL[account.request.requestedType]}. A project manager
              will review it, and you&apos;ll get an email and a WhatsApp message when they do.
            </p>
          </>
        )}
        {account.state === "deactivated" && (
          <>
            <h1>Account deactivated</h1>
            <p className="lead">
              Your account has been switched off. Contact your 9 Solar Home project manager if
              you think this is a mistake.
            </p>
          </>
        )}
        {(account.state === "no_account" || account.state === "rejected") && (
          <>
            <h1>Request access</h1>
            <p className="lead">
              {account.state === "rejected"
                ? `Your last request wasn't approved${
                    account.request.decisionNote ? ` (“${account.request.decisionNote}”)` : ""
                  }. You can send a new one.`
                : "You're signed in, but don't have a GetHomeApps account yet. Tell us who you are and a project manager will approve it."}
            </p>
          </>
        )}
      </header>

      {(account.state === "no_account" || account.state === "rejected") && (
        <section className="card">
          <RequestForm defaultName={account.clerk.fullName ?? ""} defaultPhone={account.clerk.phone ?? ""} />
        </section>
      )}

      <footer>
        <SignOutButton>
          <button type="button" className="signout">
            Sign out
          </button>
        </SignOutButton>
      </footer>
    </main>
  );
}
