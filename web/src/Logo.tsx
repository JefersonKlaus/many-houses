// The brand: a house whose inside is a rising bar chart (the house bought, renovated and valued). Petróleo
// (deep teal) with ouro (amber) for the growth. Drawn inline (no image request; allowed by the CSP).
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="12" fill="var(--logo-bg)" />
      <path d="M10 23.5 24 12l14 11.5" fill="none" stroke="var(--logo-line)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 21.5V36h20V21.5" fill="none" stroke="var(--logo-line)" strokeWidth="3.4" strokeLinejoin="round" />
      <rect x="18" y="29" width="3.4" height="7" rx="1" fill="var(--accent)" />
      <rect x="22.3" y="26" width="3.4" height="10" rx="1" fill="var(--accent)" />
      <rect x="26.6" y="23" width="3.4" height="13" rx="1" fill="var(--accent)" />
    </svg>
  );
}

/** The mark and the name: "Minhas Casas", with "Casas" in the brand color. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">Minhas <b>Casas</b></span>
    </span>
  );
}
