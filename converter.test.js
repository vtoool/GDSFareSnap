const assert = require('assert');

global.window = global;
require('./airlines.js');
require('./rbd.js');
require('./converter.js');

assert.strictEqual(
  window.lookupAirlineCodeByName('Saudia (SV)'),
  'SV',
  'Saudia alias with trailing code should resolve to SV'
);
assert.strictEqual(
  window.lookupAirlineCodeByName('Saudia (SV) 20'),
  'SV',
  'Saudia line with flight number should resolve to SV'
);

const saudiaSample = [
  'Depart • Wed, Nov 19',
  'Flight 1 • Wed, Nov 19',
  '11h 30m',
  'Saudia',
  'Saudia (SV) 20',
  'Boeing 777-300',
  '11:00 am',
  'New York John F Kennedy Intl (JFK)',
  'Overnight flight',
  '6:30 am',
  'Jeddah King Abdulaziz Intl (JED)',
  'Arrives Thu, Nov 20',
  'Return • Wed, Apr 8',
  'Flight 2 • Wed, Apr 8',
  '12h 55m',
  'Saudia',
  'Saudia (SV) 21',
  'Boeing 777-300',
  '3:05 am',
  'Jeddah King Abdulaziz Intl (JED)',
  '9:50 am',
  'New York John F Kennedy Intl (JFK)',
  'Arrives Wed, Apr 8'
].join('\n');

const saudiaLines = window.convertTextToI(saudiaSample).split('\n');
assert.strictEqual(saudiaLines.length, 2, 'Saudia sample should produce two segments');
assert.ok(/SV\s+20/.test(saudiaLines[0]), 'Outbound Saudia segment should use SV 20');
assert.ok(/SV\s+21/.test(saudiaLines[1]), 'Inbound Saudia segment should use SV 21');

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

const airSerbiaSample = [
  'Depart • Thu, Jan 22',
  '11h 45m',
  '*I✓',
  'ZRH-BEG',
  '✓',
  'Air Serbia',
  'Air Serbia 501',
  'Airbus A330-200',
  '3:00 pm',
  'New York John F Kennedy Intl (JFK)',
  '8h 40m',
  'Overnight flight',
  '5:40 am',
  'Belgrade Nikola Tesla (BEG)',
  'Arrives Fri, Jan 23',
  '1h 15m•Change planes in Belgrade (BEG)',
  'Air Serbia',
  'Air Serbia 330',
  'Airbus A319',
  '6:55 am',
  'Belgrade Nikola Tesla (BEG)',
  '1h 50m',
  '8:45 am',
  'Zurich (ZRH)',
  'Limited seats remaining at this price',
  'Meal provided',
  'Return • Sun, Feb 1',
  '13h 50m',
  'Air Serbia',
  'Air Serbia 331 · Operated by Bulgaria Air For Air Serbia',
  'Embraer 190',
  '9:30 am',
  'Zurich (ZRH)',
  '1h 40m',
  '11:10 am',
  'Belgrade Nikola Tesla (BEG)',
  'Limited seats remaining at this price',
  'Meal provided',
  '2h 00m•Change planes in Belgrade (BEG)',
  'Air Serbia',
  'Air Serbia 500',
  'Airbus A330-200',
  '1:10 pm',
  'Belgrade Nikola Tesla (BEG)',
  '10h 10m',
  '5:20 pm',
  'New York John F Kennedy Intl (JFK)',
  'Limited seats remaining at this price'
].join('\n');

const airSerbiaLines = window.convertTextToI(airSerbiaSample).split('\n');
assert.strictEqual(airSerbiaLines.length, 4, 'Air Serbia itinerary should produce four segments');
assert.ok(/JU 501/.test(airSerbiaLines[0]), 'outbound nonstop should keep JU 501');
assert.ok(/JU 500/.test(airSerbiaLines[3]), 'return nonstop should keep JU 500');

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

