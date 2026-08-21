import type { CircuitDraft, Point } from '../types'

const makeCircuit = (name: string, points: Point[], lengthM: number, id: string): CircuitDraft => ({
  id,
  name,
  points,
  lengthM,
  direction: 'clockwise',
  startFinishFraction: 0.03,
  pitEntryFraction: 0.91,
  pitExitFraction: 0.08,
  updatedAt: new Date().toISOString(),
})

export const circuitPresets: CircuitDraft[] = [
  makeCircuit('Toprani International', [
    { x: 118, y: 318 }, { x: 104, y: 280 }, { x: 110, y: 229 }, { x: 139, y: 176 },
    { x: 189, y: 140 }, { x: 258, y: 125 }, { x: 334, y: 128 }, { x: 403, y: 149 },
    { x: 452, y: 177 }, { x: 489, y: 181 }, { x: 523, y: 159 }, { x: 552, y: 123 },
    { x: 583, y: 105 }, { x: 620, y: 112 }, { x: 641, y: 143 }, { x: 636, y: 187 },
    { x: 607, y: 229 }, { x: 560, y: 260 }, { x: 521, y: 285 }, { x: 512, y: 319 },
    { x: 538, y: 347 }, { x: 590, y: 354 }, { x: 636, y: 372 }, { x: 653, y: 405 },
    { x: 641, y: 442 }, { x: 605, y: 468 }, { x: 552, y: 478 }, { x: 490, y: 469 },
    { x: 428, y: 447 }, { x: 366, y: 425 }, { x: 313, y: 418 }, { x: 270, y: 431 },
    { x: 231, y: 454 }, { x: 186, y: 463 }, { x: 145, y: 447 }, { x: 123, y: 414 },
    { x: 126, y: 378 }, { x: 151, y: 354 }, { x: 180, y: 346 }, { x: 187, y: 324 },
    { x: 165, y: 306 }, { x: 133, y: 308 }, { x: 118, y: 318 },
  ], 5420, 'toprani-international'),
  makeCircuit('Velocity Park', [
    { x: 100, y: 290 }, { x: 117, y: 204 }, { x: 170, y: 144 }, { x: 260, y: 116 },
    { x: 405, y: 112 }, { x: 548, y: 115 }, { x: 636, y: 144 }, { x: 664, y: 198 },
    { x: 642, y: 246 }, { x: 579, y: 270 }, { x: 500, y: 273 }, { x: 430, y: 284 },
    { x: 397, y: 318 }, { x: 427, y: 348 }, { x: 523, y: 351 }, { x: 601, y: 365 },
    { x: 629, y: 407 }, { x: 597, y: 450 }, { x: 517, y: 472 }, { x: 395, y: 475 },
    { x: 258, y: 468 }, { x: 162, y: 443 }, { x: 108, y: 394 }, { x: 94, y: 339 }, { x: 100, y: 290 },
  ], 6110, 'velocity-park'),
  makeCircuit('Harbor Street Circuit', [
    { x: 117, y: 171 }, { x: 560, y: 171 }, { x: 635, y: 205 }, { x: 653, y: 267 },
    { x: 612, y: 306 }, { x: 515, y: 310 }, { x: 471, y: 333 }, { x: 486, y: 367 },
    { x: 612, y: 382 }, { x: 646, y: 421 }, { x: 620, y: 458 }, { x: 465, y: 468 },
    { x: 378, y: 449 }, { x: 332, y: 415 }, { x: 268, y: 407 }, { x: 211, y: 433 },
    { x: 138, y: 432 }, { x: 102, y: 395 }, { x: 119, y: 345 }, { x: 195, y: 311 },
    { x: 206, y: 267 }, { x: 143, y: 241 }, { x: 104, y: 210 }, { x: 117, y: 171 },
  ], 4860, 'harbor-street'),
]
