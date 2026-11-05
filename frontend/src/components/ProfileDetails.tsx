"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { Select } from "./Select";
import { PageSection } from "./Sidebar";

/**
 * The user's details for forms on websites (Profile page). A task fills a
 * delivery address or sign-up form with these instead of stopping to ask.
 * Backend: GET/PUT /me/profile (app/profile.py), stored encrypted.
 */

type Details = Record<string, string>;

const GENDERS = ["", "Female", "Male", "Non-binary", "Prefer not to say"];
const FOOD = ["", "Vegetarian", "Non-vegetarian", "Eggetarian", "Vegan", "Jain"];

const opts = (list: string[]) => list.map((v) => ({ value: v, label: v || "Not set" }));
const lettersOnly = (v: string) => v.replace(/[^\p{L} .'-]/gu, "");

export function ProfileDetails({ googleEmail }: { googleEmail: string }) {
  const [saved, setSaved] = useState<Details | null>(null);
  const [draft, setDraft] = useState<Details>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    api<{ details: Details }>("/me/profile").then(
      (r) => {
        setSaved(r.details);
        setDraft(r.details);
      },
      () => setError("Couldn't load your details."),
    );
  }, []);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setJustSaved(false);
  };
  const dirty = saved !== null && JSON.stringify(trim(draft)) !== JSON.stringify(trim(saved));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ details: Details }>("/me/profile", {
        method: "PUT",
        body: JSON.stringify({ details: trim(draft) }),
      });
      setSaved(r.details);
      setDraft(r.details);
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const text = (k: string, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, clean?: (v: string) => string) => (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="input mt-1"
        value={draft[k] ?? ""}
        onChange={(e) => set(k, clean ? clean(e.target.value) : e.target.value)}
        {...extra}
      />
    </label>
  );

  return (
    <PageSection
      title="Details for forms"
      note="Hachi fills these in on websites (a delivery address, a sign-up form) instead of stopping to ask. All optional and encrypted. Your name, birthday, email and address are typed into the site without the AI ever seeing them."
    >
      {saved === null && !error ? (
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block h-10 animate-pulse rounded-lg bg-sunk" />
          ))}
        </div>
      ) : (
        <form
          className="space-y-6 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Group title="About you">
            {text("full_name", "Full name", { autoComplete: "name", placeholder: "As on your ID" }, lettersOnly)}
            <div className="grid gap-3 sm:grid-cols-2">
              {text("date_of_birth", "Date of birth", {
                type: "date",
                max: new Date().toISOString().slice(0, 10),
                min: "1900-01-01",
              })}
              <label className="block">
                <span className="text-xs text-muted">Gender</span>
                <Select className="mt-1" label="Gender" value={draft.gender ?? ""} onChange={(v) => set("gender", v)} options={opts(GENDERS)} />
              </label>
            </div>
          </Group>

          <Group title="Contact">
            <label className="block">
              <span className="flex items-center justify-between text-xs text-muted">
                Email for websites
                {googleEmail && draft.email !== googleEmail && (
                  <button type="button" className="text-accent hover:underline" onClick={() => set("email", googleEmail)}>
                    Use {googleEmail}
                  </button>
                )}
              </span>
              <input
                className="input mt-1"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={draft.email ?? ""}
                onChange={(e) => set("email", e.target.value.trim())}
              />
            </label>
            <p className="text-xs text-muted">Your phone number is in Sign-in above, verified.</p>
          </Group>

          <Group title="Address">
            {text("address_line1", "House / flat, street", { autoComplete: "address-line1" })}
            {text("address_line2", "Area, locality (optional)", { autoComplete: "address-line2" })}
            {text("landmark", "Landmark (optional)", { placeholder: "Near…" })}
            <div className="grid gap-3 sm:grid-cols-2">
              {text("city", "City", { autoComplete: "address-level2" }, lettersOnly)}
              {text("state", "State", { autoComplete: "address-level1" }, lettersOnly)}
              {text(
                "postal_code",
                "PIN / postal code",
                { autoComplete: "postal-code", inputMode: "numeric", maxLength: 12 },
                (v) => v.replace(/[^A-Za-z0-9 -]/g, ""),
              )}
              {text("country", "Country", { autoComplete: "country-name", placeholder: "India" }, lettersOnly)}
            </div>
          </Group>

          <Group title="Preferences">
            <label className="block sm:max-w-xs">
              <span className="text-xs text-muted">Food</span>
              <Select className="mt-1" label="Food preference" value={draft.food_preference ?? ""} onChange={(v) => set("food_preference", v)} options={opts(FOOD)} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Anything else Hachi should know</span>
              <textarea
                className="input mt-1 min-h-20 resize-y"
                maxLength={500}
                placeholder="Aisle seat on flights. Leave deliveries at the door, don't ring the bell."
                value={draft.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </Group>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save details"}
            </button>
            {dirty && !busy && (
              <button type="button" className="btn-ghost" onClick={() => setDraft(saved ?? {})}>
                Undo changes
              </button>
            )}
            {justSaved && !dirty && <span className="text-sm text-ok">✓ Saved</span>}
            {error && (
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
    </PageSection>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function trim(d: Details): Details {
  const out: Details = {};
  for (const [k, v] of Object.entries(d)) if (v?.trim()) out[k] = v.trim();
  return out;
}
