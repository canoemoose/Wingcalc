// The linkage from a servo to its control surface: the servo arms each maker sells, the control
// horns, and which arms fit which servo. Pure data and lookups; the geometry (throw, mechanical
// advantage, pushrod length) joins it in a later step (docs/scope-servo.md).
//
// Gathered 18 October 2026 from hitecrcd.com, futabausa.com and rc.futaba.co.jp (arms) and
// makers' and retailers' pages (horns). Neither maker publishes an arm's hole positions, and no
// horn maker its holes' heights, so holes is null throughout until they're measured
// (docs/backlog.md lists them).
//
// Arm:
//   id, maker, part, name   the maker's part number and name
//   kind      'single', 'double', 'cross', 'star', 'tee', 'disc' (a round horn or wheel) or 'set'
//   spline    the spline it fits, as servos name theirs (servoCatalogue.js), or null if unknown
//   inferred  true where the spline is read from the part's name or tooth count rather than
//             stated: Futaba's FSH-6 series as its Φ6 horns, Hitec's 24T arms as Standard 24
//   models    servos the maker names it for (some only by family), for a horn set made for them
//   holes     the holes' distances from the pivot, m, one list per arm; null until measured
//   source    the page it's from
// Left out: sail-winch arms and drums (HS-815BB, HS-715BB/765HB, HS-725, Futaba FSH-38), which
// aren't for control surfaces.
const arm = (maker, part, name, kind, spline, { inferred = false, models = [], source }) => ({
  id: `${maker.toLowerCase()}-${part.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  maker,
  part,
  name,
  kind,
  spline,
  inferred,
  models,
  holes: null,
  source,
})

const HITEC_HORNS = 'https://hitecrcd.com/'
const FUTABA_HORNS = 'https://futabausa.com/product-category/accessories/servo-parts/horns/'

export const ARMS = [
  arm('Hitec', '55702', 'Heavy duty double-sided aluminium servo arm, 24T', 'double', 'Standard 24', { inferred: true, source: 'https://hitecrcd.com/24t-double-aluminum-horn/' }),
  arm('Hitec', '55709', 'Heavy duty and large horn set with mounting hardware, 24T', 'set', 'Standard 24', { inferred: true, source: 'https://hitecrcd.com/heavy-duty-large-and-regular-horn-set-24t/' }),
  arm('Hitec', '55701', 'Standard aluminium servo arm', 'single', 'Standard 24', { inferred: true, source: 'https://hitecrcd.com/std-aluminum-servo-arm/' }),
  arm('Hitec', '55725', 'Mega horn set and hardware, 24T (HS-755HB/MG, HS-5765MH)', 'set', null, { models: ['HS-755HB', 'HS-755MG', 'HS-5765MH'], source: 'https://hitecrcd.com/hs-5755-5765-mega-horn-set/' }),
  arm('Hitec', '55732', 'H25T heavy duty horn and hardware set, airplane', 'set', 'H25T', { source: 'https://hitecrcd.com/h25t-hd-horn-hdwr-airplane/' }),
  arm('Hitec', '55706', 'Micro 25T horn set and mounting hardware', 'set', 'Micro 25', { models: ['HS-65HB', 'HS-65MG', 'HS-5065MG', 'HS-70MG', 'HS-5070MH', 'HS-125MG', 'HS-5125MG'], source: 'https://hitecrcd.com/hs-125mg-5125mg-horn-set/' }),
  arm('Hitec', '55707', 'MS-ML25 aluminium horn, 0.75 in, Micro 25T', 'single', 'Micro 25', { source: 'https://hitecrcd.com/hs-125-5125mg-65mg-5065mg-70mg-5070mg-aluminum-horn/' }),
  arm('Hitec', '55718', 'Micro horn set, Micro 25T', 'set', 'Micro 25', { source: HITEC_HORNS }),
  arm('Hitec', '55738', 'R-ML25 aluminium horn, 0.75 in, 25T', 'single', null, { source: 'https://hitecrcd.com/25t-aluminum-servo-horn/' }),
  arm('Hitec', '56326', 'Micro horn set', 'set', null, { source: HITEC_HORNS }),
  arm('Hitec', '55713', 'Heavy duty horn set (HS-755HB/MG)', 'set', null, { models: ['HS-755HB', 'HS-755MG'], source: HITEC_HORNS }),
  arm('Hitec', '55723', 'Mega servo aluminium double-sided horn', 'double', null, { source: HITEC_HORNS }),

  arm('Futaba', 'FSH-6X', '4-arm plastic servo horn (horn A)', 'cross', 'Φ6', { inferred: true, source: 'https://futabausa.com/product/fsh-6x/' }),
  arm('Futaba', 'FSH-6S', '6-arm plastic servo horn, star (horn B)', 'star', 'Φ6', { inferred: true, source: 'https://futabausa.com/product/fsh-6s/' }),
  arm('Futaba', 'FSH-6E', '1 in double plastic horn (horn E)', 'double', 'Φ6', { inferred: true, source: 'https://futabausa.com/product/fsh-6e/' }),
  arm('Futaba', 'FSH-6F', 'Plastic double horn', 'double', 'Φ6', { inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6T', 'Heavy duty T horn', 'tee', 'Φ6', { inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6G', 'Large round plastic horn (horn G)', 'disc', 'Φ6', { inferred: true, source: 'https://futabausa.com/product/fsh-6g/' }),
  arm('Futaba', 'FSH-6R', 'Medium round wheel horn (horn C)', 'disc', 'Φ6', { inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-6W', 'Small round horn, standard stock', 'disc', 'Φ6', { inferred: true, source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T1', '1 in single aluminium horn (blue, red or silver)', 'single', null, { source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T2', '1.5 in single aluminium horn (blue, red or silver)', 'single', null, { source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-T4', '20 mm single aluminium horn (blue, red or silver)', 'single', null, { source: FUTABA_HORNS }),
  arm('Futaba', 'EBS0170', 'Aluminium clamping horn, 38 mm', 'single', null, { source: FUTABA_HORNS }),
  arm('Futaba', 'FSH-63', 'Micro servo horn pack, long type', 'set', null, { models: ['S3103', 'S3107', 'S3270SVi'], source: 'https://futabausa.com/product/fsh-63/' }),
  arm('Futaba', 'FSH-60', 'S3108 horn and screw pack', 'set', null, { models: ['S3108', 'S3108M'], source: 'https://futabausa.com/product/fsh-60/' }),
  arm('Futaba', 'FSH-6V', 'S3156 horn variety pack', 'set', null, { models: ['S3156'], source: FUTABA_HORNS }),
]

// The arms that fit a catalogue servo: its maker's, on its spline or made for it by name. Empty
// for a generic class, or a servo whose spline isn't published and that no arm names.
export function armsFor(servo) {
  if (!servo?.maker) return []
  const type = servo.spline?.type
  return ARMS.filter((a) => a.maker === servo.maker && ((type && a.spline === type) || a.models.includes(servo.model)))
}

// Control horns: the horn on the moving surface the pushrod's clevis hooks into.
//   size      'micro', 'mini', 'standard' or 'large'
//   height    overall, from the face it sits on, m (null if not published)
//   holes     the holes' heights above that face, m; null until measured
//   double    two-sided (for pull-pull)
const horn = (maker, part, name, size, height, source) => ({
  id: `${maker.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${part.toLowerCase()}`,
  maker,
  part,
  name,
  size,
  height: height == null ? null : height / 1000,
  holes: null,
  double: false,
  source,
})

export const HORNS = [
  horn('Du-Bro', '848', 'Micro control horn, 1/2 in', 'micro', 12.7, 'https://motionrc.com/products/du-bro-micro-12-7mm-1-2-control-horns-2-pack-dub848'),
  horn('Du-Bro', '107', '1/2A control horn, 3/4 in', 'mini', null, 'https://www.dubro.com/products/1-2-a-control-horns'),
  horn('Du-Bro', '105', 'Nylon control horn, 1-1/8 in', 'standard', 28.5, 'https://www.readymaderc.com/products/details/dubro-nylon-control-horns-1-left-1-right-number-105-2pcs'),
  horn('Du-Bro', '716', 'T-style nylon control horn, 1-3/8 in', 'large', 34.7, 'https://motionrc.com/products/du-bro-34-7mm-1-37-super-strength-t-style-control-horns-2-pack-dub716'),
  horn('Du-Bro', '237', 'T-style nylon control horn', 'large', 34.9, 'https://motionrc.com/products/du-bro-nylon-t-style-control-horns-2-pack-dub237'),
  horn('Robart', '329', 'Ball-link control horn, 3/4 in', 'micro', 12.0, 'https://gator-rc.com/robart-329-ball-link-control-horn-3-4-2-pack-rob329'),
  horn('Great Planes', 'GPMQ3900', 'Small nylon control horn', 'mini', null, 'https://www.amazon.com/Great-Planes-Nylon-Control-Horns/dp/B001BHGD7K'),
  horn('Great Planes', 'GPMQ3901', 'Large nylon control horn', 'standard', null, 'https://amr-rc.com/nylon-control-horns-large-2.html'),
  horn('Gator RC', 'GRC-34', 'Control horn, 34 mm, triangle base, angled', 'large', null, 'https://www.gator-rc.com/products/gator-rc-control-horn-34mm-triangle-base-angled'),
]