const baPremiumSample = [
  'Depart • Sat, Nov 8',
  'Flight 1 • Sat, Nov 8',
  'British Airways 228',
  '8:35 pm',
  'Baltimore/Washington (BWI)',
  'Overnight flight',
  '8:40 am',
  'London Heathrow (LHR)',
  'Arrives Sun, Nov 9',
  '1h 50m • Change planes in London (LHR)',
  'British Airways 594',
  '10:30 am',
  'London Heathrow (LHR)',
  '1:45 pm',
  'Venice Marco Polo (VCE)'
].join('\n');

const baPremiumPeek = window.peekSegments(baPremiumSample);
assert.strictEqual(baPremiumPeek.segments.length, 2, 'BA itinerary should produce two segments');
assert.strictEqual(
  baPremiumPeek.segments[1].durationMinutes,
  195,
  'short-haul BA segment should compute duration in minutes'
);

const baPremiumLines = window.convertTextToI(baPremiumSample, { bookingClass: '', autoCabin: 'premium' }).split('\n');
assert.ok(/BA\s+594Y/.test(baPremiumLines[1] || ''), 'short-haul premium cabin should fall back to economy booking class');

const baPremiumLongSample = [
  'Return • Thu, Dec 4',
  '16h 20m',
  'British Airways',
  'British Airways 551',
  'Airbus A319',
  '11:10 am',
  'Rome Fiumicino (FCO)',
  '2h 55m',
  '1:05 pm',
  'London Heathrow (LHR)',
  '2h 05m • Change planes in London (LHR)',
  'British Airways',
  'British Airways 269',
  'Airbus A380-800',
  '3:10 pm',
  'London Heathrow (LHR)',
  '11h 20m',
  '6:30 pm',
  'Los Angeles (LAX)'
].join('\n');

const baPremiumLongLines = window.convertTextToI(baPremiumLongSample, { bookingClass: '', autoCabin: 'premium' }).split('\n');
assert.ok(/BA\s+269W/.test(baPremiumLongLines[1] || baPremiumLongLines[0] || ''), 'long-haul premium cabin should keep premium booking class');

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

const matrixArriveLeak = [
  'Depart • Fri, Oct 10',
  'Flight 1 • Fri, Oct 10',
  'Los Angeles (LAX) to Philadelphia (PHL) on Fri, Oct 10',
  'American 3013',
  '12:04 pm',
  'Los Angeles (LAX)',
  '8:19 pm',
  'Philadelphia (PHL)',
  'Philadelphia (PHL) to Paris (CDG) on Fri, Oct 10',
  'American 754',
  '10:15 pm',
  'Philadelphia (PHL)',
  '11:30 am',
  'Paris (CDG)',
  'Return • Thu, Oct 30',
  'Flight 2 • Thu, Oct 30',
  'Paris (CDG) to London (LHR) on Thu, Oct 30',
  'American 7044',
  '7:05 am',
  'Paris (CDG)',
  '7:35 am',
  'London (LHR)',
  'London (LHR) to San Francisco (SFO) on Thu, Oct 30',
  'American 6996',
  '11:45 am',
  'London (LHR)',
  '4:00 pm',
  'San Francisco (SFO)'
].join('\n');

const matrixArriveLines = window.convertTextToI(matrixArriveLeak).split('\n');
assert.ok(/10OCT/.test(matrixArriveLines[1] || ''), 'PHL-CDG segment should retain its Oct 10 departure date');
assert.ok(!/30OCT/.test(matrixArriveLines[1] || ''), 'PHL-CDG segment should not inherit the Oct 30 return header as an arrival date');
assert.ok(/30OCT/.test(matrixArriveLines[2] || ''), 'CDG-LHR segment should depart on Oct 30 per the return header');

const matrixReturnless = [
  'Los Angeles (LAX) to Paris (CDG) on Fri, Oct 10',
  'Los Angeles (LAX) to Philadelphia (PHL) on Fri, Oct 10',
  '12:04 PM to 8:19 PM (5h 15m)',
  'American 3013',
  'Philadelphia (PHL) to Paris (CDG) on Fri, Oct 10',
  '10:15 PM to 11:30 AM (7h 15m)',
  'American 754',
  'Paris (CDG) to San Francisco (SFO) on Thu, Oct 30',
  'Paris (CDG) to London (LHR) on Thu, Oct 30',
  '7:05 AM to 7:35 AM (1h 30m)',
  'American 7044 (operated by British Airways)',
  'London (LHR) to San Francisco (SFO) on Thu, Oct 30',
  '11:45 AM to 4:00 PM (11h 15m)',
  'American 6996 (operated by British Airways)'
].join('\n');

