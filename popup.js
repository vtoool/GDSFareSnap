(() => {
  'use strict';

  const MONTH_INDEX = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DOW_CHARS = ['S','M','T','W','Q','F','J'];

  const bookingInput = document.getElementById('bookingClass');
  const statusInput = document.getElementById('segmentStatus');
  const enableDirections = document.getElementById('enableDirections');
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
  const availabilityList = document.getElementById('availabilityList');

  if (bookingStatusNote){
    bookingStatusNote.textContent = 'Checking auto cabin detection…';
  }
  if (restoreAutoBtn){
    restoreAutoBtn.style.display = 'none';
  }
  if (availabilityPreview){
    availabilityPreview.style.display = 'none';
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
    lastAvailabilityCopiedIndex: -1
  };

  const scheduleAutoConvert = debounce((reason) => runConversion(reason || 'auto'), 140);

  chrome.storage.sync.get([
    'bookingClass',
    'segmentStatus',
    'enableDirectionButtons',
    'bookingClassLocked'
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
    state.originalBookingClass = bookingValue;
    state.bookingClassLocked = !!(res && res.bookingClassLocked);
    state.bookingEdited = false;
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
  });

  if (saveBtn){
    saveBtn.addEventListener('click', () => {
      const bookingClass = bookingInput ? sanitizeBookingClass(bookingInput.value) : 'J';
      const segmentStatus = statusInput ? sanitizeSegmentStatus(statusInput.value) : 'SS1';
      if (bookingInput) bookingInput.value = bookingClass;
      if (statusInput) statusInput.value = segmentStatus;
      const enableDir = !!(enableDirections && enableDirections.checked);
      const shouldLock = state.bookingEdited ? true : state.bookingClassLocked;
      chrome.storage.sync.set({
        bookingClass,
        segmentStatus,
        enableDirectionButtons: enableDir,
        bookingClassLocked: shouldLock
      }, () => {
        if (okEl){
          okEl.textContent = 'Saved';
          okEl.style.display = 'inline-block';
        }
        state.bookingClassLocked = shouldLock;
        state.originalBookingClass = bookingClass;
        state.bookingEdited = false;
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

  if (availabilityList){
    availabilityList.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('.availability-preview__copy') : null;
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
    if (copyBtn){
      copyBtn.disabled = true;
    }

    const sameInput = state.lastInput === raw;

    try {
      const bookingClass = bookingInput ? sanitizeBookingClass(bookingInput.value) : 'J';
      const segmentStatus = statusInput ? sanitizeSegmentStatus(statusInput.value) : 'SS1';
      if (bookingInput) bookingInput.value = bookingClass;
      if (statusInput) statusInput.value = segmentStatus;

      const conversion = convertViToI(raw, { bookingClass, segmentStatus }) || {};
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
    } catch (err){
      state.lastResult = '';
      state.lastCopied = '';
      state.lastSegments = [];
      outputEl.value = '';
      if (copyBtn) copyBtn.disabled = true;
      updateAvailabilityPreview('');
      const message = err && err.message ? err.message : 'Could not convert itinerary.';
      showError(message);
    }
  }

  async function handleManualCopy(){
    if (!outputEl) return;
    resetFeedback();
    const text = (outputEl.value || '').trim();
    if (!text){
      showError('Nothing to copy yet.');
      return;
    }
    const outcome = await copyOutputText(text);
    if (outcome.ok){
      state.lastCopied = text;
      showStatus('Copied to clipboard.');
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
    showError('Clipboard blocked. Command highlighted for manual copy.');
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
    if (!availabilityList) return;
    try {
      const commandEl = availabilityList.querySelector(`code[data-command-index="${index}"]`);
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
    if (!availabilityPreview || !availabilityList){
      return;
    }
    const trimmed = (rawText || '').trim();
    availabilityList.innerHTML = '';
    state.availabilityCommands = [];
    state.lastAvailabilityCopiedIndex = -1;
    if (!trimmed || typeof window.convertTextToAvailability !== 'function'){
      availabilityPreview.style.display = 'none';
      return;
    }
    let preview = null;
    try {
      preview = typeof window.peekSegments === 'function' ? window.peekSegments(trimmed) : null;
    } catch (err) {
      console.warn('peekSegments preview failed:', err);
      preview = null;
    }
    const journeys = preview && Array.isArray(preview.journeys) ? preview.journeys : [];
    const segments = preview && Array.isArray(preview.segments) ? preview.segments : [];
    const directionGroups = (typeof window.computeDirectionsFromSegments === 'function' && segments.length)
      ? window.computeDirectionsFromSegments(segments, { journeys })
      : [];
    const commands = [];
    const isMultiCity = !!(preview && preview.isMultiCity);
    const labelForDirection = (direction, fallbackIdx) => {
      if (!direction) return `Journey ${fallbackIdx + 1}`;
      const origin = direction.od && direction.od[0] ? direction.od[0] : '';
      const dest = direction.od && direction.od[1] ? direction.od[1] : '';
      if (origin && dest){
        return `${origin}-${dest}`;
      }
      const kind = (direction.kind || '').toLowerCase();
      if (kind === 'outbound') return 'Outbound';
      if (kind === 'inbound') return 'Inbound';
      const index = Number.isFinite(direction.index) ? direction.index : fallbackIdx;
      return `Journey ${index + 1}`;
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
          const command = window.convertTextToAvailability(trimmed, { direction: 'all', segmentRange: range });
          if (command){
            commands.push({ label: labelForDirection(direction, idx), command });
          }
        } catch (err) {
          console.warn('Availability command build failed:', err);
        }
      });
    }
    if (!commands.length && journeys.length){
      journeys.forEach((journey, idx) => {
        if (!journey) return;
        try {
          const command = window.convertTextToAvailability(trimmed, { journeyIndex: idx, direction: 'all' });
          if (command){
            const label = isMultiCity ? `Journey ${idx + 1}` : labelForDirection(null, idx);
            commands.push({ label, command });
          }
        } catch (err) {
          console.warn('Availability command build failed:', err);
        }
      });
    }
    if (!commands.length){
      try {
        const fallback = window.convertTextToAvailability(trimmed, { direction: 'all' });
        if (fallback){
          commands.push({ label: 'All segments', command: fallback });
        }
      } catch (err) {
        console.warn('Availability command build failed:', err);
      }
    }
    if (!commands.length){
      availabilityPreview.style.display = 'none';
      return;
    }
    state.availabilityCommands = commands;
    const html = commands.map((entry, idx) => {
      const label = escapeHtml(entry && entry.label ? entry.label : `Journey ${idx + 1}`);
      const command = escapeHtml(entry && entry.command ? entry.command : '');
      return `<div class="availability-preview__item" role="listitem">`
        + `<span class="availability-preview__label">${label}</span>`
        + `<code class="availability-preview__command" data-command-index="${idx}" title="${command}">${command}</code>`
        + `<button type="button" class="availability-preview__copy" data-index="${idx}">Copy</button>`
        + `</div>`;
    }).join('');
    availabilityList.innerHTML = html;
    availabilityPreview.style.display = 'block';
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
    for (const line of lines){
      if (!/^\s*\d+\s+/.test(line || '')) continue;
      const tokens = line.trim().split(/\s+/);
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

      segments.push({
        airlineCode,
        flightNumber,
        depAirport,
        arrAirport,
        depDay: day,
        depMonth: monthIndex,
        depTime: depParsed.time,
        arrTime: arrParsed.time,
        arrOffset: arrParsed.offset
      });
    }
    return segments;
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
    const bookingClass = sanitizeBookingClass(options.bookingClass);
    const segmentStatus = sanitizeSegmentStatus(options.segmentStatus);
    const lines = [];
    for (let i = 0; i < segments.length; i++){
      const seg = segments[i];
      const segNumber = String(i + 1).padStart(2, ' ');
      const flightField = formatFlightField(seg.airlineCode, seg.flightNumber, bookingClass);
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
})();
