const assert = require('assert');
const { getPreferredRBD, normalizeCabinEnum, shouldTreatSegmentAsShortHaul } = require('./rbd.js');

function test(description, fn){
  try {
    fn();
    console.log(`✓ ${description}`);
  } catch (err) {
    console.error(`✗ ${description}`);
    throw err;
  }
}

test('LH + BUSINESS → J', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'LH', marketedCabin: 'BUSINESS', durationMinutes: 480 }), 'J');
});

test('AA + BUSINESS → J', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'AA', marketedCabin: 'BUSINESS', durationMinutes: 180 }), 'J');
});

test('TP + BUSINESS → C', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'TP', marketedCabin: 'BUSINESS', durationMinutes: 300 }), 'C');
});

test('DL + PREMIUM → P', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'DL', marketedCabin: 'PREMIUM', durationMinutes: 480 }), 'P');
});

test('UA + ECONOMY → Y', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'UA', marketedCabin: 'ECONOMY', durationMinutes: 150 }), 'Y');
});

test('BA + FIRST → F', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'BA', marketedCabin: 'FIRST', durationMinutes: 600 }), 'F');
});

test('Unknown airline ZZ + BUSINESS → J (generic)', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'ZZ', marketedCabin: 'BUSINESS', durationMinutes: 90 }), 'J');
});

test('Airline without FIRST cabin returns null', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'B6', marketedCabin: 'FIRST', durationMinutes: 480 }), null);
});

test('TK business uses C', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'TK', marketedCabin: 'BUSINESS', durationMinutes: 480 }), 'C');
});

test('SK business uses C', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'SK', marketedCabin: 'BUSINESS', durationMinutes: 120 }), 'C');
});

test('Short-haul First converts to Business', () => {
  assert.strictEqual(
    getPreferredRBD({ airlineCode: 'AA', marketedCabin: 'FIRST', durationMinutes: 220, origin: 'DFW', destination: 'AUS' }),
    'J'
  );
});

test('Short-haul Premium converts to Economy', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'AA', marketedCabin: 'PREMIUM', durationMinutes: 180 }), 'Y');
});

test('Long-haul First stays First', () => {
  assert.strictEqual(getPreferredRBD({ airlineCode: 'AA', marketedCabin: 'FIRST', durationMinutes: 420 }), 'F');
});

test('Cross-continent premium segment stays premium despite short local clock', () => {
  const result = getPreferredRBD({
    airlineCode: 'IB',
    marketedCabin: 'PREMIUM',
    durationMinutes: 275,
    origin: 'MIA',
    destination: 'BCN'
  });
  assert.strictEqual(result, 'W');
});

test('Intra-Europe premium segment downgrades to economy', () => {
  const result = getPreferredRBD({
    airlineCode: 'IB',
    marketedCabin: 'PREMIUM',
    durationMinutes: 110,
    origin: 'MAD',
    destination: 'BCN'
  });
  assert.strictEqual(result, 'Y');
});

test('Short-haul helper matches expected heuristics', () => {
  assert.strictEqual(shouldTreatSegmentAsShortHaul({ durationMinutes: 150, origin: 'LAX', destination: 'SFO' }), true);
  assert.strictEqual(shouldTreatSegmentAsShortHaul({ durationMinutes: 275, origin: 'MIA', destination: 'BCN' }), false);
  assert.strictEqual(shouldTreatSegmentAsShortHaul({ durationMinutes: 540, origin: 'JFK', destination: 'LHR' }), false);
});

test('Short-haul helper falls back to duration when regions unknown', () => {
  assert.strictEqual(
    shouldTreatSegmentAsShortHaul({ durationMinutes: 240, origin: 'BOI', destination: 'JFK' }),
    true
  );
});

test('Premium cabin downgrades when duration is short but region unknown', () => {
  const result = getPreferredRBD({
    airlineCode: 'AA',
    marketedCabin: 'PREMIUM',
    durationMinutes: 240,
    origin: 'BOI',
    destination: 'JFK'
  });
  assert.strictEqual(result, 'Y');
});

test('normalizeCabinEnum handles lowercase business', () => {
  assert.strictEqual(normalizeCabinEnum('business'), 'BUSINESS');
});

console.log('All tests passed.');
