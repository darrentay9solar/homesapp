/** The Alerts screen's shapes and pure logic: grouping by day, filtering, and where an alert goes. */

export type AlertRow = {
  id: number;
  kind: string;
  kindLabel: string;
  title: string;
  body: string | null;
  link: string;
  projectId: number | null;
  projectName: string | null;
  createdAt: string;
  read: boolean;
  urgent: boolean;
};

export type AlertTab = "all" | "unread" | "late";

export function filterAlerts(list: AlertRow[], tab: AlertTab): AlertRow[] {
  if (tab === "unread") return list.filter((a) => !a.read);
  if (tab === "late") return list.filter((a) => a.urgent);
  return list;
}

const SG = "Asia/Singapore";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: SG });

/** "Today", "Yesterday", or a date, in Singapore time; newest group first. */
export function groupByDay(list: AlertRow[], now = new Date()): Array<{ label: string; alerts: AlertRow[] }> {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const groups = new Map<string, AlertRow[]>();
  for (const a of list) {
    const k = dayKey(new Date(a.createdAt));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([k, alerts]) => ({
      label:
        k === today
          ? "Today"
          : k === yesterday
            ? "Yesterday"
            : new Date(`${k}T12:00:00+08:00`).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "short", timeZone: SG }),
      alerts,
    }));
}

/** Only links inside the app are followed; anything else goes to the Alerts screen. */
export function safeLink(link: string | null | undefined): string {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : "/alerts";
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: SG });
}
