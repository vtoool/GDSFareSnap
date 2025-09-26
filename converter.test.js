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
  'Arrives Fri, Jun 5',
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
const interleavedPeek = window.peekSegments(interleavedOrder);
assert.ok(/15JUN/.test(interleavedLines[2] || ''), 'first inbound segment should use Jun 15 header date');
assert.ok(/15JUN/.test(interleavedLines[3] || ''), 'final inbound segment should use Jun 15 header date');
assert.ok(/05JUN/.test(interleavedLines[1]), 'outbound connection should carry arrival date to next leg');
assert.ok(/05JUN\s+F/.test(interleavedLines[0]), 'overnight arrival should include next-day date context');
assert.strictEqual(interleavedPeek.segments[1].depDate, '05JUN', 'peekSegments should advance outbound connection date');

const matrixDateRegression = [
  'Flight 1 • Sun, Sep 28',
  'Los Angeles (LAX) to Munich (MUC) on Sun, Sep 28',
  'United 8861',
  '5:30 pm',
  'Los Angeles (LAX)',
  '1:40 pm',
  'Munich (MUC)',
  'Flight 2 • Mon, Oct 6',
  'Munich (MUC) to Taipei (TPE) on Mon, Oct 6',
  'EVA Air 72',
  '12:00 pm',
  'Munich (MUC)',
  '6:35 am',
  'Taipei (TPE)',
  'Arrives Tue, Oct 7',
  'Flight 3 • Tue, Oct 7',
  'Taipei (TPE) to Tokyo (NRT) on Tue, Oct 7',
  'EVA Air 184',
  '7:55 am',
  'Taipei (TPE)',
  '12:25 pm',
  'Tokyo (NRT)',
  'Flight 4 • Tue, Oct 28',
  'Tokyo (NRT) to Los Angeles (LAX) on Tue, Oct 28',
  'ANA 7018',
  '5:30 pm',
  'Tokyo (NRT)',
  '11:30 am',
  'Los Angeles (LAX)'
].join('\n');

const matrixRegressionLines = window.convertTextToI(matrixDateRegression).split('\n');
assert.ok(/28SEP/.test(matrixRegressionLines[0]), 'first Matrix leg should keep Sep 28 departure date when later journeys include October headers');
const matrixRegressionPeek = window.peekSegments(matrixDateRegression);
assert.strictEqual(matrixRegressionPeek.segments[0].depDate, '28SEP', 'peekSegments should retain original September departure date');

const overnightWrap = [
  'Depart • Fri, Mar 1',
  'Flight 1 • Fri, Mar 1',
  'Delta Air Lines 101',
  '11:30 pm',
  'Los Angeles (LAX)',
  '1:00 am',
  'New York (JFK)',
  'Delta Air Lines 202',
  '1:45 am',
  'New York (JFK)',
  '3:15 am',
  'Boston (BOS)'
].join('\n');

const overnightLines = window.convertTextToI(overnightWrap).split('\n');
assert.ok(/01MAR/.test(overnightLines[0]), 'first segment should retain original departure date');
assert.ok(/02MAR/.test(overnightLines[1]), 'time wrap should advance to next calendar day for continuing leg');

const journeyBoundaryRegression = [
  'Depart • Thu, Oct 16',
  'Flight 1 • Thu, Oct 16',
  'British Airways 287',
  '9:00 am',
  'London (LHR)',
  '1:40 pm',
  'San Francisco (SFO)',
  'Return • Thu, Oct 16',
  'Flight 2 • Thu, Oct 16',
  'British Airways 286',
  '1:05 pm',
  'San Francisco (SFO)',
  '7:00 am',
  'London (LHR)'
].join('\n');

const journeyBoundaryLines = window.convertTextToI(journeyBoundaryRegression).split('\n');
const journeyBoundaryPeek = window.peekSegments(journeyBoundaryRegression);
assert.ok(/16OCT/.test(journeyBoundaryLines[1] || ''), 'first return segment should stay on Oct 16 at journey boundary');
assert.strictEqual(journeyBoundaryPeek.segments[1].depDate, '16OCT', 'return leg should not inherit next-day rollover from prior journey');

const midnightConnection = [
  'Depart • Mon, Nov 3',
  'Flight 1 • Mon, Nov 3',
  'Delta Air Lines 200',
  '9:00 pm',
  'New York (JFK)',
  '11:30 pm',
  'Atlanta (ATL)',
  'Delta Air Lines 201',
  '12:10 am',
  'Atlanta (ATL)',
  '2:20 am',
  'Miami (MIA)'
].join('\n');

const midnightLines = window.convertTextToI(midnightConnection).split('\n');
const midnightPeek = window.peekSegments(midnightConnection);
assert.ok(/04NOV/.test(midnightLines[1] || ''), 'overnight connection should advance to Nov 4 in output');
assert.strictEqual(midnightPeek.segments[1].depDate, '04NOV', 'overnight connection within a journey should roll to the next day');

const kayakSplitHeader = [
  'Depart',
  '23h 15m',
  '*I✓',
  'Fri,',
  '3',
  'Oct',
  'Turkish Airlines 272',
  '21:20',
  'Chișinău Intl (RMO)',
  '22:55',
  'Istanbul (IST)',
  'Long stopover',
  'Turkish Airlines 289',
  '07:10',
  'Istanbul (IST)',
  'Departs',
  'Sat,',
  '4',
  'Oct',
  '10:35',
  'San Francisco (SFO)',
  'Return',
  '15h 45m',
  '*I✓',
  'Fri,',
  '24',
  'Oct',
  'Turkish Airlines 80',
  '18:45',
  'San Francisco (SFO)',
  'Arrives',
  'Sat,',
  '25',
  'Oct',
  '17:45',
  'Istanbul (IST)',
  'Turkish Airlines 271',
  '18:55',
  'Istanbul (IST)',
  '20:30',
  'Chișinău Intl (RMO)'
].join('\n');

const kayakSplitLines = window.convertTextToI(kayakSplitHeader).split('\n');
assert.strictEqual(kayakSplitLines.length, 4, 'split header sample should yield four segments');
assert.ok(/03OCT/.test(kayakSplitLines[0]), 'split header should still yield outbound date');
assert.ok(/24OCT/.test(kayakSplitLines[2]), 'return header should reset inbound departure date');

const outboundAvailability = window.convertTextToAvailability(sampleItinerary, { direction: 'outbound' });
assert.strictEqual(outboundAvailability, '112APRSEABCN12AORD/MAD¥IB', 'outbound availability should collapse to SEA-BCN with connections');

const inboundAvailability = window.convertTextToAvailability(sampleItinerary, { direction: 'inbound' });
assert.strictEqual(inboundAvailability, '127APRSVQSEA12AMAD/DFW¥IB', 'inbound availability should collapse to SVQ-SEA with connections');

console.log('✓ converter maintains departure date continuity for connecting segments');
