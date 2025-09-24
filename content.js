// content.js — surface a floating *I copy button on expanded Kayak cards
(() => {
  'use strict';

  const HOSTNAME = (location && location.hostname) || '';
  const IS_ITA = /(?:^|\.)matrix\.itasoftware\.com$/i.test(HOSTNAME);
  const IS_KAYAK = /(?:^|\.)kayak\.[^.]+(?:\.[^.]+)*$/i.test(HOSTNAME);

  if (!IS_ITA && !IS_KAYAK) {
    return;
  }

  const BTN_CLASS    = 'kayak-copy-btn';
  const SEARCH_LIKE_SELECTOR = 'form, [role="search"], [data-testid*="searchbox" i], [data-test*="searchbox" i], [data-testid*="search-form" i], [data-test*="search-form" i], [data-testid*="searchform" i], [data-test*="searchform" i], [data-testid*="searchpanel" i], [data-test*="searchpanel" i], [class*="searchbox" i], [class*="search-form" i], [aria-label*="search" i]';
  const BTN_GROUP_CLASS = 'kayak-copy-btn-group';
  const OVERLAY_ROOT_ID = 'kayak-copy-overlay-root';
  const MODAL_DIM_CLASS = 'kayak-copy-modal-dim';
  const MAX_CLIMB   = 12;
  const SELECT_RX   = /\b(?:Select(?:\s+Flight)?|Choose|View\s+(?:Deal|Flight|Offer)|See\s+(?:Deal|Offer)|Book|Continue(?:\s+to\s+Airline)?|Go\s+to\s+(?:Site|Airline)|Visit\s+(?:Airline|Site)|Check\s+Price|View\s+Offer)\b/i;
  const CTA_ATTR_HINTS = ['select','book','booking','cta','result-select','provider','price-link','price','offer','deal'];
  const CTA_MIN_WIDTH = 90;
  const CTA_MIN_HEIGHT = 32;
  const CTA_MIN_AREA = CTA_MIN_WIDTH * CTA_MIN_HEIGHT;
  const ITA_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const REVIEW_BOOK_SIGNATURE_RX = /review(?:\s|&|and|-|_)*book|book(?:\s|&|and|-|_)*review/;
  const CARD_KEY_ATTR = 'data-kayak-copy-key';
  const CABIN_PRIORITY = ['first','business','premium','economy'];
  const CABIN_LABELS = { first:'First', business:'Business', premium:'Premium Economy', economy:'Economy' };
  const CABIN_ENUM_MAP = { first: 'FIRST', business: 'BUSINESS', premium: 'PREMIUM', economy: 'ECONOMY' };
  const CABIN_DEFAULT_BOOKING = { FIRST: 'F', BUSINESS: 'J', PREMIUM: 'N', ECONOMY: 'Y' };
  const DEFAULT_OVERLAY_BASE_Z = 1400;
  const STABLE_CARD_ATTRS = [
    'data-resultid',
    'data-result-id',
    'data-option-id',
    'data-offer-id',
    'data-offerid',
    'data-optionid',
    'data-resultkey',
    'data-offer-key',
    'data-product-id'
  ];
  const STABLE_LINK_SELECTOR = [
    'a[data-resultid]',
    'a[data-result-id]',
    'a[data-option-id]',
    'a[data-offer-id]',
    'a[href*="/book" i]',
    'a[href*="/booking" i]',
    'a[href*="/itinerary" i]',
    'a[href*="/deal" i]',
    'a[href*="/offer" i]',
    'a[href*="/flight" i]'
  ].join(', ');

  let nextCardKey = 1;

  let buttonConfigVersion = 0;
  let overlayRoot = null;
  let syncScheduled = false;
  let overlayBaseZ = DEFAULT_OVERLAY_BASE_Z;
  let lastKnownHeaderZ = null;
  let lastStoredAutoBookingClass = null;
  let cabinDetectionState = { cabin:null, bookingClass:null, mixed:false, label:'', source:'' };
  let cabinDetectionScheduled = false;
  let reviewHeadingCacheTime = 0;
  let reviewHeadingCacheValue = false;

  const cardGroupMap = new WeakMap();
  const activeGroups = new Set();
  const cardGroupsByKey = new Map();
  const kayakInlineSlotMap = new WeakMap();
  const itaGroupsByKey = new Map();
  let modalDimScheduled = false;
  let modalDimState = false;

  let itaResultsObserver = null;
  let itaObservedRoot = null;

  let itaDetailRoot = null;
  let itaDetailHost = null;
  let itaDetailGroup = null;
  let itaDetailCopyTarget = null;
  let itaDetailEnsureTimer = null;
  let itaDetailRetryStart = 0;
  let itaDetailRetryCount = 0;
  let itaDetailHostNeedsReset = false;

  let cardResizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    cardResizeObserver = new ResizeObserver(() => {
      schedulePositionSync();
    });
  }

  // settings cache
  let SETTINGS = { bookingClass:'J', segmentStatus:'SS1', enableDirectionButtons:false, bookingClassLocked:false };
  chrome.storage.sync.get(['bookingClass','segmentStatus','enableDirectionButtons','bookingClassLocked'], (res)=>{
    if (res && res.bookingClass)  SETTINGS.bookingClass  = String(res.bookingClass || 'J').toUpperCase();
    if (res && res.segmentStatus) SETTINGS.segmentStatus = String(res.segmentStatus || 'SS1').toUpperCase();
    if (res && typeof res.bookingClassLocked === 'boolean') {
      SETTINGS.bookingClassLocked = !!res.bookingClassLocked;
    }
    if (res) {
      const storedDirections = typeof res.enableDirectionButtons === 'boolean'
        ? !!res.enableDirectionButtons
        : SETTINGS.enableDirectionButtons;
      if(storedDirections !== SETTINGS.enableDirectionButtons){
        SETTINGS.enableDirectionButtons = storedDirections;
        buttonConfigVersion++;
        refreshExistingGroups();
        scheduleItaDetailEnsure(true);
      } else {
        SETTINGS.enableDirectionButtons = storedDirections;
      }
    }
    if(!SETTINGS.bookingClassLocked){
      lastStoredAutoBookingClass = SETTINGS.bookingClass;
    }
    scheduleCabinDetection(true);
  });
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area!=='sync') return;
    if(chg.bookingClass){
      SETTINGS.bookingClass  = String(chg.bookingClass.newValue  || 'J').toUpperCase();
      if(!SETTINGS.bookingClassLocked){
        lastStoredAutoBookingClass = SETTINGS.bookingClass;
      }
    }
    if(chg.segmentStatus) SETTINGS.segmentStatus = String(chg.segmentStatus.newValue || 'SS1').toUpperCase();
    if(chg.enableDirectionButtons){
      SETTINGS.enableDirectionButtons = !!chg.enableDirectionButtons.newValue;
      buttonConfigVersion++;
      refreshExistingGroups();
      scheduleItaDetailEnsure(true);
    }
    if(chg.bookingClassLocked){
      SETTINGS.bookingClassLocked = !!chg.bookingClassLocked.newValue;
      if(!SETTINGS.bookingClassLocked){
        scheduleCabinDetection(true);
      }
    }
  });

  const isVisible = (el) => {
    if (!el) return false;
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      return false;
    }
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const opacity = parseFloat(cs.opacity || '1');
    if (Number.isFinite(opacity) && opacity <= 0.02) return false;
    if (el.getClientRects().length === 0) return false;
    return true;
  };

  function toast(msg){
    let t = document.querySelector('.kayak-copy-toast');
    if(!t){
      t = document.createElement('div');
      t.className = 'kayak-copy-toast';
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1400);
  }

  function cardLooksLikeAd(card){
    if(!card) return false;
    if(card.id === OVERLAY_ROOT_ID) return false;
    const adBadge = card.querySelector('[data-testid*="ad" i], [data-test*="ad" i], [class*="AdBadge"], [class*="ad-badge"]');
    if(adBadge){
      const txt = (adBadge.innerText || adBadge.textContent || '').trim();
      if(/\bAd\b/i.test(txt) || /Sponsored/i.test(txt)) return true;
    }
    const labelSources = [
      card.getAttribute('aria-label') || '',
      card.getAttribute('data-testid') || '',
      card.getAttribute('data-test') || ''
    ];
    if(labelSources.some(val => /\bSponsored\b/i.test(val) || /\bAd\b/i.test(val))) return true;

    const textContent = (card.innerText || '').trim();
    if(!textContent) return false;
    if(/\bSponsored\b/i.test(textContent)) return true;
    if(/(?:\||•|·)\s*Ad\b/i.test(textContent)) return true;
    return false;
  }

  function invalidateReviewHeadingCache(){
    reviewHeadingCacheTime = 0;
    reviewHeadingCacheValue = false;
  }

  function pageIndicatesReview(){
    if(IS_ITA) return false;
    const now = Date.now();
    if(reviewHeadingCacheTime && (now - reviewHeadingCacheTime) < 800){
      return reviewHeadingCacheValue;
    }
    reviewHeadingCacheTime = now;
    reviewHeadingCacheValue = false;
    try {
      const headings = document.querySelectorAll(ITA_HEADING_SELECTOR);
      let sawReview = false;
      let sawBook = false;
      let sawStepReview = false;
      let sawStepBook = false;
      for(const node of headings){
        if(!node) continue;
        const txt = (node.textContent || node.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if(!txt) continue;
        const hasReview = /\breview\b/.test(txt);
        const hasBook = /\bbook(?:ing)?\b/.test(txt);
        const hasStep = /\bstep\s*\d+\b/.test(txt);
        if(REVIEW_BOOK_SIGNATURE_RX.test(txt) || (hasReview && hasBook) || (hasStep && hasReview)){
          reviewHeadingCacheValue = true;
          break;
        }
        if(hasStep && hasBook){
          sawStepBook = true;
        }
        if(hasStep && hasReview){
          sawStepReview = true;
        }
        if(hasReview){
          sawReview = true;
        }
        if(hasBook){
          sawBook = true;
        }
      }
      if(!reviewHeadingCacheValue){
        if((sawReview && sawBook) || sawStepReview || (sawReview && sawStepBook)){
          reviewHeadingCacheValue = true;
        }
      }
    } catch (err) {
      reviewHeadingCacheValue = false;
    }
    return reviewHeadingCacheValue;
  }

  function isInKayakReviewContext(node){
    if(IS_ITA || !node) return false;
    let el = node.nodeType === 1 ? node : node.parentElement;
    let hops = 0;
    while(el && el.nodeType === 1 && hops++ < 24){
      const tokens = nodeSignatureTokens(el);
      if(tokens && tokens.length){
        const signature = tokens.join(' ').replace(/[\s\u00a0]+/g, ' ').toLowerCase();
        if(REVIEW_BOOK_SIGNATURE_RX.test(signature)){
          return true;
        }
      }
      el = el.parentElement;
    }
    return pageIndicatesReview();
  }

  function shouldIgnoreCard(card){
    if(!card) return true;
    if(card === overlayRoot) return true;
    if(!IS_ITA && isInKayakReviewContext(card)) return true;
    if(hasDisqualifyingSignature(card)) return true;
    if(card.matches){
      if(card.matches(SEARCH_LIKE_SELECTOR)) return true;
    }
    if(card.closest){
      const structural = card.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]');
      if(structural && structural !== card) return true;
      if(card.closest('[data-testid*="kayak+ai" i], [data-test*="kayak+ai" i], [data-testid*="kayak plus ai" i], [data-test*="kayak plus ai" i], [data-testid*="kayakplusai" i], [data-test*="kayakplusai" i], [data-testid*="k+ai" i], [data-test*="k+ai" i]')) return true;
      const bannerWrapper = card.closest('[data-testid*="banner" i], [data-test*="banner" i], [class*="banner" i]');
      if(bannerWrapper && bannerWrapper !== card) return true;
      const searchWrapper = card.closest(SEARCH_LIKE_SELECTOR);
      if(searchWrapper && searchWrapper !== card) return true;
    }
    if(isWithinRightRail(card)) return true;
    if(card.closest('.CRPe-main-banner-content')) return true;
    if(card.closest('.h_nb')) return true;
    const disqualifier = card.closest('[data-testid*="ad" i], [data-test*="ad" i], [data-testid*="promo" i], [data-test*="promo" i]');
    if(disqualifier) return true;
    if(cardLooksLikeAd(card)) return true;
    return false;
  }

  function getCardKey(card){
    if(!card || card.nodeType !== 1) return null;
    const stable = getStableAnchorIdentifier(card);
    if(stable){
      const stableKey = `stable:${stable}`;
      try {
        card.setAttribute(CARD_KEY_ATTR, stableKey);
      } catch (err) {
        // ignore read-only attributes
      }
      return stableKey;
    }
    let key = card.getAttribute(CARD_KEY_ATTR);
    if(!key){
      key = `k${nextCardKey++}`;
      try {
        card.setAttribute(CARD_KEY_ATTR, key);
      } catch (err) {
        // ignore inability to set attribute
      }
    }
    return key;
  }

  function cardHasFlightClues(card, selectHint, opts){
    if(!card || card.nodeType !== 1) return false;
    if(!isVisible(card)) return false;
    const txt = typeof card.innerText === 'string' ? card.innerText : '';
    if(!txt) return false;

    const timeMatches = txt.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig) || [];
    const airportMatches = txt.match(/\([A-Z]{3}\)/g) || [];
    if(timeMatches.length < 2 || airportMatches.length < 2) return false;

    if(IS_ITA) return true;

    let options;
    if(typeof opts === 'boolean'){
      options = { suppressSelectLookup: opts };
    } else {
      options = opts || {};
    }
    const suppressSelectLookup = !!options.suppressSelectLookup;
    const allowMissingSelect = !!options.allowMissingSelect;

    let selectCandidate = (typeof selectHint !== 'undefined' && selectHint && selectHint.nodeType === 1)
      ? selectHint
      : null;
    if(selectCandidate && !card.contains(selectCandidate)){
      selectCandidate = null;
    }
    if(!selectCandidate && !suppressSelectLookup){
      selectCandidate = findSelectButton(card);
      if(selectCandidate && !card.contains(selectCandidate)){
        selectCandidate = null;
      }
    }
    if(!selectCandidate){
      return allowMissingSelect;
    }
    if(!isVisible(selectCandidate)){
      return allowMissingSelect;
    }
    const rect = typeof selectCandidate.getBoundingClientRect === 'function'
      ? selectCandidate.getBoundingClientRect()
      : null;
    if(rect && (rect.width <= 0 || rect.height <= 0)){
      return allowMissingSelect;
    }
    return true;
  }

  function nodeSignatureTokens(el){
    if(!el || el.nodeType !== 1) return [];
    const tokens = [];
    const attrs = ['data-testid', 'data-test', 'data-resultid', 'data-result-id', 'data-option-id', 'data-offer-id', 'id'];
    for(const attr of attrs){
      const val = el.getAttribute ? el.getAttribute(attr) : null;
      if(val){
        tokens.push(String(val));
      }
    }
    if(el.className){
      tokens.push(typeof el.className === 'string' ? el.className : String(el.className));
    }
    return tokens;
  }

  function normalizeStableHref(href){
    if(!href) return '';
    try {
      const base = (typeof document !== 'undefined' && document.baseURI)
        ? document.baseURI
        : ((typeof location !== 'undefined' && location.href) ? location.href : 'https://www.kayak.com/');
      const url = new URL(href, base);
      return `${url.origin}${url.pathname}${url.search}`;
    } catch (err) {
      return String(href);
    }
  }

  function getStableAnchorIdentifier(node){
    if(!node || node.nodeType !== 1) return null;
    for(const attr of STABLE_CARD_ATTRS){
      const val = node.getAttribute ? node.getAttribute(attr) : null;
      if(val){
        return `${attr}:${val}`;
      }
    }
    if(node.id && /^result/i.test(node.id)){ // Kayak commonly sets id="resultXXXX"
      return `id:${node.id}`;
    }
    if(node.dataset){
      const datasetKeys = ['resultid','resultId','optionId','offerId','offerKey','resultkey'];
      for(const key of datasetKeys){
        const val = node.dataset[key];
        if(val){
          return `data-${key}:${val}`;
        }
      }
    }
    if(node.querySelector){
      const anchor = node.querySelector(STABLE_LINK_SELECTOR);
      if(anchor){
        const href = anchor.getAttribute('href');
        if(href){
          return `href:${normalizeStableHref(href)}`;
        }
      }
    }
    return null;
  }

  function findStableCardAnchor(node, selectBtn){
    if(!node || node.nodeType !== 1) return node;
    const seen = new Set();
    let current = node;
    let anchor = node;
    while(current && current.nodeType === 1 && !seen.has(current)){
      seen.add(current);
      if(selectBtn && !current.contains(selectBtn)){
        break;
      }
      if(current !== overlayRoot && !hasDisqualifyingSignature(current) && !isWithinRightRail(current) && !shouldIgnoreCard(current)){
        const identifier = getStableAnchorIdentifier(current);
        if(identifier){
          anchor = current;
          break;
        }
      }
      current = current.parentElement;
    }
    return anchor;
  }

  function hasDisqualifyingSignature(el){
    if(!el || el.nodeType !== 1) return false;
    const signature = nodeSignatureTokens(el).join(' ').replace(/\s+/g, ' ').toLowerCase();
    if(!signature) return false;
    if(/kayak\s*\+\s*ai/.test(signature) || /kayak\+ai/.test(signature) || /kayakplusai/.test(signature)) return true;
    if(/\b(right-?rail|side-?rail|rail-tile|railcard|railcard)\b/.test(signature)) return true;
    if(/\b(kayak\s*plus\s*ai|k\+ai)\b/.test(signature)) return true;
    if(/\b(ad|ads|advert|advertisement|sponsor|promo)\b/.test(signature)) return true;
    return false;
  }

  function isWithinRightRail(el){
    if(!el || !el.closest) return false;
    const rail = el.closest('[data-testid*="rail" i], [data-test*="rail" i], [class*="right-rail" i], [class*="RightRail" i], aside, [role="complementary"]');
    if(!rail) return false;
    if(rail === document.body || rail === document.documentElement) return false;
    return true;
  }

  let cachedAvoidTop = 0;
  let lastAvoidMeasure = 0;

  function measureAvoidTop(){
    const now = Date.now();
    if(now - lastAvoidMeasure < 200){
      return cachedAvoidTop;
    }
    lastAvoidMeasure = now;

    const viewWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const candidates = new Set();
    let highestZ = null;

    const addCandidate = (node) => {
      let current = node;
      let hops = 0;
      while (current && hops < 8){
        if(current === overlayRoot) return;
        if(current.closest && current.closest(`#${OVERLAY_ROOT_ID}`)) return;
        if(current === document.body || current === document.documentElement){
          break;
        }
        let cs;
        try {
          cs = getComputedStyle(current);
        } catch (err) {
          current = current.parentElement;
          hops++;
          continue;
        }
        const pos = cs.position;
        if(pos === 'fixed' || pos === 'sticky'){
          if(cs.display === 'none' || cs.visibility === 'hidden') return;
          if(parseFloat(cs.opacity || '1') === 0) return;
          candidates.add(current);
          return;
        }
        if(!current.parentElement) break;
        current = current.parentElement;
        hops++;
      }
    };

    const selectorList = [
      'header[role="banner"]',
      'header[data-testid]',
      'header',
      '[data-testid*="header" i]',
      '[data-test*="header" i]',
      '.common-header',
      '.CommonHeader',
      '.common-Header',
      '.header',
      '.Header'
    ];

    selectorList.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => addCandidate(el));
    });

    if(document.body){
      Array.from(document.body.children).forEach(el => addCandidate(el));
    }

    if(typeof document.elementsFromPoint === 'function'){
      const sampleXs = [];
      if(viewWidth > 0){
        const mid = Math.round(viewWidth / 2);
        const left = Math.round(Math.max(16, viewWidth * 0.22));
        const right = Math.round(Math.max(16, viewWidth - viewWidth * 0.22));
        sampleXs.push(mid, left, Math.min(right, viewWidth - 1));
      } else {
        sampleXs.push(0);
      }
      const sampleYs = [0, 24, 48, 72, 96, 128, 160];
      sampleYs.forEach(y => {
        sampleXs.forEach(x => {
          const clampedX = Math.max(0, Math.min(x, Math.max(viewWidth - 1, 0)));
          const clampedY = Math.max(0, Math.min(y, Math.max(viewHeight - 1, 0)));
          const elements = document.elementsFromPoint(clampedX, clampedY) || [];
          for(const el of elements){
            if(!el) continue;
            addCandidate(el);
          }
        });
      });
    }

    let maxBottom = 0;
    let searchBottom = 0;
    const considerSearchLike = (el) => {
      if(!el || !el.isConnected) return;
      if(el.closest && el.closest(`#${OVERLAY_ROOT_ID}`)) return;
      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch (err) {
        return;
      }
      if(!rect || rect.bottom <= 0) return;
      if(rect.height < 24) return;
      const maxAllowableTop = (() => {
        if(!Number.isFinite(viewHeight) || viewHeight <= 0){
          return 360;
        }
        const mid = Math.max(viewHeight * 0.5, 0);
        const cap = Math.max(viewHeight - 120, 0);
        return Math.max(200, Math.min(mid, cap));
      })();
      if(rect.top > maxAllowableTop) return;
      searchBottom = Math.max(searchBottom, rect.bottom);
    };

    candidates.forEach(el => {
      if(!el || !el.isConnected) return;
      if(el === overlayRoot) return;
      if(el.closest && el.closest(`#${OVERLAY_ROOT_ID}`)) return;
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch (err) {
        return;
      }
      if(cs.display === 'none' || cs.visibility === 'hidden') return;
      if(parseFloat(cs.opacity || '1') === 0) return;
      const zIndexRaw = cs.zIndex;
      if(zIndexRaw && zIndexRaw !== 'auto'){
        const parsed = parseInt(zIndexRaw, 10);
        if(Number.isFinite(parsed)){
          highestZ = highestZ == null ? parsed : Math.max(highestZ, parsed);
        }
      }
      const rect = el.getBoundingClientRect();
      if(!rect || rect.bottom <= 0) return;
      if(rect.top > 180) return;
      if(rect.height < 20) return;
      if(rect.width < Math.min(viewWidth, 280)) return;
      maxBottom = Math.max(maxBottom, rect.bottom);
    });

    if(SEARCH_LIKE_SELECTOR){
      try {
        document.querySelectorAll(SEARCH_LIKE_SELECTOR).forEach(considerSearchLike);
      } catch (err) {
        // ignore query issues
      }
    }

    if(searchBottom > 0){
      maxBottom = Math.max(maxBottom, searchBottom);
    }

    cachedAvoidTop = maxBottom || 0;
    const fallbackAvoid = (() => {
      if(!Number.isFinite(viewHeight) || viewHeight <= 0){
        return 96;
      }
      const scaled = Math.max(viewHeight * 0.2, 96);
      const capped = Math.min(scaled, Math.max(viewHeight - 140, 96));
      return Math.max(96, Math.round(capped));
    })();
    if(cachedAvoidTop < fallbackAvoid){
      cachedAvoidTop = fallbackAvoid;
    }
    if(highestZ != null){
      lastKnownHeaderZ = highestZ;
      const targetBase = Math.max(0, Math.min(highestZ - 2, DEFAULT_OVERLAY_BASE_Z));
      updateOverlayZIndex(targetBase);
    } else {
      lastKnownHeaderZ = null;
      updateOverlayZIndex(DEFAULT_OVERLAY_BASE_Z);
    }
    return cachedAvoidTop;
  }

  function computeGroupZIndex(cardZ){
    let target = overlayBaseZ + 1;
    if(Number.isFinite(cardZ)){
      target = Math.max(target, cardZ + 2);
    }
    if(Number.isFinite(lastKnownHeaderZ)){
      target = Math.min(target, lastKnownHeaderZ - 1);
    }
    if(!Number.isFinite(target)){
      target = overlayBaseZ + 1;
    }
    return Math.max(target, 0);
  }

  function applyGroupZIndex(group){
    if(!group || group.dataset && group.dataset.inline === '1'){
      if(group) group.style.zIndex = '';
      return;
    }
    const card = group.__kayakCard;
    let cardZ = null;
    if(card){
      try {
        const cs = getComputedStyle(card);
        if(cs && cs.zIndex && cs.zIndex !== 'auto'){
          const parsed = parseInt(cs.zIndex, 10);
          if(Number.isFinite(parsed)){
            cardZ = parsed;
          }
        }
      } catch (err) {}
    }
    group.style.zIndex = String(computeGroupZIndex(cardZ));
  }

  function updateOverlayZIndex(baseZ){
    const normalized = Number.isFinite(baseZ) ? baseZ : DEFAULT_OVERLAY_BASE_Z;
    if(normalized === overlayBaseZ) return;
    overlayBaseZ = normalized;
    if(overlayRoot){
      overlayRoot.style.zIndex = String(overlayBaseZ);
    }
    activeGroups.forEach(group => {
      applyGroupZIndex(group);
    });
  }

  function parseCabinTokens(text){
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if(!cleaned) return null;
    const lower = cleaned.toLowerCase();
    const matches = new Set();
    const hasPremiumEconomy = /premium\s+economy/.test(lower);
    if(/\bfirst\b/.test(lower)) matches.add('first');
    if(/\bbusiness\b/.test(lower)) matches.add('business');
    if(hasPremiumEconomy) matches.add('premium');
    if(!hasPremiumEconomy && /\bpremium\b/.test(lower)) matches.add('premium');
    if(!hasPremiumEconomy && (/\beconomy\b/.test(lower) || /\bcoach\b/.test(lower))) matches.add('economy');
    if(!hasPremiumEconomy && /\bbasic\s+economy\b/.test(lower)) matches.add('economy');
    if(matches.size === 0) return null;
    let cabin = null;
    for(const key of CABIN_PRIORITY){
      if(matches.has(key)){
        cabin = key;
        break;
      }
    }
    if(!cabin) return null;
    const mixed = /\bmix/i.test(lower) || /multiple\s+cabin/.test(lower) || matches.size > 1;
    const label = CABIN_LABELS[cabin] || cabin.charAt(0).toUpperCase() + cabin.slice(1);
    return { cabin, mixed, label };
  }

  function toCabinEnum(value){
    if(!value) return null;
    const normalized = String(value).trim().toLowerCase();
    if(!normalized) return null;
    return CABIN_ENUM_MAP[normalized] || null;
  }

  function detectCabinFromLocation(){
    try {
      const url = new URL(location.href);
      const raw = (url.searchParams.get('cabin') || '').toLowerCase();
      if(!raw) return null;
      const cleaned = raw.replace(/[^a-z]/g, '');
      const mapping = {
        e:'economy', ec:'economy', eco:'economy', economy:'economy', coach:'economy',
        y:'economy',
        p:'premium', pe:'premium', prem:'premium', premium:'premium', premiumeconomy:'premium',
        n:'premium',
        b:'business', bus:'business', business:'business', j:'business',
        f:'first', first:'first'
      };
      const cabin = mapping[cleaned];
      if(!cabin) return null;
      return { cabin, mixed:false, label: CABIN_LABELS[cabin], priority:1, source:'url' };
    } catch (err) {
      return null;
    }
  }

  function detectCabinFromDom(){
    if(typeof document === 'undefined' || !document.querySelectorAll) return [];
    const selectors = [
      '[data-testid*="cabin" i]',
      '[data-test*="cabin" i]',
      '[class*="Cabin" i]',
      '[class*="cabin" i]',
      '[aria-label*="cabin" i]',
      '[data-testid*="traveler" i]',
      '[data-test*="traveler" i]'
    ];
    const seenNodes = new Set();
    const seenTexts = new Set();
    const results = [];
    selectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if(!el || seenNodes.has(el)) return;
          seenNodes.add(el);
          let rect = null;
          try { rect = el.getBoundingClientRect(); } catch (err) { rect = null; }
          if(rect && rect.bottom > 520) return;
          const texts = [];
          const textContent = (el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
          if(textContent) texts.push(textContent);
          if(el.getAttribute){
            const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
            if(aria && aria !== textContent) texts.push(aria);
          }
          texts.forEach(txt => {
            const key = txt.toLowerCase();
            if(!txt || seenTexts.has(key)) return;
            const parsed = parseCabinTokens(txt);
            if(parsed){
              seenTexts.add(key);
              results.push({ cabin: parsed.cabin, mixed: parsed.mixed, label: parsed.label, priority:2, source:'dom' });
            }
          });
        });
      } catch (err) {}
    });
    return results;
  }

  function detectKayakCabinInfo(){
    if(IS_ITA) return null;
    const candidates = [];
    const fromLocation = detectCabinFromLocation();
    if(fromLocation) candidates.push(fromLocation);
    const domHints = detectCabinFromDom();
    if(domHints && domHints.length){
      candidates.push(...domHints);
    }
    if(candidates.length === 0) return null;
    candidates.sort((a, b) => {
      if(a.priority !== b.priority) return a.priority - b.priority;
      const idxA = CABIN_PRIORITY.indexOf(a.cabin);
      const idxB = CABIN_PRIORITY.indexOf(b.cabin);
      if(idxA !== idxB) return idxA - idxB;
      if(a.mixed !== b.mixed) return a.mixed ? 1 : -1;
      return (b.label || '').length - (a.label || '').length;
    });
    const best = candidates[0];
    if(!best || !best.cabin) return null;
    const cabinEnum = toCabinEnum(best.cabin);
    if(!cabinEnum) return null;
    const getPreferred = (typeof window !== 'undefined' && typeof window.getPreferredRBD === 'function')
      ? window.getPreferredRBD
      : null;
    let bookingClass = getPreferred ? getPreferred('', cabinEnum) : null;
    if(!bookingClass){
      bookingClass = CABIN_DEFAULT_BOOKING[cabinEnum] || null;
    }
    if(!bookingClass) return null;
    return {
      cabin: best.cabin,
      bookingClass: String(bookingClass).toUpperCase(),
      mixed: !!best.mixed,
      label: best.label || CABIN_LABELS[best.cabin] || '',
      source: best.source || 'dom'
    };
  }

  function applyDetectedCabin(info){
    if(!info || SETTINGS.bookingClassLocked) return;
    const changedBooking = info.bookingClass && info.bookingClass !== SETTINGS.bookingClass;
    const changedMixed = info.mixed !== cabinDetectionState.mixed;
    const changedCabin = info.cabin !== cabinDetectionState.cabin;
    const changedLabel = (info.label || '') !== (cabinDetectionState.label || '');
    if(!changedBooking && !changedMixed && !changedCabin && !changedLabel){
      return;
    }
    cabinDetectionState = {
      cabin: info.cabin,
      bookingClass: info.bookingClass,
      mixed: !!info.mixed,
      label: info.label || '',
      source: info.source || 'dom'
    };
    if(changedBooking){
      SETTINGS.bookingClass = info.bookingClass;
    }
    if(changedBooking || changedMixed || changedCabin){
      buttonConfigVersion++;
      refreshExistingGroups();
    } else if(changedLabel){
      refreshExistingGroups();
    }
    if(changedBooking && info.bookingClass !== lastStoredAutoBookingClass){
      lastStoredAutoBookingClass = info.bookingClass;
      try {
        chrome.storage.sync.set({ bookingClass: info.bookingClass, bookingClassLocked: false }, () => {});
      } catch (err) {}
    }
  }

  function runCabinDetection(){
    if(IS_ITA || SETTINGS.bookingClassLocked) return;
    const detected = detectKayakCabinInfo();
    if(detected){
      applyDetectedCabin(detected);
    }
  }

  function scheduleCabinDetection(immediate){
    if(IS_ITA || SETTINGS.bookingClassLocked) return;
    if(immediate){
      cabinDetectionScheduled = false;
      runCabinDetection();
      return;
    }
    if(cabinDetectionScheduled) return;
    cabinDetectionScheduled = true;
    requestAnimationFrame(() => {
      cabinDetectionScheduled = false;
      runCabinDetection();
    });
  }

  function computeButtonConfigsForCard(card){
    const baseConfig = {
      key: 'all',
      label: '*I',
      title: 'Copy itinerary option details',
      ariaLabel: 'Copy itinerary option details to clipboard',
      direction: 'all',
      copyKind: 'itinerary'
    };

    let rawText = '';
    let preview = null;
    if(card){
      try {
        rawText = extractVisibleText(card);
      } catch (err) {
        console.warn('Failed to extract itinerary text for preview:', err);
      }
      if(rawText && typeof window.peekSegments === 'function'){
        try {
          preview = window.peekSegments(rawText);
        } catch (err) {
          console.warn('peekSegments failed:', err);
        }
      }
    }

    const configs = [ Object.assign({}, baseConfig) ];
    const journeys = preview && Array.isArray(preview.journeys) ? preview.journeys : [];
    const segments = preview && Array.isArray(preview.segments) ? preview.segments : [];
    const multiCity = !!(preview && preview.isMultiCity && journeys.length > 0);
    const showJourneyButtons = multiCity && SETTINGS.enableDirectionButtons;

    const journeySignatureParts = [];
    if(showJourneyButtons){
      journeys.forEach((journey, idx) => {
        const start = typeof journey.startIdx === 'number' ? journey.startIdx : 0;
        const end = typeof journey.endIdx === 'number' ? journey.endIdx : start;
        if(end < start || !segments[start] || !segments[Math.min(end, segments.length - 1)]){
          return;
        }
        const origin = journey.origin || (segments[start] ? segments[start].depAirport : '');
        const dest = journey.dest || (segments[end] ? segments[end].arrAirport : '');
        const indexHint = journey.indexHint != null && Number.isFinite(journey.indexHint)
          ? journey.indexHint
          : (idx + 1);
        const labelSuffix = (origin && dest)
          ? `${origin}-${dest}`
          : `Segments ${start + 1}-${end + 1}`;
        const label = `${indexHint} ${labelSuffix}`.trim();
        const ariaLabel = origin && dest
          ? `Copy journey ${indexHint} from ${origin} to ${dest}`
          : `Copy journey ${indexHint}`;
        configs.push({
          key: `journey-${indexHint}-${start}-${end}`,
          label,
          title: ariaLabel,
          ariaLabel,
          direction: 'all',
          segmentRange: [start, end],
          journeyIndex: idx,
          variant: 'journey',
          copyKind: 'availability'
        });
        journeySignatureParts.push(`${start}-${end}-${origin || ''}-${dest || ''}-${indexHint}`);
      });
    } else if(SETTINGS.enableDirectionButtons && (!multiCity || IS_ITA)){
      configs.push({
        key: 'ob',
        label: 'OB',
        title: 'Copy outbound segments',
        ariaLabel: 'Copy outbound segments to clipboard',
        direction: 'outbound',
        copyKind: 'availability'
      });
      configs.push({
        key: 'ib',
        label: 'IB',
        title: 'Copy inbound segments',
        ariaLabel: 'Copy inbound segments to clipboard',
        direction: 'inbound',
        copyKind: 'availability'
      });
    }

    let effectiveConfigs = configs;
    let effectiveShowJourneyButtons = showJourneyButtons;

    if(!SETTINGS.enableDirectionButtons){
      effectiveConfigs = configs.filter(cfg => cfg && cfg.copyKind !== 'availability');
      if(!effectiveConfigs.length && configs.length){
        effectiveConfigs = [ configs[0] ];
      }
      effectiveShowJourneyButtons = false;
    }

    const signaturePieces = [
      effectiveShowJourneyButtons ? 'multi' : 'simple',
      journeySignatureParts.join('|'),
      String(effectiveConfigs.length)
    ];
    if(segments.length){
      const segmentSignature = segments.map(seg => {
        if(!seg) return '';
        const carrier = (seg.airlineCode || '').toUpperCase();
        const number = seg.number || '';
        const dep = seg.depAirport || '';
        const arr = seg.arrAirport || '';
        const depDate = seg.depDate || '';
        return `${carrier}-${number}-${dep}-${arr}-${depDate}`;
      }).join('|');
      signaturePieces.push(segmentSignature);
    }

    return {
      configs: effectiveConfigs,
      signature: signaturePieces.join('::'),
      preview,
      showJourneyButtons: effectiveShowJourneyButtons
    };
  }

  function markButtonCopied(btn){
    if(!btn) return;
    btn.classList.add('is-copied');
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      btn.classList.remove('is-copied');
    }, 1400);
  }

  function createButton(card, config){
    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    if (IS_ITA){
      btn.classList.add('kayak-copy-btn--ita');
    }
    if(config && config.variant === 'journey'){
      btn.classList.add('kayak-copy-btn--journey');
    }
    btn.type = 'button';
    btn.title = config.title;
    btn.setAttribute('aria-label', config.ariaLabel);
    btn.dataset.direction = config.direction;
    btn.innerHTML = '<span aria-hidden="true" class="pill pill-text">' + config.label + '</span>' +
                    '<span aria-hidden="true" class="pill pill-check">✓</span>';

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if(btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      try{
        const raw = extractVisibleText(card);
        if(!raw || !raw.trim()){
          throw new Error('No itinerary details found');
        }
        const baseOpts = {
          bookingClass: SETTINGS.bookingClass,
          segmentStatus: SETTINGS.segmentStatus
        };
        if(!SETTINGS.bookingClassLocked && cabinDetectionState && cabinDetectionState.cabin){
          const detectedEnum = toCabinEnum(cabinDetectionState.cabin);
          if(detectedEnum){
            baseOpts.autoCabin = detectedEnum;
          }
        }
        const direction = config.direction || 'all';
        const copyKind = config.copyKind || (direction === 'all' ? 'itinerary' : 'availability');
        let converted;
        try {
          if(copyKind === 'itinerary'){
            const convertOpts = Object.assign({}, baseOpts);
            if(Array.isArray(config.segmentRange) && config.segmentRange.length === 2){
              convertOpts.segmentRange = [
                Number(config.segmentRange[0]),
                Number(config.segmentRange[1])
              ];
            }
            if(typeof config.journeyIndex === 'number'){
              convertOpts.journeyIndex = config.journeyIndex;
            }
            converted = window.convertTextToI(raw, convertOpts);
          }else{
            const availOpts = { direction };
            if(Array.isArray(config.segmentRange) && config.segmentRange.length === 2){
              availOpts.segmentRange = [
                Number(config.segmentRange[0]),
                Number(config.segmentRange[1])
              ];
            }
            if(typeof config.journeyIndex === 'number'){
              availOpts.journeyIndex = config.journeyIndex;
            }
            converted = window.convertTextToAvailability(raw, availOpts);
          }
        } catch (parseErr) {
          console.error('Conversion failed:', parseErr);
          if (parseErr && /No segments parsed/i.test(parseErr.message || '') && raw) {
            console.warn('Raw itinerary text (conversion debug):', raw);
            try {
              const times = (raw.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig) || []).slice(0, 10);
              const airports = (raw.match(/\([A-Z]{3}\)/g) || []).slice(0, 10);
              const previewTokens = times.concat(airports).slice(0, 20);
              if(previewTokens.length){
                console.warn('Token preview:', previewTokens.join(' | '));
              }
            } catch (previewErr) {
              console.warn('Token preview generation failed:', previewErr);
            }
          }
          throw new Error(parseErr?.message || 'Conversion failed');
        }

        await navigator.clipboard.writeText(converted);
        markButtonCopied(btn);
        if (typeof config.onSuccess === 'function') {
          try {
            config.onSuccess({ text: converted, button: btn, source: card });
          } catch (hookErr) {
            console.error('Success handler failed:', hookErr);
          }
        } else if (config.successMessage) {
          toast(config.successMessage);
        }
      }catch(err){
        console.error('Copy option failed:', err);
        toast(err?.message || 'Copy failed');
      }finally{
        delete btn.dataset.busy;
      }
    });

    return btn;
  }

  function buildGroupForCard(card, group, configData){
    if(!group) return;
    const data = configData || computeButtonConfigsForCard(card);
    const inlineMode = group.dataset.inline === '1';
    const showMulti = !!(data && data.showJourneyButtons);
    group.classList.toggle('kayak-copy-btn-group--ita', inlineMode);
    group.classList.toggle('kayak-copy-btn-group--multi', showMulti);
    if(showMulti){
      group.dataset.multi = '1';
    } else {
      delete group.dataset.multi;
    }
    if(!data || !Array.isArray(data.configs) || data.configs.length === 0){
      group.innerHTML = '';
      delete group.dataset.configVersion;
      return;
    }
    const versionKey = `${buttonConfigVersion}:${data.signature || 'default'}`;
    if(group.dataset.configVersion === versionKey && group.childElementCount === data.configs.length){
      return;
    }
    group.innerHTML = '';
    if(!IS_ITA && cabinDetectionState && cabinDetectionState.mixed){
      const hint = document.createElement('span');
      hint.className = 'kayak-copy-cabin-hint';
      hint.textContent = 'Mixed cabin';
      hint.title = cabinDetectionState.label ? `${cabinDetectionState.label} (mixed cabins)` : 'Mixed cabin detected';
      group.appendChild(hint);
    }
    data.configs.forEach(cfg => {
      group.appendChild(createButton(card, cfg));
    });
    group.dataset.configVersion = versionKey;
  }

  function getInlineHostPaddingInfo(host){
    if (!host || typeof host !== 'object') return null;
    let info = host.__kayakCopyInlinePaddingInfo;
    if (!info){
      info = {
        originalPaddingTop: host.style ? host.style.paddingTop || '' : '',
        basePaddingTop: null,
        appliedPaddingTop: null
      };
      host.__kayakCopyInlinePaddingInfo = info;
    }
    return info;
  }

  function ensureInlineHostPadding(host, group, needsExtraSpace){
    if (!IS_ITA || !host || !group) return;
    const info = getInlineHostPaddingInfo(host);
    if (!info) return;

    if (info.basePaddingTop == null){
      try {
        const computed = getComputedStyle(host);
        if (computed){
          const parsed = parseFloat(computed.paddingTop);
          info.basePaddingTop = Number.isFinite(parsed) ? parsed : 0;
        } else {
          info.basePaddingTop = 0;
        }
      } catch (err) {
        info.basePaddingTop = 0;
      }
    }

    if (!needsExtraSpace){
      if (info.appliedPaddingTop != null){
        host.style.paddingTop = info.originalPaddingTop || '';
        info.appliedPaddingTop = null;
      }
      return;
    }

    let topOffset = 12;
    try {
      const groupStyles = getComputedStyle(group);
      if (groupStyles){
        const parsedTop = parseFloat(groupStyles.top);
        if (Number.isFinite(parsedTop)){
          topOffset = parsedTop;
        }
      }
    } catch (err) {
      // ignore measurement errors
    }

    let groupHeight = 0;
    try {
      const rect = group.getBoundingClientRect();
      if (rect && Number.isFinite(rect.height)){
        groupHeight = rect.height;
      }
    } catch (err) {
      groupHeight = 0;
    }
    if (!groupHeight){
      groupHeight = group.offsetHeight || 0;
    }

    const basePadding = info.basePaddingTop || 0;
    const desiredPadding = Math.max(basePadding, Math.ceil(topOffset + groupHeight + 8));
    if (!Number.isFinite(desiredPadding)){
      return;
    }

    if (desiredPadding <= basePadding + 0.5){
      if (info.appliedPaddingTop != null){
        host.style.paddingTop = info.originalPaddingTop || '';
        info.appliedPaddingTop = null;
      }
      return;
    }

    if (info.appliedPaddingTop !== null && Math.abs(info.appliedPaddingTop - desiredPadding) < 0.5){
      return;
    }

    host.style.paddingTop = `${desiredPadding}px`;
    info.appliedPaddingTop = desiredPadding;
  }

  function resetInlineHostPadding(host){
    if (!host) return;
    const info = host.__kayakCopyInlinePaddingInfo;
    if (!info) return;
    if (info.appliedPaddingTop != null){
      host.style.paddingTop = info.originalPaddingTop || '';
      info.appliedPaddingTop = null;
    }
    delete host.__kayakCopyInlinePaddingInfo;
  }

  function ensureOverlayRoot(){
    if (overlayRoot && overlayRoot.isConnected) return overlayRoot;
    const existing = document.getElementById(OVERLAY_ROOT_ID);
    if (existing) {
      overlayRoot = existing;
    }
    if (!overlayRoot || !overlayRoot.isConnected) {
      overlayRoot = document.createElement('div');
      overlayRoot.id = OVERLAY_ROOT_ID;
      overlayRoot.setAttribute('aria-hidden', 'true');
      overlayRoot.style.position = 'fixed';
      overlayRoot.style.inset = '0';
      overlayRoot.style.pointerEvents = 'none';
      overlayRoot.style.zIndex = String(overlayBaseZ);
    }
    const host = document.body || document.documentElement;
    if (host && overlayRoot.parentNode !== host) {
      host.appendChild(overlayRoot);
    }
    return overlayRoot;
  }

  function looksLikeModalCandidate(node){
    if(!node || node.nodeType !== 1) return false;
    let rect = null;
    try {
      rect = node.getBoundingClientRect();
    } catch (err) {
      rect = null;
    }
    if(!rect || rect.width <= 0 || rect.height <= 0) return false;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if(viewWidth <= 0 || viewHeight <= 0) return false;
    const area = rect.width * rect.height;
    const viewArea = viewWidth * viewHeight;
    if(!Number.isFinite(area) || !Number.isFinite(viewArea) || viewArea <= 0) return false;
    const areaRatio = area / viewArea;
    const widthRatio = rect.width / viewWidth;
    const heightRatio = rect.height / viewHeight;
    if(areaRatio < 0.18 && (widthRatio < 0.32 || heightRatio < 0.32)) return false;
    let cs;
    try {
      cs = getComputedStyle(node);
    } catch (err) {
      cs = null;
    }
    if(!cs) return false;
    if(cs.display === 'none' || cs.visibility === 'hidden') return false;
    const opacity = parseFloat(cs.opacity || '1');
    if(Number.isFinite(opacity) && opacity <= 0.02) return false;
    const pos = cs.position || '';
    if(pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') return false;
    return true;
  }

  function hasVisibleModal(){
    if(!IS_KAYAK) return false;
    const selectors = [
      '[aria-modal="true"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[data-testid*="modal" i]',
      '[data-test*="modal" i]',
      '[data-testid*="dialog" i]',
      '[data-test*="dialog" i]',
      '[id*="modal" i]'
    ];
    const nodes = document.querySelectorAll(selectors.join(','));
    for(const node of nodes){
      if(!node || node.nodeType !== 1) continue;
      if(node.closest && node.closest(`#${OVERLAY_ROOT_ID}`)) continue;
      if(!isVisible(node)) continue;
      if(!looksLikeModalCandidate(node)) continue;
      return true;
    }
    return false;
  }

  function updateModalDimState(){
    if(!IS_KAYAK) return;
    const shouldDim = hasVisibleModal();
    if(shouldDim === modalDimState) return;
    modalDimState = shouldDim;
    const host = document.documentElement || document.body;
    if(!host) return;
    if(shouldDim){
      host.classList.add(MODAL_DIM_CLASS);
    } else {
      host.classList.remove(MODAL_DIM_CLASS);
    }
  }

  function scheduleModalDimUpdate(){
    if(modalDimScheduled) return;
    modalDimScheduled = true;
    const fn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    fn(() => {
      modalDimScheduled = false;
      updateModalDimState();
    });
  }

  function registerGroup(card, group){
    if (!group) return;
    group.__kayakCard = card;
    const key = getCardKey(card);
    if(key){
      group.__kayakCardKey = key;
      const existing = cardGroupsByKey.get(key);
      if(existing && existing !== group){
        hardRemoveGroup(existing);
      }
      cardGroupsByKey.set(key, group);
    } else {
      delete group.__kayakCardKey;
    }
    activeGroups.add(group);
    applyGroupZIndex(group);
    if (cardResizeObserver && card) {
      try {
        cardResizeObserver.observe(card);
      } catch (err) {
        // ignore duplicate observe errors
      }
    }
  }

  function unregisterGroup(group){
    if (!group) return;
    const card = group.__kayakCard;
    if (cardResizeObserver && card) {
      try {
        cardResizeObserver.unobserve(card);
      } catch (err) {
        // ignore
      }
    }
    activeGroups.delete(group);
    const key = group.__kayakCardKey;
    if(key && cardGroupsByKey.get(key) === group){
      cardGroupsByKey.delete(key);
    }
    delete group.__kayakCard;
    delete group.__kayakCardKey;
  }

  function clamp(value, min, max){
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function positionGroup(card, group){
    if (!card || !group) return;
    if (!isVisible(card)){
      group.style.display = 'none';
      group.style.visibility = 'hidden';
      return;
    }
    const rect = card.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      group.style.display = 'none';
      group.style.visibility = 'hidden';
      return;
    }

    group.style.display = 'flex';
    group.style.visibility = 'hidden';
    group.style.top = '0px';
    group.style.left = '0px';

    const groupRect = group.getBoundingClientRect();
    const viewWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const avoidTop = measureAvoidTop();
    if(rect.bottom <= avoidTop + 4 || rect.top >= viewHeight){
      group.style.display = 'none';
      group.style.visibility = 'hidden';
      return;
    }
    const maxTop = Math.max(avoidTop + 4, viewHeight - groupRect.height - 4);
    const desiredTop = rect.top + 10;
    const top = clamp(Math.max(desiredTop, avoidTop + 8), avoidTop + 4, maxTop);
    const rawRight = Math.max(4, viewWidth - rect.right + 10);
    const maxRight = Math.max(4, viewWidth - groupRect.width - 4);
    const right = clamp(rawRight, 4, maxRight);

    group.style.top = `${Math.round(top)}px`;
    group.style.left = 'auto';
    group.style.right = `${Math.round(right)}px`;
    group.style.visibility = 'visible';
  }

  function syncPositions(){
    if (activeGroups.size === 0) return;
    let overlayRootRef = null;
    activeGroups.forEach(group => {
      const card = group.__kayakCard;
      if (!card) {
        unregisterGroup(group);
        if (group.parentNode) group.remove();
        return;
      }
      if (!card.isConnected) {
        removeCardButton(card);
        return;
      }

      const inlineMode = group.dataset.inline === '1';
      if (inlineMode){
        if (shouldIgnoreCard(card)){
          removeCardButton(card);
          return;
        }
        if (!group.parentNode || !group.parentNode.isConnected){
          removeCardButton(card);
          return;
        }
        if (!isVisible(card)){
          group.style.display = 'none';
          group.style.visibility = 'hidden';
          return;
        }
        group.style.display = 'flex';
        group.style.visibility = 'visible';
        return;
      }

      overlayRootRef = overlayRootRef || ensureOverlayRoot();
      if (!overlayRootRef){
        return;
      }
      if (shouldIgnoreCard(card)) {
        removeCardButton(card);
        return;
      }
      if (group.parentNode !== overlayRootRef) {
        overlayRootRef.appendChild(group);
      }
      if (!isVisible(card)) {
        group.style.display = 'none';
        group.style.visibility = 'hidden';
        return;
      }
      positionGroup(card, group);
    });
  }

  function schedulePositionSync(){
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => {
      syncScheduled = false;
      syncPositions();
    });
  }

  window.addEventListener('scroll', schedulePositionSync, true);
  document.addEventListener('scroll', schedulePositionSync, true);
  window.addEventListener('resize', schedulePositionSync, true);
  window.addEventListener('orientationchange', schedulePositionSync);

  function refreshExistingGroups(){
    activeGroups.forEach(group => {
      const card = group.__kayakCard;
      if (!card) {
        unregisterGroup(group);
        if (group.parentNode) group.remove();
        return;
      }
      if (!card.isConnected || shouldIgnoreCard(card)){
        removeCardButton(card);
        return;
      }
      buildGroupForCard(card, group);
    });
    schedulePositionSync();
  }

  function getItaSummaryRowFromDetail(detailRow){
    if (!detailRow || !detailRow.previousElementSibling) return null;
    let prev = detailRow.previousElementSibling;
    while (prev) {
      if (prev.classList && prev.classList.contains('row')) {
        return prev;
      }
      prev = prev.previousElementSibling;
    }
    return null;
  }

  function getItaDetailRowFromSummary(summaryRow){
    if (!summaryRow) return null;
    let next = summaryRow.nextElementSibling;
    while (next) {
      if (next.classList && next.classList.contains('detail-row')) {
        return next;
      }
      if (next.classList && next.classList.contains('row')) {
        break;
      }
      next = next.nextElementSibling;
    }
    return null;
  }

  function isItaDetailVisible(summaryRow, detailRow){
    if (!summaryRow || !detailRow) return false;
    if (!summaryRow.classList || !summaryRow.classList.contains('expanded-row')) return false;
    if (!isVisible(detailRow)) return false;
    const expander = detailRow.querySelector && detailRow.querySelector('.detail-expander');
    if (expander) {
      const style = (expander.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
      if (style) {
        const zeroHeight = /height:0px/.test(style);
        const zeroMin = /min-height:0px/.test(style);
        if (zeroHeight && zeroMin) {
          return false;
        }
      }
    }
    return true;
  }

  function getItaDetailCell(node, allowCollapsed = false){
    if (!IS_ITA || !node) return null;
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.nodeType === 1 && el.tagName !== 'TR' && el.tagName !== 'TD') {
      el = el.parentElement;
    }
    if (!el) return null;
    if (el.closest) {
      const detailRow = el.closest('tr.detail-row');
      if (detailRow) {
        const td = detailRow.querySelector('td');
        if (td) return td;
      }
    }
    const summaryRow = el.closest ? el.closest('tr.row') : null;
    if (summaryRow) {
      const detailRow = getItaDetailRowFromSummary(summaryRow);
      if (detailRow) {
        const td = detailRow.querySelector('td');
        if (td && (allowCollapsed || isItaDetailVisible(summaryRow, detailRow))) {
          return td;
        }
      }
    }
    return null;
  }

  function getItaItineraryKey(summaryRow, detailRow){
    if (!summaryRow && detailRow) {
      summaryRow = getItaSummaryRowFromDetail(detailRow);
    }
    if (!summaryRow) return '';
    const attrSources = [
      summaryRow.getAttribute && summaryRow.getAttribute('data-itinerary-id'),
      summaryRow.getAttribute && summaryRow.getAttribute('data-result-id'),
      summaryRow.getAttribute && summaryRow.getAttribute('id')
    ];
    for (const val of attrSources) {
      if (val) return val;
    }
    if (summaryRow.querySelector) {
      const priceLink = summaryRow.querySelector('a[href*="/itinerary"]');
      if (priceLink) {
        const href = priceLink.getAttribute('href');
        if (href) return href;
      }
    }
    if (detailRow && detailRow.id) {
      return detailRow.id;
    }
    const parent = summaryRow.parentElement;
    if (parent) {
      const rows = Array.from(parent.children).filter(el => el.classList && el.classList.contains('row'));
      const idx = rows.indexOf(summaryRow);
      if (idx >= 0) {
        return `row-index:${idx}`;
      }
    }
    return '';
  }

  function ensureItaResultsObserver(card){
    if (!IS_ITA || !card || !card.closest) return;
    const table = card.closest('table');
    if (!table) return;
    if (itaObservedRoot && itaObservedRoot !== table) {
      cleanupItaGroups(true);
      if (itaResultsObserver) {
        try { itaResultsObserver.disconnect(); } catch (err) {}
      }
      itaObservedRoot = null;
    }
    if (!itaResultsObserver) {
      itaResultsObserver = new MutationObserver((muts) => {
        const forceClear = !itaObservedRoot || !itaObservedRoot.isConnected;
        let needsCleanup = forceClear;
        if (!needsCleanup) {
          for (const m of muts) {
            if (m.type === 'childList' && ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length))) {
              needsCleanup = true;
              break;
            }
          }
        }
        if (needsCleanup) {
          cleanupItaGroups(forceClear);
        }
      });
    }
    if (itaObservedRoot !== table) {
      if (itaResultsObserver) {
        try { itaResultsObserver.disconnect(); } catch (err) {}
      }
      itaObservedRoot = table;
      try {
        itaResultsObserver.observe(table, { childList: true, subtree: true });
      } catch (err) {
        // ignore observer errors
      }
    }
  }

  function hardRemoveGroup(group){
    if (!group) return;
    const card = group.__kayakCard;
    if (card && cardGroupMap.get(card) === group){
      cardGroupMap.delete(card);
    }
    if (card){
      const cardKey = card.getAttribute ? card.getAttribute(CARD_KEY_ATTR) : null;
      if (cardKey && cardGroupsByKey.get(cardKey) === group){
        cardGroupsByKey.delete(cardKey);
      }
    }
    const host = group.__inlineHost;
    let ownedSlot = null;
    if (host && host.classList){
      if(host.classList.contains('kayak-copy-inline-slot')){
        ownedSlot = host;
      }
      host.classList.remove('kayak-copy-inline-host');
      resetInlineHostPadding(host);
    }
    delete group.__inlineHost;
    const key = group.dataset && group.dataset.itaKey;
    if (key && itaGroupsByKey.get(key) === group){
      itaGroupsByKey.delete(key);
    }
    unregisterGroup(group);
    if (group.parentNode){
      group.remove();
    }
    if(ownedSlot){
      if(card && kayakInlineSlotMap.get(card) === ownedSlot){
        kayakInlineSlotMap.delete(card);
      }
      if(ownedSlot.isConnected && !ownedSlot.childElementCount){
        ownedSlot.remove();
      }
    }
    schedulePositionSync();
  }

  function cleanupItaGroups(force = false){
    if (!IS_ITA) return;
    const snapshot = Array.from(activeGroups);
    const survivors = [];
    snapshot.forEach(group => {
      if (!group || group.dataset.inline !== '1' || !group.classList.contains('kayak-copy-btn-group--ita')) {
        return;
      }
      const card = group.__kayakCard;
      const host = group.__inlineHost;
      const detailRow = group.__kayakDetailRow || (card && card.closest ? card.closest('tr.detail-row') : null);
      const summaryRow = group.__kayakSummaryRow || (detailRow ? getItaSummaryRowFromDetail(detailRow) : null);
      const stillValid = !force && host && host.isConnected && card && card.isConnected && detailRow && detailRow.isConnected && summaryRow && summaryRow.isConnected && isItaDetailVisible(summaryRow, detailRow);
      if (stillValid) {
        survivors.push(group);
        return;
      }
      hardRemoveGroup(group);
    });
    if (force) {
      itaGroupsByKey.clear();
      return;
    }
    const seenKeys = new Map();
    survivors.forEach(group => {
      const key = group.dataset && group.dataset.itaKey;
      if (!key) return;
      const existing = seenKeys.get(key);
      if (!existing) {
        seenKeys.set(key, group);
        return;
      }
      if (existing === group) return;
      hardRemoveGroup(existing);
      seenKeys.set(key, group);
    });
  }

  /* ---------- Card + header detection ---------- */

  function looksLikeItaExpandedCard(el){
    if(!el || el.nodeType !== 1) return false;
    let target = el;
    if(target.tagName === 'TR'){
      const cell = target.querySelector('td');
      if(cell) target = cell;
    }
    if(!target || target.nodeType !== 1 || !isVisible(target)) return false;
    const rect = target.getBoundingClientRect();
    if (!rect || rect.height < 80 || rect.width < 260) return false;
    const txt = (target.innerText || '').trim();
    if(!txt) return false;
    if(!/\([A-Z]{3}\)/.test(txt)) return false;
    if(!/\bto\b/i.test(txt)) return false;
    const airportMatches = txt.match(/\([A-Z]{3}\)/g) || [];
    if(airportMatches.length < 2) return false;
    const flightMatches = txt.match(/\b[A-Z]{1,3}\s?\d{1,4}\b/g) || [];
    if(flightMatches.length === 0) return false;
    return true;
  }

  function normalizeItaCard(el, opts){
    if(!IS_ITA || !el) return el;
    const allowCollapsed = opts && opts.allowCollapsed;
    const detailCell = getItaDetailCell(el, !!allowCollapsed);
    if(detailCell) return detailCell;
    if(el.tagName === 'TD') return el;
    if(el.tagName === 'TR'){
      const cell = el.querySelector('td');
      if(cell) return cell;
    }
    if(el.closest){
      const closestCell = el.closest('td');
      if(closestCell) return closestCell;
    }
    if(el.querySelector){
      const nestedCell = el.querySelector('td');
      if(nestedCell) return nestedCell;
    }
    return el;
  }

  function scoreKayakCardNode(node, selectBtn, depth){
    if(!node || node.nodeType !== 1) return -Infinity;
    if(selectBtn && node.nodeType === 1 && !node.contains(selectBtn)) return -Infinity;
    if(node === document.body || node === document.documentElement) return -Infinity;
    if(node.id === OVERLAY_ROOT_ID) return -Infinity;
    if(hasDisqualifyingSignature(node)) return -Infinity;
    if(isWithinRightRail(node)) return -Infinity;

    let score = 0;
    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    if(rect){
      const width = rect.width || 0;
      const height = rect.height || 0;
      if(width < 220 || height < 140){
        return -Infinity;
      }
      score += Math.min(width, 1200) * 0.12;
      score += Math.min(height, 900) * 0.1;
    } else {
      score -= 20;
    }

    const signature = nodeSignatureTokens(node).join(' ').toLowerCase();
    if(signature){
      if(/\b(result|option|card|flight|journey|trip|offer|itinerary|item|ticket|listing)\b/.test(signature)){
        score += 140;
      }
      if(/\b(detail|expanded|selected)\b/.test(signature)){
        score += 30;
      }
      if(/\b(list|results|container|scroll)\b/.test(signature)){
        score -= 40;
      }
      if(/\b(module|grid|wrapper)\b/.test(signature)){
        score -= 10;
      }
    }

    if(node.hasAttribute && (node.hasAttribute('data-resultid') || node.hasAttribute('data-result-id'))){
      score += 180;
    }
    if(node.hasAttribute && (node.hasAttribute('data-option-id') || node.hasAttribute('data-offer-id'))){
      score += 120;
    }
    if(node.hasAttribute && (node.hasAttribute('data-testid') || node.hasAttribute('data-test'))){
      score += 30;
    }

    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if(tag === 'article') score += 40;
    if(tag === 'li') score += 28;
    if(tag === 'section') score += 18;
    if(tag === 'ul' || tag === 'ol') score -= 80;
    if(tag === 'main') score -= 100;

    if(selectBtn){
      try {
        const selectCount = node.querySelectorAll('button[data-testid*="select" i], button[data-test*="select" i], button[aria-label*="Select" i], a[role="button"][data-testid*="select" i], a[role="button"][data-test*="select" i]').length;
        if(selectCount > 1){
          score -= Math.min(220, (selectCount - 1) * 90);
        }
      } catch (err) {
        // ignore query issues
      }
    }

    score -= depth * 18;
    return score;
  }

  function normalizeKayakCard(el){
    if(IS_ITA || !el || el.nodeType !== 1) return el;
    if(el.closest && el.closest(`#${OVERLAY_ROOT_ID}`)) return null;

    const selectBtn = findSelectButton(el);
    let allowMissingSelect = false;
    if(selectBtn && !isVisible(selectBtn)){
      allowMissingSelect = true;
    }
    if(!selectBtn){
      let baseRect = null;
      try {
        baseRect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      } catch (err) {
        baseRect = null;
      }
      if(!baseRect || baseRect.width < 160 || baseRect.height < 260){
        return null;
      }
      if(!cardHasFlightClues(el, null, { suppressSelectLookup: true, allowMissingSelect: true })){
        return null;
      }
      allowMissingSelect = true;
    }

    const candidates = [];
    let current = el;
    let depth = 0;
    while(current && depth <= MAX_CLIMB){
      if(current.nodeType === 1 && (!selectBtn || current.contains(selectBtn))){
        candidates.push({ node: current, depth });
      }
      current = current.parentElement;
      depth++;
    }

    let bestEntry = null;
    let bestScore = -Infinity;
    for(const entry of candidates){
      const node = entry.node;
      if(node === document.body || node === document.documentElement) continue;
      if(node.id === OVERLAY_ROOT_ID) continue;
      if(hasDisqualifyingSignature(node)) continue;
      if(isWithinRightRail(node)) continue;
      if(shouldIgnoreCard(node)) continue;
      if(!cardHasFlightClues(node, selectBtn, { suppressSelectLookup: true, allowMissingSelect })) continue;
      const score = scoreKayakCardNode(node, selectBtn, entry.depth);
      if(score > bestScore){
        bestScore = score;
        bestEntry = entry;
      }
    }

    if(!bestEntry){
      return null;
    }

    const anchor = findStableCardAnchor(bestEntry.node, selectBtn);
    if(anchor && anchor !== bestEntry.node){
      if(!cardHasFlightClues(anchor, selectBtn, { suppressSelectLookup: true, allowMissingSelect })){
        getCardKey(bestEntry.node);
        return bestEntry.node;
      }
      if(!isVisible(anchor)){
        getCardKey(bestEntry.node);
        return bestEntry.node;
      }
      const rect = typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null;
      if(rect && (rect.width < 220 || rect.height < 140)){
        getCardKey(bestEntry.node);
        return bestEntry.node;
      }
      getCardKey(anchor);
      return anchor;
    }

    getCardKey(bestEntry.node);
    return bestEntry.node;
  }

  function normalizeCard(el, opts){
    if(IS_ITA){
      return normalizeItaCard(el, opts);
    }
    return normalizeKayakCard(el);
  }

  function scoreKayakDetailCandidate(node, card, selectBtn, cardRect){
    if(!node || node === card || node.nodeType !== 1) return Number.NEGATIVE_INFINITY;
    if(node.closest && node.closest(`#${OVERLAY_ROOT_ID}`)) return Number.NEGATIVE_INFINITY;
    if(node.classList && node.classList.contains('kayak-copy-inline-slot')) return Number.NEGATIVE_INFINITY;
    if(selectBtn && node.contains && node.contains(selectBtn)) return Number.NEGATIVE_INFINITY;
    if(node.querySelector && node.querySelector(`.${BTN_CLASS}`)) return Number.NEGATIVE_INFINITY;
    if(!isVisible(node)) return Number.NEGATIVE_INFINITY;

    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    if(rect){
      if(rect.height < 60 || rect.width < 200) return Number.NEGATIVE_INFINITY;
    }

    let rawText = '';
    try {
      rawText = typeof node.innerText === 'string' ? node.innerText : '';
    } catch (err) {
      rawText = '';
    }
    if(!rawText) return Number.NEGATIVE_INFINITY;
    const normalized = rawText.replace(/\s+/g, ' ').trim();
    if(!normalized) return Number.NEGATIVE_INFINITY;
    const text = normalized.length > 2400 ? normalized.slice(0, 2400) : normalized;

    const timeMatches = text.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig) || [];
    const airportMatches = text.match(/\([A-Z]{3}\)/g) || [];
    const keywordMatches = text.match(/\b(?:Depart|Departure|Return|Flight|Flights|Leg|Segment|Journey|Stop|Stops|Layover|Change|Duration|Overnight|Arrives)\b/gi) || [];

    if(timeMatches.length < 2 && airportMatches.length < 2){
      if(keywordMatches.length < 2) return Number.NEGATIVE_INFINITY;
    }
    if(timeMatches.length === 0 && airportMatches.length === 0) return Number.NEGATIVE_INFINITY;

    let score = 0;
    score += timeMatches.length * 5;
    score += airportMatches.length * 6;
    score += keywordMatches.length * 2;
    if(/\bOvernight\s+flight\b/i.test(text)) score += 4;
    if(/\bArrives\b/i.test(text)) score += 2;
    if(/\bNonstop\b/i.test(text)) score += 2;
    if(/\bLayover\b/i.test(text)) score += 2;

    const attrParts = [];
    if(node.getAttribute){
      const dt = node.getAttribute('data-testid');
      const dtest = node.getAttribute('data-test');
      if(dt) attrParts.push(dt);
      if(dtest) attrParts.push(dtest);
    }
    if(node.className){
      attrParts.push(typeof node.className === 'string' ? node.className : String(node.className));
    }
    const attrSig = attrParts.join(' ').toLowerCase();
    if(attrSig){
      if(/detail|itiner|journey|segment|leg|schedule|timeline/.test(attrSig)) score += 36;
      if(/summary|collapsed/.test(attrSig)) score -= 8;
    }

    if(rect){
      const clampedHeight = Math.min(420, rect.height);
      const clampedWidth = Math.min(720, rect.width);
      score += clampedHeight * 0.4;
      score += clampedWidth * 0.12;
      if(cardRect){
        const offsetTop = rect.top - cardRect.top;
        if(Number.isFinite(offsetTop)){
          if(offsetTop < 20){
            score += 12;
          } else if(offsetTop > 260){
            score -= Math.min(80, (offsetTop - 260) * 0.25);
          }
        }
      }
    }

    let depth = 0;
    let current = node.parentElement;
    while(current && current !== card && depth < 10){
      depth++;
      current = current.parentElement;
    }
    score -= depth * 4;

    return score;
  }

  function findKayakDetailContainer(card, selectBtn){
    if(!card || card.nodeType !== 1) return null;
    let cardRect = null;
    try {
      cardRect = typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
    } catch (err) {
      cardRect = null;
    }

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const scoreCache = new WeakMap();

    const evaluate = (node, bonus = 0) => {
      if(!node || node === card) return;
      let baseScore;
      if(scoreCache.has(node)){
        baseScore = scoreCache.get(node);
      } else {
        baseScore = scoreKayakDetailCandidate(node, card, selectBtn, cardRect);
        scoreCache.set(node, baseScore);
      }
      if(!Number.isFinite(baseScore)) return;
      const total = baseScore + bonus;
      if(total > bestScore){
        bestScore = total;
        best = node;
      }
    };

    const selectors = [
      '[data-testid*="itiner" i]',
      '[data-test*="itiner" i]',
      '[data-testid*="detail" i]',
      '[data-test*="detail" i]',
      '[data-testid*="journey" i]',
      '[data-test*="journey" i]',
      '[data-testid*="segment" i]',
      '[data-test*="segment" i]',
      '[class*="Itiner" i]',
      '[class*="itiner" i]',
      '[class*="detail" i]',
      '[class*="journey" i]',
      '[class*="segment" i]'
    ];

    selectors.forEach((sel, idx) => {
      let nodes = [];
      try {
        nodes = card.querySelectorAll(sel);
      } catch (err) {
        nodes = [];
      }
      if(!nodes || !nodes.length) return;
      const bonus = (selectors.length - idx) * 6;
      nodes.forEach(node => evaluate(node, bonus));
    });

    if(!best){
      let walker;
      try {
        walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT, null);
      } catch (err) {
        walker = null;
      }
      if(walker){
        let count = 0;
        while(count < 220 && walker.nextNode()){
          const node = walker.currentNode;
          count++;
          evaluate(node, 0);
        }
      }
    }

    return best;
  }

  function resolveKayakInlineHost(card, selectBtn, detailOverride){
    if(!card || card.nodeType !== 1) return card;
    const cached = kayakInlineSlotMap.get(card);
    if(cached && cached.isConnected && card.contains(cached)){
      return cached;
    }

    let detail = detailOverride || null;
    if(detail){
      if(detail.nodeType !== 1){
        detail = detail.parentElement;
      }
      if(detail && (detail === card || !detail.isConnected || !card.contains(detail))){
        detail = null;
      }
      if(detail && !isVisible(detail)){
        detail = null;
      }
    }
    if(!detail){
      detail = findKayakDetailContainer(card, selectBtn);
    }
    if(!detail){
      kayakInlineSlotMap.delete(card);
      return card;
    }
    const parent = detail.parentElement;
    if(!parent){
      kayakInlineSlotMap.delete(card);
      return card;
    }

    let insertionParent = parent;
    let insertionBefore = detail;
    while (insertionParent && insertionParent !== card){
      if(!card.contains(insertionParent)) break;
      let elementCount = 0;
      const parentChildren = insertionParent.children || [];
      for(let i = 0; i < parentChildren.length; i++){
        const child = parentChildren[i];
        if(child && child.nodeType === 1){
          elementCount++;
          if(elementCount > 1) break;
        }
      }
      if(elementCount !== 1) break;
      insertionBefore = insertionParent;
      insertionParent = insertionParent.parentElement;
    }

    if(!insertionParent || !insertionBefore || !card.contains(insertionBefore)){
      kayakInlineSlotMap.delete(card);
      return card;
    }

    let slot = null;
    const targetChildren = insertionParent.children || [];
    for(let i = 0; i < targetChildren.length; i++){
      const child = targetChildren[i];
      if(child && child.classList && child.classList.contains('kayak-copy-inline-slot')){
        slot = child;
        break;
      }
    }
    if(!slot){
      slot = document.createElement('div');
      slot.className = 'kayak-copy-inline-slot';
      try {
        insertionParent.insertBefore(slot, insertionBefore);
      } catch (err) {
        kayakInlineSlotMap.delete(card);
        return card;
      }
    }
    if(!card.contains(slot)){
      kayakInlineSlotMap.delete(card);
      return card;
    }
    kayakInlineSlotMap.set(card, slot);
    return slot;
  }

  function parseCssSize(value){
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  function isAcceptableCtaCandidate(candidate, rect, computedStyles){
    if(!candidate) return false;
    let metrics = rect || null;
    if(!metrics){
      try {
        metrics = candidate.getBoundingClientRect();
      } catch (err) {
        metrics = null;
      }
    }
    if(!metrics) return false;
    if(metrics.width < CTA_MIN_WIDTH || metrics.height < CTA_MIN_HEIGHT) return false;
    if(metrics.width * metrics.height < CTA_MIN_AREA) return false;
    let styles = computedStyles || null;
    if(!styles){
      try {
        styles = getComputedStyle(candidate);
      } catch (err) {
        styles = null;
      }
    }
    if(styles){
      const radiusValues = [
        styles.borderRadius,
        styles.borderTopLeftRadius,
        styles.borderTopRightRadius,
        styles.borderBottomLeftRadius,
        styles.borderBottomRightRadius
      ];
      let maxRadius = 0;
      for(const val of radiusValues){
        const parsed = parseCssSize(val);
        if(parsed > maxRadius){
          maxRadius = parsed;
        }
      }
      const padX = parseCssSize(styles.paddingLeft) + parseCssSize(styles.paddingRight);
      const padY = parseCssSize(styles.paddingTop) + parseCssSize(styles.paddingBottom);
      if(maxRadius <= 1 && padX < 14 && padY < 8){
        return false;
      }
    }
    return true;
  }

  function getCtaLabel(candidate){
    if(!candidate) return '';
    const parts = [
      candidate.textContent || '',
      (candidate.getAttribute && candidate.getAttribute('aria-label')) || '',
      (candidate.getAttribute && candidate.getAttribute('data-test')) || '',
      (candidate.getAttribute && candidate.getAttribute('data-testid')) || '',
      (candidate.getAttribute && candidate.getAttribute('title')) || ''
    ];
    return parts.join(' ');
  }

  function getCtaAttributeSignature(candidate){
    if(!candidate || candidate.nodeType !== 1) return '';
    const attrs = ['data-testid', 'data-test', 'id', 'name', 'data-resultid', 'data-result-id', 'data-option-id', 'data-offer-id'];
    const parts = [];
    for(const attr of attrs){
      const val = candidate.getAttribute ? candidate.getAttribute(attr) : null;
      if(val){
        parts.push(String(val));
      }
    }
    if(candidate.dataset){
      for(const key of Object.keys(candidate.dataset)){
        const val = candidate.dataset[key];
        if(val){
          parts.push(String(val));
        }
      }
    }
    if(candidate.className){
      parts.push(typeof candidate.className === 'string' ? candidate.className : String(candidate.className));
    }
    return parts.join(' ').toLowerCase();
  }

  function looksLikeExpandedCard(el){
    if(IS_ITA){
      return looksLikeItaExpandedCard(el);
    }
    if(!el || el.nodeType !== 1) return false;
    if(shouldIgnoreCard(el)) return false;
    const selectCandidate = findSelectButton(el);
    let allowMissingSelect = false;
    if(selectCandidate){
      if(!isVisible(selectCandidate)){
        allowMissingSelect = true;
      }
    } else {
      let rect = null;
      try {
        rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      } catch (err) {
        rect = null;
      }
      if(!rect || rect.width < 160 || rect.height < 260){
        return false;
      }
      allowMissingSelect = true;
    }
    return cardHasFlightClues(el, selectCandidate, { suppressSelectLookup: true, allowMissingSelect });
  }

  // Find the expanded “card” container
  function findCardFrom(node){
    if (IS_ITA) {
      const detail = getItaDetailCell(node, false);
      if (detail) {
        return normalizeCard(detail);
      }
    }
    let el = node.nodeType === 1 ? node : node.parentElement;
    let hops = 0;
    while (el && hops++ < MAX_CLIMB) {
      if (looksLikeExpandedCard(el)) {
        const normalized = IS_ITA ? normalizeItaCard(el) : normalizeKayakCard(el);
        if(normalized){
          return normalized;
        }
      }
      el = el.parentElement;
    }
    // shallow descendant fallback
    if (node.nodeType === 1) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null);
      let count = 0;
      while (walker.nextNode() && count++ < 300) {
        const e = walker.currentNode;
        if (looksLikeExpandedCard(e)) {
          const normalized = IS_ITA ? normalizeItaCard(e) : normalizeKayakCard(e);
          if(normalized){
            return normalized;
          }
        }
      }
    }
    return null;
  }

  function findSelectButton(card){
    if (!card || card.nodeType !== 1) return null;

    const seen = new Set();
    const scored = [];
    let order = 0;
    let nodeList = [];
    try {
      nodeList = card.querySelectorAll('button, a[role="button"], div[role="button"], a[href]');
    } catch (err) {
      nodeList = [];
    }

    for (const candidate of nodeList){
      if(!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      order++;
      if(!isVisible(candidate)) continue;
      let rect = null;
      try {
        rect = candidate.getBoundingClientRect();
      } catch (err) {
        rect = null;
      }
      if(!rect) continue;
      const label = getCtaLabel(candidate);
      if(!label) continue;
      if(!SELECT_RX.test(label)) continue;
      let styles = null;
      if(rect.width < CTA_MIN_WIDTH || rect.height < CTA_MIN_HEIGHT || rect.width * rect.height < CTA_MIN_AREA){
        try {
          styles = getComputedStyle(candidate);
        } catch (err) {
          styles = null;
        }
      }
      if(!isAcceptableCtaCandidate(candidate, rect, styles)) continue;
      const attrSignature = getCtaAttributeSignature(candidate);
      const loweredLabel = label.toLowerCase();
      let score = 0;
      const tagName = candidate.tagName ? candidate.tagName.toLowerCase() : '';
      if(tagName === 'button') score += 60;
      if(tagName === 'a') score += 36;
      score += Math.min(rect.width, 360) * 0.6;
      score += Math.min(rect.height, 200) * 0.6;
      const hintScores = {
        'result-select': 160,
        'select': 150,
        'booking': 140,
        'book': 140,
        'cta': 120,
        'price-link': 120,
        'price': 90,
        'provider': 80,
        'offer': 70,
        'deal': 60
      };
      let hasPreferredAttr = false;
      for(const hint of CTA_ATTR_HINTS){
        if(attrSignature.includes(hint)){
          hasPreferredAttr = true;
          score += hintScores[hint] || 40;
        }
      }
      if(/\bselect\b/.test(loweredLabel)) score += 50;
      if(/\bbook\b/.test(loweredLabel)) score += 40;
      if(/\bgo\s+to\b/.test(loweredLabel)) score += 32;
      if(/\bvisit\b/.test(loweredLabel)) score += 28;
      if(/\bview\s+offer\b/.test(loweredLabel)) score += 32;
      if(/\bcheck\s+price\b/.test(loweredLabel)) score += 24;
      if(/\bdeal\b/.test(loweredLabel)) score += 20;
      if(/\boffer\b/.test(loweredLabel)) score += 20;

      scored.push({ element: candidate, score, order, hasPreferredAttr });
    }

    if(!scored.length) return null;
    scored.sort((a, b) => {
      if(a.hasPreferredAttr !== b.hasPreferredAttr){
        return a.hasPreferredAttr ? -1 : 1;
      }
      if(b.score !== a.score){
        return b.score - a.score;
      }
      return a.order - b.order;
    });
    return scored[0].element;
  }

  /* ---------- Button injection near the primary Select button ---------- */

  function removeCardButton(card){
    if (!card) return;
    if(card && typeof card === 'object' && cardGroupMap.has(card)){
      const direct = cardGroupMap.get(card);
      if(direct){
        hardRemoveGroup(direct);
      }
    }
    const normalized = normalizeCard(card, { allowCollapsed: true });
    if(!normalized){
      const fallbackKey = card && card.getAttribute ? card.getAttribute(CARD_KEY_ATTR) : null;
      if(fallbackKey){
        const stray = cardGroupsByKey.get(fallbackKey);
        if(stray){
          hardRemoveGroup(stray);
        }
      }
      schedulePositionSync();
      return;
    }
    card = normalized;
    const group = cardGroupMap.get(card);
    const cardKey = card && card.getAttribute ? card.getAttribute(CARD_KEY_ATTR) : null;
    if (group){
      hardRemoveGroup(group);
    } else if (cardKey){
      const stray = cardGroupsByKey.get(cardKey);
      if(stray){
        hardRemoveGroup(stray);
      }
    }
    schedulePositionSync();
  }

  function ensureItaButton(card){
    if (!card) return;

    cleanupItaGroups(false);

    card = normalizeCard(card);

    if (!card || !card.isConnected){
      removeCardButton(card);
      return;
    }

    const detailRow = card.closest ? card.closest('tr.detail-row') : null;
    const summaryRow = detailRow ? getItaSummaryRowFromDetail(detailRow) : null;

    if (!detailRow || !summaryRow){
      removeCardButton(card);
      return;
    }

    if (!isItaDetailVisible(summaryRow, detailRow)){
      removeCardButton(card);
      return;
    }

    if (shouldIgnoreCard(card) || shouldIgnoreCard(summaryRow)){
      removeCardButton(card);
      return;
    }

    const cardKey = getCardKey(card);
    let group = cardGroupMap.get(card);
    if(cardKey){
      const existingGroup = cardGroupsByKey.get(cardKey);
      if(existingGroup && existingGroup !== group){
        hardRemoveGroup(existingGroup);
      }
    }

    ensureItaResultsObserver(card);

    const host = card;
    if (!host || !host.isConnected){
      removeCardButton(card);
      return;
    }

    host.classList && host.classList.add('kayak-copy-inline-host');

    const key = getItaItineraryKey(summaryRow, detailRow);
    if (key){
      const existing = itaGroupsByKey.get(key);
      if (existing && existing !== group && existing.__kayakCard !== card){
        hardRemoveGroup(existing);
      }
    }

    if (!group){
      group = document.createElement('div');
      group.className = BTN_GROUP_CLASS;
      group.setAttribute('role', 'group');
      group.dataset.inline = '1';
      group.__inlineHost = host;
      group.__kayakSummaryRow = summaryRow;
      group.__kayakDetailRow = detailRow;
      group.classList.add('kayak-copy-btn-group--ita');
      if (key){
        group.dataset.itaKey = key;
        itaGroupsByKey.set(key, group);
      } else {
        delete group.dataset.itaKey;
      }
      cardGroupMap.set(card, group);
      registerGroup(card, group);
    }else{
      const prevHost = group.__inlineHost;
      if (prevHost && prevHost !== host && prevHost.classList){
        prevHost.classList.remove('kayak-copy-inline-host');
        resetInlineHostPadding(prevHost);
      }
      group.dataset.inline = '1';
      group.__inlineHost = host;
      group.__kayakSummaryRow = summaryRow;
      group.__kayakDetailRow = detailRow;
      group.classList.add('kayak-copy-btn-group--ita');
      if (!activeGroups.has(group)){
        registerGroup(card, group);
      }
      const prevKey = group.dataset && group.dataset.itaKey;
      if (prevKey && prevKey !== key && itaGroupsByKey.get(prevKey) === group) {
        itaGroupsByKey.delete(prevKey);
      }
      if (key){
        group.dataset.itaKey = key;
        itaGroupsByKey.set(key, group);
      } else {
        delete group.dataset.itaKey;
      }
    }

    let configData = null;
    try {
      configData = computeButtonConfigsForCard(card);
    } catch (err) {
      console.warn('Failed to compute button configs:', err);
      removeCardButton(card);
      return;
    }
    const buttonCount = configData && Array.isArray(configData.configs) ? configData.configs.length : 0;
    const showMulti = !!(configData && configData.showJourneyButtons);
    buildGroupForCard(card, group, configData);

    if(cardKey){
      group.__kayakCardKey = cardKey;
      cardGroupsByKey.set(cardKey, group);
    } else {
      delete group.__kayakCardKey;
    }

    if (group.parentNode !== host){
      host.appendChild(group);
    }
    ensureInlineHostPadding(host, group, showMulti || buttonCount > 1);

    group.style.display = 'flex';
    group.style.visibility = 'visible';
  }

  function ensureCardButton(card){
    if (!card) return;

    if (IS_ITA){
      ensureItaButton(card);
      schedulePositionSync();
      return;
    }

    const rawCard = card;
    const normalized = normalizeCard(card);
    if(!normalized){
      removeCardButton(rawCard);
      schedulePositionSync();
      return;
    }
    card = normalized;

    if (!card.isConnected) {
      removeCardButton(card);
      return;
    }

    if (!isVisible(card)) {
      schedulePositionSync();
      return;
    }

    const expansionHost = card.getAttribute('aria-expanded') != null
      ? card
      : card.closest('[aria-expanded]');
    if (expansionHost && expansionHost.getAttribute('aria-expanded') !== 'true'){
      removeCardButton(card);
      return;
    }

    if(shouldIgnoreCard(card)){
      removeCardButton(card);
      return;
    }

    const cardKey = getCardKey(card);
    let group = cardGroupMap.get(card);
    if(cardKey){
      const existingGroup = cardGroupsByKey.get(cardKey);
      if(existingGroup && existingGroup !== group){
        hardRemoveGroup(existingGroup);
      }
    }

    const selectBtn = findSelectButton(card);
    let cardRect = null;
    try {
      cardRect = card.getBoundingClientRect();
    } catch (err) {
      cardRect = null;
    }
    let inlineFallback = false;
    let selectRect = null;
    if(selectBtn){
      if(!isVisible(selectBtn)){
        inlineFallback = true;
      }
      try {
        selectRect = selectBtn.getBoundingClientRect();
      } catch (err) {
        selectRect = null;
      }
      if(!selectRect){
        inlineFallback = true;
      } else {
        if(selectRect.width < CTA_MIN_WIDTH || selectRect.height < CTA_MIN_HEIGHT || (selectRect.width * selectRect.height) < CTA_MIN_AREA){
          inlineFallback = true;
        }
        const avoidTop = measureAvoidTop();
        if(selectRect.top <= avoidTop + 8 || selectRect.top < 56){
          inlineFallback = true;
        }
        if(selectRect.width <= 0 || selectRect.height <= 0){
          inlineFallback = true;
        }
      }
    } else {
      inlineFallback = true;
    }

    if(!inlineFallback && cardRect){
      try {
        const avoidTop = measureAvoidTop();
        if(Number.isFinite(avoidTop) && (cardRect.top <= avoidTop + 10)){
          inlineFallback = true;
        }
      } catch (err) {
        // ignore measurement failure
      }
    }

    if(!cardHasFlightClues(card, selectBtn, { suppressSelectLookup: true, allowMissingSelect: inlineFallback })){
      removeCardButton(card);
      return;
    }

    let configData = null;
    try {
      configData = computeButtonConfigsForCard(card);
    } catch (err) {
      console.warn('Failed to compute button configs:', err);
      removeCardButton(card);
      return;
    }
    if(!configData || !Array.isArray(configData.configs) || configData.configs.length === 0){
      removeCardButton(card);
      return;
    }
    const hasMultiPreview = !!(configData.preview && configData.preview.isMultiCity);
    if(hasMultiPreview){
      inlineFallback = true;
    }

    let detailContainer = null;
    try {
      detailContainer = findKayakDetailContainer(card, selectBtn);
    } catch (err) {
      detailContainer = null;
    }
    if(detailContainer && (detailContainer === card || !card.contains(detailContainer) || !detailContainer.isConnected || !isVisible(detailContainer))){
      detailContainer = null;
    }
    if(detailContainer){
      inlineFallback = true;
    }

    if(!group){
      group = document.createElement('div');
      group.className = BTN_GROUP_CLASS;
      group.setAttribute('role', 'group');
      cardGroupMap.set(card, group);
    }
    if (!activeGroups.has(group)){
      registerGroup(card, group);
    }
    if(cardKey){
      group.__kayakCardKey = cardKey;
      cardGroupsByKey.set(cardKey, group);
    } else {
      delete group.__kayakCardKey;
    }
    if(inlineFallback){
      group.dataset.inline = '1';
    } else {
      delete group.dataset.inline;
    }

    buildGroupForCard(card, group, configData);

    const previousHost = group.__inlineHost;
    if(inlineFallback){
      let host = resolveKayakInlineHost(card, selectBtn, detailContainer);
      if(!host){
        host = card;
      }
      const prevSlot = (previousHost && previousHost !== host && previousHost.classList && previousHost.classList.contains('kayak-copy-inline-slot'))
        ? previousHost
        : null;
      if(previousHost && previousHost !== host && previousHost.classList){
        previousHost.classList.remove('kayak-copy-inline-host');
        resetInlineHostPadding(previousHost);
      }
      if(host && host.classList){
        host.classList.add('kayak-copy-inline-host');
      }
      group.__inlineHost = host;
      group.classList.add('kayak-copy-btn-group--ita');
      group.style.position = '';
      group.style.pointerEvents = '';
      group.style.visibility = '';
      group.style.top = '';
      group.style.left = '';
      group.style.right = '';
      group.style.bottom = '';
      group.style.zIndex = '';
      if (group.parentNode !== host){
        host.appendChild(group);
      }
      if(prevSlot){
        const cachedSlot = card ? kayakInlineSlotMap.get(card) : null;
        if(cachedSlot === prevSlot){
          kayakInlineSlotMap.delete(card);
        }
        if(prevSlot.isConnected && !prevSlot.childElementCount){
          prevSlot.remove();
        }
      }
      if(host === card){
        kayakInlineSlotMap.delete(card);
      }
      group.style.display = 'flex';
      group.style.visibility = 'visible';
    } else {
      let removedSlot = null;
      if(previousHost && previousHost.classList){
        if(previousHost.classList.contains('kayak-copy-inline-slot')){
          removedSlot = previousHost;
        }
        previousHost.classList.remove('kayak-copy-inline-host');
      }
      delete group.__inlineHost;
      group.classList.remove('kayak-copy-btn-group--ita');
      group.style.position = 'fixed';
      group.style.pointerEvents = 'auto';
      group.style.visibility = 'hidden';
      const root = ensureOverlayRoot();
      if (!group.isConnected || group.parentNode !== root){
        root.appendChild(group);
      }
      applyGroupZIndex(group);
      if(removedSlot){
        if(card && kayakInlineSlotMap.get(card) === removedSlot){
          kayakInlineSlotMap.delete(card);
        }
        if(removedSlot.isConnected && !removedSlot.childElementCount){
          removedSlot.remove();
        }
      }
    }

    schedulePositionSync();
  }

  /* ---------- ITA itinerary details view button ---------- */

  function looksLikeItaDetailContainer(el){
    if (!IS_ITA || !el || !el.querySelector) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (!el.isConnected) return false;
    if (!isVisible(el)) return false;

    if (el.closest){
      const sidebar = el.closest('aside, [data-testid*="sidebar" i], [class*="sidebar" i]');
      if (sidebar && sidebar !== el) return false;
      const shareBlock = el.closest('[data-testid*="share" i], [data-testid*="export" i], [class*="share-export" i], [class*="ShareExport" i]');
      if (shareBlock && shareBlock !== el) return false;
    }

    const heading = el.querySelector(ITA_HEADING_SELECTOR);
    if (heading){
      const headingText = (heading.textContent || '').replace(/\s+/g,' ').trim();
      if (/Share\s*&\s*Export/i.test(headingText)) return false;
    }

    const text = (el.innerText || '').replace(/\s+/g,' ').trim();
    if (!text) return false;

    const airportMatches = text.match(/\([A-Z]{3}\)/g) || [];
    if (airportMatches.length < 2) return false;

    const timeMatches = text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi) || [];
    if (timeMatches.length < 2) return false;

    if (!/\b(Itinerary|Depart|Departure|Outbound|Inbound|Return|Flight|Duration|Layover|Economy|Business|Cabin)\b/i.test(text)){
      return false;
    }

    if (/Share\s*&\s*Export/i.test(text) && airportMatches.length < 3){
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 280 || rect.height < 140) return false;

    return true;
  }

  function scoreItaDetailContainer(el){
    if (!IS_ITA || !el) return -Infinity;
    if (!looksLikeItaDetailContainer(el)) return -Infinity;

    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) return -Infinity;

    let score = 0;
    const airportMatches = text.match(/\([A-Z]{3}\)/g) || [];
    const timeMatches = text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi) || [];
    score += airportMatches.length * 6 + timeMatches.length * 3;

    const segmentSelectors = [
      '[data-testid*="segment" i]',
      '[data-testid*="leg" i]',
      '[class*="segment" i]',
      'table tr',
      'li'
    ];
    const segmentNodes = new Set();
    segmentSelectors.forEach(sel => {
      const list = el.querySelectorAll(sel);
      for (const node of list){
        if (segmentNodes.size >= 120) break;
        if (node) segmentNodes.add(node);
      }
    });

    let inspected = 0;
    let segmentHits = 0;
    for (const node of segmentNodes){
      inspected++;
      if (inspected > 80) break;
      if (!isVisible(node)) continue;
      const nodeText = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (!nodeText) continue;
      const nodeAirports = nodeText.match(/\([A-Z]{3}\)/g) || [];
      const nodeTimes = nodeText.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/gi) || [];
      if (nodeAirports.length && nodeTimes.length){
        segmentHits += 1;
      } else if (nodeAirports.length + nodeTimes.length >= 3){
        segmentHits += 0.5;
      }
    }
    score += segmentHits * 14;

    if (el.closest){
      if (el.closest('aside, [data-testid*="sidebar" i], [class*="sidebar" i]')){
        score -= 160;
      }
      if (el.closest('[data-testid*="share" i], [data-testid*="export" i]')){
        score -= 200;
      }
    }

    if (typeof el.getBoundingClientRect === 'function'){
      const rect = el.getBoundingClientRect();
      if (rect){
        score += Math.min(rect.width, 1400) / 4;
        score += Math.min(rect.height, 2200) / 6;
      }
    }

    return score;
  }

  function getItaDetailsRoot(){
    if (!IS_ITA) return null;

    const headingCandidates = [];
    document.querySelectorAll(ITA_HEADING_SELECTOR).forEach(node => {
      const txt = (node.textContent || '').replace(/\s+/g,' ').trim();
      if (!txt) return;
      if (!/^(Itinerary Details|Itinerary)\b/i.test(txt)) return;
      if (!isVisible(node)) return;
      headingCandidates.push(node);
    });

    const seenContainers = new Set();
    const scored = [];
    const consider = (el) => {
      if (!el || seenContainers.has(el)) return;
      seenContainers.add(el);
      const score = scoreItaDetailContainer(el);
      if (score === -Infinity) return;
      scored.push({ el, score });
    };

    const addMatches = (root, selectors, predicate) => {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      for (const sel of selectors){
        const list = root.querySelectorAll(sel);
        for (const node of list){
          if (!node) continue;
          if (predicate && !predicate(node)) continue;
          consider(node);
          if (scored.length >= 32) return;
        }
      }
    };

    const nearHeadingSelectors = [
      '[data-testid*="itinerary" i]',
      '[data-testid*="itin" i]',
      '[data-testid*="detail" i]',
      '[class*="itinerary" i]',
      '[class*="itin" i]',
      '[class*="detail" i]',
      'section',
      'article',
      'div'
    ];

    headingCandidates.forEach(heading => {
      let current = heading;
      while (current && current !== document.body){
        consider(current);
        current = current.parentElement;
      }

      const parent = heading.parentElement;
      if (parent){
        addMatches(parent, nearHeadingSelectors, (node) => node.contains(heading));
      }
    });

    if (!scored.length){
      const fallbackSelectors = [
        '[data-testid*="itinerary" i]',
        '[data-testid*="itin" i]',
        '[data-testid*="detail" i]',
        '[class*="itinerary" i]',
        '[class*="itin" i]',
        '[class*="detail" i]',
        'main',
        'main section',
        'main article',
        'main > div',
        'section',
        'article'
      ];
      addMatches(document, fallbackSelectors);
      const main = document.querySelector('main');
      if (main){
        consider(main);
        Array.from(main.children || []).forEach(child => consider(child));
      }
    }

    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].el;
  }

  function getItaDetailsCopyTarget(root){
    if (!root || !root.querySelector) return root;
    const selectors = [
      '[data-testid*="segment" i]',
      '[data-testid*="detail" i]',
      '[class*="segment" i]',
      'table'
    ];
    for (const sel of selectors){
      const candidate = root.querySelector(sel);
      if (!candidate || candidate === itaDetailGroup) continue;
      const text = (candidate.innerText || '').replace(/\s+/g,' ').trim();
      if (!text) continue;
      if (/\([A-Z]{3}\)/.test(text) && /\d{1,2}:\d{2}/.test(text)){
        return candidate;
      }
    }
    return root;
  }

  function ensureItaDetailButton(){
    if (!IS_ITA) return;

    const root = getItaDetailsRoot();
    if (!root || !root.isConnected || !isVisible(root)){
      if (itaDetailRoot || itaDetailGroup){
        cleanupItaDetailButton();
      }
      if (!itaDetailRetryStart){
        itaDetailRetryStart = Date.now();
        itaDetailRetryCount = 0;
      }
      if (Date.now() - itaDetailRetryStart <= 5000){
        itaDetailRetryCount = Math.min(itaDetailRetryCount + 1, 20);
        scheduleItaDetailEnsure(false);
      } else {
        itaDetailRetryStart = 0;
        itaDetailRetryCount = 0;
      }
      return;
    }

    if (itaDetailRoot && itaDetailRoot !== root){
      cleanupItaDetailButton();
    }

    itaDetailRoot = root;
    itaDetailRetryStart = 0;
    itaDetailRetryCount = 0;

    const host = root;
    if (itaDetailHost && itaDetailHost !== host){
      if (itaDetailHostNeedsReset && itaDetailHost.classList){
        itaDetailHost.classList.remove('kayak-copy-inline-host');
      }
      resetInlineHostPadding(itaDetailHost);
      itaDetailHostNeedsReset = false;
    }
    itaDetailHost = host;

    const computedPos = host instanceof Element ? getComputedStyle(host).position : '';
    if (!computedPos || computedPos === 'static'){
      if (!host.classList.contains('kayak-copy-inline-host')){
        host.classList.add('kayak-copy-inline-host');
      }
      itaDetailHostNeedsReset = true;
    } else {
      itaDetailHostNeedsReset = false;
    }

    itaDetailCopyTarget = getItaDetailsCopyTarget(root) || root;

    if (itaDetailGroup && itaDetailGroup.parentNode !== host){
      itaDetailGroup.remove();
      itaDetailGroup = null;
    }

    if (!itaDetailGroup){
      const group = document.createElement('div');
      group.className = BTN_GROUP_CLASS;
      group.classList.add('kayak-copy-btn-group--ita');
      group.dataset.inline = '1';
      group.dataset.itaDetail = '1';
      group.setAttribute('role', 'group');
      host.appendChild(group);
      itaDetailGroup = group;
    }

    if (!itaDetailGroup.isConnected){
      host.appendChild(itaDetailGroup);
    }

    const detailTarget = itaDetailCopyTarget || root;
    const currentVersion = itaDetailGroup.dataset.configVersion;
    const targetChanged = itaDetailGroup.__kayakCard !== detailTarget;
    if (targetChanged){
      itaDetailGroup.__kayakCard = detailTarget;
    }

    const configData = computeButtonConfigsForCard(detailTarget);
    const configs = configData && Array.isArray(configData.configs) ? configData.configs : [];
    const showMulti = !!(configData && configData.showJourneyButtons);
    if (showMulti){
      itaDetailGroup.dataset.multi = '1';
    } else {
      delete itaDetailGroup.dataset.multi;
    }
    itaDetailGroup.classList.toggle('kayak-copy-btn-group--multi', showMulti);
    const desiredVersion = `${buttonConfigVersion}:${configData && configData.signature ? configData.signature : 'default'}`;
    if (targetChanged || currentVersion !== desiredVersion){
      itaDetailGroup.innerHTML = '';
      configs.forEach(cfg => {
        const btn = createButton(detailTarget, cfg);
        btn.dataset.itaDetail = '1';
        itaDetailGroup.appendChild(btn);
      });
      itaDetailGroup.dataset.configVersion = desiredVersion;
    }
    ensureInlineHostPadding(host, itaDetailGroup, showMulti || configs.length > 1);
  }

  function cleanupItaDetailButton(){
    if (itaDetailGroup){
      delete itaDetailGroup.__kayakCard;
      if (itaDetailGroup.parentNode){
        itaDetailGroup.remove();
      }
    }
    itaDetailGroup = null;
    itaDetailCopyTarget = null;
    if (itaDetailHost && itaDetailHostNeedsReset && itaDetailHost.classList){
      itaDetailHost.classList.remove('kayak-copy-inline-host');
    }
    if (itaDetailHost){
      resetInlineHostPadding(itaDetailHost);
    }
    itaDetailHostNeedsReset = false;
    itaDetailHost = null;
    itaDetailRoot = null;
    itaDetailRetryStart = 0;
    itaDetailRetryCount = 0;
  }

  function scheduleItaDetailEnsure(immediate = false){
    if (!IS_ITA) return;
    if (itaDetailEnsureTimer){
      clearTimeout(itaDetailEnsureTimer);
      itaDetailEnsureTimer = null;
    }
    const delay = immediate ? 0 : Math.min(240, 60 + itaDetailRetryCount * 80);
    itaDetailEnsureTimer = setTimeout(() => {
      itaDetailEnsureTimer = null;
      ensureItaDetailButton();
    }, delay);
  }

  /* ---------- Visible text extractor (kept from previous build) ---------- */

  function looksLikeItaAirlineName(line){
    const normalized = (line || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if(!normalized) return false;
    if(/^[0-9]/.test(normalized)) return false;
    if(/\b(AIRBUS|BOEING|EMBRAER|BOMBARDIER|CANADAIR|DE HAVILLAND|MCDONNELL|DOUGLAS|LOCKHEED|SUKHOI|SUPERJET|FOKKER|TUP|ANTONOV|IL-?\d*|SAAB|ATR|TURBOPROP|JETLINER|AIRCRAFT|E-?JET|CRJ|MAX|NEO)\b/.test(normalized)) return false;
    if(typeof lookupAirlineCodeByName === 'function'){
      const code = lookupAirlineCodeByName(line);
      if(code) return true;
    } else if(typeof AIRLINE_CODES !== 'undefined' && AIRLINE_CODES[normalized]){
      return true;
    }
    const airlineKeywords = [
      'AIR ', 'AIRLINES', 'AIRWAYS', 'AVIATION', 'FLY', 'JET ', 'JETBLUE', 'JET2', 'CONDOR', 'LUFTHANSA', 'UNITED', 'DELTA',
      'AMERICAN', 'SWISS', 'AUSTRIAN', 'IBERIA', 'QANTAS', 'QATAR', 'EMIRATES', 'ETIHAD', 'TURKISH', 'SAS', 'FINNAIR', 'AER ',
      'AERO', 'WING', 'SKY', 'PORTER', 'WESTJET', 'SPIRIT', 'FRONTIER', 'ICELAND', 'EUROWINGS', 'RYANAIR', 'EASYJET', 'VIRGIN',
      'ALASKA', 'HAWAIIAN', 'KLM', 'AIR FRANCE', 'FRANCE AIR', 'TAP', 'ANA', 'JAPAN', 'COPA', 'LATAM', 'VUELING', 'LEVEL',
      'TRANSAT', 'SUN COUNTRY', 'AER LINGUS', 'AEROMEXICO', 'AEROLINEAS', 'BRITISH', 'LOT', 'EVA', 'KOREAN', 'CHINA', 'HAINAN',
      'PHILIPPINE'
    ];
    return airlineKeywords.some(keyword => normalized.includes(keyword));
  }

  function extractItaVisibleText(root){
    if(!root) return '';
    const rawText = (root.innerText || '').trim();
    if(!rawText) return '';
    const rawLines = rawText.split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const processed = [];

    const rangeRx = /(\d{1,2}:\d{2}\s*(?:[AP]M)?)(?:\s*(?:to|–|—|-)\s*)(\d{1,2}:\d{2}\s*(?:[AP]M)?)/i;
    const durationParenRx = /\(\s*\d+h(?:\s*\d*m)?\s*\)/ig;
    const plusDaysRx = /\+\s?\d+\s*day(?:s)?/ig;
    const layoverRx = /^LAYOVER IN\b/i;
    const durationOnlyRx = /^\d+h(?:\s*\d+m)?$/i;
    const equipmentRx = /\b(Airbus|Boeing|Embraer|Bombardier|CRJ|E-?Jet|Dreamliner|neo|MAX|ATR|Turboprop|Aircraft|Jetliner|Sukhoi)\b/i;
    const operatedRx = /^Operated by/i;
    const bookingRx = /\b(Economy|Business|First|Premium|Coach|Cabin|Class)[^()]*\(([A-Z0-9]{1,2})\)/i;
    const cabinWordRx = /\b(Economy|Business|First|Premium|Coach|Cabin|Class)\b/i;
    const flightDesignatorRx = /\b[A-Z]{1,3}\s?\d{1,4}\b/;
    const routeMarkerRx = /\bto\b/i;
    const airportRx = /\([A-Z]{3}\)/;
    const pureFlightNumberRx = /^\d{1,4}[A-Z]?$/;
    const timeTokenRx = /\b\d{1,2}:\d{2}\s*(?:[AP]M)?\b/g;

    for(const original of rawLines){
      let line = original.replace(/[•·]/g, ' ').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
      if(!line || line === '•') continue;
      if(layoverRx.test(line)) continue;

      const hasRoute = routeMarkerRx.test(line) && airportRx.test(line);
      const hasFlight = flightDesignatorRx.test(line);

      const rangeMatch = line.match(rangeRx);
      if(rangeMatch){
        const dep = rangeMatch[1].replace(/\s+/g, ' ').trim();
        const arr = rangeMatch[2].replace(/\s+/g, ' ').trim();
        if(dep) processed.push(dep);
        if(arr) processed.push(arr);
        line = line.replace(rangeRx, '').trim();
      }

      if(!hasRoute && !hasFlight){
        const tokens = line.match(timeTokenRx);
        if(tokens && tokens.length >= 2 && /(\bto\b|[-–—])/.test(line)){
          tokens.forEach(t => processed.push(t.trim()));
          line = line.replace(timeTokenRx, '').replace(/(\bto\b|[-–—])/gi, ' ').trim();
        }
      }

      line = line.replace(durationParenRx, ' ').replace(plusDaysRx, ' ').replace(/\s+/g, ' ').trim();
      if(!line && !hasRoute && !hasFlight){
        continue;
      }

      if(!hasRoute && !hasFlight){
        const bookingMatch = line.match(bookingRx);
        if(bookingMatch){
          processed.push(`${bookingMatch[1]} (${bookingMatch[2].toUpperCase()})`);
          continue;
        }
        if(equipmentRx.test(line) || operatedRx.test(line)){
          continue;
        }
        if(durationOnlyRx.test(line)){
          continue;
        }
        if(cabinWordRx.test(line) && !/\([A-Z0-9]{1,2}\)/.test(line)){
          continue;
        }
      }

      if(line){
        processed.push(line.replace(/\s*,\s*$/, ''));
      }
    }

    if(processed.length === 0) return '';

    const deduped = [];
    for(const line of processed){
      const trimmed = line.trim();
      if(!trimmed) continue;
      if(deduped.length && deduped[deduped.length - 1] === trimmed) continue;
      deduped.push(trimmed);
    }

    const combined = [];
    for(let i = 0; i < deduped.length; i++){
      const cur = deduped[i];
      const next = deduped[i + 1] || '';
      const routeNoOn = /\bto\b/i.test(cur) && /\([A-Z]{3}\)/.test(cur) && !/\bon\b/i.test(cur);
      const dateLike = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,\s]/i.test(next) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(next);
      if(routeNoOn && dateLike){
        const routeBase = cur.replace(/[,:]\s*$/, '');
        const datePart = next.replace(/^[,\s]+/, '');
        combined.push(`${routeBase} on ${datePart}`);
        i++;
        continue;
      }
      combined.push(cur);
    }

    const merged = [];
    for(let i = 0; i < combined.length; i++){
      const cur = combined[i];
      const next = combined[i + 1] || '';
      if(looksLikeItaAirlineName(cur) && pureFlightNumberRx.test(next.trim())){
        merged.push(`${cur} ${next.trim()}`);
        i++;
        continue;
      }
      merged.push(cur);
    }

    return merged.join('\n');
  }

  function extractVisibleText(root){
    if(IS_ITA){
      return extractItaVisibleText(root);
    }
    const tokens = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        const p = node.parentElement;
        if(!p || !isVisible(p)) return NodeFilter.FILTER_SKIP;
        const t = (node.nodeValue||'').replace(/\s+/g,' ').trim();
        if(!t) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) tokens.push(walker.currentNode.nodeValue.replace(/\s+/g,' ').trim());

    const keep = [];
    const airlineLike   = /(Airlines?|Airways|Aviation|Virgin Atlantic|British Airways|United|Delta|KLM|Air Canada|American|Lufthansa|SWISS|Austrian|TAP|Aer Lingus|Iberia|Finnair|SAS|Turkish|Emirates|Qatar|Etihad|JetBlue|Alaska|Hawaiian|Frontier|Spirit|Condor|Icelandair|Air Transat|Porter|Sun Country|Eurowings|TUI Fly)/i;
    const aircraftLike  = /(Boeing|Airbus|Embraer|Bombardier|CRJ|E-?Jet|Dreamliner|neo|MAX|777|787|737|A3\d{2}|A220|A321|A320|A319|A330|A350)/i;
    const timeLike      = /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?$/i;
    const durationLike  = /^\d+h(?:\s?\d+m)?$/i;
    const changeLike    = /Change planes in/i;
    const operatedLike  = /·\s*Operated by/i;
    const departHdr     = /^(Depart|Departure|Outbound)(?:\s*[•·])?/i;
    const returnHdr     = /^(Return|Inbound)(?:\s*[•·])?/i;
    const arrivesLike   = /^Arrives\b/i;
    const overnightLike = /Overnight flight/i;
    const airportLike   = /\([A-Z]{3}\)/;
    const wifiLike      = /Wi-?Fi available/i;
    const limitedSeats  = /Limited seats remaining/i;
    const flightCodeLike = /^[A-Z]{2,3}\s?\d{1,4}$/;

    const blacklist = [
      /^\$\d/, /Select/, /deal(s)?\s*from/i, /per\s*son/i,
      /Business Basic|Economy|Premium|Upper Class/i, /^Bags?$/i, /^Seat(s)?$/i, /^CO2/i
    ];
    const bookingClassLike = /\(([A-Z0-9]{1,2})\)/;

    const dowPartLike = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,]?$/i;
    const monthPartLike = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\.?|,)?$/i;
    const monthDayLike = /^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,]?\s*)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s*\d{1,2}(?:st|nd|rd|th)?$/i;
    const dayNumberLike = /^\d{1,2}(?:st|nd|rd|th)?$/i;

    for(let i = 0; i < tokens.length; i++){
      const t = tokens[i];
      const next = tokens[i + 1] || '';
      if (blacklist.some(rx => rx.test(t))){
        if(bookingClassLike.test(t)){
          keep.push(t);
        }
        continue;
      }

      if (departHdr.test(t) || returnHdr.test(t) ||
          durationLike.test(t) || airlineLike.test(t) || aircraftLike.test(t) ||
          timeLike.test(t) || airportLike.test(t) || changeLike.test(t) ||
          operatedLike.test(t) || arrivesLike.test(t) || overnightLike.test(t) ||
          flightCodeLike.test(t) ||
          wifiLike.test(t) || limitedSeats.test(t) ||
          monthDayLike.test(t)) {
        keep.push(t);
        continue;
      }

      if (dowPartLike.test(t) || monthPartLike.test(t)){
        keep.push(t);
        continue;
      }

      if (dayNumberLike.test(t) && (monthPartLike.test(next) || dowPartLike.test(next))){
        keep.push(t);
        continue;
      }

      const prevKept = keep[keep.length - 1] || '';
      if (dayNumberLike.test(t) && (monthPartLike.test(prevKept) || dowPartLike.test(prevKept))){
        keep.push(t);
      }
    }

    // Merge split tokens we care about
    const merged = [];
    for (let i=0;i<keep.length;i++){
      const t = keep[i];
      const next = keep[i+1] || '';

      // Case 1: "City" + "(CODE)"
      if (!/\([A-Z]{3}\)/.test(t) && /^\([A-Z]{3}\)$/.test(next)){
        merged.push(t + ' ' + next);
        i++;
        continue;
      }

      // Case 2: "<Airline Name>" + "<pure flight number>"
      const nameClean = t.trim();
      const mergedCode = (typeof lookupAirlineCodeByName === 'function')
        ? lookupAirlineCodeByName(nameClean)
        : (typeof AIRLINE_CODES !== 'undefined' ? AIRLINE_CODES[nameClean.toUpperCase()] : null);
      if (mergedCode && /^\d{1,4}$/.test(next)){
        merged.push(t + ' ' + next);
        i++;
        continue;
      }

      merged.push(t);
    }
    return merged.join('\n');
  }

  /* ---------- Observe + attach header buttons ---------- */

  function processNode(n){
    const card = findCardFrom(n);
    if (!card) return;
    ensureCardButton(card);
  }

  const mo = new MutationObserver((muts) => {
    let needsCleanup = false;
    let detailHint = false;
    let mutatedStructure = false;
    for (const m of muts){
      if (m.type === 'childList'){
        const addedCount = m.addedNodes ? m.addedNodes.length : 0;
        const removedCount = m.removedNodes ? m.removedNodes.length : 0;
        if (addedCount || removedCount){
          mutatedStructure = true;
        }
        if (m.addedNodes){
          m.addedNodes.forEach(n => { if (n.nodeType === 1) processNode(n); });
          if (IS_ITA && m.addedNodes.length){
            needsCleanup = true;
            detailHint = true;
          }
        }
        if (m.removedNodes && m.removedNodes.length){
          if (IS_ITA) {
            needsCleanup = true;
            detailHint = true;
          }
        }
      } else if (m.type === 'attributes'){
        if (m.attributeName === 'aria-expanded'){
          if (m.target && m.target.getAttribute('aria-expanded') === 'true'){
            processNode(m.target);
          } else if (m.target && m.target.getAttribute('aria-expanded') === 'false'){
            const card = findCardFrom(m.target);
            removeCardButton(card);
          }
        } else if (IS_ITA && m.attributeName === 'class'){
          const target = m.target;
          if (target && target.classList && target.classList.contains('row')){
            if (target.classList.contains('expanded-row')){
              processNode(target);
            } else {
              const detailCell = getItaDetailCell(target, true);
              if (detailCell){
                removeCardButton(detailCell);
              }
            }
            needsCleanup = true;
            detailHint = true;
          } else if (target && target.classList && target.classList.contains('detail-row')){
            needsCleanup = true;
            detailHint = true;
          }
        }
      }
    }
    if (IS_ITA && needsCleanup){
      const force = !itaObservedRoot || !itaObservedRoot.isConnected;
      cleanupItaGroups(force);
    }
    if (IS_ITA && detailHint){
      scheduleItaDetailEnsure();
    }
    if(mutatedStructure){
      invalidateReviewHeadingCache();
    }
    schedulePositionSync();
    scheduleCabinDetection();
    scheduleModalDimUpdate();
  });
  mo.observe(document.documentElement || document.body, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter: IS_ITA ? ['aria-expanded','class'] : ['aria-expanded']
  });

  const handleNavigationEvent = () => {
    invalidateReviewHeadingCache();
    scheduleCabinDetection();
    scheduleModalDimUpdate();
  };
  window.addEventListener('popstate', handleNavigationEvent);
  window.addEventListener('hashchange', handleNavigationEvent);
  window.addEventListener('pageshow', handleNavigationEvent);

  if (IS_ITA){
    const rescheduleDetail = () => scheduleItaDetailEnsure();
    window.addEventListener('popstate', rescheduleDetail);
    window.addEventListener('hashchange', rescheduleDetail);
    window.addEventListener('pageshow', () => scheduleItaDetailEnsure(true));
    const wrap = (fnName) => {
      const orig = history && history[fnName];
      if (typeof orig !== 'function') return;
      if (orig._kayakCopyWrapped) return;
      const wrapped = function (...args){
        const ret = orig.apply(this, args);
        try {
          rescheduleDetail();
          invalidateReviewHeadingCache();
        } catch (e) {}
        return ret;
      };
      wrapped._kayakCopyWrapped = true;
      history[fnName] = wrapped;
    };
    wrap('pushState');
    wrap('replaceState');
    scheduleItaDetailEnsure(true);
  }

  // Initial pass
  (function initialScan(){
    const matchers = IS_ITA
      ? [/\([A-Z]{3}\)\s+to\s+/i, /\bEconomy\b/i]
      : [/\bDepart\b/i];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        const v = (n.nodeValue || '').trim();
        if(!v) return NodeFilter.FILTER_SKIP;
        if(matchers.some(rx => rx.test(v))) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()){
      processNode(walker.currentNode.parentElement);
    }
  })();

  scheduleModalDimUpdate();
})();
