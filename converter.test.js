const assert = require('assert');

global.window = global;
require('./airlines.js');
require('./converter.js');

const sampleItinerary = [
  'Depart • Sun, Apr 12',
  'Flight 1 • Sun, Apr 12',
  'Iberia 4550 · Operated by American Airlines',
  '3:21 pm',
  'Seattle (SEA)',
  '9:25 pm',
  'Chicago (ORD)',
  'Change planes in Chicago (ORD)',
  'Iberia 4481 · Operated by American Airlines',
  '10:20 pm',
  'Chicago (ORD)',
  '1:25 pm',
  'Madrid (MAD)',
  'Arrives Mon, Apr 13',
  '1h 30m • Change planes in Madrid (MAD)',
  'Iberia 0415',
  '   2:55 pm',
  'Madrid (MAD)',
  '   4:10 pm',
  'Barcelona (BCN)',
  'Return • Mon, Apr 27',
  'Flight 2 • Mon, Apr 27',
  'Iberia 1756',
  '1:15 pm',
  'Seville (SVQ)',
  '2:25 pm',
  'Madrid (MAD)',
  'Iberia 363',
  '4:00 pm',
  'Madrid (MAD)',
  '8:10 pm',
  'Dallas (DFW)',
  'Iberia 4134',
  '10:30 pm',
  'Dallas (DFW)',
  '12:52 am',
  'Seattle (SEA)',
  'Arrives Tue, Apr 28'
].join('\n');

const peek = window.peekSegments(sampleItinerary);
assert.ok(peek && Array.isArray(peek.segments), 'peekSegments should return segments');
assert.strictEqual(peek.segments.length, 6, 'expected six segments in sample');
assert.strictEqual(peek.segments[1].depDate, '12APR', 'second leg should retain original departure date');
assert.strictEqual(peek.segments[1].arrDate, '13APR M', 'second leg should carry forward arrival date context');
assert.strictEqual(peek.segments[2].depDate, '13APR', 'third leg should stay on arrival date until explicit return header');

const lines = window.convertTextToI(sampleItinerary).split('\n');
assert.ok(lines[1].includes('12APR'), 'second line should show original departure date');
assert.ok(lines[1].includes('13APR M'), 'second line should include arrival date suffix');
assert.ok(/13APR\s+M\s+MADBCN/.test(lines[2]), 'third line should use Apr 13 for MAD-BCN leg');

const interleavedOrder = [
  'Flight 1 • Thu, Jun 4',
  'Turkish Airlines 32',
  '9:50 pm',
  'Atlanta (ATL)',
  '3:40 pm',
  'Istanbul (IST)',
  'Flight 2 • Mon, Jun 15',
  'Turkish Airlines 1845',
  '6:55 pm',
  'Istanbul (IST)',
  '8:30 pm',
  'Athens (ATH)',
  'Turkish Airlines 1362',
  '7:05 am',
  'Rome (FCO)',
  '10:45 am',
  'Istanbul (IST)',
  'Turkish Airlines 31',
  '2:45 pm',
  'Istanbul (IST)',
  '7:45 pm',
  'Atlanta (ATL)'
].join('\n');

const interleavedLines = window.convertTextToI(interleavedOrder).split('\n');
assert.ok(/15JUN/.test(interleavedLines[2] || ''), 'first inbound segment should use Jun 15 header date');
assert.ok(/15JUN/.test(interleavedLines[3] || ''), 'final inbound segment should use Jun 15 header date');
assert.ok(/04JUN/.test(interleavedLines[1]), 'outbound connection should not inherit return date');

console.log('✓ converter maintains departure date continuity for connecting segments');
