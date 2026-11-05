import { Paw } from "./Logo";

const REPO = "https://github.com/whoisasx/heyhachi";

/**
 * The sign-in page's left panel: a looping, CSS-only demo of the agent at work
 * (open a site, find the thing, click it, report back). Styles live in globals.css (.demo-*).
 */
export function AgentDemo() {
  return (
    <div className="demo relative flex h-full flex-col justify-between overflow-hidden p-10 text-white lg:p-14">
      {/* a calm meadow below the mountains (Angela Loria on Unsplash, Unsplash License) */}
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative photo straight from Unsplash's CDN */}
      <img
        src="https://images.unsplash.com/photo-1587990754909-18ae9d92c8e8?auto=format&fit=crop&w=1600&q=75"
        alt=""
        aria-hidden
        className="demo-scene pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(8,20,30,0.45)_0%,rgba(8,20,30,0)_28%,rgba(8,20,30,0)_52%,rgba(6,16,12,0.82)_100%)]" aria-hidden />
      {[12, 28, 46, 63, 78, 90].map((left, i) => (
        <span key={left} className="demo-pollen" style={{ left: `${left}%`, animationDelay: `${-i * 2.3}s` }} aria-hidden />
      ))}

      <span className="display relative inline-flex items-center gap-2 text-lg tracking-tight text-white/90">
        <Paw size={18} className="text-[#ffd98a]" />
        Hachi
        <span className="font-sans text-sm font-normal text-white/50">· the loyal agent</span>
      </span>

      <div className="relative mx-auto w-full max-w-[34rem]">
        {/* what the user asked */}
        <div className="demo-ask mb-4 ml-auto flex w-fit max-w-[85%] items-center gap-2 rounded-2xl rounded-br-md bg-white py-2 pl-3 pr-2 text-sm text-[#16181d] shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <GitHubMark />
          Star
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-[#f1f3f7] px-2 py-1 font-mono text-[12.5px] font-medium text-[#1f3fbf] transition-colors hover:bg-[#e3e8f8]"
          >
            whoisasx/heyhachi
            <Arrow />
          </a>
          on GitHub
        </div>

        {/* the browser it drives */}
        <div className="demo-window relative rounded-2xl border border-white/10 bg-[#0f1424]/90 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 flex-1 truncate rounded-md bg-white/[0.06] px-3 py-1 font-mono text-[11px] text-white/60">
              github.com/<span className="demo-url">whoisasx/heyhachi</span>
            </span>
          </div>

          <div className="relative space-y-4 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#f6b961] to-[#c9792b] text-white">
                <Paw size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white/90">whoisasx / heyhachi</p>
                <p className="text-[11px] text-white/45">Hachi, the loyal agent for any website</p>
              </div>
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open whoisasx/heyhachi on GitHub (new tab)"
                className="demo-star group/star relative flex h-8 items-center gap-2 rounded-lg border border-white/15 pl-3 pr-2 text-xs font-medium transition-colors hover:border-white/40 hover:bg-white/10"
              >
                <span className="relative grid w-[4.4rem] place-items-center">
                  <span className="demo-star-off col-start-1 row-start-1">☆ Star</span>
                  <span className="demo-star-on col-start-1 row-start-1 text-[#ffd166]">★ Starred</span>
                </span>
                <span className="grid h-5 w-5 place-items-center rounded-md bg-white/10 text-white/70 transition-colors group-hover/star:bg-white group-hover/star:text-[#0f1424]">
                  <Arrow />
                </span>
                <span className="demo-ripple" />
              </a>
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
            <svg className="demo-cursor pointer-events-none absolute h-5 w-5 drop-shadow" viewBox="0 0 24 24" aria-hidden>
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

function Arrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.27 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}
