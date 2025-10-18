(() => {
  'use strict';

  const MONTH_INDEX = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DOW_CHARS = ['S','M','T','W','Q','F','J'];
  const ROOT_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
  const PREFERRED_RBD_FN = ROOT_SCOPE && typeof ROOT_SCOPE.getPreferredRBD === 'function' ? ROOT_SCOPE.getPreferredRBD : null;
  const SHORT_HAUL_CHECK_FN = ROOT_SCOPE && typeof ROOT_SCOPE.shouldTreatSegmentAsShortHaul === 'function'
    ? ROOT_SCOPE.shouldTreatSegmentAsShortHaul
    : null;
  const NORMALIZE_CABIN_FN = ROOT_SCOPE && typeof ROOT_SCOPE.normalizeCabinEnum === 'function' ? ROOT_SCOPE.normalizeCabinEnum : null;
  const CABIN_FALLBACK_BOOKING = { FIRST: 'F', BUSINESS: 'J', PREMIUM: 'N', ECONOMY: 'Y' };
  const SHORT_HAUL_LIMIT_MINUTES = 360;

  const bookingInput = document.getElementById('bookingClass');
  const statusInput = document.getElementById('segmentStatus');
  const enableDirections = document.getElementById('enableDirections');
  const detailedAvailabilityToggle = document.getElementById('detailedAvailability');
  const okEl = document.getElementById('ok');
  const saveBtn = document.getElementById('saveBtn');

  const viInput = document.getElementById('viInput');
  const convertBtn = document.getElementById('convertBtn');
  const copyBtn = document.getElementById('copyBtn');
  const outputEl = document.getElementById('iOutput');
  const convertErrorEl = document.getElementById('convertError');
  const convertStatusEl = document.getElementById('convertStatus');

  const bookingStatusNote = document.getElementById('bookingStatusNote');
  const restoreAutoBtn = document.getElementById('restoreAutoBtn');
  const availabilityPreview = document.getElementById('availabilityPreview');

  const COPY_SUCCESS_LABEL = 'Copied';
  const COPY_RESET_DELAY = 1600;
  const copyBtnDefaultLabel = copyBtn && copyBtn.textContent ? copyBtn.textContent.trim() || 'Copy result' : 'Copy result';

  if (bookingStatusNote){
    bookingStatusNote.textContent = 'Checking auto cabin detection…';
  }
  if (restoreAutoBtn){
    restoreAutoBtn.style.display = 'none';
  }
  if (availabilityPreview){
    availabilityPreview.style.display = 'none';
    availabilityPreview.setAttribute('aria-hidden', 'true');
  }

  const state = {
    bookingClassLocked: false,
    originalBookingClass: 'J',
    bookingEdited: false,
    autoCopy: true,
    lastInput: '',
    lastResult: '',
    lastCopied: '',
    lastSegments: [],
    availabilityCommands: [],
    lastAvailabilityCopiedIndex: -1,
    copyLabelTimer: null,
    copyHoldUntil: 0,
    detailedAvailability: false
  };

  function normalizeCabinValue(value){
    if (!value && value !== 0) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (NORMALIZE_CABIN_FN){
      try {
        const normalized = NORMALIZE_CABIN_FN(raw);
        if (normalized) return normalized;
      } catch (err) {}
    }
    const upper = raw.toUpperCase();
    if (upper.includes('FIRST')) return 'FIRST';
    if (upper.includes('BUS')) return 'BUSINESS';
    if (upper.includes('PREMIUM')) return 'PREMIUM';
    if (upper.includes('ECONOMY') || upper.includes('COACH') || upper.includes('MAIN CABIN')) return 'ECONOMY';
    return null;
  }

  function resolveCabinForSegment(segment){
    if (!segment) return null;
    const normalized = normalizeCabinValue(segment.cabinRaw || segment.cabin);
    if (!normalized) return null;
    const minutes = segmentDurationToMinutes(segment);
    let treatAsShort = false;
    if (SHORT_HAUL_CHECK_FN){
      try {
        treatAsShort = !!SHORT_HAUL_CHECK_FN({
          durationMinutes: minutes,
          origin: segment ? (segment.depAirport || segment.origin) : '',
          destination: segment ? (segment.arrAirport || segment.dest) : ''
        });
      } catch (err) {
        treatAsShort = false;
      }
    } else if (minutes != null && minutes <= SHORT_HAUL_LIMIT_MINUTES){
      treatAsShort = true;
    }
    if (treatAsShort){
      if (normalized === 'FIRST'){
        return 'BUSINESS';
      }
      if (normalized === 'PREMIUM'){
        return 'ECONOMY';
      }
    }
    return normalized;
  }

  function segmentDurationToMinutes(segment){
    if (!segment) return null;
    if (Number.isFinite(segment.durationMinutes)) return segment.durationMinutes;
    if (Number.isFinite(segment.elapsedMinutes)) return segment.elapsedMinutes;
    if (Number.isFinite(segment.elapsedHours)) return Math.round(segment.elapsedHours * 60);
    return null;
  }

  function pickPreferredBookingClass(airlineCode, cabinEnum, fallback, segment){
    const base = (fallback || '').toString().trim().toUpperCase();
    if (!cabinEnum){
      return base;
    }
    let candidate = '';
    if (PREFERRED_RBD_FN){
      try {
        candidate = PREFERRED_RBD_FN({
          airlineCode: airlineCode || '',
          marketedCabin: cabinEnum,
          durationMinutes: segmentDurationToMinutes(segment),
          origin: segment ? toAirportCode(segment.depAirport || segment.origin) : '',
          destination: segment ? toAirportCode(segment.arrAirport || segment.dest) : ''
        }) || '';
      } catch (err) {
        candidate = '';
      }
    }
    if (!candidate && Object.prototype.hasOwnProperty.call(CABIN_FALLBACK_BOOKING, cabinEnum)){
      candidate = CABIN_FALLBACK_BOOKING[cabinEnum] || '';
    }
    const cleaned = (candidate || '').toString().trim().toUpperCase();
    return cleaned || base || CABIN_FALLBACK_BOOKING.ECONOMY;
  }

  const scheduleAutoConvert = debounce((reason) => runConversion(reason || 'auto'), 140);

  chrome.storage.sync.get([
    'bookingClass',
    'segmentStatus',
    'enableDirectionButtons',
    'bookingClassLocked',
    'detailedAvailability'
  ], (res) => {
    const bookingValue = sanitizeBookingClass(res && res.bookingClass);
    const segmentStatus = sanitizeSegmentStatus(res && res.segmentStatus);
    if (bookingInput){
      bookingInput.value = bookingValue;
    }
    if (statusInput){
      statusInput.value = segmentStatus;
    }
    if (enableDirections){
      enableDirections.checked = !!(res && res.enableDirectionButtons);
    }
    const detailedFlag = !!(res && res.detailedAvailability);
    if (detailedAvailabilityToggle){
      detailedAvailabilityToggle.checked = detailedFlag;
    }
    state.originalBookingClass = bookingValue;
    state.bookingClassLocked = !!(res && res.bookingClassLocked);
    state.bookingEdited = false;
    state.detailedAvailability = detailedFlag;
    updateAutoDetectionNote();
  });

  if (bookingInput){
    bookingInput.addEventListener('input', () => {
      state.bookingEdited = true;
      updateAutoDetectionNote();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.bookingClassLocked){
      state.bookingClassLocked = !!changes.bookingClassLocked.newValue;
      updateAutoDetectionNote();
    }
    if (changes.bookingClass && !state.bookingEdited){
      const nextValue = sanitizeBookingClass(changes.bookingClass.newValue);
      if (bookingInput){
        bookingInput.value = nextValue;
      }
      state.originalBookingClass = nextValue;
      updateAutoDetectionNote();
    }
    if (changes.detailedAvailability){
      state.detailedAvailability = !!changes.detailedAvailability.newValue;
      if (detailedAvailabilityToggle){
        detailedAvailabilityToggle.checked = state.detailedAvailability;
      }
      updateAvailabilityPreview(state.lastInput || '');
    }
  });

  if (saveBtn){
    saveBtn.addEventListener('click', () => {
      const bookingClass = bookingInput ? sanitizeBookingClass(bookingInput.value) : 'J';
      const segmentStatus = statusInput ? sanitizeSegmentStatus(statusInput.value) : 'SS1';
      if (bookingInput) bookingInput.value = bookingClass;
      if (statusInput) statusInput.value = segmentStatus;
      const enableDir = !!(enableDirections && enableDirections.checked);
      const detailedAvail = !!(detailedAvailabilityToggle && detailedAvailabilityToggle.checked);
      const shouldLock = state.bookingEdited ? true : state.bookingClassLocked;
      chrome.storage.sync.set({
        bookingClass,
        segmentStatus,
        enableDirectionButtons: enableDir,
        bookingClassLocked: shouldLock,
        detailedAvailability: detailedAvail
      }, () => {
        if (okEl){
          okEl.textContent = 'Saved';
          okEl.style.display = 'inline-block';
        }
        state.bookingClassLocked = shouldLock;
        state.originalBookingClass = bookingClass;
        state.bookingEdited = false;
        state.detailedAvailability = detailedAvail;
        updateAutoDetectionNote();
        setTimeout(() => { window.close(); }, 600);
      });
    });
  }

  if (restoreAutoBtn){
    restoreAutoBtn.addEventListener('click', () => {
      if (!state.bookingClassLocked){
        updateAutoDetectionNote();
        return;
      }
      restoreAutoBtn.disabled = true;
      chrome.storage.sync.set({ bookingClassLocked: false }, () => {
        state.bookingClassLocked = false;
        state.bookingEdited = false;
        updateAutoDetectionNote();
        restoreAutoBtn.disabled = false;
      });
    });
  }

  if (detailedAvailabilityToggle){
    detailedAvailabilityToggle.addEventListener('change', () => {
      state.detailedAvailability = !!detailedAvailabilityToggle.checked;
      updateAvailabilityPreview(state.lastInput || '');
    });
  }

  if (viInput){
    viInput.addEventListener('input', () => {
      if (!viInput.value.trim()){
        resetConversionState();
        return;
      }
      scheduleAutoConvert('auto');
    });
    viInput.addEventListener('paste', () => {
      requestAnimationFrame(() => runConversion('auto'));
    });
    viInput.addEventListener('drop', () => {
      setTimeout(() => runConversion('auto'), 0);
    });
  }

  if (convertBtn){
    convertBtn.addEventListener('click', () => {
      runConversion('manual');
    });
  }

  if (copyBtn){
    copyBtn.addEventListener('click', () => {
      handleManualCopy();
    });
  }

  if (availabilityPreview){
    availabilityPreview.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('.availability-pill') : null;
      if (!button) return;
      event.preventDefault();
      const index = parseInt(button.getAttribute('data-index') || '', 10);
      if (!Number.isFinite(index) || index < 0) return;
      if (button.disabled) return;
      button.disabled = true;
      copyAvailabilityCommand(index, button).finally(() => {
        button.disabled = false;
      });
    });
  }

  async function runConversion(reason = 'auto'){
    if (!viInput || !outputEl) return;
    const raw = (viInput.value || '').trim();
    if (!raw){
      resetConversionState();
      if (reason === 'manual'){
        showError('Paste VI* text first.');
      }
      return;
    }

    resetFeedback();
    resetCopyButtonLabel();
    if (copyBtn){
      copyBtn.disabled = true;
    }

    const sameInput = state.lastInput === raw;

    try {
      const bookingClass = bookingInput ? sanitizeBookingClass(bookingInput.value) : 'J';
      const segmentStatus = statusInput ? sanitizeSegmentStatus(statusInput.value) : 'SS1';
      if (bookingInput) bookingInput.value = bookingClass;
      if (statusInput) statusInput.value = segmentStatus;

      const conversion = convertViToI(raw, {
        bookingClass,
        segmentStatus,
        autoCabin: !state.bookingClassLocked
      }) || {};
      const itineraryText = typeof conversion.text === 'string' ? conversion.text : '';
      const segments = Array.isArray(conversion.segments) ? conversion.segments : [];
      state.lastInput = raw;
      state.lastSegments = segments;
      outputEl.value = itineraryText;

      if (!itineraryText){
        state.lastResult = '';
        state.lastCopied = '';
        state.lastSegments = [];
        if (copyBtn) copyBtn.disabled = true;
        updateAvailabilityPreview('');
        showError('No segments found in VI* text.');
        return;
      }

      state.lastResult = itineraryText;
      if (copyBtn) copyBtn.disabled = false;
      const segmentCount = segments.length || itineraryText.split('\n').filter(line => line.trim()).length;
      updateAvailabilityPreview(raw);
      const shouldAutoCopy = state.autoCopy && (!sameInput || itineraryText !== state.lastCopied);

      if (shouldAutoCopy){
        const outcome = await copyOutputText(itineraryText);
        if (outcome.ok){
          state.lastCopied = itineraryText;
          showStatus(`Copied ${segmentCount} segment${segmentCount === 1 ? '' : 's'} to clipboard.`);
          flashCopyButtonLabel();
          return;
        }
        state.lastCopied = '';
        if (outcome.fallback){
          showError('Clipboard blocked. Result selected for manual copy.');
          return;
        }
        showError('Copy failed. Use the Copy button.');
        return;
      }

      showStatus(`Converted ${segmentCount} segment${segmentCount === 1 ? '' : 's'}.`);
      resetCopyButtonLabel();
    } catch (err){
      state.lastResult = '';
      state.lastCopied = '';
      state.lastSegments = [];
      outputEl.value = '';
      if (copyBtn) copyBtn.disabled = true;
      updateAvailabilityPreview('');
      const message = err && err.message ? err.message : 'Could not convert itinerary.';
      showError(message);
      resetCopyButtonLabel(true);
    }
  }

  async function handleManualCopy(){
    if (!outputEl) return;
    resetFeedback();
    resetCopyButtonLabel(true);
    const text = (outputEl.value || '').trim();
    if (!text){
      showError('Nothing to copy yet.');
      return;
    }
    const outcome = await copyOutputText(text);
    if (outcome.ok){
      state.lastCopied = text;
      showStatus('Copied to clipboard.');
      flashCopyButtonLabel();
      return;
    }
    state.lastCopied = '';
    if (outcome.fallback){
      showError('Clipboard blocked. Result selected for manual copy.');
      return;
    }
    showError('Copy failed.');
  }

  async function copyOutputText(text){
    if (!text){
      return { ok: false };
    }
    if (navigator.clipboard && navigator.clipboard.writeText){
      try {
        await navigator.clipboard.writeText(text);
        return { ok: true };
      } catch (err) {
        // fall through to execCommand fallback
      }
    }
    if (outputEl){
      try {
        if (document.queryCommandSupported && document.queryCommandSupported('copy')){
          outputEl.focus();
          outputEl.select();
          if (document.execCommand('copy')){
            return { ok: true };
          }
        }
      } catch (err) {
        // ignore and continue to selection fallback
      }
      try {
        outputEl.focus();
        outputEl.select();
      } catch (err) {}
    }
    return { ok: false, fallback: true };
  }

  async function copyAvailabilityCommand(index, triggerButton){
    if (!Array.isArray(state.availabilityCommands) || !state.availabilityCommands[index]){
      showError('No availability command to copy yet.');
      return;
    }
    const entry = state.availabilityCommands[index];
    const commandText = (entry && entry.command ? String(entry.command) : '').trim();
    if (!commandText){
      showError('No availability command to copy yet.');
      return;
    }
    resetFeedback();
    const copied = await copyPlainText(commandText);
    if (copied){
      state.lastAvailabilityCopiedIndex = index;
      const label = entry && entry.label ? entry.label : `Journey ${index + 1}`;
      showStatus(`Copied availability (${label}).`);
      return;
    }
    if (triggerButton && typeof triggerButton.focus === 'function'){
      triggerButton.focus();
    }
    highlightAvailabilityCommand(index);
    showError(`Clipboard blocked. Command: ${commandText}`);
  }

  async function copyPlainText(text){
    if (!text){
      return false;
    }
    if (navigator.clipboard && navigator.clipboard.writeText){
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {}
    }
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'absolute';
    temp.style.opacity = '0';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    temp.style.pointerEvents = 'none';
    document.body.appendChild(temp);
    let ok = false;
    try {
      temp.select();
      ok = !!(document.execCommand && document.execCommand('copy'));
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(temp);
    return ok;
  }

  function highlightAvailabilityCommand(index){
    if (!availabilityPreview) return;
    try {
      const commandEl = availabilityPreview.querySelector(`.availability-pill__code[data-command-index="${index}"]`);
      if (!commandEl) return;
      const selection = window.getSelection ? window.getSelection() : null;
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(commandEl);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (err) {}
  }

  function updateAvailabilityPreview(rawText){
    if (!availabilityPreview){
      return;
    }
    const trimmed = (rawText || '').trim();
    const useDetailed = !!state.detailedAvailability;
    availabilityPreview.innerHTML = '';
    state.availabilityCommands = [];
    state.lastAvailabilityCopiedIndex = -1;
    if (!trimmed || typeof window.convertTextToAvailability !== 'function'){
      availabilityPreview.style.display = 'none';
      availabilityPreview.setAttribute('aria-hidden', 'true');
      return;
    }
    let preview = null;
    try {
      preview = typeof window.peekSegments === 'function' ? window.peekSegments(trimmed) : null;
    } catch (err) {
      console.warn('peekSegments preview failed:', err);
      preview = null;
    }
    let journeys = preview && Array.isArray(preview.journeys) ? preview.journeys : [];
    let segments = preview && Array.isArray(preview.segments) ? preview.segments : [];
    let directionGroups = (typeof window.computeDirectionsFromSegments === 'function' && segments.length)
      ? window.computeDirectionsFromSegments(segments, { journeys })
      : [];
    const commands = [];
    let isMultiCity = !!(preview && preview.isMultiCity);
    const airportCode = toAirportCode;
    const formatDirectionLabel = (direction, fallbackIdx) => {
      if (!direction){
        return `Journey ${fallbackIdx + 1}`;
      }
      const kind = (direction.kind || '').toLowerCase();
      const origin = airportCode(direction.od && direction.od[0]);
      const dest = airportCode(direction.od && direction.od[1]);
      const route = origin && dest ? `${origin}-${dest}` : '';
      if (kind === 'outbound'){
        return route ? `OB ${route}` : 'OB';
      }
      if (kind === 'inbound'){
        return route ? `IB ${route}` : 'IB';
      }
      const ordinal = Number.isFinite(direction.index) ? direction.index + 1 : fallbackIdx + 1;
      if (route){
        return `${ordinal} ${route}`;
      }
      return `Journey ${ordinal}`;
    };
    const formatJourneyLabel = (journey, idx) => {
      if (!journey){
        return `Journey ${idx + 1}`;
      }
      const ordinal = Number.isFinite(journey.indexHint) && journey.indexHint > 0
        ? journey.indexHint
        : idx + 1;
      const origin = airportCode(journey.origin);
      const dest = airportCode(journey.dest);
      const route = origin && dest ? `${origin}-${dest}` : '';
      if (route){
        return `${ordinal} ${route}`;
      }
      return `Journey ${ordinal}`;
    };
    if (!isMultiCity && directionGroups.length){
      const sortedDirections = directionGroups.slice().sort((a, b) => {
        const priority = (entry) => {
          if (!entry) return 99;
          const kind = (entry.kind || '').toLowerCase();
          if (kind === 'outbound') return 0;
          if (kind === 'inbound') return 1;
          return 2 + (Number.isFinite(entry.index) ? entry.index : 0);
        };
        const diff = priority(a) - priority(b);
        if (diff !== 0) return diff;
        const idxA = Number.isFinite(a && a.index) ? a.index : 0;
        const idxB = Number.isFinite(b && b.index) ? b.index : 0;
        return idxA - idxB;
      });
      sortedDirections.forEach((direction, idx) => {
        if (!direction) return;
        const range = Array.isArray(direction.range) && direction.range.length === 2
          ? [ Number(direction.range[0]), Number(direction.range[1]) ]
          : null;
        if (!range) return;
        try {
          const command = window.convertTextToAvailability(trimmed, {
            direction: 'all',
            segmentRange: range,
            detailed: useDetailed
          });
          if (command){
            commands.push({ label: formatDirectionLabel(direction, idx), command });
          }
        } catch (err) {
          console.warn('Availability command build failed:', err);
        }
      });
    }
    if ((isMultiCity && journeys.length) || (!commands.length && journeys.length)){
      journeys.forEach((journey, idx) => {
        if (!journey) return;
        try {
          const command = window.convertTextToAvailability(trimmed, {
            journeyIndex: idx,
            direction: 'all',
            detailed: useDetailed
          });
          if (command){
            const label = isMultiCity ? formatJourneyLabel(journey, idx) : formatDirectionLabel(null, idx);
            commands.push({ label, command });
          }
        } catch (err) {
          console.warn('Availability command build failed:', err);
        }
      });
    }
    if (!commands.length){
      try {
        const fallback = window.convertTextToAvailability(trimmed, {
          direction: 'all',
          detailed: useDetailed
        });
        if (fallback){
          commands.push({ label: 'All segments', command: fallback });
        }
      } catch (err) {
        console.warn('Availability command build failed:', err);
      }
    }
    if (!commands.length && Array.isArray(state.lastSegments) && state.lastSegments.length){
      const viPreview = buildViAvailabilityPreview(state.lastSegments);
      if (viPreview){
        if (!isMultiCity && viPreview.isMultiCity){
          isMultiCity = true;
        }
        const viCommands = buildViAvailabilityCommands({
          preview: viPreview,
          formatDirectionLabel,
          formatJourneyLabel
        });
        if (viCommands.length){
          viCommands.forEach(entry => commands.push(entry));
        }
      }
    }
    if (!commands.length){
      availabilityPreview.style.display = 'none';
      availabilityPreview.setAttribute('aria-hidden', 'true');
      return;
    }
    state.availabilityCommands = commands;
    const fragment = document.createDocumentFragment();
    commands.forEach((entry, idx) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'availability-pill';
      button.setAttribute('data-index', String(idx));
      const label = entry && entry.label ? String(entry.label) : `Journey ${idx + 1}`;
      const command = entry && entry.command ? String(entry.command) : '';
      if (command){
        button.setAttribute('data-command', command);
        button.title = command;
      } else {
        button.removeAttribute('title');
      }
      const labelSpan = document.createElement('span');
      labelSpan.className = 'availability-pill__label';
      labelSpan.textContent = label;
      const hiddenCode = document.createElement('code');
      hiddenCode.className = 'availability-pill__code';
      hiddenCode.setAttribute('data-command-index', String(idx));
      hiddenCode.textContent = command;
      button.appendChild(labelSpan);
      button.appendChild(hiddenCode);
      fragment.appendChild(button);
    });
    availabilityPreview.appendChild(fragment);
    availabilityPreview.style.display = 'flex';
    availabilityPreview.setAttribute('aria-hidden', 'false');
  }

  function toAirportCode(value){
    return value ? String(value).trim().toUpperCase() : '';
  }

  function toCarrierCode(value){
    if (!value && value !== 0) return '';
    return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function buildViAvailabilityPreview(sourceSegments){
    if (!Array.isArray(sourceSegments) || !sourceSegments.length){
      return null;
    }
    const normalized = sourceSegments.map((seg, idx) => {
      const carrier = toCarrierCode(seg && seg.airlineCode);
      return {
        depAirport: toAirportCode(seg && seg.depAirport),
        arrAirport: toAirportCode(seg && seg.arrAirport),
        depDate: seg && seg.depDateString ? String(seg.depDateString).toUpperCase() : '',
        marketingCarrier: carrier,
        airlineCode: carrier,
        direction: '',
        index: idx
      };
    });
    const journeys = inferViJourneysFromSegments(sourceSegments);
    if (!journeys.length){
      const fallbackJourney = buildViJourneyDescriptor(sourceSegments, 0, sourceSegments.length - 1, 1);
      if (fallbackJourney){
        journeys.push(fallbackJourney);
      }
    }
    journeys.forEach((journey, idx) => {
      if (!journey) return;
      if (journey.indexHint == null || !Number.isFinite(journey.indexHint)){
        journey.indexHint = idx + 1;
      }
      const kind = journey.sectionKind || journey.kind || '';
      journey.kind = kind;
      journey.sectionKind = kind;
      for (let i = journey.startIdx; i <= journey.endIdx && i < normalized.length; i++){
        if (!normalized[i]) continue;
        normalized[i].direction = kind;
      }
    });
    const isMultiCity = determineViMultiCity(journeys);
    return { segments: normalized, journeys, isMultiCity };
  }

  function determineViMultiCity(journeys){
    if (!Array.isArray(journeys) || journeys.length <= 1){
      return false;
    }
    if (journeys.length > 2){
      return true;
    }
    const first = journeys[0] || null;
    const second = journeys[1] || null;
    if (!first || !second){
      return false;
    }
    const startOrigin = toAirportCode(first.origin);
    const finalDest = toAirportCode(second.dest);
    const outboundDest = toAirportCode(first.dest);
    const inboundOrigin = toAirportCode(second.origin);
    if (startOrigin && finalDest && startOrigin === finalDest && outboundDest && inboundOrigin && outboundDest === inboundOrigin){
      return false;
    }
    return true;
  }

  function inferViJourneysFromSegments(segments){
    if (!Array.isArray(segments) || !segments.length){
      return [];
    }
    const journeys = [];
    let start = 0;
    for (let idx = 1; idx < segments.length; idx++){
      if (!isLikelyViConnection(segments[idx - 1], segments[idx])){
        const descriptor = buildViJourneyDescriptor(segments, start, idx - 1, journeys.length + 1);
        if (descriptor){
          journeys.push(descriptor);
        }
        start = idx;
      }
    }
    const finalDescriptor = buildViJourneyDescriptor(segments, start, segments.length - 1, journeys.length + 1);
    if (finalDescriptor){
      journeys.push(finalDescriptor);
    }
    if (journeys.length === 2){
      const first = journeys[0];
      const second = journeys[1];
      const startOrigin = toAirportCode(first && first.origin);
      const finalDest = toAirportCode(second && second.dest);
      const outboundDest = toAirportCode(first && first.dest);
      const inboundOrigin = toAirportCode(second && second.origin);
      if (startOrigin && finalDest && startOrigin === finalDest && outboundDest && inboundOrigin && outboundDest === inboundOrigin){
        first.kind = 'outbound';
        first.sectionKind = 'outbound';
        second.kind = 'inbound';
        second.sectionKind = 'inbound';
      }
    }
    journeys.forEach((journey, idx) => {
      if (!journey) return;
      if (journey.indexHint == null || !Number.isFinite(journey.indexHint)){
        journey.indexHint = idx + 1;
      }
      if (!journey.sectionKind){
        journey.sectionKind = journey.kind || '';
      }
    });
    return journeys;
  }

  function buildViJourneyDescriptor(segments, startIdx, endIdx, ordinal){
    if (!Array.isArray(segments) || !segments.length){
      return null;
    }
    const total = segments.length;
    const safeStart = Math.max(0, Number.isFinite(startIdx) ? startIdx : 0);
    const safeEndRaw = Number.isFinite(endIdx) ? endIdx : safeStart;
    const safeEnd = Math.max(safeStart, Math.min(total - 1, safeEndRaw));
    const first = segments[safeStart] || null;
    const last = segments[safeEnd] || first;
    return {
      startIdx: safeStart,
      endIdx: safeEnd,
      origin: first ? toAirportCode(first.depAirport) : '',
      dest: last ? toAirportCode(last.arrAirport) : '',
      explicit: true,
      indexHint: ordinal,
      kind: '',
      sectionKind: '',
      headerDate: null
    };
  }

  function isLikelyViConnection(prev, next){
    if (!prev || !next) return false;
    const prevArr = toAirportCode(prev.arrAirport);
    const nextDep = toAirportCode(next.depAirport);
    if (!prevArr || !nextDep || prevArr !== nextDep){
      return false;
    }
    const prevArrDate = prev.arrDateObj instanceof Date ? prev.arrDateObj : null;
    const nextDepDate = next.depDateObj instanceof Date ? next.depDateObj : null;
    if (prevArrDate && nextDepDate){
      const diffDays = Math.floor((nextDepDate - prevArrDate) / (24 * 60 * 60 * 1000));
      if (diffDays > 1){
        return false;
      }
    }
    return true;
  }

  function buildViAvailabilityCommands(config){
    if (!config || typeof config !== 'object') return [];
    const preview = config.preview || {};
    const formatDirectionLabel = typeof config.formatDirectionLabel === 'function'
      ? config.formatDirectionLabel
      : (direction, idx) => `Journey ${idx + 1}`;
    const formatJourneyLabel = typeof config.formatJourneyLabel === 'function'
      ? config.formatJourneyLabel
      : ((journey, idx) => `Journey ${idx + 1}`);
    const segments = Array.isArray(preview.segments) ? preview.segments : [];
    const journeys = Array.isArray(preview.journeys) ? preview.journeys : [];
    const isMultiCity = !!preview.isMultiCity;
    if (!segments.length){
      return [];
    }
    let directions = [];
    if (typeof window.computeDirectionsFromSegments === 'function'){
      try {
        directions = window.computeDirectionsFromSegments(segments, { journeys }) || [];
      } catch (err) {
        console.warn('computeDirectionsFromSegments failed for VI* preview:', err);
        directions = [];
      }
    }
    const seen = new Set();
    const commands = [];
    const directionList = isMultiCity ? directions : sortDirectionsForDisplay(directions);
    directionList.forEach((direction, idx) => {
      if (!direction) return;
      const command = buildViAvailabilityCommandForDirection(direction, segments);
      if (!command || seen.has(command)) return;
      const label = isMultiCity
        ? formatJourneyLabel(journeys && direction && Number.isFinite(direction.index) ? journeys[direction.index] || null : journeys[idx] || null, idx)
        : formatDirectionLabel(direction, idx);
      commands.push({ label, command });
      seen.add(command);
    });
    if (!commands.length){
      const fallbackCommand = buildViAvailabilityCommandForRange(segments, 0, segments.length - 1);
      if (fallbackCommand && !seen.has(fallbackCommand)){
        commands.push({ label: 'All segments', command: fallbackCommand });
      }
    }
    return commands;
  }

  function sortDirectionsForDisplay(directions){
    if (!Array.isArray(directions)){
      return [];
    }
    return directions.slice().sort((a, b) => {
      const priority = (entry) => {
        if (!entry) return 99;
        const kind = (entry.kind || '').toLowerCase();
        if (kind === 'outbound') return 0;
        if (kind === 'inbound') return 1;
        return 2 + (Number.isFinite(entry.index) ? entry.index : 0);
      };
      const diff = priority(a) - priority(b);
      if (diff !== 0) return diff;
      const idxA = Number.isFinite(a && a.index) ? a.index : 0;
      const idxB = Number.isFinite(b && b.index) ? b.index : 0;
      return idxA - idxB;
    });
  }

  function buildViAvailabilityCommandForRange(segments, startIdx, endIdx){
    const range = normalizeDirectionRange([startIdx, endIdx], Array.isArray(segments) ? segments.length : 0);
    if (!range) return '';
    const [start, end] = range;
    const origin = segments[start] ? segments[start].depAirport : '';
    const destination = segments[end] ? segments[end].arrAirport : '';
    const date = segments[start] ? segments[start].depDate : '';
    const connections = [];
    for (let idx = start + 1; idx <= end; idx++){
      const code = segments[idx] ? segments[idx].depAirport : '';
      connections.push(code);
    }
    const descriptor = {
      od: [origin, destination],
      date,
      connections,
      range: [start, end]
    };
    return buildViAvailabilityCommandForDirection(descriptor, segments);
  }

  function buildViAvailabilityCommandForDirection(direction, segments){
    if (!direction || !Array.isArray(segments) || !segments.length){
      return '';
    }
    const origin = toAirportCode(direction.od && direction.od[0]);
    const destination = toAirportCode(direction.od && direction.od[1]);
    if (!origin || !destination){
      return '';
    }
    const dateToken = (direction.date || '').toString().trim().toUpperCase();
    if (!/^\d{2}[A-Z]{3}$/.test(dateToken)){
      return '';
    }
    const dayValue = parseInt(dateToken.slice(0, 2), 10);
    if (!Number.isFinite(dayValue) || dayValue <= 0){
      return '';
    }
    const monthPart = dateToken.slice(2);
    let command = `1${dayValue}${monthPart}${origin}${destination}`;
    const connectionSuffix = renderAvailabilityConnectionSuffix(direction, segments, state.detailedAvailability);
    if (connectionSuffix){
      command += connectionSuffix;
    }
    const carrier = selectViPreferredCarrier(direction, segments);
    if (carrier){
      command += `¥${carrier}`;
    }
    return command;
  }

  function collectDirectionConnections(direction, segments){
    const seen = new Set();
    const connections = [];
    const origin = toAirportCode(direction && direction.od && direction.od[0]);
    const destination = toAirportCode(direction && direction.od && direction.od[1]);
    const raw = [];
    if (direction){
      if (Array.isArray(direction.connections)){
        raw.push(...direction.connections);
      } else if (direction.connections && typeof direction.connections.forEach === 'function'){
        direction.connections.forEach((value) => raw.push(value));
      }
    }
    const range = normalizeDirectionRange(direction && direction.range, Array.isArray(segments) ? segments.length : 0);
    if (!raw.length && range){
      const [start, end] = range;
      for (let idx = start + 1; idx <= end; idx++){
        const seg = segments[idx];
        if (seg && seg.depAirport){
          raw.push(seg.depAirport);
        }
      }
    }
    raw.forEach((code) => {
      const airport = toAirportCode(code);
      if (!airport || airport === origin || airport === destination) return;
      if (seen.has(airport)) return;
      seen.add(airport);
      connections.push(airport);
    });
    return connections;
  }

  function renderAvailabilityConnectionSuffix(direction, segments, detailed){
    const useDetailed = !!detailed;
    if (useDetailed && typeof window.computeAvailabilityConnectionDetails === 'function'){
      try {
        const info = window.computeAvailabilityConnectionDetails(direction, segments);
        if (info && Array.isArray(info.connections) && info.connections.length){
          const parts = info.connections
            .map((entry) => {
              if (!entry || !entry.airport) return '';
              const airport = String(entry.airport).trim().toUpperCase();
              if (!airport) return '';
              const layover = Number.isFinite(entry.layoverMinutes)
                ? Math.max(0, Math.round(entry.layoverMinutes))
                : null;
              return layover != null ? `${airport}-${layover}` : airport;
            })
            .filter(Boolean);
          if (parts.length){
            const prefix = info.departureTimeToken ? String(info.departureTimeToken).trim() : '';
            return `${prefix}${parts.join('/')}`;
          }
        }
      } catch (err) {
        console.warn('Detailed availability rendering failed:', err);
      }
    }
    const basic = collectDirectionConnections(direction, segments);
    if (basic.length){
      return `12A${basic.join('/')}`;
    }
    return '';
  }

  function selectViPreferredCarrier(direction, segments){
    const range = normalizeDirectionRange(direction && direction.range, Array.isArray(segments) ? segments.length : 0);
    if (!range){
      return '';
    }
    const [start, end] = range;
    const counts = new Map();
    for (let idx = start; idx <= end; idx++){
      const seg = segments[idx];
      if (!seg) continue;
      const code = toCarrierCode(seg.marketingCarrier || seg.airlineCode || '');
      if (!code) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    counts.forEach((count, code) => {
      if (count > bestCount){
        best = code;
        bestCount = count;
      }
    });
    return best;
  }

  function normalizeDirectionRange(range, total){
    if (!Array.isArray(range) || range.length < 2 || !Number.isFinite(total) || total <= 0){
      return null;
    }
    const startRaw = Number(range[0]);
    const endRaw = Number(range[1]);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)){
      return null;
    }
    const start = Math.max(0, Math.min(total - 1, startRaw));
    const end = Math.max(start, Math.min(total - 1, endRaw));
    return [start, end];
  }

  function escapeHtml(value){
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeBookingClass(value){
    const clean = (value || 'J').toString().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
    return clean || 'J';
  }

  function sanitizeSegmentStatus(value){
    const clean = (value || 'SS1').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    return clean || 'SS1';
  }

  function resetConversionState(){
    resetFeedback();
    if (outputEl) outputEl.value = '';
    if (copyBtn) copyBtn.disabled = true;
    resetCopyButtonLabel(true);
    state.lastResult = '';
    state.lastCopied = '';
    state.lastInput = '';
    state.lastSegments = [];
    state.availabilityCommands = [];
    state.lastAvailabilityCopiedIndex = -1;
    updateAvailabilityPreview('');
  }

  function resetFeedback(){
    if (convertErrorEl){
      convertErrorEl.style.display = 'none';
      convertErrorEl.textContent = '';
    }
    if (convertStatusEl){
      convertStatusEl.style.display = 'none';
      convertStatusEl.textContent = '';
    }
  }

  function showError(message){
    if (!convertErrorEl) return;
    convertStatusEl.style.display = 'none';
    convertStatusEl.textContent = '';
    convertErrorEl.textContent = message;
    convertErrorEl.style.display = 'block';
  }

  function showStatus(message){
    if (!convertStatusEl) return;
    convertErrorEl.style.display = 'none';
    convertErrorEl.textContent = '';
    convertStatusEl.textContent = message;
    convertStatusEl.style.display = 'block';
  }

  function flashCopyButtonLabel(){
    if (!copyBtn) return;
    if (state.copyLabelTimer){
      clearTimeout(state.copyLabelTimer);
      state.copyLabelTimer = null;
    }
    copyBtn.textContent = COPY_SUCCESS_LABEL;
    state.copyHoldUntil = Date.now() + COPY_RESET_DELAY;
    state.copyLabelTimer = setTimeout(() => {
      copyBtn.textContent = copyBtnDefaultLabel;
      state.copyLabelTimer = null;
      state.copyHoldUntil = 0;
    }, COPY_RESET_DELAY);
  }

  function resetCopyButtonLabel(force = false){
    if (!copyBtn) return;
    if (!force && state.copyLabelTimer){
      return;
    }
    if (!force && state.copyHoldUntil && Date.now() < state.copyHoldUntil){
      return;
    }
    if (state.copyLabelTimer){
      clearTimeout(state.copyLabelTimer);
      state.copyLabelTimer = null;
    }
    state.copyHoldUntil = 0;
    copyBtn.textContent = copyBtnDefaultLabel;
  }

  function updateAutoDetectionNote(){
    if (!bookingStatusNote) return;
    const currentClass = bookingInput ? sanitizeBookingClass(bookingInput.value) : state.originalBookingClass;
    if (state.bookingClassLocked){
      bookingStatusNote.textContent = `Auto cabin detection paused — using manual booking class ${currentClass || 'J'}.`;
      if (restoreAutoBtn){
        restoreAutoBtn.style.display = '';
        restoreAutoBtn.disabled = false;
      }
    } else {
      bookingStatusNote.textContent = `Auto cabin detection active (default ${currentClass || 'J'}).`;
      if (restoreAutoBtn){
        restoreAutoBtn.style.display = 'none';
        restoreAutoBtn.disabled = false;
      }
    }
  }

  function debounce(fn, wait){
    let timer = null;
    return function debounced(...args){
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function convertViToI(rawText, options){
    const opts = options || {};
    const segments = extractSegments(rawText);
    if (segments.length === 0){
      throw new Error('No segments found in VI* text.');
    }
    assignSegmentDates(segments, opts.baseYear);
    const formatted = formatSegments(segments, opts);
    return { text: formatted, segments };
  }

  function extractSegments(rawText){
    const segments = [];
    if (!rawText) return segments;
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    let lastSegment = null;
    for (const line of lines){
      const rawLine = line || '';
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const cabinMatch = trimmed.match(/^CABIN-([A-Z\s]+)/i);
      if (cabinMatch){
        if (lastSegment){
          lastSegment.cabinRaw = cabinMatch[1].replace(/\s+/g, ' ').trim();
        }
        continue;
      }

      const elpdMatch = trimmed.match(/\bELPD\s+(\d+(?:\.\d+)?)/i);
      if (elpdMatch && lastSegment && !Number.isFinite(lastSegment.elapsedHours)){
        const value = parseFloat(elpdMatch[1]);
        if (Number.isFinite(value)){
          lastSegment.elapsedHours = value;
        }
        continue;
      }

      if (!/^\s*\d+\s+/.test(rawLine)) continue;
      const tokens = trimmed.split(/\s+/);
      if (tokens.length < 7) continue;

      const indexToken = tokens.shift();
      if (!/^\d+$/.test(indexToken)) continue;

      const flightTokens = [];
      while (tokens.length && !/^\d{1,2}[A-Z]{3}$/i.test(tokens[0])){
        flightTokens.push(tokens.shift());
      }
      if (flightTokens.length === 0) continue;
      const flightJoined = flightTokens.join('');
      const flightMatch = flightJoined.match(/^([A-Z0-9]{2})(\*?)([A-Z0-9]+)$/i);
      if (!flightMatch) continue;

      const airlineCode = flightMatch[1].toUpperCase();
      const flightNumber = flightMatch[3].toUpperCase();

      if (tokens.length === 0) continue;
      const dateToken = (tokens.shift() || '').toUpperCase();
      const dateMatch = dateToken.match(/^(\d{1,2})([A-Z]{3})$/);
      if (!dateMatch) continue;
      const day = parseInt(dateMatch[1], 10);
      const monthKey = dateMatch[2];
      if (!Object.prototype.hasOwnProperty.call(MONTH_INDEX, monthKey)) continue;
      const monthIndex = MONTH_INDEX[monthKey];

      if (tokens.length < 4) continue;
      const depAirport = (tokens.shift() || '').toUpperCase();
      const arrAirport = (tokens.shift() || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(depAirport) || !/^[A-Z]{3}$/.test(arrAirport)) continue;

      const depTimeToken = tokens.shift() || '';
      const arrTimeToken = tokens.shift() || '';
      const depParsed = parseTimeToken(depTimeToken);
      const arrParsed = parseTimeToken(arrTimeToken);

      const segment = {
        airlineCode,
        flightNumber,
        depAirport,
        arrAirport,
        depDay: day,
        depMonth: monthIndex,
        depTime: depParsed.time,
        arrTime: arrParsed.time,
        arrOffset: arrParsed.offset,
        cabinRaw: null,
        elapsedHours: parseElapsedHoursFromTokens(tokens)
      };
      segments.push(segment);
      lastSegment = segment;
    }
    return segments;
  }

  function parseElapsedHoursFromTokens(tokens){
    if (!Array.isArray(tokens) || !tokens.length){
      return null;
    }
    for (const token of tokens){
      const cleaned = (token || '').replace(/[^0-9.]/g, '');
      if (!cleaned || cleaned === '.') continue;
      if (cleaned.includes('.')){
        const value = parseFloat(cleaned);
        if (Number.isFinite(value) && value > 0 && value < 30){
          return value;
        }
      }
    }
    return null;
  }

  function parseTimeToken(token){
    const trimmed = (token || '').trim();
    if (!trimmed){
      return { time: '', offset: 0 };
    }
    const offsetMatch = trimmed.match(/(?:¥|\+)(\d+)/i);
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) || 0 : 0;
    const base = trimmed.replace(/(?:¥|\+)\s*\d+/gi, '');
    const cleaned = base.replace(/[^0-9AP]/gi, '');
    const match = cleaned.match(/(\d{3,4})([AP])?/i);
    if (!match){
      return { time: cleaned.toUpperCase(), offset };
    }
    const time = match[1] + (match[2] ? match[2].toUpperCase() : '');
    return { time, offset };
  }

  function assignSegmentDates(segments, baseYear){
    if (segments.length === 0) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let workingYear = Number.isFinite(baseYear) ? baseYear : now.getFullYear();

    let firstDep = new Date(workingYear, segments[0].depMonth, segments[0].depDay);
    if (!Number.isFinite(baseYear)){
      const nextCandidate = new Date(workingYear + 1, segments[0].depMonth, segments[0].depDay);
      if (firstDep < today && Math.abs(nextCandidate - today) < Math.abs(firstDep - today)){
        workingYear += 1;
        firstDep = nextCandidate;
      }
    }
    applyDatesToSegment(segments[0], firstDep);
    let lastArrMidnight = toMidnight(segments[0].arrDateObj);

    for (let i = 1; i < segments.length; i++){
      let candidate = new Date(workingYear, segments[i].depMonth, segments[i].depDay);
      while (candidate < lastArrMidnight){
        workingYear += 1;
        candidate = new Date(workingYear, segments[i].depMonth, segments[i].depDay);
      }
      applyDatesToSegment(segments[i], candidate);
      const arrMidnight = toMidnight(segments[i].arrDateObj);
      if (arrMidnight > lastArrMidnight){
        lastArrMidnight = arrMidnight;
      }
    }
  }

  function applyDatesToSegment(segment, depDate){
    segment.depDateObj = depDate;
    segment.depDateString = formatDatePart(depDate);
    segment.depDow = DOW_CHARS[depDate.getDay()] || '';
    const arrival = new Date(depDate.getTime());
    arrival.setDate(arrival.getDate() + (segment.arrOffset || 0));
    segment.arrDateObj = arrival;
    segment.arrDateString = formatDatePart(arrival);
    segment.arrDow = DOW_CHARS[arrival.getDay()] || '';
  }

  function toMidnight(date){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDatePart(date){
    const day = String(date.getDate()).padStart(2, '0');
    const mon = MONTH_NAMES[date.getMonth()] || '';
    return `${day}${mon}`;
  }

  function formatSegments(segments, options){
    const opts = options || {};
    const bookingClass = sanitizeBookingClass(opts.bookingClass);
    const segmentStatus = sanitizeSegmentStatus(opts.segmentStatus);
    const autoCabinEnabled = !!opts.autoCabin;
    const lines = [];
    for (let i = 0; i < segments.length; i++){
      const seg = segments[i];
      if (!seg) continue;
      const segNumber = String(i + 1).padStart(2, ' ');
      let detectedCabin = null;
      let segmentBookingClass = bookingClass;
      if (autoCabinEnabled){
        detectedCabin = resolveCabinForSegment(seg);
        if (detectedCabin){
          seg.cabin = detectedCabin;
          segmentBookingClass = pickPreferredBookingClass(seg.airlineCode, detectedCabin, bookingClass, seg);
        }
      }
      if (!segmentBookingClass){
        segmentBookingClass = bookingClass || CABIN_FALLBACK_BOOKING.ECONOMY;
      }
      seg.detectedCabin = detectedCabin;
      seg.bookingClass = segmentBookingClass;
      const flightField = formatFlightField(seg.airlineCode, seg.flightNumber, segmentBookingClass);
      const dateField = seg.depDow ? `${seg.depDateString} ${seg.depDow}` : seg.depDateString;
      const cityField = segmentStatus
        ? `${seg.depAirport}${seg.arrAirport}*${segmentStatus}`
        : `${seg.depAirport}${seg.arrAirport}`;
      const parts = [segNumber, flightField, dateField, cityField];
      if (seg.depTime){ parts.push(seg.depTime); }
      if (seg.arrTime){ parts.push(seg.arrTime); }
      if (seg.arrOffset > 0){
        const arrField = seg.arrDow ? `${seg.arrDateString} ${seg.arrDow}` : seg.arrDateString;
        parts.push(arrField);
      }
      parts.push(`/DC${seg.airlineCode}`);
      parts.push('/E');
      lines.push(parts.join(' '));
    }
    return lines.join('\n');
  }

  function formatFlightField(airlineCode, flightNumber, bookingClass){
    const num = flightNumber || '';
    const base = num.length < 4 ? `${airlineCode} ${num}` : `${airlineCode}${num}`;
    return `${base}${bookingClass}`;
  }

  if (typeof module !== 'undefined' && module.exports){
    module.exports = {
      convertViToI,
      pickPreferredBookingClass,
      resolveCabinForSegment,
      normalizeCabinValue
    };
  }
})();
