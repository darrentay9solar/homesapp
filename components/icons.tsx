/** The prototype's icon set and logo, as React components. */

import type { CSSProperties, ReactNode } from "react";

type P = { size?: number; style?: CSSProperties };

function svg(children: ReactNode, opts: { sw?: number; join?: boolean; cap?: boolean } = {}) {
  const Icon = ({ size, style }: P) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={opts.sw ?? 1.9}
      strokeLinecap={opts.cap === false ? undefined : "round"}
      strokeLinejoin={opts.join === false ? undefined : "round"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
  return Icon;
}

export const I = {
  home: svg(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  list: svg(<path d="M8 6h13M8 12h13M8 18h13M3.2 6h.01M3.2 12h.01M3.2 18h.01" />),
  bell: svg(<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />),
  user: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  shield: svg(
    <>
      <path d="M12 2.5 20 6v6c0 5-3.6 8.6-8 9.5-4.4-.9-8-4.5-8-9.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  pin: svg(
    <>
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  back: svg(<path d="M15 19l-7-7 7-7" />, { sw: 2.1 }),
  plus: svg(<path d="M12 5v14M5 12h14" />, { sw: 2.2 }),
  x: svg(<path d="M6 6l12 12M18 6 6 18" />, { sw: 2.1 }),
  tick: svg(<path d="m5 12.5 4.5 4.5L19 7" />, { sw: 2.4 }),
  chev: svg(<path d="m6 9 6 6 6-6" />, { sw: 2 }),
  doc: svg(
    <>
      <path d="M14 2.5H7a1.5 1.5 0 0 0-1.5 1.5v16A1.5 1.5 0 0 0 7 21.5h10a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 2.5V7h4.5" />
    </>,
    { sw: 1.8 }
  ),
  cam: svg(
    <>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.7l1.3-2h6.9l1.3 2h2.8A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
      <circle cx="12" cy="13" r="3.6" />
    </>,
    { sw: 1.8 }
  ),
  cal: svg(
    <>
      <rect x="3.2" y="5" width="17.6" height="16" rx="2.2" />
      <path d="M3.2 10h17.6M8 3v4M16 3v4" />
    </>
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  pen: svg(<path d="M15.5 4.5 19.5 8.5 8 20H4v-4z" />, { sw: 1.8 }),
  alert: svg(
    <>
      <path d="M12 4 2.6 20h18.8z" />
      <path d="M12 10v4.2M12 17.4h.01" />
    </>,
    { sw: 2 }
  ),
  bolt: svg(<path d="M13.5 2.5 5 13.8h6L10.5 21.5 19 10.2h-6z" />),
  people: svg(
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.6 20c0-3.3 2.9-5.2 6.4-5.2s6.4 1.9 6.4 5.2" />
      <path d="M16.4 4.9a3.4 3.4 0 0 1 0 6.4M18 14.4c2.2.5 3.7 1.9 3.7 4.3" />
    </>
  ),
  sun: svg(
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
    </>
  ),
  moon: svg(<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" />),
  minus: svg(<path d="M6 12h12" />, { sw: 2.2 }),
  mail: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </>,
    { sw: 1.8 }
  ),
  lock: svg(
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>,
    { sw: 1.8 }
  ),
  eye: svg(
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    { sw: 1.8 }
  ),
  eyeOff: svg(
    <>
      <path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>,
    { sw: 1.8 }
  ),
};

/** The 9 Solar Home mark: a roof over a sun, with a bolt. */
export function Logo({ size = 60 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      stroke="var(--brand)"
      strokeWidth={4}
      strokeLinecap="round"
      role="img"
      aria-label="9 Solar Home"
    >
      <path d="M18 52 60 18l42 34" strokeWidth={4.5} />
      <circle cx="60" cy="66" r="21" />
      <path d="M63 55l-9 13h7l-3 10 9-13h-7z" fill="var(--brand)" stroke="none" />
      <g strokeWidth={3.4}>
        <path d="M60 33v9M60 90v9M27 66h9M84 66h9M37 43l6 6M77 83l6 6M83 43l-6 6M43 83l-6 6" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="wordmark">
      <b>GETHOMEAPPS</b>
      <small>9 SOLAR HOME · 九太阳家</small>
    </div>
  );
}
