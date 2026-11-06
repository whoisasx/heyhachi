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
 <path class="earL" d="M42 26C30 25 25 37 26 48C27 58 31 66 37 66C41 63 43 57 45 50C47 42 47 32 42 26Z" fill="url(#ear)"/>
 <path d="M78 26C90 25 95 37 94 48C93 58 89 66 83 66C79 63 77 57 75 50C73 42 73 32 78 26Z" fill="url(#ear)"/>
 <path class="strand" d="M33 36C31 44 31 52 33 60M38 34C36 42 36 52 37 62M87 36C89 44 89 52 87 60M82 34C84 42 84 52 83 62" style="stroke:#8E5118"/>
 <path d="M30 62Q32 67 35 64Q37 68 39 63M90 62Q88 67 85 64Q83 68 81 63" fill="#A45E1E"/>
 <path d="M46 31Q51 28.5 55 31M65 31Q69 28.5 74 31" stroke="#A9651F" stroke-width="1.1" fill="none" stroke-linecap="round"/>
 {eye(50.5, 36)}{eye(69.5, 36)}
 <ellipse cx="60" cy="48.5" rx="12.5" ry="9" fill="url(#cream)"/>
 <path d="M52 53C55 61 65 61 68 53C64 56.5 56 56.5 52 53Z" fill="#6B2C28"/>
<path class="tongue" d="M55.6 55.6C55 62 57 66.5 60 66.5C63 66.5 65 62 64.4 55.6C62 57.2 58 57.2 55.6 55.6Z" fill="#EE7C8A"/>
 <path d="M60 57.5V64" stroke="#D45E6E" stroke-width=".8" stroke-linecap="round"/>
 <path d="M60 49.5V52.5M49.5 51C53 56 57 56 60 52.5C63 56 67 56 70.5 51" stroke="#5A3420" stroke-width="1.2" fill="none" stroke-linecap="round"/>
 <path d="M53.5 44.2C53.5 41 66.5 41 66.5 44.2C66.5 47.6 62.3 49.8 60 49.8C57.7 49.8 53.5 47.6 53.5 44.2Z" fill="#2A1A12"/>
 <ellipse cx="57.3" cy="43.1" rx="1.8" ry=".9" fill="#fff" opacity=".45"/>
</g>"""

MOTION = """.tongue{transform-box:fill-box;transform-origin:50% 0;animation:pant .5s ease-in-out infinite alternate}
.earL,.ear{transform-box:fill-box;transform-origin:50% 8%;animation:flick 7s ease-in-out infinite}
.breath{transform-box:view-box;transform-origin:60px 110px;animation:breathe 3.2s ease-in-out infinite}
@keyframes pant{to{scale:1 1.2}}
@keyframes flick{0%,86%,100%{rotate:0deg}89%{rotate:-9deg}92%{rotate:4deg}95%{rotate:-2deg}}
@keyframes breathe{50%{scale:1 1.015}}"""


def front(tilted: bool) -> str:
    """Sitting, facing you. Tilted: the head cocked to one side (mirror it for the other)."""
    extra = MOTION + (
        """.head{transform-box:view-box;transform-origin:60px 60px;rotate:-12deg;animation:cock 4.5s ease-in-out infinite}
@keyframes cock{0%,100%{rotate:-12deg}50%{rotate:-8deg}}"""
        if tilted
        else """.head{transform-box:view-box;transform-origin:60px 60px;animation:sway 6s ease-in-out infinite}
