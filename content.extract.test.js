const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
    this.ownerDocument = null;
    this._rect = { top: 0, left: 0, width: 320, height: 200 };
    this.offsetHeight = this._rect.height;
    this.offsetWidth = this._rect.width;
    this.offsetTop = this._rect.top;
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
    this.getBoundingClientRect = () => ({
      top: this._rect.top,
      left: this._rect.left,
      width: this._rect.width,
      height: this._rect.height,
      right: this._rect.left + this._rect.width,
      bottom: this._rect.top + this._rect.height
    });
    this.getClientRects = () => [this.getBoundingClientRect()];
  }

  setBoundingRect(rect = {}){
    this._rect = Object.assign({}, this._rect, rect);
    this.offsetHeight = this._rect.height;
    this.offsetWidth = this._rect.width;
    this.offsetTop = this._rect.top;
  }

  appendChild(node){
    if(!node) return node;
    if(node.parentElement){
      node.parentElement.removeChild(node);
    }
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

  insertBefore(node, referenceNode){
    if(!node) return node;
    if(referenceNode && referenceNode.parentElement !== this){
      return this.appendChild(node);
    }
    if(node.parentElement){
      node.parentElement.removeChild(node);
    }
    const idx = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    if(idx >= 0){
      this.childNodes.splice(idx, 0, node);
    } else {
      this.childNodes.push(node);
    }
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

  get firstElementChild(){
    for(const child of this.childNodes){
      if(child && child.nodeType === 1) return child;
    }
    return null;
  }

  get lastElementChild(){
    for(let i = this.childNodes.length - 1; i >= 0; i--){
      const child = this.childNodes[i];
      if(child && child.nodeType === 1) return child;
    }
    return null;
  }

  get nextElementSibling(){
    if(!this.parentElement) return null;
    const siblings = this.parentElement.childNodes;
    let seen = false;
    for(const sibling of siblings){
      if(!sibling || sibling.nodeType !== 1) continue;
      if(seen) return sibling;
      if(sibling === this) seen = true;
    }
    return null;
  }

  get previousElementSibling(){
    if(!this.parentElement) return null;
    const siblings = this.parentElement.childNodes;
    let prev = null;
    for(const sibling of siblings){
      if(!sibling || sibling.nodeType !== 1) continue;
      if(sibling === this) return prev;
      prev = sibling;
    }
    return null;
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

  matches(selector){
    return stubMatchesSelector(this, selector);
  }

  closest(selector){
    if(!selector) return null;
    let current = this;
    while(current){
      if(current.matches && current.matches(selector)) return current;
      current = current.parentElement || null;
    }
    return null;
  }

  querySelector(selector){
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  querySelectorAll(selector){
    const selectors = String(selector || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if(!selectors.length) return [];
    const results = [];
    const visit = (node) => {
      if(!node || !node.childNodes) return;
      for(const child of node.childNodes){
        if(!child || child.nodeType !== 1) continue;
        if(selectors.some(sel => child.matches(sel))){
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
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

  setAttribute(name, value){
    const val = value === undefined ? '' : String(value);
    if(name === 'class'){
      this.className = val;
      return;
    }
    this.attributes.set(name, val);
    if(name && name.startsWith('data-')){
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = val;
    }
  }

  getAttribute(name){
    if(name === 'class'){
      return this.className;
    }
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name){
    if(name === 'class'){
      this.className = '';
      return;
    }
    this.attributes.delete(name);
    if(name && name.startsWith('data-')){
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[key];
    }
  }

  contains(node){
    let current = node;
    while(current){
      if(current === this) return true;
      current = current.parentNode || current.parentElement || null;
    }
    return false;
  }
}

function splitSelectorParts(selector){
  const parts = [];
  let current = '';
  let depth = 0;
  for(let i = 0; i < selector.length; i++){
    const ch = selector[i];
    if(ch === '['){
      depth++;
    } else if(ch === ']'){
      depth = Math.max(0, depth - 1);
    }
    if(depth === 0 && /\s/.test(ch)){
      if(current.trim()){
        parts.push(current.trim());
      }
      current = '';
      continue;
    }
    current += ch;
  }
  if(current.trim()){
    parts.push(current.trim());
  }
  return parts;
}

function matchSimpleSelector(node, selector){
  const trimmed = (selector || '').trim();
  if(!trimmed) return false;
  if(trimmed === '*') return true;
  if(trimmed.startsWith('.')){
    const cls = trimmed.slice(1);
    return !!cls && node.classList.contains(cls);
  }
  if(trimmed.startsWith('#')){
    const id = trimmed.slice(1);
    return !!id && node.getAttribute('id') === id;
  }
  if(trimmed.startsWith('[')){
    const attrRegex = /^\[([^\s=\]]+)([*^$~|]?=)?(?:"([^"]*)"|'([^']*)'|([^\s\]]+))?(?:\s+([iIsS]))?\]$/;
    const match = trimmed.match(attrRegex);
    if(!match) return false;
    const attr = match[1];
    const operator = match[2] || null;
    const rawValue = match[3] ?? match[4] ?? match[5] ?? '';
    const flag = (match[6] || '').toLowerCase();
    const attrValue = node.getAttribute(attr);
    if(operator === null){
      return attrValue !== null;
    }
    if(attrValue == null) return false;
    const attrStr = flag === 'i' ? String(attrValue).toLowerCase() : String(attrValue);
    const valueStr = flag === 'i' ? rawValue.toLowerCase() : rawValue;
    if(operator === '*='){
      return attrStr.indexOf(valueStr) !== -1;
    }
    if(operator === '='){
      return attrStr === valueStr;
    }
    return false;
  }
  return node.tagName === trimmed.toUpperCase();
}

function matchCompoundSelector(node, selector){
  const parts = splitSelectorParts(selector.trim());
  if(!parts.length) return false;
  const last = parts[parts.length - 1];
  if(!matchSimpleSelector(node, last)) return false;
  if(parts.length === 1) return true;
  const ancestorSelector = parts.slice(0, -1).join(' ');
  let ancestor = node.parentElement;
  while(ancestor){
    if(matchCompoundSelector(ancestor, ancestorSelector)){
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function stubMatchesSelector(node, selector){
  if(!node || node.nodeType !== 1) return false;
  const options = String(selector || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if(!options.length) return false;
  return options.some(sel => matchCompoundSelector(node, sel));
}

global.window = global;
window.addEventListener = () => {};
window.removeEventListener = () => {};
window.dispatchEvent = () => false;
global.NodeFilter = {
  SHOW_ELEMENT: 1,
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
    const elementMask = Number.isFinite(whatToShow) ? (whatToShow & NodeFilter.SHOW_ELEMENT) : NodeFilter.SHOW_ELEMENT;
    const textMask = Number.isFinite(whatToShow) ? (whatToShow & NodeFilter.SHOW_TEXT) : NodeFilter.SHOW_TEXT;
    const visit = (node) => {
      if(!node) return;
      if(node.nodeType === 1 && elementMask){
        nodes.push(node);
      }
      if(node.nodeType === 3 && textMask){
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

function parseHtmlFragment(html){
  const container = new StubElement('fragment');
  container.ownerDocument = document;
  const stack = [container];
  const tokenRegex = /<!--[\s\S]*?-->|<[^>]+>|[^<]+/g;
  const source = String(html || '');
  let match;
  while((match = tokenRegex.exec(source))){
    const token = match[0];
    if(!token) continue;
    if(token.startsWith('<!--')){
      continue;
    }
    if(token.startsWith('</')){
      if(stack.length > 1){
        stack.pop();
      }
      continue;
    }
    if(token.startsWith('<')){
      const isSelfClosing = /\/\s*>$/.test(token);
      const openMatch = token.match(/^<\s*([a-zA-Z0-9:-]+)([^>]*)\/?\s*>$/);
      if(!openMatch) continue;
      const tagName = openMatch[1];
      const attrSource = openMatch[2] || '';
      const el = new StubElement(tagName);
      el.ownerDocument = document;
      const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
      let attrMatch;
      while((attrMatch = attrRegex.exec(attrSource))){
        const attrName = attrMatch[1];
        if(!attrName) continue;
        const attrValue = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5];
        if(typeof attrValue === 'undefined'){
          el.setAttribute(attrName, attrName);
        } else {
          el.setAttribute(attrName, attrValue);
        }
      }
      stack[stack.length - 1].appendChild(el);
      if(!isSelfClosing){
        stack.push(el);
      }
      continue;
    }
    const textValue = token.replace(/\s+/g, ' ').trim();
    if(!textValue) continue;
    const textNode = new StubTextNode(textValue);
    stack[stack.length - 1].appendChild(textNode);
  }
  return container.childNodes.filter(Boolean);
}

function loadFixtureNodes(relativePath){
  const filePath = path.join(__dirname, relativePath);
  const html = fs.readFileSync(filePath, 'utf8');
  return parseHtmlFragment(html);
}

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

const reviewRoot = new StubElement('section');
[
  'American Airlines',
  'Nonstop • 5h 45m',
  '6:06 pm - 8:51 pm(5h 45m)',
  'Los Angeles (LAX)',
  'Honolulu (HNL)',
  'American Airlines 297'
].forEach(line => reviewRoot.appendChild(makeLine(line)));

const reviewExtracted = extractVisibleText(reviewRoot);

assert.ok(
  reviewExtracted.includes('6:06 pm - 8:51 pm(5h 45m)'),
  'Time range rows should be preserved for itinerary parsing'
);

const resolveKayakInlineHost = window.__kayakCopyTestHooks && window.__kayakCopyTestHooks.resolveKayakInlineHost;
const findKayakDetailContainer = window.__kayakCopyTestHooks && window.__kayakCopyTestHooks.findKayakDetailContainer;
assert.strictEqual(typeof resolveKayakInlineHost, 'function', 'resolveKayakInlineHost test hook should be available');
assert.strictEqual(typeof findKayakDetailContainer, 'function', 'findKayakDetailContainer test hook should be available');

function buildKayakDetailCard(){
  const card = new StubElement('div');
  card.ownerDocument = document;
  card.className = 'detail-card';
  card.setAttribute('data-testid', 'detail-card');
  card.setBoundingRect({ top: 200, left: 0, width: 760, height: 1200 });
  const nodes = loadFixtureNodes('fixtures/kayak/multi-city-nonstop-flight1.html');
  nodes.forEach(node => card.appendChild(node));
  const selectBtn = new StubElement('button');
  selectBtn.ownerDocument = document;
  selectBtn.className = 'primary-select';
  selectBtn.innerText = 'Select';
  selectBtn.setBoundingRect({ top: 260, left: 520, width: 140, height: 40 });
  card.insertBefore(selectBtn, card.firstElementChild || null);
  const legs = card.querySelectorAll('.o-C7-leg-outer');
  legs.forEach((leg, idx) => {
    const top = 340 + idx * 220;
    leg.setBoundingRect({ top, left: 32, width: 640, height: 200 });
    const inner = leg.querySelector('.o-C7-leg-inner');
    if(inner && typeof inner.setBoundingRect === 'function'){
      inner.setBoundingRect({ top: top + 24, left: 64, width: 600, height: 160 });
    }
  });
  body.appendChild(card);
  return { card, selectBtn };
}

function buildKayakCollapsedCard(){
  const card = new StubElement('div');
  card.ownerDocument = document;
  card.className = 'result-card';
  card.setAttribute('data-testid', 'result-card');
  card.setBoundingRect({ top: 420, left: 0, width: 760, height: 380 });

  const summary = new StubElement('div');
  summary.className = 'result-summary';
  summary.setBoundingRect({ top: 440, left: 0, width: 720, height: 120 });
  summary.appendChild(new StubTextNode('Sample carrier · 2 stops'));
  card.appendChild(summary);

  const priceRow = new StubElement('div');
  priceRow.className = 'result-price-row';
  priceRow.setAttribute('data-testid', 'price-container');
  priceRow.setBoundingRect({ top: 580, left: 0, width: 720, height: 72 });
  const price = new StubElement('div');
  price.className = 'result-price';
  price.innerText = '$642';
  priceRow.appendChild(price);

  const selectBtn = new StubElement('button');
  selectBtn.className = 'primary-select';
  selectBtn.setAttribute('data-testid', 'primary-button');
  selectBtn.innerText = 'Select';
  selectBtn.setBoundingRect({ top: 592, left: 536, width: 160, height: 44 });
  priceRow.appendChild(selectBtn);

  card.appendChild(priceRow);
  body.appendChild(card);
  return { card, selectBtn, priceRow };
}

const { card: detailCard, selectBtn: detailSelect } = buildKayakDetailCard();
const firstLeg = detailCard.querySelector('.o-C7-leg-outer');
assert.ok(firstLeg, 'fixture should expose at least one leg element');

const detailTarget = findKayakDetailContainer(detailCard, detailSelect);
assert.ok(detailTarget, 'detail container discovery should yield a candidate');
const detailLeg = detailTarget.closest ? detailTarget.closest('.o-C7-leg-outer') : null;
assert.strictEqual(detailLeg, firstLeg, 'detail container should resolve to the first leg');

const inlineHost = resolveKayakInlineHost(detailCard, detailSelect, detailTarget);
assert.ok(inlineHost, 'inline host resolution should return an element');
assert.ok(inlineHost.classList.contains('kayak-copy-inline-slot'), 'inline host should use kayak slot class');
assert.strictEqual(inlineHost.nextElementSibling, firstLeg, 'inline slot should sit immediately before the first leg');
assert.strictEqual(inlineHost.parentElement, firstLeg.parentElement, 'inline slot should share the parent container with the first leg');

const { card: collapsedCard, selectBtn: collapsedSelect, priceRow } = buildKayakCollapsedCard();
const collapsedInline = resolveKayakInlineHost(collapsedCard, collapsedSelect, null);
assert.ok(collapsedInline, 'collapsed card should yield an inline host');
assert.ok(collapsedInline.classList.contains('kayak-copy-inline-slot--cta'), 'collapsed inline host should mark CTA variant');
assert.strictEqual(collapsedInline.parentElement, priceRow, 'CTA inline slot should live inside the price row container');
assert.strictEqual(collapsedInline.nextElementSibling, collapsedSelect, 'CTA inline slot should sit before the select button');
const collapsedRepeat = resolveKayakInlineHost(collapsedCard, collapsedSelect, null);
assert.strictEqual(collapsedRepeat, collapsedInline, 'CTA inline slot should be cached on repeat resolutions');

body.removeChild(detailCard);
body.removeChild(collapsedCard);

console.log('extractVisibleText tests passed.');
