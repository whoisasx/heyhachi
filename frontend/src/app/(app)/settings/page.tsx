"use client";

import { useEffect, useState, type ReactNode } from "react";

import { PageHeader, ThemeSwitch } from "@/components/Sidebar";
import { api } from "@/lib/api";
import { setBackdrop, useBackdrop, useThemePref, type Backdrop } from "@/lib/theme";

interface Model {
  id: string;
  name: string;
  provider: string;
}
interface AppSettings {
  models: { orchestrator: Model; browser: Model };
  limits: { cost_per_task_usd: number; cost_per_day_usd: number; browser_steps: number; task_minutes: number; wait_minutes: number };
  browser: "cloud" | "local";
}
interface Usage {
  days: number;
  tasks: number;
  done: number;
  failed: number;
  cost_usd: number;
  avg_seconds: number | null;
  daily: { date: string; tasks: number; cost_usd: number }[];
}

const SOON = ["OpenAI", "Google Gemini", "OpenRouter"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  const theme = useThemePref();
  const backdrop = useBackdrop();

  useEffect(() => {
    Promise.all([api<AppSettings>("/settings"), api<Usage>("/usage?days=30")]).then(
      ([s, u]) => {
        setSettings(s);
        setUsage(u);
      },
      () => setError(true),
    );
  }, []);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-9 px-4 py-10 sm:px-6">
        <PageHeader title="Settings" note="How Hachi looks, what it runs on, and what it has cost.">
          {error && <p className="mt-3 text-sm text-danger">Couldn&apos;t reach the server. Reload to try again.</p>}
        </PageHeader>

        <Block label="Appearance">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted">
                {theme === "light" ? "Always light." : theme === "dark" ? "Always dark." : "Follows your computer\u2019s setting."}
              </p>
            </div>
            <ThemeSwitch />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <div>
              <p className="font-medium">Background</p>
              <p className="text-sm text-muted">
                {backdrop === "hachi" ? "A dawn sky and Hachi\u2019s meadow along the bottom." : "Calm paper, nothing behind the words."}
              </p>
            </div>
            <BackdropSwitch value={backdrop} />
          </div>
        </Block>

        <Block label="Usage · last 30 days">
          {usage ? <UsageView usage={usage} /> : <Skeleton h="h-56" />}
        </Block>

        <Block label="AI models">
          {settings ? (
            <>
              <Row
                title="Assistant"
                sub="Plans the task, talks to you, asks for access"
                right={<ModelTag model={settings.models.orchestrator} />}
              />
              <Row
                title="Browser agent"
                sub="Reads pages and clicks, types and scrolls"
                right={<ModelTag model={settings.models.browser} />}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted">
                <span>Bring your own model:</span>
                {SOON.map((p) => (
                  <span key={p} className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs">
                    {p}
                  </span>
                ))}
                <span className="soon-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                  <span aria-hidden>✦</span> Coming soon
                </span>
              </div>
            </>
          ) : (
            <Skeleton h="h-32" />
          )}
        </Block>

        <Block label="Limits · every task">
          {settings ? (
            <>
              <Row title="Spending limit" sub="AI and browser cost together; the task stops at this" right={<Mono>${settings.limits.cost_per_task_usd.toFixed(2)}</Mono>} />
              <Row title="Daily spending" sub="All your tasks in the last 24 hours; new tasks wait after this" right={<Mono>${settings.limits.cost_per_day_usd.toFixed(2)}</Mono>} />
              <Row title="Browser steps" sub="Clicks, typing and page loads per browser run" right={<Mono>{settings.limits.browser_steps}</Mono>} />
              <Row title="Working time" sub="Time spent working, not waiting for you" right={<Mono>{settings.limits.task_minutes} min</Mono>} />
              <Row title="Waiting for you" sub="A task pauses if a card isn't answered; Resume picks it up" right={<Mono>{settings.limits.wait_minutes} min</Mono>} />
              <Row title="Ask before irreversible actions" sub="Paying, ordering, sending, deleting" right={<span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok">Always on</span>} />
              <p className="border-t border-border px-4 py-3 text-xs text-muted">
                The same for everyone for now. When a task reaches a limit it stops and tells you; nothing is charged past it.
              </p>
            </>
          ) : (
            <Skeleton h="h-40" />
          )}
        </Block>

        <Block label="Browser">
          {settings ? (
            <Row
              title={settings.browser === "cloud" ? "Cloud browser" : "Local Chrome"}
              sub={
                settings.browser === "cloud"
                  ? "A fresh browser in the cloud for every task, with a live view and a proxy where a site needs one"
                  : "A Chrome window on the computer running the agent (development)"
              }
              right={<Mono>{settings.browser}</Mono>}
            />
          ) : (
            <Skeleton h="h-16" />
          )}
        </Block>
      </div>
    </main>
  );
}

