// The servo catalogue's published figures, as the makers print them (mm, g, kgf·cm, s per 60°);
// servos.js turns them into entries in SI units. Gathered 18 October 2026.
//
// Ratings are [volts, torque, speed] at each voltage the maker rates the servo at; null where a
// figure isn't given at that voltage. Hitec mostly prints a range across its operating voltages
// with no voltage against each end: the low torque and the slow speed are taken as the lower
// voltage's, the others as the higher's.
//
// Splines are named as the maker names them. Hitec gives a type and tooth count ('Standard 24',
// 'Micro 25', 'Feather 15', 'H25T'); Futaba names its horns by size (Φ4, Φ6) and publishes no
// tooth counts. null where the maker doesn't say.
//
// Gears: 'plastic' (nylon or resin), 'karbonite' (Hitec's reinforced resin), 'metal' (including a
// metal train with a plastic or part-plastic first gear) or 'titanium'.

// Hitec: the figures the drawn entries in servos.js don't already carry, from each model's
// hitecrcd.com product page. D141SW's are the D141SH's (same case and gear train).
export const HITEC_SPECS = {
  'HS-65MG': { gears: 'metal', digital: false, spline: 'Micro 25', ratings: [[4.8, 1.8, 0.14], [6.0, 2.2, 0.11]] },
  'HS-5070MH': { gears: 'metal', digital: true, spline: 'Micro 25', ratings: [[6.0, 3.1, 0.15], [7.4, 3.8, 0.12]] },
  'HS-5085MG': { gears: 'metal', digital: true, spline: 'Standard 24', ratings: [[4.8, 3.6, 0.17], [6.0, 4.3, 0.13]] },
  'HS-85MG': { gears: 'metal', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.0, 0.16], [6.0, 3.5, 0.14]] },
  D89MW: { gears: 'metal', digital: true, spline: '25T, 6 mm', ratings: [[4.8, 5.3, 0.17], [7.4, 8.5, 0.11]] },
  'HS-81': { gears: 'plastic', digital: false, spline: 'Standard 24', ratings: [[4.8, 2.6, 0.11], [6.0, 3.0, 0.09]] },
  'HS-5125MG': { gears: 'metal', digital: true, spline: 'Micro 25', ratings: [[4.8, 3.0, 0.17], [6.0, 3.5, 0.13]] },
  'HS-125MG': { gears: 'metal', digital: false, spline: 'Micro 25', ratings: [[4.8, 3.0, 0.17], [6.0, 3.5, 0.13]] },
  D131MW: { gears: 'metal', digital: true, spline: 'M25T', ratings: [[7.4, 2.9, 0.11]] },
  D141SW: { gears: 'metal', digital: true, spline: 'H25T', ratings: [[7.4, 7.0, 0.1]] },
  D145SW: { gears: 'metal', digital: true, spline: '23T, 6 mm', ratings: [[4.8, 3.9, 0.21], [7.4, 6.0, 0.14]] },
  'HS-7115TH': { gears: 'titanium', digital: true, spline: 'Feather 15', ratings: [[6.0, 3.2, 0.12], [7.4, 3.9, 0.1]] },
  'HS-225MG': { gears: 'metal', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.9, 0.14], [6.0, 4.8, 0.11]] },
  'HS-5245MG': { gears: 'metal', digital: true, spline: 'Standard 24', ratings: [[4.8, 4.4, 0.15], [6.0, 5.5, 0.12]] },
  'HS-55': { gears: 'plastic', digital: false, spline: 'Feather 15', ratings: [[4.8, 1.2, 0.17], [6.0, 1.5, 0.14]] },
  'HS-65HB': { gears: 'karbonite', digital: false, spline: 'Micro 25', ratings: [[4.8, 1.6, 0.16], [6.0, 1.9, 0.13]] },
  'HS-5055MG': { gears: 'metal', digital: true, spline: 'Feather 15', ratings: [[4.8, 1.3, 0.2], [6.0, 1.6, 0.17]] },
  'HS-5065MG': { gears: 'metal', digital: true, spline: 'Micro 25', ratings: [[4.8, 1.8, 0.14], [6.0, 2.2, 0.11]] },
  'HS-85BB': { gears: 'plastic', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.0, 0.16], [6.0, 3.5, 0.14]] },
  'HS-225BB': { gears: 'plastic', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.9, 0.14], [6.0, 4.8, 0.11]] },
  'HS-77BB': { gears: 'plastic', digital: false, spline: 'Standard 24', ratings: [[4.8, 4.4, 0.18], [6.0, 5.5, 0.14]] },
  'HS-311': { gears: 'plastic', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.0, 0.19], [6.0, 3.7, 0.15]] },
  'HS-322HD': { gears: 'karbonite', digital: false, spline: 'Standard 24', ratings: [[4.8, 3.0, 0.19], [6.0, 3.7, 0.15]] },
  'HS-485HB': { gears: 'karbonite', digital: false, spline: 'Standard 24', ratings: [[4.8, 4.8, 0.22], [6.0, 6.0, 0.18]] },
  'HS-5485HB': { gears: 'karbonite', digital: true, spline: 'Standard 24', ratings: [[4.8, 5.2, 0.2], [6.0, 6.4, 0.17]] },
  'HS-625MG': { gears: 'metal', digital: false, spline: 'Standard 24', ratings: [[4.8, 5.5, 0.18], [6.0, 6.8, 0.15]] },
  'HS-645MG': { gears: 'metal', digital: false, spline: 'Standard 24', ratings: [[4.8, 7.7, 0.24], [6.0, 9.6, 0.2]] },
  'HS-5625MG': { gears: 'metal', digital: true, spline: 'Standard 24', ratings: [[4.8, 7.9, 0.17], [6.0, 9.4, 0.14]] },
  'HS-5645MG': { gears: 'metal', digital: true, spline: 'Standard 24', ratings: [[4.8, 10.3, 0.23], [6.0, 12.1, 0.18]] },
}

