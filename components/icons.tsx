/** The 9 Solar Home mark: a roof over a sun, with a bolt. */
export function Logo({ size = 60, color = "var(--mui-palette-primary-main)" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" role="img" aria-label="9 Solar Home">
      <path d="M18 52 60 18l42 34" strokeWidth={4.5} />
      <circle cx="60" cy="66" r="21" />
      <path d="M63 55l-9 13h7l-3 10 9-13h-7z" fill={color} stroke="none" />
      <g strokeWidth={3.4}>
        <path d="M60 33v9M60 90v9M27 66h9M84 66h9M37 43l6 6M77 83l6 6M83 43l-6 6M43 83l-6 6" />
      </g>
    </svg>
  );
}
