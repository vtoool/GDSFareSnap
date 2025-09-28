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

global.chrome = {
  storage: {
    sync: {
      get: (_, cb) => cb({}),
      set: (_, cb) => cb && cb(),
    },
    onChanged: {
      addListener: () => {}
    }
  }
};

require('./airlines.js');
require('./rbd.js');

const { convertViToI } = require('./popup.js');

const sampleText = `FLIGHT  DATE  SEGMENT DPTR  ARVL    MLS  EQP  ELPD MILES SM\n 1 AA  293 22OCT DEL JFK 1130P  605A¥1 LS   789 16.05  7318  N\nDEP-TERMINAL 3                 ARR-TERMINAL 8                 \nONEWORLD\nCABIN-PREMIUM ECONOMY\n 2 AA 2813 23OCT JFK AUS 1132A  237P   F    738  4.05  1521  N\nDEP-TERMINAL 8                 \nONEWORLD\nCABIN-ECONOMY`;

const result = convertViToI(sampleText, { autoCabin: true, bookingClass: 'J', segmentStatus: 'SS1' });

assert.ok(result && typeof result.text === 'string', 'convertViToI should return text output');

const firstLine = result.text.split('\n')[0] || '';
assert.ok(/AA\s?293W/.test(firstLine), 'AA premium economy segment should use W booking class');

assert.ok(Array.isArray(result.segments), 'segments should be returned');
assert.strictEqual(result.segments[0].bookingClass, 'W', 'first segment booking class should be W');

console.log('All tests passed.');
