"""Generates Hachi's drawings in public/pet/. Run: python3 scripts/pet.py"""
import pathlib
OUT = pathlib.Path(__file__).parent.parent / "public" / "pet"

DEFS = """<defs>
<radialGradient id="fur" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#F6B961"/><stop offset=".55" stop-color="#DE8D35"/><stop offset="1" stop-color="#B5651D"/></radialGradient>
<linearGradient id="ear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9792B"/><stop offset="1" stop-color="#995114"/></linearGradient>
<linearGradient id="cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBDDA6"/><stop offset="1" stop-color="#EDB066" stop-opacity=".2"/></linearGradient>
<linearGradient id="leg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DE8D35" stop-opacity="0"/><stop offset=".3" stop-color="#E3963F"/><stop offset="1" stop-color="#F2BA6E"/></linearGradient>
</defs>"""

STYLE = """<style>
.tail{transform-box:view-box;animation:wag 1.1s ease-in-out infinite alternate}
.eye{transform-box:fill-box;transform-origin:center;animation:blink 5s infinite}
.strand{fill:none;stroke:#B9702A;stroke-width:.7;stroke-linecap:round;opacity:.55}
.lite{fill:none;stroke:#FBE2B0;stroke-width:.8;stroke-linecap:round;opacity:.8}
@keyframes wag{from{rotate:-7deg}to{rotate:9deg}}
@keyframes blink{0%,95%,100%{scale:1 1}97.5%{scale:1 .1}}
%EXTRA%
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>"""

def eye(cx, cy, s=1.0):
    return f"""<g class="eye"><ellipse cx="{cx}" cy="{cy}" rx="{3.5*s}" ry="{3.7*s}" fill="#3B2415"/>
<ellipse cx="{cx}" cy="{cy+.3}" rx="{2.3*s}" ry="{2.5*s}" fill="#170D07"/>
<circle cx="{cx+1.1*s}" cy="{cy-1.3*s}" r="{1.15*s}" fill="#fff"/><circle cx="{cx-1*s}" cy="{cy+1.2*s}" r="{.5*s}" fill="#fff" opacity=".8"/></g>"""

