// Echte LEGO-Teile. blId = BrickLink-Teilenummer, designId = LEGO-Design-ID.
export const STUD_PARTS = {
  'plate-round': { label: 'Platte rund 1×1', blId: '4073',  designId: '6141',  shape: 'round' },
  'tile-round':  { label: 'Fliese rund 1×1', blId: '98138', designId: '98138', shape: 'round-flat' },
  'plate':       { label: 'Platte 1×1',      blId: '3024',  designId: '3024',  shape: 'square' },
  'tile':        { label: 'Fliese 1×1',      blId: '3070b', designId: '3070',  shape: 'square-flat' },
};

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
