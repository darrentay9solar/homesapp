import { SignUp } from "@clerk/nextjs";

import { Logo, Wordmark } from "@/components/icons";
import { ThemeButton } from "@/components/theme-button";

/**
 * Sign-up, branded like sign-in. People invited by a project manager land
 * here from their email link; anyone else who signs up is asked which role
 * they want and waits for a project manager to approve it.
 */
export default function Page() {
  return (
    <main className="login">
      <div className="top">
        <ThemeButton />
      </div>
      <div className="brand">
        <Logo size={56} />
        <Wordmark />
      </div>
      <h2>Create your login</h2>
      <p className="lead">
        Invited by 9 Solar Home? Use the email address the invitation was sent to.
      </p>
      <div className="form">
        <SignUp />
      </div>
    </main>
  );
}