// Futaba: the S3001 and the current airplane servos of standard, mini, micro and wing size, from
// rc.futaba.co.jp and futabausa.com product pages (Japan's figures where both give them).
//   body     [length, width, height], mm, as published
//   drawing  the figures from the dimensioned drawing on the model's futaba.uk product page, in
//            the shape servos.js drawn() reads (body, case, lugs, wing, output, lead; mm). The
//            output's top is the spline's top, or the fitted horn's underside where the drawing
//            shows a horn (S-U400's case, S-A400, S-A401, S3150, S3154); the boss's diameter,
//            the lead's place and S-A401's and S-A501's output top are scaled off the drawing
//            (about half a millimetre), the rest printed. S-AG500's lead is scaled off a photo.
//            No lead where the drawing doesn't show one. Models without a drawing (futaba.uk has
//            none for them) take the lugs, output and lead from their class (servoFrame).
//   class    the generic class it's sized as (servos.js SERVOS)
//   thin     a slim wing servo
//   current  false for the S3001, kept as the classic
// Left out: S3306 and S3306MG (quarter-scale cases), S3170G (a retract servo), and the
// discontinued S148, S9177SV, S3174SV and BLS173SV.
// Cases that share a drawing
const STD_400 = { body: [40.0, 20.0, 38.1], lugs: [54.5, 2.5, 28.1], output: [9.9, 44.1, 13], lead: ['end', 5.0] }
const HPS_703 = { body: [40.5, 21.0, 39.4], lugs: [54.5, 2.5, 28.3], output: [9.95, 43.8, 6], lead: ['end', 2.5] }

