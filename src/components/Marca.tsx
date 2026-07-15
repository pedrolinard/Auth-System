export function Marca({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10.5" className="stroke-current" strokeWidth="1.25" opacity="0.35" />
      <circle cx="12" cy="9.4" r="2.6" className="fill-current" />
      <path d="M10.35 11.3L8.6 17.2H15.4L13.65 11.3Z" className="fill-current" />
    </svg>
  );
}
