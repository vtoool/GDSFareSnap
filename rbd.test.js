const assert = require('assert');
const { getPreferredRBD, normalizeCabinEnum } = require('./rbd.js');

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
  assert.strictEqual(getPreferredRBD('LH', 'BUSINESS'), 'J');
});

test('AA + BUSINESS → J', () => {
  assert.strictEqual(getPreferredRBD('AA', 'BUSINESS'), 'J');
});

test('DL + PREMIUM → P', () => {
  assert.strictEqual(getPreferredRBD('DL', 'PREMIUM'), 'P');
});

test('UA + ECONOMY → Y', () => {
  assert.strictEqual(getPreferredRBD('UA', 'ECONOMY'), 'Y');
});

test('BA + FIRST → F', () => {
  assert.strictEqual(getPreferredRBD('BA', 'FIRST'), 'F');
});

test('Unknown airline ZZ + BUSINESS → J (generic)', () => {
  assert.strictEqual(getPreferredRBD('ZZ', 'BUSINESS'), 'J');
});

test('Airline without FIRST cabin returns null', () => {
  assert.strictEqual(getPreferredRBD('B6', 'FIRST'), null);
});

test('normalizeCabinEnum handles lowercase business', () => {
  assert.strictEqual(normalizeCabinEnum('business'), 'BUSINESS');
});

console.log('All tests passed.');