const matrixReturnlessLines = window.convertTextToI(matrixReturnless).split('\n');
const matrixReturnlessPeek = window.peekSegments(matrixReturnless);
assert.ok(/30OCT/.test(matrixReturnlessLines[2] || ''), 'returnless itinerary should still depart on Oct 30 when a new route header provides the date');
assert.strictEqual(matrixReturnlessPeek.segments[2].depDate, '30OCT', 'peekSegments should honor the Oct 30 departure for the inbound leg even without a return header');

// Kayak regression: ensure outbound legs and return date context survive durations, pills, and inline change-plane copy.
const kayakRmoSfo = [
  'Depart • Fri, 3 Oct',
  '16h 55m',
  '*I✓',
  'Turkish Airlines',
  'Turkish Airlines 276',
  'Boeing 737-800 (winglets)',
  '03:40',
  'Chișinău Intl (RMO)',
  '1h 40m',
  '05:20',
  'Istanbul (IST)',
  '1h 50m•Change planes in Istanbul (IST)',
  'Turkish Airlines',
  'Turkish Airlines 289',
  'Airbus A350-900',
  '07:10',
  'Istanbul (IST)',
  '13h 25m',
  '10:35',
  'San Francisco (SFO)',
  'Return • Fri, 24 Oct',
  '16h 05m',
  'Turkish Airlines',
  'Turkish Airlines 290',
  'Airbus A350-900',
  '12:40',
  'San Francisco (SFO)',
  '12h 55m',
  'Overnight flight',
  '11:35',
  'Istanbul (IST)',
  'Arrives Sat, 25 Oct',
  '1h 40m•Change planes in Istanbul (IST)',
  'Turkish Airlines',
  'Turkish Airlines 273',
  'Boeing 737-800 (winglets)',
  '13:15',
  'Istanbul (IST)',
  '1h 30m',
  '14:45',
  'Chișinău Intl (RMO)'
].join('\n');

const kayakRmoSfoLines = window.convertTextToI(kayakRmoSfo).split('\n');
const kayakRmoSfoPeek = window.peekSegments(kayakRmoSfo);
assert.strictEqual(kayakRmoSfoPeek.segments.length, 4, 'Kayak itinerary should surface all four flight legs');
assert.strictEqual(kayakRmoSfoPeek.segments[0].depDate, '03OCT', 'Outbound departure should use Oct 3 header date');
assert.strictEqual(kayakRmoSfoPeek.segments[1].depDate, '03OCT', 'Outbound connection should remain on Oct 3');
assert.strictEqual(kayakRmoSfoPeek.segments[2].depDate, '24OCT', 'Inbound long-haul should keep its Oct 24 departure');
assert.strictEqual(kayakRmoSfoPeek.segments[2].arrDate, '25OCT J', 'Inbound long-haul should arrive on Oct 25 (Saturday)');
assert.strictEqual(kayakRmoSfoPeek.segments[3].depDate, '25OCT', 'Inbound connection should inherit the arrival date context');
assert.ok(/03OCT/.test(kayakRmoSfoLines[0] || ''), 'Outbound long-haul line should print the Oct 3 departure');
assert.ok(/03OCT/.test(kayakRmoSfoLines[1] || ''), 'Outbound connection line should retain the Oct 3 departure');
assert.ok(/24OCT/.test(kayakRmoSfoLines[2] || ''), 'Inbound long-haul should print its Oct 24 departure date');

