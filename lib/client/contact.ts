/**
 * How to reach 9 Solar Home, as the company gives it to people who write in.
 * Shown before sign-in (/contact, linked from the sign-in page and the privacy
 * notice) and in Help. Change it here and every place follows.
 */
export const CONTACT = {
  newClients: "8989 9568",
  postSales: "8899 6734",
  email: "homes@9solarfintech.com",
  links: [
    { label: "Explore our solar plans", href: "https://tinyurl.com/9solarhomeplan" },
    { label: "Brochure", href: "https://tinyurl.com/9solarhomebrochure2026" },
    { label: "Book your installation", href: "https://tinyurl.com/9solarhome" },
    { label: "Common questions", href: "https://tinyurl.com/9solarhomefaqsolar" },
  ],
} as const;

/** "8989 9568" → "+6589899568" (Singapore numbers), for tel: and WhatsApp links. */
export function sgNumber(n: string): string {
  return `+65${n.replace(/\D/g, "")}`;
}

export function telHref(n: string): string {
  return `tel:${sgNumber(n)}`;
}

export function whatsappHref(n: string): string {
  return `https://wa.me/${sgNumber(n).slice(1)}`;
}
