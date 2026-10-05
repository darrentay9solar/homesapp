import { SignIn } from "@clerk/nextjs";

import { Logo, Wordmark } from "@/components/icons";
import { ThemeButton } from "@/components/theme-button";

/** The prototype's login screen, with Clerk doing the actual signing in. */
export default function Page() {
  return (
    <main className="login">
      <div className="top">
        <ThemeButton />
      </div>
      <div className="brand">
        <Logo size={64} />
        <Wordmark />
      </div>
      <h2>
        Rooftop solar,
        <br />
        tracked to the day.
      </h2>
      <p className="lead">Follow your installation from commissioning through to grid connection.</p>
      <div className="form">
        <SignIn />
      </div>
      <p className="tiny" style={{ textAlign: "center", marginTop: 14 }}>
        Forgot password? Use &ldquo;Forgot password&rdquo; above, or contact your project manager.
      </p>
    </main>
  );
}