const kayakMissingDepartLabel = [
  'Fri, 3 Oct',
  '16h 55m',
  'Turkish Airlines',
  'Turkish Airlines 276',
  '03:40',
  'Chișinău Intl (RMO)',
  '05:20',
  'Istanbul (IST)',
  'Turkish Airlines',
  'Turkish Airlines 289',
  '07:10',
  'Istanbul (IST)',
  '10:35',
  'San Francisco (SFO)',
  'Return • Fri, 24 Oct',
  'Turkish Airlines',
  'Turkish Airlines 290',
  '12:40',
  'San Francisco (SFO)',
  '11:35',
  'Istanbul (IST)',
  'Arrives Sat, 25 Oct',
  'Turkish Airlines',
  'Turkish Airlines 273',
  '13:15',
  'Istanbul (IST)',
  '14:45',
  'Chișinău Intl (RMO)'
].join('\n');

const kayakMissingDepartLines = window.convertTextToI(kayakMissingDepartLabel).split('\n').filter(Boolean);
assert.strictEqual(kayakMissingDepartLines.length, 4, 'Dropping the Depart label should not remove outbound legs');
assert.ok(/03OCT/.test(kayakMissingDepartLines[0] || ''), 'Missing Depart label should still infer the Oct 3 outbound date');
assert.ok(/24OCT/.test(kayakMissingDepartLines[2] || ''), 'Return leg should keep the Oct 24 departure date when Depart label is absent');

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

const midnightArrivalEncoding = [
  'Depart • Thu, Nov 13',
  'Flight 1 • Thu, Nov 13',
  'Turkish Airlines 272',
  '9:35 pm',
  'Chișinău Intl (RMO)',
  '12:15 am',
  'Istanbul (IST)',
  'Arrives Fri, Nov 14'
].join('\n');

const midnightArrivalLines = window.convertTextToI(midnightArrivalEncoding);
assert.ok(/1215A/.test(midnightArrivalLines), 'overnight arrival should encode 12:15 AM as 1215A');

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

const kayakReturnHeaderRegression = [
  'Depart • Thu, Oct 9',
  'Austrian Airlines 654',
  '4:15 pm',
  'Chișinău Intl (RMO)',
  '4:55 pm',
  'Vienna Intl (VIE)',
  'Austrian Airlines 7857 · Operated by United Airlines',
  '10:35 am',
  'London Heathrow (LHR)',
  '1:40 pm',
  'San Francisco (SFO)',
  'Return • Thu, Oct 16 19h 00m',
  'Austrian Airlines 7856 · Operated by United Airlines',
  '1:05 pm',
  'San Francisco (SFO)',
  '7:25 am',
  'London Heathrow (LHR)',
  'Arrives Fri, Oct 17',
  'Austrian Airlines 454 · Operated by Air Baltic',
  '10:25 am',
  'London Heathrow (LHR)',
  '1:45 pm',
  'Vienna Intl (VIE)',
  'Austrian Airlines 655',
  '3:30 pm',
  'Vienna Intl (VIE)',
  '6:05 pm',
  'Chișinău Intl (RMO)'
].join('\n');

const kayakReturnLines = window.convertTextToI(kayakReturnHeaderRegression).split('\n');
const kayakReturnPeek = window.peekSegments(kayakReturnHeaderRegression);
const sfToLondonLine = kayakReturnLines.find(line => /SFOLHR/.test(line));
assert.ok(sfToLondonLine && /16OCT/.test(sfToLondonLine), 'SFO-LHR leg should depart on Oct 16 when return header carries duration text');
const sfToLondonSeg = kayakReturnPeek.segments.find(seg => seg.depAirport === 'SFO' && seg.arrAirport === 'LHR');
assert.ok(sfToLondonSeg, 'peekSegments should expose an SFO-LHR segment for the return');
assert.strictEqual(sfToLondonSeg.depDate, '16OCT', 'peekSegments should keep Oct 16 for the first inbound segment when header text includes duration');

const outboundAvailability = window.convertTextToAvailability(sampleItinerary, { direction: 'outbound' });
assert.strictEqual(outboundAvailability, '112APRSEABCN12AORD/MAD¥IB¥IB¥IB', 'outbound availability should include all marketing carriers in order');

