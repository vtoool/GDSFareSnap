const assert = require('assert');

global.window = global;
require('./airlines.js');
require('./converter.js');

const sampleItinerary = [
  'Depart • Sun, Apr 12',
  'Flight 1 • Sun, Apr 12',
  'Iberia 4067 · Operated by American Airlines',
  '11:51 am',
  'Seattle (SEA)',
  '5:55 pm',
  'Chicago (ORD)',
  'Change planes in Chicago (ORD)',
  'Iberia 4382 · Operated by American Airlines',
  '6:55 pm',
  'Chicago (ORD)',
  '10:30 am',
  'Barcelona (BCN)',
  'Arrives Mon, Apr 13',
  'Return • Mon, Apr 27',
  'Flight 2 • Mon, Apr 27',
  'Iberia 1756',
  '1:15 pm',
  'Seville (SVQ)',
  '2:25 pm',
  'Madrid (MAD)',
  'Iberia 8049',
  '4:40 pm',
  'Madrid (MAD)',
  '6:50 pm',
  'Chicago (ORD)',
  'Iberia 4951',
  '8:25 pm',
  'Chicago (ORD)',
  '11:05 pm',
  'Seattle (SEA)'
].join('\n');

const peek = window.peekSegments(sampleItinerary);
assert.ok(peek && Array.isArray(peek.segments), 'peekSegments should return segments');
assert.strictEqual(peek.segments.length, 5, 'expected five segments in sample');
assert.strictEqual(peek.segments[1].depDate, '12APR', 'second leg should retain original departure date');
assert.strictEqual(peek.segments[1].arrDate, '13APR M', 'second leg should carry forward arrival date context');

const lines = window.convertTextToI(sampleItinerary).split('\n');
assert.ok(lines[1].includes('12APR'), 'second line should show original departure date');
assert.ok(lines[1].includes('13APR M'), 'second line should include arrival date suffix');

console.log('✓ converter maintains departure date continuity for connecting segments');
