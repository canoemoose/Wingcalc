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

export const DEFAULT_HINGE = 'slec-sl037a'

export const hingeById = (id) => HINGES.find((h) => h.id === id) ?? HINGES.find((h) => h.id === DEFAULT_HINGE)

// "Kavan small nylon pin hinge (SL070B-S)"
// (Mylar keeps its capital)
export const hingeLabel = (h) => `${h.maker} ${h.name.startsWith('Mylar') ? h.name : h.name.charAt(0).toLowerCase() + h.name.slice(1)} (${h.part})`

// Packets to buy for n hinges
export const hingePacks = (h, n) => Math.ceil(n / h.pack)
