// Bought hinges, from SLEC's listings (slecuk.com, read 14 November 2026). All are flat hinges
// slotted into both hinge spars at the centre line, half each side of the hinge line.
//
//   across     its length across the hinge line, m: half (less half the gap) goes into each spar
//   along      its width along the hinge line, m
//   thickness  the slot's width, m. No listing gives one: these are typical figures for the
//              kind, so every thickness here is `estimated`. Measure the hinge before slotting.
//   kind       'flat' (a Mylar or flocked strip that flexes at the hinge line) or 'leaf' (two
//              nylon leaves on a steel pin, which lies along the hinge line in the gap)
//   pack       how many come in a packet
//   glue       what the listing says to fit it with, or null where it doesn't say
//
// The listings give each size as two figures without saying which is which. The longer one is
// taken as across the hinge, as these hinges are made (the crease or pin runs across the
// shorter way).
const mm = (v) => v / 1000

export const HINGES = [
  { id: 'slec-sl037a', maker: 'SLEC', part: 'SL037A-R', name: 'Mylar flat hinge', kind: 'flat', across: mm(26), along: mm(19), thickness: mm(0.25), pack: 25, glue: 'epoxy' },
  { id: 'slec-sl163', maker: 'SLEC', part: 'SL163-R', name: 'Flocked cyano Mylar hinge', kind: 'flat', across: mm(25), along: mm(20), thickness: mm(0.3), pack: 12, glue: 'thin cyano, wicked in once fitted dry' },
  { id: 'kavan-sl070b', maker: 'Kavan', part: 'SL070B-S', name: 'Small nylon pin hinge', kind: 'leaf', across: mm(26), along: mm(11), thickness: mm(1), pack: 10, glue: null },
  { id: 'kavan-sl070a', maker: 'Kavan', part: 'SL070A-S', name: 'Standard nylon pin hinge', kind: 'leaf', across: mm(34), along: mm(16), thickness: mm(1.2), pack: 10, glue: null },
  { id: 'kavan-sl070', maker: 'Kavan', part: 'SL070-S', name: 'Heavy duty nylon pin hinge', kind: 'leaf', across: mm(39), along: mm(20), thickness: mm(1.5), pack: 10, glue: null },
].map((h) => ({ ...h, estimated: ['thickness'] }))

// Hinge points: a round barbed shank each side of a pin, glued into a hole drilled in each hinge
// spar at the centre line. Robart's, from retailers' listings (motionrc.com, gator-rc.com, read
// 14 November 2026), which give the shank's diameter (the drill size) and the packet, and no
// length: each length here is a typical figure for the size, so it is `estimated`. Measure one.
//   across  its whole length across the hinge line, m: half (less half the gap) into each spar
//   along   the shank's diameter, m: the hole drilled for it
const inch = (v) => v * 0.0254
export const PIN_HINGES = [
  { id: 'robart-306', maker: 'Robart', part: '306', name: 'Hinge point, 3/32 in', kind: 'pin', across: mm(19), along: inch(3 / 32), pack: 15, glue: null, estimated: ['across'] },
  { id: 'robart-308', maker: 'Robart', part: '308', name: 'Steel pin hinge point, 1/8 in', kind: 'pin', across: mm(28), along: inch(1 / 8), pack: 15, glue: null, estimated: ['across'] },
  { id: 'robart-309', maker: 'Robart', part: '309', name: 'Steel pin hinge point, 3/16 in', kind: 'pin', across: mm(38), along: inch(3 / 16), pack: 6, glue: null, estimated: ['across'] },
]
// A hinge point by id, or null (a pin sized by hand)
export const pinById = (id) => PIN_HINGES.find((h) => h.id === id) ?? null

// A hinge seen from above for a thumbnail, as [u, z] points: u across the hinge from one end, z
// along it. A flat hinge is its rectangle; a leaf hinge and a hinge point show the knuckle at the
// hinge line. across and along stand in for a hinge sized by hand.
export function hingeOutline({ kind = 'flat', across, along, thickness = null }) {
  if (kind === 'flat') return [[0, 0], [across, 0], [across, along], [0, along]]
  const c = across / 2
  const k = kind === 'pin' ? along * 0.8 : Math.max(thickness ?? 0.001, across * 0.04)
  const e = kind === 'pin' ? along * 0.35 : along * 0.08
  return [[0, 0], [c - k, 0], [c - k, -e], [c + k, -e], [c + k, 0], [across, 0], [across, along], [c + k, along], [c + k, along + e], [c - k, along + e], [c - k, along], [0, along]]
}

export const DEFAULT_HINGE = 'slec-sl037a'

export const hingeById = (id) => HINGES.find((h) => h.id === id) ?? HINGES.find((h) => h.id === DEFAULT_HINGE)

// "Kavan small nylon pin hinge (SL070B-S)"
// (Mylar keeps its capital)
export const hingeLabel = (h) => `${h.maker} ${h.name.startsWith('Mylar') ? h.name : h.name.charAt(0).toLowerCase() + h.name.slice(1)} (${h.part})`

// Packets to buy for n hinges
export const hingePacks = (h, n) => Math.ceil(n / h.pack)
