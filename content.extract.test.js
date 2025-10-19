const assert = require('assert');

class StubTextNode {
  constructor(value){
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = null;
    this.parentNode = null;
    this.ownerDocument = null;
  }

  get textContent(){
    return this.nodeValue;
  }

  set textContent(value){
    this.nodeValue = String(value);
  }
}

class StubElement {
  constructor(tag = 'div'){
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.parentElement = null;
    this.parentNode = null;
    this.childNodes = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.offsetHeight = 0;
    this.ownerDocument = null;
    const classSet = new Set();
    this.classList = {
      add: (...cls) => cls.forEach(c => classSet.add(c)),
      remove: (...cls) => cls.forEach(c => classSet.delete(c)),
      toggle: (cls, force) => {
        if(force === true){
          classSet.add(cls);
          return true;
        }
        if(force === false){
          classSet.delete(cls);
          return false;
        }
        if(classSet.has(cls)){
          classSet.delete(cls);
          return false;
        }
        classSet.add(cls);
        return true;
      },
      contains: (cls) => classSet.has(cls)
    };
    Object.defineProperty(this, 'className', {
      get: () => Array.from(classSet).join(' '),
      set: (value) => {
        classSet.clear();
        String(value || '')
          .split(/\s+/)
          .filter(Boolean)
          .forEach(c => classSet.add(c));
      }
    });
  }

  appendChild(node){
    if(!node) return node;
    this.childNodes.push(node);
    if(node.nodeType === 1 || node.nodeType === 3){
      node.parentElement = this;
      node.parentNode = this;
      if(typeof document !== 'undefined'){
        node.ownerDocument = document;
      }
    }
    return node;
  }

  removeChild(node){
    const idx = this.childNodes.indexOf(node);
    if(idx >= 0){
      this.childNodes.splice(idx, 1);
    }
    if(node){
      node.parentElement = null;
      node.parentNode = null;
    }
    return node;
  }

  get children(){
    return this.childNodes.filter(child => child && child.nodeType === 1);
  }

  get textContent(){
    if(this.childNodes.length === 0) return '';
    return this.childNodes
      .map(child => {
        if(!child) return '';
        if(child.nodeType === 3) return child.nodeValue;
        if(typeof child.textContent === 'string') return child.textContent;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  set textContent(value){
    this.childNodes.length = 0;
    if(value && value !== 0){
      this.appendChild(new StubTextNode(String(value)));
    }
  }

  get innerText(){
    return this.textContent;
  }

  set innerText(value){
    this.textContent = value;
  }

  getClientRects(){
    return [{}];
  }

  getBoundingClientRect(){
    return { top: 0, left: 0, width: 320, height: 200 };
  }

  querySelector(){
    return null;
  }

  querySelectorAll(){
    return [];
  }

  addEventListener(){
    return undefined;
  }

  removeEventListener(){
    return undefined;
  }

  dispatchEvent(){
    return false;
  }

  contains(node){
    let current = node;
    while(current){
      if(current === this) return true;
      current = current.parentNode || current.parentElement || null;
    }
    return false;
  }

  closest(){
    return null;
  }

  setAttribute(name, value){
    this.attributes.set(name, String(value));
  }

  getAttribute(name){
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name){
    this.attributes.delete(name);
  }
}

global.window = global;
window.addEventListener = () => {};
window.removeEventListener = () => {};
window.dispatchEvent = () => false;
global.NodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3
};

global.location = { hostname: 'www.kayak.com' };

const docElement = new StubElement('html');
const body = new StubElement('body');
docElement.appendChild(body);

global.document = {
  documentElement: docElement,
  body,
  createElement: (tag) => {
    const el = new StubElement(tag);
    el.ownerDocument = document;
    return el;
  },
  createTreeWalker(root, whatToShow, filter){
    const nodes = [];
    const visit = (node) => {
      if(!node) return;
      if(node.nodeType === 3){
        nodes.push(node);
      }
      if(node.childNodes){
        node.childNodes.forEach(visit);
      }
    };
    visit(root);
    let index = -1;
    return {
      currentNode: null,
      nextNode(){
        while(++index < nodes.length){
          const candidate = nodes[index];
          const result = filter && typeof filter.acceptNode === 'function'
            ? filter.acceptNode(candidate)
            : NodeFilter.FILTER_ACCEPT;
          if(result === NodeFilter.FILTER_ACCEPT){
            this.currentNode = candidate;
            return true;
          }
        }
        return false;
      }
    };
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  createEvent: () => ({ initEvent: () => {} })
};

global.Element = StubElement;

global.getComputedStyle = () => ({
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'relative',
  marginRight: '0px',
  marginLeft: '0px',
  marginTop: '0px',
  marginBottom: '0px',
  paddingRight: '0px',
  paddingLeft: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  gap: '0px',
  columnGap: '0px',
  getPropertyValue: () => '0px'
});

global.MutationObserver = class {
  constructor(){ this.observe = () => {}; this.disconnect = () => {}; }
};

global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

global.navigator = {
  clipboard: {
    writeText: async () => {}
  }
};

global.chrome = {
  storage: {
    sync: {
      get: (_keys, cb) => cb && cb({}),
      set: (_items, cb) => cb && cb()
    },
    onChanged: {
      addListener: () => {}
    }
  }
};

global.history = {
  pushState: function(){},
  replaceState: function(){}
};

require('./airlines.js');
require('./content.js');

const extractVisibleText = window.__kayakCopyTestHooks && window.__kayakCopyTestHooks.extractVisibleText;
assert.strictEqual(typeof extractVisibleText, 'function', 'extractVisibleText test hook should be available');

const makeLine = (value) => {
  const wrapper = new StubElement('div');
  wrapper.ownerDocument = document;
  wrapper.appendChild(new StubTextNode(value));
  return wrapper;
};

const root = new StubElement('section');
[
  'Flight 1 • Thu, Jul 16',
  '19h 10m',
  '*I✓',
  'Condor',
  'Condor 2454',
  'Airbus A330-900neo',
  '2:25 pm',
  'Frankfurt am Main (FRA)',
  '10h 25m',
  '3:50 pm',
  'Vancouver Intl (YVR)',
  '2h 35m•Change planes in Vancouver (YVR)',
  'Self-transfer',
  'WestJet 1862',
  '6:25 pm',
  'Vancouver Intl (YVR)',
  '6h 10m',
  '9:35 pm',
  'Honolulu (HNL)',
  'Flight 2 • Wed, Aug 26',
  'ANA 183',
  '11:35 am',
  'Honolulu (HNL)',
  '8h 15m',
  '2:50 pm',
  'Tokyo Narita (NRT)',
  '2h 10m•Change planes in Tokyo (NRT)',
  'Self-transfer',
  'ZIPAIR 51',
  '5:00 pm',
  'Tokyo Narita (NRT)',
  '6h 40m',
  '9:40 pm',
  'Bangkok Suvarnabhumi (BKK)',
  'Flight 3 • Wed, Sep 16',
  'EVA Air 67',
  '12:45 pm',
  'Bangkok Suvarnabhumi (BKK)',
  '12h 35m',
  '7:20 pm',
  'London Heathrow (LHR)'
].forEach(line => root.appendChild(makeLine(line)));

const extracted = extractVisibleText(root);

assert.ok(extracted.includes('WestJet 1862'), 'WestJet segment should remain in extracted text');
assert.ok(extracted.includes('ZIPAIR 51'), 'ZIPAIR segment should remain in extracted text');
assert.ok(extracted.includes('EVA Air 67'), 'EVA Air segment should remain in extracted text');

console.log('extractVisibleText tests passed.');
