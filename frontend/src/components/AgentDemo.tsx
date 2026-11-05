import { Paw } from "./Logo";

/**
 * The sign-in page's left panel: a looping, CSS-only demo of the agent at work
 * (open a site, find the thing, click it, report back). Styles live in globals.css (.demo-*).
 */
export function AgentDemo() {
  return (
    <div className="demo relative flex h-full flex-col justify-between overflow-hidden p-10 text-white lg:p-14">
      {/* soft light blobs */}
      <span className="demo-glow left-[-10%] top-[-10%] bg-[#3b6cff]" />
      <span className="demo-glow bottom-[-15%] right-[-10%] bg-[#18a7a0] [animation-delay:-6s]" />

      <span className="display relative inline-flex items-center gap-2 text-lg tracking-tight text-white/90">
        <Paw size={18} className="text-[#7c9cff]" />
        Hachi
        <span className="font-sans text-sm font-normal text-white/50">· the loyal agent</span>
      </span>

      <div className="relative mx-auto w-full max-w-[34rem]">
        {/* what the user asked */}
        <div className="demo-ask mb-4 ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-white px-4 py-2.5 text-sm text-[#16181d] shadow-lg">
          Star browser-use/browser-use on GitHub
        </div>

        {/* the browser it drives */}
        <div className="demo-window relative rounded-2xl border border-white/10 bg-[#0f1424]/90 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 flex-1 truncate rounded-md bg-white/[0.06] px-3 py-1 font-mono text-[11px] text-white/60">
              github.com/<span className="demo-url">browser-use/browser-use</span>
            </span>
          </div>

          <div className="relative space-y-4 p-5">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#7c9cff] to-[#18a7a0]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white/90">browser-use / browser-use</p>
                <p className="text-[11px] text-white/45">Make websites accessible for AI agents</p>
              </div>
              <span className="demo-star relative grid h-8 w-24 place-items-center rounded-lg border border-white/15 text-xs font-medium">
                <span className="demo-star-off absolute">☆ Star</span>
                <span className="demo-star-on absolute text-[#ffd166]">★ Starred</span>
                <span className="demo-ripple" />
              </span>
            </div>
            <div className="space-y-2">
              <span className="block h-2 w-11/12 rounded bg-white/[0.07]" />
              <span className="block h-2 w-4/5 rounded bg-white/[0.07]" />
              <span className="block h-2 w-2/3 rounded bg-white/[0.07]" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <span className="h-14 rounded-lg bg-white/[0.04]" />
              <span className="h-14 rounded-lg bg-white/[0.04]" />
              <span className="h-14 rounded-lg bg-white/[0.04]" />
            </div>

            {/* the agent's cursor */}
            <svg className="demo-cursor absolute h-5 w-5 drop-shadow" viewBox="0 0 24 24" aria-hidden>
              <path d="M4 3l14 7-6 2-2 6z" fill="#fff" stroke="#0f1424" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>

          {/* progress, like the chat shows it */}
          <ol className="demo-steps absolute -bottom-10 -right-4 w-60 space-y-2 rounded-2xl border border-white/10 bg-[#161c30] p-4 text-xs shadow-2xl sm:-right-8">
            {["Opening github.com", "Finding the repo", "Clicking Star", "Checking it worked"].map((s, i) => (
              <li key={s} className={`demo-step demo-step-${i} flex items-center gap-2 text-white/80`}>
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#28c840] text-[9px] text-[#0f1424]">✓</span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        {/* floating reassurances */}
        <span className="demo-chip absolute -left-10 top-[58%] hidden rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs backdrop-blur lg:block">
          🔒 Password stays in your Vault
        </span>
        <span className="demo-chip absolute -left-2 -bottom-20 hidden rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs backdrop-blur [animation-delay:-3s] lg:block">
          ✋ Asks before paying
        </span>
      </div>

      <div className="relative max-w-md">
        <p className="display text-2xl leading-snug text-white sm:text-[1.7rem]">
          Say what you need. It opens a real browser and gets it done.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Orders, forms, settings, lookups. You watch it live, and it stops to ask whenever a code, a
          password or a payment is involved.
        </p>
      </div>
    </div>
  );
}
