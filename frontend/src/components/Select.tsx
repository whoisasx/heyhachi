import { useEffect, useId, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** A dropdown that looks the same everywhere (the browser's own list varies by OS). */
export function Select({
  value,
  options,
  onChange,
  className = "",
  label,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(i: number) {
    onChange(options[i].value);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Tab") setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`input flex items-center gap-2 text-left ${open ? "border-accent" : ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 z-20 mt-1.5 max-h-64 min-w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                  i === active ? "bg-sunk" : ""
                }`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus on the button
                onClick={() => pick(i)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-nowrap">{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                </span>
                <span className={`text-accent ${selected ? "" : "invisible"}`}>✓</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