FRONT_BODY = f"""
<g class="tail" style="transform-origin:84px 104px">
 <path d="M82 106C96 106 107 99 112 86C112 82 110 80 108 80C108 84 106 86 103 87C105 83 105 79 103 76C101 81 98 85 94 88C95 85 95 82 93 80C91 86 88 91 84 96Z" fill="#D88A35"/>
 <path class="strand" d="M90 100C98 96 104 90 108 84M88 96C94 92 98 88 101 82"/>
</g>
<ellipse cx="38" cy="97" rx="15" ry="13" fill="#D2832F"/><ellipse cx="82" cy="97" rx="15" ry="13" fill="#D2832F"/>
<ellipse cx="28" cy="110.5" rx="9" ry="4.2" fill="#E9A350"/><ellipse cx="92" cy="110.5" rx="9" ry="4.2" fill="#E9A350"/>
<path d="M44 58C35 68 30 84 32 98C33 105 38 110 46 110H74C82 110 87 105 88 98C90 84 85 68 76 58Z" fill="url(#fur)"/>
<path d="M33 80Q30 84 33 86Q30 90 33 92M87 80Q90 84 87 86Q90 90 87 92" stroke="#C9772A" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M48 57C43 64 42 73 45 81C47 86 50 90 53 94Q56 90 58 95Q60 90 62 95Q64 90 67 94C70 90 73 86 75 81C78 73 77 64 72 57Z" fill="url(#cream)"/>
<path class="lite" d="M50 72C52 78 53 84 52 89M60 74V91M70 72C68 78 67 84 68 89M55 66C56 70 56 74 55 78M65 66C64 70 64 74 65 78"/>
<g class="legL"><path d="M43 80C42 92 42 102 43 109H54C54 102 54 92 53 80Z" fill="url(#leg)"/>
 <ellipse cx="48.5" cy="110.5" rx="7.6" ry="4.2" fill="#F5C886"/><path d="M46 108.5v3.5M51 108.5v3.5" stroke="#D8964A" stroke-width=".8" stroke-linecap="round"/></g>
<g class="legR"><path d="M77 80C78 92 78 102 77 109H66C66 102 66 92 67 80Z" fill="url(#leg)"/>
 <ellipse cx="71.5" cy="110.5" rx="7.6" ry="4.2" fill="#F5C886"/><path d="M69 108.5v3.5M74 108.5v3.5" stroke="#D8964A" stroke-width=".8" stroke-linecap="round"/></g>
<path d="M41 59Q60 69 79 59" stroke="#2F5BEA" stroke-width="4" fill="none" stroke-linecap="round"/>
<circle cx="60" cy="67" r="3" fill="#FFD166" stroke="#E0A800" stroke-width=".8"/>
<g class="head">
 <path d="M60 15C46 15 37 26 37 38C37 50 46 59 60 59C74 59 83 50 83 38C83 26 74 15 60 15Z" fill="url(#fur)"/>
 <path d="M56 17C57 24 57 30 55 37H65C63 30 63 24 64 17Z" fill="#F4C27C" opacity=".55"/>
 <path class="strand" style="opacity:.3" d="M50 20C48 23 47 26 47 29M70 20C72 23 73 26 73 29"/>
 <path d="M38 44Q34 50 39 52Q36 56 42 56M82 44Q86 50 81 52Q84 56 78 56" fill="#E59A45"/>
 <path d="M42 26C30 25 25 37 26 48C27 58 31 66 37 66C41 63 43 57 45 50C47 42 47 32 42 26Z" fill="url(#ear)"/>
 <path d="M78 26C90 25 95 37 94 48C93 58 89 66 83 66C79 63 77 57 75 50C73 42 73 32 78 26Z" fill="url(#ear)"/>
 <path class="strand" d="M33 36C31 44 31 52 33 60M38 34C36 42 36 52 37 62M87 36C89 44 89 52 87 60M82 34C84 42 84 52 83 62" style="stroke:#8E5118"/>
 <path d="M30 62Q32 67 35 64Q37 68 39 63M90 62Q88 67 85 64Q83 68 81 63" fill="#A45E1E"/>
 <path d="M46 31Q51 28.5 55 31M65 31Q69 28.5 74 31" stroke="#A9651F" stroke-width="1.1" fill="none" stroke-linecap="round"/>
 {eye(50.5, 36)}{eye(69.5, 36)}
 <ellipse cx="60" cy="48.5" rx="12.5" ry="9" fill="url(#cream)"/>
 <path d="M52 53C55 61 65 61 68 53C64 56.5 56 56.5 52 53Z" fill="#6B2C28"/>
 <path d="M55.6 55.6C55 62 57 66.5 60 66.5C63 66.5 65 62 64.4 55.6C62 57.2 58 57.2 55.6 55.6Z" fill="#EE7C8A"/>
 <path d="M60 57.5V64" stroke="#D45E6E" stroke-width=".8" stroke-linecap="round"/>
 <path d="M60 49.5V52.5M49.5 51C53 56 57 56 60 52.5C63 56 67 56 70.5 51" stroke="#5A3420" stroke-width="1.2" fill="none" stroke-linecap="round"/>
 <path d="M53.5 44.2C53.5 41 66.5 41 66.5 44.2C66.5 47.6 62.3 49.8 60 49.8C57.7 49.8 53.5 47.6 53.5 44.2Z" fill="#2A1A12"/>
 <ellipse cx="57.3" cy="43.1" rx="1.8" ry=".9" fill="#fff" opacity=".45"/>
</g>"""

def front(walking: bool) -> str:
    extra = ""
    if walking:
        extra = """.legL{animation:step .55s ease-in-out infinite alternate}.legR{animation:step .55s ease-in-out infinite alternate-reverse}
.head{animation:bob .55s ease-in-out infinite alternate}
@keyframes step{from{translate:0 0}to{translate:0 -4px}}@keyframes bob{from{translate:0 0}to{translate:0 1.2px}}"""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">{DEFS}{STYLE.replace("%EXTRA%", extra)}{FRONT_BODY}</svg>'

def side_leg(cls, x, top, fill, paw):
    return f"""<g class="{cls}" style="transform-origin:{x+5.5}px {top}px"><path d="M{x} {top}C{x-1} {top+12} {x} {top+22} {x+.5} {top+30}H{x+11}C{x+11.5} {top+20} {x+12} {top+10} {x+11} {top}Z" fill="{fill}"/>
<path d="M{x-.5} {top+8}Q{x-3} {top+13} {x-.5} {top+17}" stroke="{fill}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<ellipse cx="{x+7}" cy="{top+30.5}" rx="7" ry="3.2" fill="{paw}"/></g>"""