export const FUTABA_FIGURES = [
  { model: 'S3001', class: 'standard', body: [40.6, 20.3, 36.1], mass: 45.4, ratings: [[4.8, 2.4, 0.28], [6.0, 3.0, 0.22]], gears: 'plastic', digital: false, spline: null, current: false },
  { model: 'S-U300', class: 'standard', body: [40.4, 19.8, 36.0], mass: 36, ratings: [[4.8, 3.2, 0.23], [6.0, 4.1, 0.19]], gears: 'plastic', digital: true, spline: 'Φ6', drawing: { body: [40.4, 19.8, 36.0], lugs: [55.5, 2.5, 26.6], output: [9.9, 42.1, 13], lead: ['end', 3.0] } },
  { model: 'S-U301', class: 'standard', body: [40.5, 20.0, 36.1], mass: 36, ratings: [[6.6, 3.5, 0.18], [7.4, 3.9, 0.16]], gears: 'plastic', digital: true, spline: 'Φ6', drawing: { body: [40.5, 20.0, 36.1], lugs: [55.5, 2.5, 26.6], output: [9.95, 42.1, 13], lead: ['end', 3.0] } },
  { model: 'S-U305', class: 'standard', body: [40.0, 20.0, 38.1], mass: 46.5, ratings: [[4.8, 7.1, 0.23], [6.0, 8.9, 0.18]], gears: 'metal', digital: null, spline: null, drawing: STD_400 },
  { model: 'S-U306', class: 'standard', body: [40.0, 20.0, 38.1], mass: 46.5, ratings: [[4.8, 7.1, 0.23], [6.0, 8.9, 0.18]], gears: 'metal', digital: null, spline: null },
  { model: 'S-U400', class: 'standard', body: [40.0, 20.0, 38.1], mass: 39, ratings: [[6.6, 7.1, 0.14], [7.4, 7.9, 0.13]], gears: 'plastic', digital: true, spline: 'Φ6', drawing: STD_400 },
  { model: 'S-A300', class: 'standard', body: [40.0, 20.0, 38.1], mass: 47, ratings: [[6.6, 10.0, 0.19], [7.4, 11.0, 0.17]], gears: 'metal', digital: true, spline: null, drawing: STD_400 },
  { model: 'S-A301', class: 'standard', body: [40.0, 20.0, 38.1], mass: 47, ratings: [[6.6, 8.5, 0.14], [7.4, 9.0, 0.13]], gears: 'metal', digital: true, spline: null, drawing: STD_400 },
  { model: 'S-A400', class: 'standard', body: [40.5, 20.0, 25.4], mass: 46, ratings: [[6.6, 7.2, 0.09], [7.4, 8.0, 0.08]], gears: 'metal', digital: true, spline: 'Φ6', drawing: { body: [40.5, 20.0, 25.4], lugs: [54.5, 2.5, 16.0], output: [11.35, 29.3, 12] } },
  { model: 'S-A401', class: 'mini', body: [33.0, 15.0, 27.5], mass: 27, ratings: [[6.6, 5.0, 0.12], [7.4, 5.7, 0.1]], gears: 'metal', digital: true, spline: 'Φ6', drawing: { body: [33.0, 15.0, 27.5], lugs: [46.0, 2.0, 18.0], output: [7.2, 33.0, 9], lead: ['end', 4.3] } },
  { model: 'S-A501', class: 'standard', body: [40.0, 20.0, 36.8], mass: 61, ratings: [[6.6, 15.0, 0.12], [7.4, 16.8, 0.11]], gears: 'metal', digital: true, spline: 'Φ6', drawing: { body: [40.0, 20.0, 36.8], lugs: [54.5, 2.5, 28.7], output: [9.9, 43.2, 14], lead: ['end', 3.5] } },
  { model: 'S-A601', class: 'standard', body: [40.5, 21.0, 37.2], mass: 74, ratings: [[6.6, 36.8, 0.12], [7.4, 41.0, 0.11]], gears: 'metal', digital: true, spline: null, drawing: { body: [40.5, 21.0, 37.2], lugs: [54.5, 2.5, 27.7], output: [9.95, 43.2, 6] } },
  { model: 'BLS-A600', class: 'micro', body: [27.2, 13.0, 30.5], mass: 28, ratings: [[6.6, 6.0, 0.1], [7.4, 6.7, 0.09]], gears: 'metal', digital: true, spline: null },
  { model: 'HPS-A701', class: 'standard', body: [40.5, 21.0, 26.9], mass: 48, ratings: [[6.6, 14.5, 0.07], [7.4, 16.0, 0.06]], gears: 'metal', digital: true, spline: 'Φ6' },
  { model: 'HPS-A703', class: 'standard', body: [40.5, 21.0, 39.4], mass: 82, ratings: [[6.6, 61.0, 0.13], [7.4, 66.0, 0.12]], gears: 'metal', digital: true, spline: 'Φ6', drawing: HPS_703 },
  { model: 'HPS-A704', class: 'standard', body: [40.5, 21.0, 26.9], mass: 48, ratings: [[6.6, 12.5, 0.07], [7.4, 14.0, 0.06]], gears: 'metal', digital: true, spline: null, drawing: { body: [40.5, 21.0, 26.9], lugs: [54.5, 2.5, 16.3], output: [10.75, 31.0, 6] } },
  { model: 'HPS-AA702', class: 'standard', body: [40.5, 21.0, 39.4], mass: 80, ratings: [[6.6, 37.0, 0.08], [7.4, 41.0, 0.075]], gears: 'metal', digital: true, spline: 'Φ6', drawing: HPS_703 },
  { model: 'S-AG300', class: 'micro', thin: true, body: [23.5, 8.0, 19.7], mass: 10.8, ratings: [[3.8, 1.5, 0.13], [7.4, 2.5, 0.065]], gears: 'metal', digital: true, spline: null },
  { model: 'S-AG500', class: 'mini', thin: true, body: [30.0, 10.0, 35.5], mass: 28, ratings: [[6.6, 8.5, 0.13], [7.4, 9.5, 0.12]], gears: 'metal', digital: true, spline: null, drawing: { body: [30.0, 10.0, 35.5], lugs: [42.0, 1.8, 27.5], wing: { length: 8.0, tab: [10.0, 6.4] }, output: [8.4, 38.8, 4], lead: ['end', 16.0] } },
  { model: 'S3016', class: 'mini', body: [31.0, 16.0, 30.7], mass: 34, ratings: [[6.0, 4.2, 0.2]], gears: 'metal', digital: false, spline: null },
  { model: 'S3102', class: 'micro', body: [28.0, 13.0, 29.7], mass: 21, ratings: [[4.8, 3.7, 0.25]], gears: 'metal', digital: false, spline: null },
  { model: 'S3107', class: 'micro', body: [21.8, 11.0, 19.8], mass: 9, ratings: [[4.8, 1.2, 0.12]], gears: null, digital: false, spline: null },
  { model: 'S3114', class: 'micro', body: [21.8, 11.0, 19.8], mass: 7.8, ratings: [[4.8, 1.5, 0.1], [6.0, 1.7, 0.09]], gears: 'plastic', digital: false, spline: 'Φ4' },
  { model: 'S3114M', class: 'micro', body: [21.8, 10.9, 19.8], mass: 7.4, ratings: [[4.8, 1.5, 0.1], [6.0, 1.7, 0.09]], gears: null, digital: false, spline: null },
  { model: 'S3154', class: 'micro', body: [21.8, 11.0, 19.8], mass: 7.9, ratings: [[4.8, 1.5, 0.1], [6.0, 1.7, 0.09]], gears: 'plastic', digital: true, spline: null, drawing: { body: [21.8, 11.0, 23.3], case: 19.8, lugs: [29.4, 1.0, 14.9], output: [5.15, 26.6, 5.5], lead: ['end', 5.0] } },
  { model: 'S3150', class: 'mini', thin: true, body: [30.0, 10.8, 29.0], mass: 23, ratings: [[4.8, 3.7, 0.24]], gears: 'metal', digital: true, spline: null, drawing: { body: [30.0, 10.8, 29.0], lugs: [42.0, 2.0, 19.8], output: [8.1, 32.6, 8], lead: ['end', 5.5] } },
  { model: 'S3155', class: 'mini', thin: true, body: [30.5, 10.9, 29.5], mass: 20.1, ratings: [[4.8, 2.0, 0.16]], gears: 'metal', digital: true, spline: null },
  { model: 'S3173SVi', class: 'mini', thin: true, body: [30.0, 10.8, 29.1], mass: 20.6, ratings: [[6.6, 3.9, 0.18], [7.4, 4.3, 0.16]], gears: null, digital: true, spline: null },
  { model: 'S3176SV', class: 'mini', body: [35.9, 19.5, 24.9], mass: 27, ratings: [[6.6, 4.5, 0.17], [7.4, 5.1, 0.16]], gears: null, digital: true, spline: null },
  { model: 'PS-10', class: 'micro', body: [21.5, 11.5, 26.5], mass: 9, ratings: [[5.0, 1.2, 0.1]], gears: null, digital: true, spline: null },
  { model: 'PS-14', class: 'micro', body: [23.0, 12.0, 27.3], mass: 10, ratings: [[4.8, null, 0.1], [6.0, 2.0, null]], gears: null, digital: true, spline: null },
]
