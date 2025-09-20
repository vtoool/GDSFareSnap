// content.js — surface a floating *I copy button on expanded Kayak cards
(() => {
  'use strict';

  const HOSTNAME = (location && location.hostname) || '';
  const IS_ITA = /(?:^|\.)matrix\.itasoftware\.com$/i.test(HOSTNAME);

  const BTN_CLASS    = 'kayak-copy-btn';
  const BTN_GROUP_CLASS = 'kayak-copy-btn-group';
  const OVERLAY_ROOT_ID = 'kayak-copy-overlay-root';
  const MAX_CLIMB   = 12;
  const SELECT_RX   = /\bSelect\b/i;
  const ITA_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

  let buttonConfigVersion = 0;
  let overlayRoot = null;
  let syncScheduled = false;

  const cardGroupMap = new WeakMap();
  const activeGroups = new Set();
  const itaGroupsByKey = new Map();

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
  let SETTINGS = { bookingClass:'J', segmentStatus:'SS1', enableDirectionButtons:false };
  chrome.storage.sync.get(['bookingClass','segmentStatus','enableDirectionButtons'], (res)=>{
    if (res && res.bookingClass)  SETTINGS.bookingClass  = String(res.bookingClass || 'J').toUpperCase();
    if (res && res.segmentStatus) SETTINGS.segmentStatus = String(res.segmentStatus || 'SS1').toUpperCase();
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
  });
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area!=='sync') return;
    if(chg.bookingClass)  SETTINGS.bookingClass  = String(chg.bookingClass.newValue  || 'J').toUpperCase();
    if(chg.segmentStatus) SETTINGS.segmentStatus = String(chg.segmentStatus.newValue || 'SS1').toUpperCase();
    if(chg.enableDirectionButtons){
      SETTINGS.enableDirectionButtons = !!chg.enableDirectionButtons.newValue;
      buttonConfigVersion++;
      refreshExistingGroups();
      scheduleItaDetailEnsure(true);
    }
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

  function shouldIgnoreCard(card){
    if(!card) return true;
    if(card.closest('.CRPe-main-banner-content')) return true;
    if(card.closest('.h_nb')) return true;
    if(cardLooksLikeAd(card)) return true;
    return false;
  }

  function cardHasFlightClues(card){
    const txt = (card && typeof card.innerText === 'string') ? card.innerText : '';
    if(!txt) return false;
    const timeMatches = txt.match(/(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?/ig) || [];
    const airportMatches = txt.match(/\([A-Z]{3}\)/g) || [];
    if(timeMatches.length < 2 || airportMatches.length < 2) return false;
    const durationMatches = txt.match(/\d+h(?:\s?\d+m)?/ig) || [];
    const flightNumberMatches = txt.match(/\b[A-Z]{1,3}\s?\d{1,4}\b/g) || [];
    const keywordMatches = txt.match(/\b(Depart|Departure|Return|Inbound|Outbound|Arrives|Operated by|Change planes)\b/ig) || [];
    const hasFlightNumber = flightNumberMatches.some(code => {
      const normalized = code.replace(/\s+/g, '');
      return /[A-Z]{2}\d{1,4}/i.test(normalized);
    });
    return hasFlightNumber || durationMatches.length > 0 || keywordMatches.length > 0;
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
    const candidates = new Set();
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
      document.querySelectorAll(sel).forEach(el => candidates.add(el));
    });

    if(document.body){
      Array.from(document.body.children).forEach(el => candidates.add(el));
    }

    let maxBottom = 0;
    candidates.forEach(el => {
      if(!el || el === overlayRoot) return;
      if(el.closest && el.closest(`#${OVERLAY_ROOT_ID}`)) return;
      const cs = getComputedStyle(el);
      if(cs.position !== 'fixed' && cs.position !== 'sticky') return;
      if(cs.display === 'none' || cs.visibility === 'hidden') return;
      if(parseFloat(cs.opacity || '1') === 0) return;
      const rect = el.getBoundingClientRect();
      if(!rect || rect.bottom <= 0) return;
      if(rect.top > 180) return;
      if(rect.height < 20) return;
      if(rect.width < Math.min(viewWidth, 280)) return;
      maxBottom = Math.max(maxBottom, rect.bottom);
    });

    cachedAvoidTop = maxBottom || 0;
    return cachedAvoidTop;
  }

  function getButtonConfigs(){
    const configs = [{
      key: 'all',
      label: '*I',
      title: 'Copy itinerary option details',
      ariaLabel: 'Copy itinerary option details to clipboard',
      direction: 'all'
    }];
    if(SETTINGS.enableDirectionButtons){
      configs.push({
        key: 'ob',
        label: 'OB',
        title: 'Copy outbound segments',
        ariaLabel: 'Copy outbound segments to clipboard',
        direction: 'outbound'
      });
      configs.push({
        key: 'ib',
        label: 'IB',
        title: 'Copy inbound segments',
        ariaLabel: 'Copy inbound segments to clipboard',
        direction: 'inbound'
      });
    }
    return configs;
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
        const direction = config.direction || 'all';
        let converted;
        try {
          if(direction === 'all'){
            converted = window.convertTextToI(raw, baseOpts);
          }else{
            converted = window.convertTextToAvailability(raw, { direction });
          }
        } catch (parseErr) {
          console.error('Conversion failed:', parseErr);
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

  function buildGroupForCard(card, group){
    if(!group) return;
    const configs = getButtonConfigs();
    group.innerHTML = '';
    configs.forEach(cfg => {
      group.appendChild(createButton(card, cfg));
    });
    group.dataset.configVersion = String(buttonConfigVersion);
    group.classList.toggle('kayak-copy-btn-group--ita', group.dataset.inline === '1');
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
      overlayRoot.style.zIndex = '2147483000';
    }
    const host = document.body || document.documentElement;
    if (host && overlayRoot.parentNode !== host) {
      host.appendChild(overlayRoot);
    }
    return overlayRoot;
  }

  function registerGroup(card, group){
    if (!group) return;
    group.__kayakCard = card;
    activeGroups.add(group);
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
    delete group.__kayakCard;
  }

  function clamp(value, min, max){
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function positionGroup(card, group){
    if (!card || !group) return;
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
    const maxLeft = Math.max(0, viewWidth - groupRect.width - 4);
    const desiredTop = rect.top + 10;
    const top = clamp(Math.max(desiredTop, avoidTop + 8), avoidTop + 4, maxTop);
    const left = clamp(rect.right - groupRect.width - 10, 4, maxLeft);

    group.style.top = `${Math.round(top)}px`;
    group.style.left = `${Math.round(left)}px`;
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

  function cleanupItaGroups(force = false){
    if (!IS_ITA) return;
    const snapshot = Array.from(activeGroups);
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
        return;
      }
      const key = group.dataset && group.dataset.itaKey;
      if (card) {
        removeCardButton(card);
      } else {
        if (key && itaGroupsByKey.get(key) === group) {
          itaGroupsByKey.delete(key);
        }
        unregisterGroup(group);
        if (group.parentNode) {
          group.remove();
        }
      }
    });
    if (force) {
      itaGroupsByKey.clear();
    }
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

  function looksLikeExpandedCard(el){
    if(IS_ITA){
      return looksLikeItaExpandedCard(el);
    }
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
    if (IS_ITA) {
      const detail = getItaDetailCell(node, false);
      if (detail) {
        return normalizeItaCard(detail);
      }
    }
    let el = node.nodeType === 1 ? node : node.parentElement;
    let hops = 0;
    while (el && hops++ < MAX_CLIMB) {
      if (looksLikeExpandedCard(el)) return normalizeItaCard(el);
      el = el.parentElement;
    }
    // shallow descendant fallback
    if (node.nodeType === 1) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null);
      let count = 0;
      while (walker.nextNode() && count++ < 300) {
        const e = walker.currentNode;
        if (looksLikeExpandedCard(e)) return normalizeItaCard(e);
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
    if (IS_ITA){
      card = normalizeItaCard(card, { allowCollapsed: true });
    }
    const group = cardGroupMap.get(card);
    if (group){
      const key = group.dataset && group.dataset.itaKey;
      if (key && itaGroupsByKey.get(key) === group) {
        itaGroupsByKey.delete(key);
      }
      const host = group.__inlineHost;
      unregisterGroup(group);
      if (group.parentNode) group.remove();
      if (host && host.classList){
        host.classList.remove('kayak-copy-inline-host');
      }
      cardGroupMap.delete(card);
    }
    schedulePositionSync();
  }

  function ensureItaButton(card){
    if (!card) return;

    card = normalizeItaCard(card);

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
      if (existing && existing.__kayakCard !== card){
        if (existing.__kayakCard){
          removeCardButton(existing.__kayakCard);
        } else {
          itaGroupsByKey.delete(key);
          unregisterGroup(existing);
          if (existing.parentNode) existing.remove();
        }
      }
    }

    let group = cardGroupMap.get(card);
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
      buildGroupForCard(card, group);
    }else{
      const prevHost = group.__inlineHost;
      if (prevHost && prevHost !== host && prevHost.classList){
        prevHost.classList.remove('kayak-copy-inline-host');
      }
      group.dataset.inline = '1';
      group.__inlineHost = host;
      group.__kayakSummaryRow = summaryRow;
      group.__kayakDetailRow = detailRow;
      group.classList.add('kayak-copy-btn-group--ita');
      if (!activeGroups.has(group)){
        registerGroup(card, group);
      }
      if (group.dataset.configVersion !== String(buttonConfigVersion)){
        buildGroupForCard(card, group);
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

    if (group.parentNode !== host){
      host.appendChild(group);
    }

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

    const selectBtn = findSelectButton(card);
    if (!selectBtn && !IS_ITA){
      removeCardButton(card);
      return;
    }

    if(selectBtn){
      const selectRect = selectBtn.getBoundingClientRect();
      if (selectRect.width < 80 || selectRect.height < 28){
        removeCardButton(card);
        return;
      }
    }

    if(!cardHasFlightClues(card)){
      removeCardButton(card);
      return;
    }

    const root = ensureOverlayRoot();
    let group = cardGroupMap.get(card);
    if(!group){
      group = document.createElement('div');
      group.className = BTN_GROUP_CLASS;
      group.setAttribute('role', 'group');
      group.style.position = 'fixed';
      group.style.pointerEvents = 'auto';
      group.style.visibility = 'hidden';
      root.appendChild(group);
      cardGroupMap.set(card, group);
      registerGroup(card, group);
      buildGroupForCard(card, group);
    }else{
      if (!activeGroups.has(group)){
        registerGroup(card, group);
      }
      if (!group.isConnected){
        root.appendChild(group);
      }
      if(group.dataset.configVersion !== String(buttonConfigVersion)){
        buildGroupForCard(card, group);
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

    if (targetChanged || currentVersion !== String(buttonConfigVersion)){
      itaDetailGroup.innerHTML = '';
      const configs = getButtonConfigs();
      configs.forEach(cfg => {
        const btn = createButton(detailTarget, cfg);
        btn.dataset.itaDetail = '1';
        itaDetailGroup.appendChild(btn);
      });
      itaDetailGroup.dataset.configVersion = String(buttonConfigVersion);
    }
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
    const delay = immediate ? 0 : Math.min(420, 120 + itaDetailRetryCount * 160);
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
    if(typeof AIRLINE_CODES !== 'undefined' && AIRLINE_CODES[normalized]) return true;
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
    let needsCleanup = false;
    let detailHint = false;
    for (const m of muts){
      if (m.type === 'childList'){
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
    schedulePositionSync();
  });
  mo.observe(document.documentElement || document.body, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter: IS_ITA ? ['aria-expanded','class'] : ['aria-expanded']
  });

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
})();
