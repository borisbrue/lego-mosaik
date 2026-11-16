// Offizielle LEGO-Farben (keine Fantasiefarben).
// legoId/legoName: offizielle LEGO-Farbnummer und -bezeichnung
// blId/blName:     BrickLink-Farb-ID und -Name (für Wanted-List-Export)
// hex:             Referenz-RGB (Rebrickable/BrickLink-Werte)
// Transparente, Perlmutt- und Metallicfarben sind bewusst ausgenommen,
// da sie in einem Mosaik nicht verlässlich wirken.
export const LEGO_COLORS = [
  { legoId: 1,   legoName: 'White',                    blId: 1,   blName: 'White',               de: 'Weiß',               hex: '#FFFFFF' },
  { legoId: 26,  legoName: 'Black',                    blId: 11,  blName: 'Black',               de: 'Schwarz',            hex: '#05131D' },
  { legoId: 194, legoName: 'Medium Stone Grey',        blId: 86,  blName: 'Light Bluish Gray',   de: 'Mittelsteingrau',    hex: '#A0A5A9' },
  { legoId: 199, legoName: 'Dark Stone Grey',          blId: 85,  blName: 'Dark Bluish Gray',    de: 'Dunkelsteingrau',    hex: '#6C6E68' },
  { legoId: 21,  legoName: 'Bright Red',               blId: 5,   blName: 'Red',                 de: 'Rot',                hex: '#C91A09' },
  { legoId: 154, legoName: 'Dark Red',                 blId: 59,  blName: 'Dark Red',            de: 'Dunkelrot',          hex: '#720E0F' },
  { legoId: 353, legoName: 'Vibrant Coral',            blId: 220, blName: 'Coral',               de: 'Koralle',            hex: '#FF698F' },
  { legoId: 106, legoName: 'Bright Orange',            blId: 4,   blName: 'Orange',              de: 'Orange',             hex: '#FE8A18' },
  { legoId: 38,  legoName: 'Dark Orange',              blId: 68,  blName: 'Dark Orange',         de: 'Dunkelorange',       hex: '#A95500' },
  { legoId: 191, legoName: 'Flame Yellowish Orange',   blId: 110, blName: 'Bright Light Orange', de: 'Hellorange',         hex: '#F8BB3D' },
  { legoId: 24,  legoName: 'Bright Yellow',            blId: 3,   blName: 'Yellow',              de: 'Gelb',               hex: '#F2CD37' },
  { legoId: 226, legoName: 'Cool Yellow',              blId: 103, blName: 'Bright Light Yellow', de: 'Hellgelb',           hex: '#FFF03A' },
  { legoId: 5,   legoName: 'Brick Yellow',             blId: 2,   blName: 'Tan',                 de: 'Beige',              hex: '#E4CD9E' },
  { legoId: 138, legoName: 'Sand Yellow',              blId: 69,  blName: 'Dark Tan',            de: 'Dunkelbeige',        hex: '#958A73' },
  { legoId: 283, legoName: 'Light Nougat',             blId: 90,  blName: 'Light Nougat',        de: 'Hellnougat',         hex: '#F6D7B3' },
  { legoId: 18,  legoName: 'Nougat',                   blId: 28,  blName: 'Nougat',              de: 'Nougat',             hex: '#D09168' },
  { legoId: 312, legoName: 'Medium Nougat',            blId: 150, blName: 'Medium Nougat',       de: 'Mittelnougat',       hex: '#AA7D55' },
  { legoId: 192, legoName: 'Reddish Brown',            blId: 88,  blName: 'Reddish Brown',       de: 'Rotbraun',           hex: '#582A12' },
  { legoId: 308, legoName: 'Dark Brown',               blId: 120, blName: 'Dark Brown',          de: 'Dunkelbraun',        hex: '#352100' },
  { legoId: 119, legoName: 'Bright Yellowish Green',   blId: 34,  blName: 'Lime',                de: 'Limette',            hex: '#BBE90B' },
  { legoId: 326, legoName: 'Spring Yellowish Green',   blId: 158, blName: 'Yellowish Green',     de: 'Gelbgrün',           hex: '#DFEEA5' },
  { legoId: 37,  legoName: 'Bright Green',             blId: 36,  blName: 'Bright Green',        de: 'Hellgrün',           hex: '#4B9F4A' },
  { legoId: 28,  legoName: 'Dark Green',               blId: 6,   blName: 'Green',               de: 'Grün',               hex: '#237841' },
  { legoId: 141, legoName: 'Earth Green',              blId: 80,  blName: 'Dark Green',          de: 'Dunkelgrün',         hex: '#184632' },
  { legoId: 151, legoName: 'Sand Green',               blId: 48,  blName: 'Sand Green',          de: 'Sandgrün',           hex: '#A0BCAC' },
  { legoId: 330, legoName: 'Olive Green',              blId: 155, blName: 'Olive Green',         de: 'Olivgrün',           hex: '#9B9A5A' },
  { legoId: 107, legoName: 'Bright Bluish Green',      blId: 39,  blName: 'Dark Turquoise',      de: 'Türkis',             hex: '#008F9B' },
  { legoId: 323, legoName: 'Aqua',                     blId: 152, blName: 'Light Aqua',          de: 'Aqua',               hex: '#ADC3C0' },
  { legoId: 322, legoName: 'Medium Azur',              blId: 156, blName: 'Medium Azure',        de: 'Mittelazur',         hex: '#36AEBF' },
  { legoId: 321, legoName: 'Dark Azur',                blId: 153, blName: 'Dark Azure',          de: 'Dunkelazur',         hex: '#078BC9' },
  { legoId: 212, legoName: 'Light Royal Blue',         blId: 105, blName: 'Bright Light Blue',   de: 'Hellblau',           hex: '#9FC3E9' },
  { legoId: 102, legoName: 'Medium Blue',              blId: 42,  blName: 'Medium Blue',         de: 'Mittelblau',         hex: '#5A93DB' },
  { legoId: 23,  legoName: 'Bright Blue',              blId: 7,   blName: 'Blue',                de: 'Blau',               hex: '#0055BF' },
  { legoId: 140, legoName: 'Earth Blue',               blId: 63,  blName: 'Dark Blue',           de: 'Dunkelblau',         hex: '#0A3463' },
  { legoId: 135, legoName: 'Sand Blue',                blId: 55,  blName: 'Sand Blue',           de: 'Sandblau',           hex: '#6074A1' },
  { legoId: 268, legoName: 'Medium Lilac',             blId: 89,  blName: 'Dark Purple',         de: 'Dunkelviolett',      hex: '#3F3691' },
  { legoId: 324, legoName: 'Medium Lavender',          blId: 157, blName: 'Medium Lavender',     de: 'Mittellavendel',     hex: '#AC78BA' },
  { legoId: 325, legoName: 'Lavender',                 blId: 154, blName: 'Lavender',            de: 'Lavendel',           hex: '#E1D5ED' },
  { legoId: 124, legoName: 'Bright Reddish Violet',    blId: 71,  blName: 'Magenta',             de: 'Magenta',            hex: '#923978' },
  { legoId: 22,  legoName: 'Bright Purple',            blId: 47,  blName: 'Dark Pink',           de: 'Dunkelrosa',         hex: '#C870A0' },
  { legoId: 222, legoName: 'Light Purple',             blId: 104, blName: 'Bright Pink',         de: 'Rosa',               hex: '#E4ADC8' },
];

// Vordefinierte Farbauswahlen (über legoId)
export const PALETTE_PRESETS = {
  all:   { label: 'Alle Farben', ids: LEGO_COLORS.map(c => c.legoId) },
  grey:  { label: 'Graustufen', ids: [1, 194, 199, 26] },
  sepia: { label: 'Sepia / Braun', ids: [1, 283, 5, 18, 312, 138, 192, 308, 26] },
  basic: { label: 'Grundfarben', ids: [1, 26, 194, 199, 21, 23, 24, 28, 106, 5, 192] },
  portrait: { label: 'Porträt (Hauttöne)', ids: [1, 26, 194, 199, 283, 5, 18, 312, 192, 308, 138, 154, 21, 140, 135] },
};
