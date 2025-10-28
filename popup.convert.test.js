const assert = require('assert');

global.window = global;

const stubElement = () => ({
  style: {},
  value: '',
  textContent: '',
  innerHTML: '',
  disabled: false,
  checked: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: () => '',
  focus: () => {},
  blur: () => {},
  select: () => {},
  appendChild: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  classList: {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false
  }
});

const elements = new Map();

global.document = {
  getElementById(id){
    if (!elements.has(id)){
      elements.set(id, stubElement());
    }
    return elements.get(id);
  },
  createElement: () => stubElement(),
  createRange: () => ({
    selectNodeContents: () => {},
    setStart: () => {},
    setEnd: () => {}
  }),
  queryCommandSupported: () => false,
  execCommand: () => false,
  body: {
    appendChild: () => {},
    removeChild: () => {}
  }
};

global.window.getSelection = () => ({
  removeAllRanges: () => {},
  addRange: () => {}
});

global.navigator = {
  clipboard: {
    writeText: async () => {}
  }
};

const chromeState = { detailedAvailability: true };

global.chrome = {
  storage: {
    sync: {
      get: (_, cb) => cb({ ...chromeState }),
      set: (data, cb) => {
        Object.assign(chromeState, data || {});
        if (typeof cb === 'function') cb();
      },
    },
    onChanged: {
      addListener: () => {}
    }
  }
};

require('./airlines.js');
require('./rbd.js');
require('./converter.js');

const {
  convertViToI,
  resolveCabinForSegment,
  pickPreferredBookingClass,
  buildViAvailabilityPreview,
  buildViAvailabilityCommands
} = require('./popup.js');

const sampleText = `FLIGHT  DATE  SEGMENT DPTR  ARVL    MLS  EQP  ELPD MILES SM\n 1 AA  293 22OCT DEL JFK 1130P  605A¥1 LS   789 16.05  7318  N\nDEP-TERMINAL 3                 ARR-TERMINAL 8                 \nONEWORLD\nCABIN-PREMIUM ECONOMY\n 2 AA 2813 23OCT JFK AUS 1132A  237P   F    738  4.05  1521  N\nDEP-TERMINAL 8                 \nONEWORLD\nCABIN-ECONOMY`;

const result = convertViToI(sampleText, { autoCabin: true, bookingClass: 'J', segmentStatus: 'SS1' });

assert.ok(result && typeof result.text === 'string', 'convertViToI should return text output');

const firstLine = result.text.split('\n')[0] || '';
assert.ok(/AA\s?293W/.test(firstLine), 'AA premium economy segment should use W booking class');

assert.ok(Array.isArray(result.segments), 'segments should be returned');
assert.strictEqual(result.segments[0].bookingClass, 'W', 'first segment booking class should be W');

const shortPremiumSegment = {
  cabinRaw: 'Premium Economy',
  durationMinutes: 150,
  airlineCode: 'AA'
};
const normalizedCabin = resolveCabinForSegment({ ...shortPremiumSegment });
assert.strictEqual(normalizedCabin, 'ECONOMY', 'short-haul premium segment should downgrade to economy cabin');
const shortPremiumBooking = pickPreferredBookingClass('AA', normalizedCabin, '', shortPremiumSegment);
assert.strictEqual(shortPremiumBooking, 'Y', 'short-haul premium segment should use Y booking class');

const viRoundTripSample = [
  'CABIN-BUSINESS',
  ' 1 AA  100 01JUL JFK LAX 0800A 1100A  0 738 5.00',
  'CABIN-BUSINESS',
  ' 2 AA  101 05JUL LAX JFK 0100P 0900P  0 738 5.00'
].join('\n');

const roundTripConversion = convertViToI(viRoundTripSample, { autoCabin: false, bookingClass: 'J', segmentStatus: 'SS1' });
assert.ok(Array.isArray(roundTripConversion.segments) && roundTripConversion.segments.length === 2, 'round trip conversion should expose two segments');

const viPreview = buildViAvailabilityPreview(roundTripConversion.segments);
assert.ok(viPreview && Array.isArray(viPreview.segments) && viPreview.segments.length === 2, 'VI preview should surface two normalized segments');

const viAvailabilityCommands = buildViAvailabilityCommands({ preview: viPreview });
assert.ok(Array.isArray(viAvailabilityCommands) && viAvailabilityCommands.length >= 2, 'VI preview should produce availability commands');

const outboundCommand = viAvailabilityCommands.find(entry => entry && typeof entry.command === 'string' && /JFKLAX/.test(entry.command));
const inboundCommand = viAvailabilityCommands.find(entry => entry && typeof entry.command === 'string' && /LAXJFK/.test(entry.command));

assert.ok(outboundCommand && /^11JULJFKLAX/.test(outboundCommand.command), 'outbound availability command should include the outbound date and route');
assert.ok(inboundCommand && /^15JULLAXJFK/.test(inboundCommand.command), 'inbound availability command should include the return date and route');

const viDetailedSample = [
  ' 1 LH  464 14FEB MCO FRA 0750P 1050A¥1 343 8.00',
  'CABIN-BUSINESS',
  ' 2 LH  944 15FEB FRA FLR 0130P 0255P 320 1.42'
].join('\n');

const detailedConversion = convertViToI(viDetailedSample, { autoCabin: false, bookingClass: 'J', segmentStatus: 'SS1' });
const detailedPreview = buildViAvailabilityPreview(detailedConversion.segments);
const detailedCommands = buildViAvailabilityCommands({ preview: detailedPreview });
const detailedOutbound = detailedCommands.find(entry => entry && typeof entry.command === 'string' && /MCOFLR/.test(entry.command));

assert.ok(detailedOutbound && /750PFRA-160/.test(detailedOutbound.command), 'detailed availability should include departure time and layover minutes for VI* conversions');

console.log('All tests passed.');
