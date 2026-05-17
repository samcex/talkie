export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Talkie"
    >
      <rect width="64" height="64" rx="18" fill="#dc2626" />
      <path
        d="M21 18c0-2.8 2.2-5 5-5h12c2.8 0 5 2.2 5 5v28c0 2.8-2.2 5-5 5H26c-2.8 0-5-2.2-5-5V18Z"
        fill="#fff"
      />
      <path
        d="M27 12V7m10 5V7"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="26"
        y="20"
        width="12"
        height="11"
        rx="2"
        fill="#dc2626"
        opacity="0.14"
      />
      <circle cx="32" cy="39" r="6" fill="#dc2626" />
      <path
        d="M14 25a14 14 0 0 1 0 14M50 25a14 14 0 0 0 0 14"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.82"
      />
      <path
        d="M9 20a22 22 0 0 1 0 24M55 20a22 22 0 0 0 0 24"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.42"
      />
    </svg>
  );
}
