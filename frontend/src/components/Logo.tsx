/** Hachi's mark: a paw print. Inherits the text colour. */
export function Paw({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <ellipse cx="5.6" cy="10" rx="2" ry="2.5" transform="rotate(-18 5.6 10)" />
      <ellipse cx="9.6" cy="5.6" rx="2" ry="2.6" transform="rotate(-6 9.6 5.6)" />
      <ellipse cx="14.4" cy="5.6" rx="2" ry="2.6" transform="rotate(6 14.4 5.6)" />
      <ellipse cx="18.4" cy="10" rx="2" ry="2.5" transform="rotate(18 18.4 10)" />
      <path d="M12 11.2c-3 0-6.2 3.6-6.2 6.3 0 1.8 1.3 2.9 3 2.9 1.3 0 2.1-.7 3.2-.7s1.9.7 3.2.7c1.7 0 3-1.1 3-2.9 0-2.7-3.2-6.3-6.2-6.3z" />
    </svg>
  );
}

/** "Hachi" with the paw, for headers. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display inline-flex items-center gap-2 ${className}`}>
      <Paw size={18} className="text-accent" />
      Hachi
    </span>
  );
}

/** A small dog seen from the side. `walking` makes its legs step (CSS: .dog-walk). */
export function Dog({ size = 12, walking = false, className = "" }: { size?: number; walking?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${walking ? "dog-walk" : ""} ${className}`}
      aria-hidden
    >
      <path d="M5.2 11.2C4 10.4 3.4 8.8 3.6 7.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="11" cy="12.4" rx="6.4" ry="3.2" />
      <circle cx="17.8" cy="8.6" r="3" />
      <ellipse cx="20.6" cy="9.9" rx="1.9" ry="1.3" />
      <path d="M15.6 6.6 16.4 3.6 18.4 6.2z" />
      {/* legs step in pairs: back-left with front-right, then the other two */}
      <rect className="dog-leg-a" x="5.9" y="13.4" width="2" height="6.2" rx="1" />
      <rect className="dog-leg-b" x="8.6" y="13.4" width="2" height="6.2" rx="1" />
      <rect className="dog-leg-b" x="12" y="13.4" width="2" height="6.2" rx="1" />
      <rect className="dog-leg-a" x="14.4" y="13.4" width="2" height="6.2" rx="1" />
    </svg>
  );
}
