import { AuthShell, Mark } from "@/components/auth";
import { DemoPicker } from "@/components/demo-picker";

/** DEVELOPMENT ONLY. The demo site's sign-in picker, with sample people from the preview's sample data. */
export default function DemoSignInPreview() {
  return (
    <AuthShell title="Sign In">
      <Mark />
      <DemoPicker />
    </AuthShell>
  );
}