SIDE = f"""
<g class="tail" style="transform-origin:36px 46px">
 <path d="M38 46C30 43 22 37 16 28C14 25 12 22 13 19C17 23 21 26 26 28C24 31 24 33 27 35C25 37 24 40 27 42C25 45 26 47 29 49C32 50 35 51 38 51Z" fill="#D88A35"/>
 <path class="strand" d="M35 47C29 44 23 39 18 32M33 49C30 47 28 45 27 43"/>
</g>
{side_leg("legB", 42, 60, "#C47F35", "#D99A50")}
{side_leg("legA", 90, 60, "#C47F35", "#D99A50")}
<path d="M35 49C33 37 46 30 64 30C80 30 94 32 101 39C107 47 106 58 99 64C88 70 58 71 44 68C37 65 36 57 35 49Z" fill="url(#fur)"/>
<path d="M45 66Q48 73 52 68Q56 74 60 69Q64 75 68 69Q72 74 76 69Q80 73 84 68Q88 72 93 65C82 70 58 71 45 66Z" fill="#E9A957"/>
<path class="strand" d="M50 38C56 36 62 36 68 37M58 44C64 42 72 42 80 44M46 52C52 50 58 50 64 51"/>
<path d="M38 44C45 40 55 45 57 55C58 61 55 66 50 68L41 67C36 61 35 51 38 44Z" fill="#C9772A" opacity=".35"/>
{side_leg("legA", 44, 60, "url(#leg)", "#F5C886")}
{side_leg("legB", 88, 60, "url(#leg)", "#F5C886")}
<path d="M85 40C91 27 101 16 113 18L119 40C113 52 99 58 89 54Z" fill="url(#fur)"/>
<path d="M96 40C100 46 104 50 104 56Q100 54 98 58Q96 54 93 56C93 50 94 45 96 40Z" fill="url(#cream)"/>
<path d="M95 31C96 37 98 42 101 47" stroke="#2F5BEA" stroke-width="3.6" fill="none" stroke-linecap="round"/>
<circle cx="101.5" cy="49.5" r="2.4" fill="#FFD166" stroke="#E0A800" stroke-width=".7"/>
<g class="head">
 <ellipse cx="114" cy="25" rx="16" ry="14" fill="url(#fur)"/>
 <path d="M118 21C126 20 134 23 137 27.5C137 33 131 35.5 123 35.5C118 34.5 116 30 118 21Z" fill="url(#cream)"/>
 <path d="M124 33.5C127 38 132 37.5 135 33.5" stroke="#5A3420" stroke-width="1.1" fill="#6B2C28" stroke-linecap="round"/>
 <path d="M126.5 35.5C126.5 40.5 128.5 43.5 131 43C132.6 41.6 132.2 37.6 131.6 35Z" fill="#EE7C8A"/>
 <ellipse cx="136.2" cy="26.6" rx="3.1" ry="2.5" fill="#2A1A12"/><ellipse cx="135.4" cy="25.7" rx="1.1" ry=".6" fill="#fff" opacity=".5"/>
 <path d="M117.5 16.5Q121 14.5 124.5 16.5" stroke="#A9651F" stroke-width="1" fill="none" stroke-linecap="round"/>
 {eye(121.5, 20.5, .8)}
 <path d="M110 12C101 12 98 21 99 31C100 40 103 47 108 47C112 45 112 37 113 29C114 21 114 13 110 12Z" fill="url(#ear)"/>
 <path class="strand" d="M104 20C103 28 103 36 105 43M108 18C107 26 108 36 109 44" style="stroke:#8E5118"/>
 <path d="M102 44Q104 49 106 46Q108 50 110 45" fill="#A45E1E"/>
</g>"""

def side() -> str:
    extra = """.legA{transform-box:view-box;animation:swing .6s ease-in-out infinite alternate}
.legB{transform-box:view-box;animation:swing .6s ease-in-out infinite alternate-reverse}
.head{animation:bob .6s ease-in-out infinite alternate}
@keyframes swing{from{rotate:-14deg}to{rotate:14deg}}@keyframes bob{from{translate:0 0}to{translate:0 1.2px}}"""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 100">{DEFS}{STYLE.replace("%EXTRA%", extra)}{SIDE}</svg>'

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "sit.svg").write_text(front(False))
(OUT / "walk-front.svg").write_text(front(True))
(OUT / "walk-side.svg").write_text(side())
print("ok")
