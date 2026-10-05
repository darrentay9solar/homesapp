import { AppShell } from "@/components/shell";
import { AppProvider } from "@/lib/client/app-state";

/** Every screen a signed-in account holder sees: the shell plus who they are. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
