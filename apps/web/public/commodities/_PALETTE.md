# Glacier badge palette — per-category gradient stops (x1=0,y1=0 → x2=1,y2=1)

| category       | stop 0    | stop 1    | notes |
|----------------|-----------|-----------|-------|
| metals · gold  | #F6D365   | #B8860B   | GLD only |
| metals · silver| #F1F3F8   | #9AA3B8   | SLV |
| metals · other | #D9DDE7   | #6C7590   | XPT, XPD, ALI (cool steel); HG uses #E8A868 → #8A4B1E (copper) |
| energy         | #FF8C42   | #5B2ED6   | CL, BZ, OIL, USO, NG, RB, HO — NG may shift to #FF7A59 → #7A2FE0 |
| agriculture    | #B7F27B   | #2E7D32   | ZW, ZC, ZS, ZM, ZL, ZR, ZO, LBR; softs (SB, KC, CC, CT, OJ, DC) use #FFD166 → #C2410C |
| livestock      | #FFB4C6   | #B23A5E   | LE, GF, HE |
| fast food      | #FFD166   | #FF6B2C   | all 13 food coins |
| cs2 skins      | #7DF9FF   | #B026FF   | 12 skins |
| game gold      | #FFE066   | #C77A00   | RSGP |
| trading cards  | #FFF06B   | #E5484D   | 25 cards/boxes |
| water          | #7DD3FC   | #0369A1   | H2O |
| cars           | #FF5C7A   | #7F1D1D   | LAMBO |
| watches        | #CBD5E1   | #334155   | 10 watches; gold-case watches (DAYTONA, NAUTILUS) may use #F6D365 → #7C5A0B |
| index coins    | #9945FF   | #14F195   | PMX, WATCHX, CS2X (the brand gradient, reserved for indexes + $ICE) |

Glyph: white (#FFFFFF), stroke 12, round caps/joins, no fills except tiny accents (≤ 2 per glyph, white at 0.9).
Keep every glyph inside x,y ∈ [56, 200]. One micro-animation per glyph, ≤ 6px travel or ≤ 8° rotation, 2–4 s, ease-in-out.
Never reuse a glyph between two coins. Never use emoji shapes, flags, or brand logos (no golden arches, no Rolex crown — draw a generic watch face).