function UsageView({ usage }: { usage: Usage }) {
  const finished = usage.done + usage.failed;
  const tiles = [
    { label: "Spend", value: `$${usage.cost_usd.toFixed(2)}`, accent: true },
    { label: "Tasks", value: String(usage.tasks) },
    { label: "Success", value: finished ? `${Math.round((usage.done / finished) * 100)}%` : "—" },
    { label: "Avg time", value: usage.avg_seconds == null ? "—" : duration(usage.avg_seconds), tip: "Start to finish, including time spent waiting for your answers" },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} title={"tip" in t ? t.tip : undefined} className={`p-4 ${i ? "border-l border-border" : ""} ${i > 1 ? "border-t border-border sm:border-t-0" : ""} ${i === 2 ? "border-l-0 sm:border-l" : ""}`}>
            <p className="font-mono text-[0.68rem] uppercase tracking-wider text-muted">{t.label}</p>
            <p className={`mt-1 font-mono text-2xl tabular-nums ${t.accent ? "text-accent" : ""}`}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">
        <SpendChart usage={usage} />
      </div>
    </div>
  );
}

/** One bar per day: cost (tasks shown on hover). */
function SpendChart({ usage }: { usage: Usage }) {
  const byDate = new Map(usage.daily.map((d) => [d.date, d]));
  const days = Array.from({ length: usage.days }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (usage.days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, ...(byDate.get(key) ?? { tasks: 0, cost_usd: 0 }) };
  });
  const max = Math.max(...days.map((d) => d.cost_usd), 0.01);
  const fmt = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  if (!usage.tasks) return <p className="py-6 text-center text-sm text-muted">No tasks in this period yet.</p>;
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px] border-b border-border">
        {days.map((d) => (
          <div
            key={d.key}
            title={`${fmt(d.key)}: $${d.cost_usd.toFixed(2)} · ${d.tasks} task${d.tasks === 1 ? "" : "s"}`}
            className="group flex h-full flex-1 items-end"
          >
            <div
              className={`w-full rounded-sm ${d.tasks ? "bg-accent/70 group-hover:bg-accent" : "bg-sunk"}`}
              style={{ height: d.tasks ? `${Math.max(6, (d.cost_usd / max) * 100)}%` : "3px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.68rem] text-muted">
        <span>{fmt(days[0].key)}</span>
        <span>{fmt(days[days.length - 1].key)}</span>
      </div>
    </div>
  );
}

const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 font-mono text-[0.68rem] uppercase tracking-wider text-muted">{label}</p>
      <div className="card">{children}</div>
    </section>
  );
}

function Row({ title, sub, right }: { title: string; sub: string; right: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

function ModelTag({ model }: { model: Model }) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-sm font-medium">{model.name}</span>
      <span className="font-mono text-[0.68rem] text-muted">{model.provider}</span>
    </span>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="tag text-xs">{children}</span>;

const Skeleton = ({ h }: { h: string }) => (
  <div className={`${h} flex flex-col gap-3 p-4`} aria-label="Loading">
    {[70, 45, 60].map((w) => (
      <span key={w} className="h-4 animate-pulse rounded bg-sunk" style={{ width: `${w}%` }} />
    ))}
  </div>
);

/** Paper (default) or Hachi: two little swatches that show what you get. */
function BackdropSwitch({ value }: { value: Backdrop }) {
  const options: { b: Backdrop; label: string; swatch: string }[] = [
    { b: "paper", label: "Paper", swatch: "bg-background" },
    {
      b: "hachi",
      label: "Hachi",
      swatch: "bg-[linear-gradient(180deg,#dcebf6_0%,#eef3ef_50%,#a9c99a_80%,#7fa86b_100%)] dark:bg-[linear-gradient(180deg,#16202d_0%,#171a1d_50%,#2c4026_80%,#304a28_100%)]",
    },
  ];
  return (
    <div role="radiogroup" aria-label="Background" className="inline-flex rounded-xl border border-border bg-sunk p-1">
      {options.map((o) => (
        <button
          key={o.b}
          type="button"
          role="radio"
          aria-checked={value === o.b}
          onClick={() => setBackdrop(o.b)}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
            value === o.b ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          <span className={`h-4 w-4 rounded-full border border-border ${o.swatch}`} aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}
