"""Makes a VAPID key pair for phone notifications (Web Push).

    npm run vapid-keys            prints a new pair to paste into Vercel
    npm run vapid-keys -- --local adds a pair to web/.env.local (prints nothing secret)

Use a different pair for production and for your laptop. Changing a pair
later turns notifications off on every phone (people turn them on again).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lib.push import new_keys

SUBJECT = "https://homesapp-alpha.vercel.app"


def main() -> None:
    public, private = new_keys()
    if "--local" in sys.argv:
        path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
        with open(path, encoding="utf8") as f:
            text = f.read()
        if "VAPID_PRIVATE_KEY=" in text:
            print(".env.local already has VAPID keys; left them alone.")
            return
        nl = "\r\n" if "\r\n" in text else "\n"
        with open(path, "a", encoding="utf8", newline="") as f:
            lead = "" if text.endswith(nl) else nl
            f.write(f"{lead}{nl}# Phone notifications (Web Push), laptop pair. See docs/alerts.md.{nl}")
            f.write(f"VAPID_PUBLIC_KEY={public}{nl}VAPID_PRIVATE_KEY={private}{nl}VAPID_SUBJECT={SUBJECT}{nl}")
        print("Added VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to .env.local.")
        return
    print("Paste these into Vercel → Settings → Environment Variables (Production):\n")
    print(f"VAPID_PUBLIC_KEY={public}")
    print(f"VAPID_PRIVATE_KEY={private}   (secret: tick 'Sensitive')")
    print(f"VAPID_SUBJECT={SUBJECT}")


if __name__ == "__main__":
    main()