const inboundAvailability = window.convertTextToAvailability(sampleItinerary, { direction: 'inbound' });
assert.strictEqual(inboundAvailability, '127APRSVQSEA12AMAD/DFW¥IB¥IB¥IB', 'inbound availability should include all marketing carriers in order');

const multiCarrierItinerary = [
  'Depart • Fri, Jun 12',
  'Scandinavian Airlines 926',
  '8:20 pm',
  'Washington, D.C. (IAD)',
  '10:45 am',
  'Kastrup Copenhagen (CPH)',
  'Change planes in Copenhagen (CPH)',
  'Kenya Airways 1178 · Operated by KLM',
  '12:30 pm',
  'Kastrup Copenhagen (CPH)',
  '2:25 pm',
  'Amsterdam Schiphol (AMS)',
  'Long layover',
  'Kenya Airways 535',
  '8:35 pm',
  'Amsterdam Schiphol (AMS)',
  '6:50 am',
  'Nairobi Jomo Kenyatta (NBO)',
  'Arrives Sat, Jun 13'
].join('\n');

const multiCarrierAvailability = window.convertTextToAvailability(multiCarrierItinerary, { direction: 'outbound' });
assert.strictEqual(multiCarrierAvailability, '112JUNIADNBO12ACPH/AMS¥SK¥KQ¥KQ', 'availability should list each marketing carrier sequentially');

const detailedAvailabilitySample = [
  'Depart • Wed, Nov 13',
  'Turkish Airlines 272',
  '9:35 pm',
  'Chișinău Intl (RMO)',
  '12:15 am',
  'Istanbul (IST)',
  'Arrives Thu, Nov 14',
  'Turkish Airlines 44',
  '1:55 am',
  'Istanbul (IST)',
  '11:50 am',
  'Cape Town (CPT)',
  'Return • Tue, Nov 26',
  'Turkish Airlines 45',
  '5:15 pm',
  'Cape Town (CPT)',
  '5:35 am',
  'Istanbul (IST)',
  'Arrives Wed, Nov 27',
  'Turkish Airlines 271',
  '8:15 pm',
  'Istanbul (IST)',
  '8:45 pm',
  'Chișinău Intl (RMO)'
].join('\n');

const detailedAvailabilityBasic = window.convertTextToAvailability(detailedAvailabilitySample, { direction: 'outbound' });
assert.strictEqual(detailedAvailabilityBasic, '113NOVRMOCPT12AIST¥TK¥TK', 'baseline availability should retain legacy format when detailed mode is off');

const detailedAvailabilityEnhanced = window.convertTextToAvailability(detailedAvailabilitySample, {
  direction: 'outbound',
  detailed: true
});
assert.strictEqual(detailedAvailabilityEnhanced, '113NOVRMOCPT935PIST-100¥TK¥TK', 'detailed availability should include departure time and layover minutes');

const tapPortugalSample = [
  'Depart • Tue, Nov 19',
  'TAP Portugal 244',
  '7:10 pm',
  'Chicago (ORD)',
  '9:05 am',
  'Lisbon (LIS)',
  'Arrives Wed, Nov 20',
  'TAP Portugal 572',
  '12:45 pm',
  'Lisbon (LIS)',
  '4:55 pm',
  'Frankfurt (FRA)',
  'Return • Sat, Dec 7',
  'TAP Portugal 575',
  '6:00 am',
  'Frankfurt (FRA)',
  '8:15 am',
  'Lisbon (LIS)',
  'TAP Portugal 243',
  '11:10 am',
  'Lisbon (LIS)',
  '2:45 pm',
  'Chicago (ORD)'
].join('\n');

const tapPortugalDetailedInbound = window.convertTextToAvailability(tapPortugalSample, {
  direction: 'inbound',
  detailed: true
});
assert.strictEqual(
  tapPortugalDetailedInbound,
  '17DECFRAORD600ALIS-175¥TP¥TP',
  'detailed availability should keep same-day layovers within the current year'
);

console.log('✓ converter maintains departure date continuity for connecting segments');
