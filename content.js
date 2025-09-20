// content.js — surface a floating *I copy button on expanded Kayak cards
(() => {
  'use strict';

  const BTN_CLASS   = 'kayak-copy-btn';
  const BTN_SEL     = '.' + BTN_CLASS;
  const ROOT_CLASS  = 'kayak-copy-root';
  const MAX_CLIMB   = 12;
  const SELECT_RX   = /\bSelect\b/i;

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
    const hasDepartLike = /\b(Depart|Departure|Outbound)\b/i.test(txt);
    const hasReturnLike = /\b(Return|Inbound|Arrival)\b/i.test(txt);
    if (!hasDepartLike && !hasReturnLike) return false;
    const timeMatches = txt.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig) || [];
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

  function findSelectButton(card){
    if (!card) return null;

    const preferredSelectors = [
      'button[data-testid*="select"]',
      'button[data-test*="select"]',
      'button[aria-label*="Select"]'
    ];

    for (const sel of preferredSelectors){
      const candidate = card.querySelector(sel);
      if (candidate && isVisible(candidate) && SELECT_RX.test(
        (candidate.textContent || '') + ' ' +
        (candidate.getAttribute('aria-label') || '')
      )) {
        return candidate;
      }
    }

    const candidates = card.querySelectorAll('button, a[role="button"], div[role="button"]');
    for (const candidate of candidates){
      if (!isVisible(candidate)) continue;
      const label = [
        candidate.textContent || '',
        candidate.getAttribute('aria-label') || '',
        candidate.getAttribute('data-test') || '',
        candidate.getAttribute('data-testid') || '',
        candidate.getAttribute('title') || ''
      ].join(' ');
      if (SELECT_RX.test(label)) return candidate;
    }

    return null;
  }

  /* ---------- Button injection near the primary Select button ---------- */

  function removeCardButton(card){
    if (!card) return;
    const btn = card.querySelector(BTN_SEL);
    if (btn) {
      const anchor = btn.parentElement;
      if (anchor && btn.dataset.anchorReset === '1') {
        anchor.style.position = '';
      }
      btn.remove();
    }
    card.classList.remove(ROOT_CLASS);
  }

  function ensureCardButton(card){
    if (!card || !isVisible(card)) return;

    const expansionHost = card.getAttribute('aria-expanded') != null
      ? card
      : card.closest('[aria-expanded]');
    if (expansionHost && expansionHost.getAttribute('aria-expanded') !== 'true'){
      removeCardButton(card);
      return;
    }

    if (card.querySelector(BTN_SEL)) return;

    const selectBtn = findSelectButton(card);
    if (!selectBtn) return;

    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.type = 'button';
    btn.title = 'Copy option details';
    btn.setAttribute('aria-label', 'Copy itinerary option details');
    btn.innerHTML = '<span aria-hidden="true" class="pill">*I</span>';

    card.classList.add(ROOT_CLASS);
    card.appendChild(btn);

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try{
        const raw = extractVisibleText(card);
        if(!raw || !raw.trim()){
          throw new Error('No itinerary details found');
        }

        let converted;
        try {
          converted = window.convertTextToI(raw, SETTINGS);
        } catch (parseErr) {
          console.error('Conversion failed:', parseErr);
          throw new Error(parseErr?.message || 'Conversion failed');
        }

        await navigator.clipboard.writeText(converted);
        toast('*I copied to clipboard');
      }catch(err){
        console.error('Copy option failed:', err);
        toast(err?.message || 'Copy failed');
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

    const dowPartLike = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,]?$/i;
    const monthPartLike = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\.?|,)?$/i;
    const monthDayLike = /^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,]?\s*)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s*\d{1,2}(?:st|nd|rd|th)?$/i;
    const dayNumberLike = /^\d{1,2}(?:st|nd|rd|th)?$/i;

    for(let i = 0; i < tokens.length; i++){
      const t = tokens[i];
      const next = tokens[i + 1] || '';
      if (blacklist.some(rx => rx.test(t))) continue;

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
      const nameUpper = t.trim().toUpperCase();
      if (typeof AIRLINE_CODES !== 'undefined' &&
          AIRLINE_CODES[nameUpper] &&
          /^\d{1,4}$/.test(next)){
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
    for (const m of muts){
      if (m.type === 'childList'){
        m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType === 1) processNode(n); });
      } else if (m.type === 'attributes' && m.attributeName === 'aria-expanded'){
        if (m.target && m.target.getAttribute('aria-expanded') === 'true'){
          processNode(m.target);
        } else if (m.target && m.target.getAttribute('aria-expanded') === 'false'){
          const card = findCardFrom(m.target);
          removeCardButton(card);
        }
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
