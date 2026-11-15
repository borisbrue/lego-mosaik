// Echte LEGO-Teile. blId = BrickLink-Teilenummer, designId = LEGO-Design-ID.
export const STUD_PARTS = {
  'plate-round': { label: 'Platte rund 1×1', blId: '4073',  designId: '6141',  shape: 'round' },
  'tile-round':  { label: 'Fliese rund 1×1', blId: '98138', designId: '98138', shape: 'round-flat' },
  'plate':       { label: 'Platte 1×1',      blId: '3024',  designId: '3024',  shape: 'square' },
  'tile':        { label: 'Fliese 1×1',      blId: '3070b', designId: '3070',  shape: 'square-flat' },
};

// Grundplatte je 16×16-Abschnitt
export const BASE_PART = { label: 'Platte 16×16', blId: '91405', designId: '91405', size: 16 };

export const STUD_MM = 8; // Rastermaß eines Noppen in mm
