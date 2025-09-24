const assert = require('assert');

global.window = global;
require('./airlines.js');
require('./converter.js');

testNumericDateParsing();

console.log('All converter tests passed.');

function testNumericDateParsing(){
  const sampleLines = [
    'Depart Thu 05/10',
    'United Airlines 123',
    '7:15 am',
    '(DUB)',
    '9:45 am',
    '(LHR)',
    'Return Sun 12/10',
    'United Airlines 456',
    '11:05 am',
    '(LHR)',
    '12:45 pm',
    '(DUB)'
  ];
  const preview = window.peekSegments(sampleLines.join('\n'));
  assert.ok(preview && Array.isArray(preview.segments), 'Expected segments from peekSegments');
  assert.strictEqual(preview.segments.length, 2, 'Expected two segments');
  assert.strictEqual(preview.segments[0].depDate, '05OCT', 'First segment day should be preserved');
  assert.strictEqual(preview.segments[1].depDate, '12OCT', 'Second segment day should be preserved');
}