@keyframes sway{0%,100%{rotate:0deg}30%{rotate:1.5deg}70%{rotate:-1.5deg}}"""
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">{DEFS}{STYLE.replace("%EXTRA%", extra)}{FRONT_BODY}</svg>'


# Sitting side-on, facing right (mirror it to face left). The head, ear, chest and
# collar are the original side drawing's; the body sits on its haunch.
SIDE_HEAD = f"""
 <ellipse cx="114" cy="25" rx="16" ry="14" fill="url(#fur)"/>
 <path d="M118 21C126 20 134 23 137 27.5C137 33 131 35.5 123 35.5C118 34.5 116 30 118 21Z" fill="url(#cream)"/>
 <path d="M124 33.5C127 38 132 37.5 135 33.5" stroke="#5A3420" stroke-width="1.1" fill="#6B2C28" stroke-linecap="round"/>
 <path class="tongue" d="M126.5 35.5C126.5 40.5 128.5 43.5 131 43C132.6 41.6 132.2 37.6 131.6 35Z" fill="#EE7C8A"/>
 <g class="nose"><ellipse cx="136.2" cy="26.6" rx="3.1" ry="2.5" fill="#2A1A12"/><ellipse cx="135.4" cy="25.7" rx="1.1" ry=".6" fill="#fff" opacity=".5"/></g>
 <path d="M117.5 16.5Q121 14.5 124.5 16.5" stroke="#A9651F" stroke-width="1" fill="none" stroke-linecap="round"/>
 {eye(121.5, 20.5, .8)}
 <g class="ear"><path d="M110 12C101 12 98 21 99 31C100 40 103 47 108 47C112 45 112 37 113 29C114 21 114 13 110 12Z" fill="url(#ear)"/>
 <path class="strand" d="M104 20C103 28 103 36 105 43M108 18C107 26 108 36 109 44" style="stroke:#8E5118"/>
 <path d="M102 44Q104 49 106 46Q108 50 110 45" fill="#A45E1E"/></g>"""

SIDE_SIT = f"""
<g class="tail" style="transform-origin:34px 104px">
 <path d="M36 104C28 107 18 107 10 102C7 100 6 97 8 95C12 98 17 99 22 99C20 97 20 95 22 93C25 96 29 98 33 98C32 96 33 94 35 93C37 96 38 99 38 102Z" fill="#D88A35"/>
 <path class="strand" d="M33 103C26 104 18 103 12 100"/>
</g>
<g class="breath">
<path d="M80 74C79 86 80 96 80.5 104H90C90.5 96 91 86 90 74Z" fill="#C47F35"/><ellipse cx="86" cy="105" rx="7" ry="3.2" fill="#D99A50"/>
<path d="M30 98C27 80 36 62 56 50C68 43 82 42 90 48C98 56 100 74 98 92C97 100 94 104 90 106L40 106C34 105 31 102 30 98Z" fill="url(#fur)"/>
<ellipse cx="48" cy="90" rx="21" ry="17" fill="url(#fur)"/>
<path d="M30 86C34 76 46 72 58 78C64 84 64 96 58 104L38 105C31 101 28 93 30 86Z" fill="#C9772A" opacity=".3"/>
<path class="strand" d="M38 80C44 76 52 77 57 82M44 62C52 56 62 52 72 51M40 72C46 66 54 62 62 61"/>
<ellipse cx="62" cy="105.5" rx="10" ry="3.4" fill="#E9A957"/>
<g class="paw" style="transform-origin:93.5px 72px"><path d="M88 72C87 86 88 96 88.5 104H99C99.5 96 100 86 99 72Z" fill="url(#leg)"/>
<path d="M87.5 82Q85 87 87.5 91" stroke="url(#leg)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
<ellipse cx="95" cy="105" rx="7" ry="3.2" fill="#F5C886"/></g>
<path d="M76 52C80 38 88 26 100 26L106 48C102 62 98 72 90 76C82 74 77 64 76 52Z" fill="url(#fur)"/>
<path d="M92 48C97 55 100 62 100 70Q96 67 94 72Q92 67 89 70C88 62 89 55 92 48Z" fill="url(#cream)"/>
<path d="M83 37C85 43 88 48 92 53" stroke="#2F5BEA" stroke-width="3.6" fill="none" stroke-linecap="round"/>
<circle cx="92.5" cy="56" r="2.4" fill="#FFD166" stroke="#E0A800" stroke-width=".7"/>
</g>
<g class="head" style="transform-origin:94px 44px"><g transform="translate(-14 4)">{SIDE_HEAD}</g></g>"""


def side() -> str:
    # pants, breathes, blinks, flicks an ear; now and then looks up, sniffs, and lifts a paw
    extra = MOTION + """.head{transform-box:view-box;animation:look 9s ease-in-out infinite}
.nose{transform-box:fill-box;transform-origin:center;animation:sniff 9s ease-in-out infinite}
.paw{transform-box:view-box;animation:lift 13s ease-in-out infinite}
@keyframes look{0%,18%,100%{rotate:0deg}24%,40%{rotate:-10deg}46%{rotate:0deg}60%,70%{rotate:5deg}76%{rotate:0deg}}
@keyframes sniff{0%,26%,40%,100%{scale:1}28%,32%,36%{scale:1.15 .9}30%,34%,38%{scale:1}}
@keyframes lift{0%,80%,100%{rotate:0deg;translate:0 0}84%,92%{rotate:-22deg;translate:2px -6px}}"""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 112">{DEFS}{STYLE.replace("%EXTRA%", extra)}{SIDE_SIT}</svg>'


OUT.mkdir(parents=True, exist_ok=True)
(OUT / "sit.svg").write_text(front(False))
(OUT / "sit-tilt.svg").write_text(front(True))
(OUT / "sit-side.svg").write_text(side())
print("ok")
