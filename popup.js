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
  const autoCopyToggle = document.getElementById('autoCopyToggle');

  if (bookingStatusNote){
    bookingStatusNote.textContent = 'Checking auto cabin detection…';
  }
  if (restoreAutoBtn){
    restoreAutoBtn.style.display = 'none';
  }
  if (autoCopyToggle){
    autoCopyToggle.checked = true;
  }

  const state = {
    bookingClassLocked: false,
    originalBookingClass: 'J',
    bookingEdited: false,
    autoCopy: true,
    lastInput: '',
    lastResult: '',
    lastCopied: ''
  };

  const scheduleAutoConvert = debounce((reason) => runConversion(reason || 'auto'), 140);

  chrome.storage.sync.get([
    'bookingClass',
    'segmentStatus',
    'enableDirectionButtons',
    'bookingClassLocked',
    'autoCopyOnConvert'
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
    state.autoCopy = (res && typeof res.autoCopyOnConvert === 'boolean')
      ? !!res.autoCopyOnConvert
      : true;
    if (autoCopyToggle){
      autoCopyToggle.checked = state.autoCopy;
    }
    updateAutoDetectionNote();
  });

  if (bookingInput){
    bookingInput.addEventListener('input', () => {
      state.bookingEdited = true;
      updateAutoDetectionNote();
    });
  }

  if (autoCopyToggle){
    autoCopyToggle.addEventListener('change', () => {
      state.autoCopy = !!autoCopyToggle.checked;
      chrome.storage.sync.set({ autoCopyOnConvert: state.autoCopy }, () => {});
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
    if (changes.autoCopyOnConvert){
      state.autoCopy = !!changes.autoCopyOnConvert.newValue;
      if (autoCopyToggle){
        autoCopyToggle.checked = state.autoCopy;
      }
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

      const result = convertViToI(raw, { bookingClass, segmentStatus });
      state.lastInput = raw;
      outputEl.value = result;

      if (!result){
        state.lastResult = '';
        state.lastCopied = '';
        if (copyBtn) copyBtn.disabled = true;
        showError('No segments found in VI* text.');
        return;
      }

      state.lastResult = result;
      if (copyBtn) copyBtn.disabled = false;
      const segmentCount = result.split('\n').length;
      const shouldAutoCopy = state.autoCopy && (!sameInput || result !== state.lastCopied);

      if (shouldAutoCopy){
        const outcome = await copyOutputText(result);
        if (outcome.ok){
          state.lastCopied = result;
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
      outputEl.value = '';
      if (copyBtn) copyBtn.disabled = true;
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
    return formatSegments(segments, opts);
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
