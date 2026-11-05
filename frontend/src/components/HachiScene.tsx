/*
 * The Hachi theme's backdrop: a soft sky with light rays from the top right, a few
 * clouds drifting slowly, and low hills along the bottom so Hachi sits on its meadow.
 * At night: stars and faint moonlight instead. Always rendered behind the app; it
 * fades in and out with html[data-backdrop] (the button next to the logo). Styles
 * in globals.css (.hachi-scene).
 */
const CLOUDS = [
  { left: "8%", top: "7%", width: 150, duration: 140, delay: -20 },
  { left: "38%", top: "15%", width: 95, duration: 180, delay: -90 },
  { left: "63%", top: "5%", width: 120, duration: 160, delay: -50 },
  { left: "84%", top: "19%", width: 70, duration: 200, delay: -130 },
];

export function HachiScene() {
  return (
    <div className="hachi-scene" aria-hidden>
      <div className="hachi-sky" />
      <div className="hachi-stars" />
      <div className="hachi-rays" />
      {CLOUDS.map((c, i) => (
        <span
          key={i}
          className="hachi-cloud"
          style={{ left: c.left, top: c.top, width: c.width, animationDuration: `${c.duration}s`, animationDelay: `${c.delay}s` }}
        />
      ))}
      <svg className="hachi-hills" viewBox="0 0 1440 160" preserveAspectRatio="none">
        <path d="M0 95C220 45 420 60 640 82s440 40 800-12V160H0z" />
        <path d="M0 128c260-34 520-12 760-16s460-22 680-2V160H0z" />
      </svg>
    </div>
  );
}
