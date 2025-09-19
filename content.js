// content.js — place *I pill next to the section header time (Depart/Return)
(() => {
  'use strict';

  const BTN_CLASS  = 'kayak-copy-btn';
  const BTN_SEL    = '.' + BTN_CLASS;
  const MAX_CLIMB  = 12;

  // settings cache
  let SETTINGS = { bookingClass:'J', segmentStatus:'SS1' };
  chrome.storage.sync.get(['bookingClass','segmentStatus'], (res)=>{
    if (res && res.bookingClass)  SETTINGS.bookingClass  = String(res.bookingClass || 'J').toUpperCase();
    if (res && res.segmentStatus) SETTINGS.segmentStatus = String(res.segmentStatus || 'SS1').toUpperCase();
  });
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area!=='sync') return;
    if(chg.bookingClass)  SETTINGS.bookingClass  = String(chg.bookingClass.newValue  || 'J').toUpperCase();
    if(chg.segmentStatus) SETTINGS.segmentStatus = String(chg.segmentStatus.newValue || 'SS1').toUpperCase();
  });

  const isVisible = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
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

  /* ---------- Card + header detection ---------- */

  function looksLikeExpandedCard(el){
    if(!el || el.nodeType !== 1 || !isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 220 || r.width < 280) return false;
    const txt = (el.innerText || '');
    if (!/\bDepart\b/i.test(txt) || !/\bReturn\b/i.test(txt)) return false;
    const timeMatches = txt.match(/(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:am|pm)/ig) || [];
    return timeMatches.length >= 2;
  }

  // Find the expanded “card” container
  function findCardFrom(node){
    let el = node.nodeType === 1 ? node : node.parentElement;
    let hops = 0;
    while (el && hops++ < MAX_CLIMB) {
      if (looksLikeExpandedCard(el)) return el;
      el = el.parentElement;
    }
    // shallow descendant fallback
    if (node.nodeType === 1) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null);
      let count = 0;
      while (walker.nextNode() && count++ < 300) {
        const e = walker.currentNode;
        if (looksLikeExpandedCard(e)) return e;
      }
    }
    return null;
  }

  // Find the “Depart • …” and “Return • …” header elements inside a card
  function findSectionHeaders(card){
    const headers = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        const v = (n.nodeValue || '').trim();
        if(!v) return NodeFilter.FILTER_SKIP;
        if(/^Depart\s*•/i.test(v) || /^Return\s*•/i.test(v)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()){
      const el = walker.currentNode.parentElement;
      // Climb to a blocky ancestor that likely holds the duration on the right
      let h = el;
      for (let i=0; i<4 && h && h.parentElement; i++){
        const r = h.getBoundingClientRect();
        if (r.height > 24 && r.width > 200) break;
        h = h.parentElement;
      }
      if (h && isVisible(h)) headers.push(h);
    }
    return headers;
  }

  /* ---------- Button injection next to header time ---------- */

  function ensureHeaderButton(header, card){
    if (!header || !isVisible(header)) return;
    if (header.querySelector(BTN_SEL)) return;

    // Anchor header for absolute positioning
    if (getComputedStyle(header).position === 'static') {
      header.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.type = 'button';
    btn.title = 'Copy *I itinerary';
    btn.setAttribute('aria-label', 'Copy star-I itinerary');
    btn.textContent = '*I';

    // Inline/pill style placed to the right of the duration
    btn.style.cssText = [
      'position:absolute',
      'top:4px',
      'right:8px',
      'height:22px',
      'padding:0 8px',
      'border-radius:999px',
      'border:1px solid rgba(0,0,0,.15)',
      'background:rgba(255,255,255,.96)',
      'box-shadow:0 2px 8px rgba(0,0,0,.12)',
      'font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
      'cursor:pointer',
      'z-index:2147483000'
    ].join(';');

    header.appendChild(btn);

    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try{
        const raw = extractVisibleText(card);
        const txt = window.convertTextToI(raw, {
          bookingClass:  SETTINGS.bookingClass,
          segmentStatus: SETTINGS.segmentStatus
        });
        await navigator.clipboard.writeText(txt);
        toast('*I copied');
      }catch(err){
        console.error('Copy *I failed:', err);
        toast('Copy failed');
      }
    });
  }

  /* ---------- Visible text extractor (kept from previous build) ---------- */

  function extractVisibleText(root){
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
    const airlineLike   = /(Airlines?|Airways|Aviation|Virgin Atlantic|British Airways|United|Delta|KLM|Air Canada|American|Lufthansa|SWISS|Austrian|TAP|Aer Lingus|Iberia|Finnair|SAS|Turkish|Emirates|Qatar|Etihad|JetBlue|Alaska|Hawaiian|Frontier|Spirit)/i;
    const aircraftLike  = /(Boeing|Airbus|Embraer|Bombardier|CRJ|E-?Jet|Dreamliner|neo|MAX|777|787|737|A3\d{2}|A220|A321|A320|A319|A330|A350)/i;
    const timeLike      = /^(?:1[0-2]|0?[1-9]):[0-5]\d\s?(?:am|pm)$/i;
    const durationLike  = /^\d+h\s?\d+m$/i;
    const changeLike    = /Change planes in/i;
    const operatedLike  = /·\s*Operated by/i;
    const departHdr     = /^Depart\s*•/i;
    const returnHdr     = /^Return\s*•/i;
    const arrivesLike   = /^Arrives\b/i;
    const overnightLike = /Overnight flight/i;
    const airportLike   = /\([A-Z]{3}\)/;
    const wifiLike      = /Wi-?Fi available/i;
    const limitedSeats  = /Limited seats remaining/i;

    const blacklist = [
      /^\$\d/, /Select/, /deal(s)?\s*from/i, /per\s*son/i,
      /Business Basic|Economy|Premium|Upper Class/i, /^Bags?$/i, /^Seat(s)?$/i, /^CO2/i
    ];

    for(const t of tokens){
      if (blacklist.some(rx => rx.test(t))) continue;
      if (departHdr.test(t) || returnHdr.test(t) ||
          durationLike.test(t) || airlineLike.test(t) || aircraftLike.test(t) ||
          timeLike.test(t) || airportLike.test(t) || changeLike.test(t) ||
          operatedLike.test(t) || arrivesLike.test(t) || overnightLike.test(t) ||
          wifiLike.test(t) || limitedSeats.test(t)) {
        keep.push(t);
      }
    }

    // Merge split "City" + "(CODE)"
    const merged = [];
    for (let i=0;i<keep.length;i++){
      const t = keep[i];
      if (!/\([A-Z]{3}\)/.test(t) && i+1<keep.length && /^\([A-Z]{3}\)$/.test(keep[i+1])){
        merged.push(t + ' ' + keep[i+1]);
        i++;
      } else {
        merged.push(t);
      }
    }
    return merged.join('\n');
  }

  /* ---------- Observe + attach header buttons ---------- */

  function processNode(n){
    const card = findCardFrom(n);
    if (!card) return;
    const headers = findSectionHeaders(card);
    headers.forEach(h => ensureHeaderButton(h, card));
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts){
      if (m.type === 'childList'){
        m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType === 1) processNode(n); });
      } else if (m.type === 'attributes' && m.attributeName === 'aria-expanded'){
        if (m.target && m.target.getAttribute('aria-expanded') === 'true') processNode(m.target);
      }
    }
  });
  mo.observe(document.documentElement || document.body, {
    subtree:true, childList:true, attributes:true, attributeFilter:['aria-expanded']
  });

  // Initial pass
  (function initialScan(){
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        const v = (n.nodeValue || '').trim();
        if(!v) return NodeFilter.FILTER_SKIP;
        if(/(^|\s)Depart\b/i.test(v)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()){
      processNode(walker.currentNode.parentElement);
    }
  })();
})();
