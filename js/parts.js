// Echte LEGO-Teile. blId = BrickLink-Teilenummer, designId = LEGO-Design-ID.
export const STUD_PARTS = {
  'plate-round': { label: 'Platte rund 1×1', blId: '4073',  designId: '6141',  shape: 'round' },
  'tile-round':  { label: 'Fliese rund 1×1', blId: '98138', designId: '98138', shape: 'round-flat' },
  'plate':       { label: 'Platte 1×1',      blId: '3024',  designId: '3024',  shape: 'square' },
  'tile':        { label: 'Fliese 1×1',      blId: '3070b', designId: '3070',  shape: 'square-flat' },
};

// Reihenfolge = Wert im Formen-Raster (project.shapes)
export const SHAPE_KEYS = ['plate-round', 'tile-round', 'plate', 'tile'];
export const SHAPE_INDEX = Object.fromEntries(SHAPE_KEYS.map((k, i) => [k, i]));
export const SHAPE_PLATE = SHAPE_INDEX.plate;
export const SHAPE_TILE = SHAPE_INDEX.tile;

// Lange Fliesen: gleichfarbige Reihen eckiger 1×1-Fliesen werden zusammengefasst.
export const LONG_TILES = {
  2: { key: 'tile-1x2', label: 'Fliese 1×2', blId: '3069b', designId: '3069' },
  3: { key: 'tile-1x3', label: 'Fliese 1×3', blId: '63864', designId: '63864' },
  4: { key: 'tile-1x4', label: 'Fliese 1×4', blId: '2431',  designId: '2431' },
};

// Halbe Noppen: Fliesen, die auf einer 1×1-Platte sitzen und die Zelle nur teilweise bedecken.
// Code im Raster project.overlay: 0 = keine, sonst 1 + kind * 4 + Drehung (0–3, je 90° im Uhrzeigersinn).
export const OVERLAY_PARTS = [
  { key: 'quarter', label: 'Fliese 1×1 Viertelkreis', short: 'Viertelkreis', blId: '25269', designId: '25269' },
  { key: 'half',    label: 'Fliese 1×1 Halbkreis',    short: 'Halbkreis',    blId: '24246', designId: '24246' },
];
export const overlayCode = (kind, rot) => 1 + kind * 4 + (rot & 3);
export const overlayKind = code => (code - 1) >> 2;
export const overlayRot = code => (code - 1) & 3;

// Abschnittsgröße der Bauanleitung (eine Seite je 16×16 Noppen)
export const SECTION = 16;

export const STUD_MM = 8; // Rastermaß eines Noppen in mm

// Papierformate in mm (kurze × lange Seite). Noppen = ganze Noppen, die hineinpassen.
export const PAPER_FORMATS = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
};
export function paperStuds(format, orientation = 'portrait') {
  const [s, l] = PAPER_FORMATS[format].map(mm => Math.floor(mm / STUD_MM));
  return orientation === 'landscape' ? { cols: l, rows: s } : { cols: s, rows: l };
}
