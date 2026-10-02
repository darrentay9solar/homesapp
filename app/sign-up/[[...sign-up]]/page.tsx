import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        // dvh, not vh: mobile browser chrome shrinks the viewport as you
        // scroll, and vh would push the card under the toolbar.
        minHeight: "100dvh",
        padding: "24px 16px",
      }}
    >
      <SignUp />
    </main>
  );
}
