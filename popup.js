(() => {
  'use strict';

  const MONTH_INDEX = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DOW_CHARS = ['S','M','T','W','Q','F','J'];

  const booking = document.getElementById('bookingClass');
  const status = document.getElementById('segmentStatus');
  const enableDirections = document.getElementById('enableDirections');
  const okEl = document.getElementById('ok');
  const saveBtn = document.getElementById('saveBtn');

  const viInput = document.getElementById('viInput');
  const yearInput = document.getElementById('yearOverride');
  const convertBtn = document.getElementById('convertBtn');
  const copyBtn = document.getElementById('copyBtn');
  const outputEl = document.getElementById('iOutput');
  const convertErrorEl = document.getElementById('convertError');
  const convertStatusEl = document.getElementById('convertStatus');

  chrome.storage.sync.get(['bookingClass','segmentStatus','enableDirectionButtons'], (res) => {
    booking.value = sanitizeBookingClass(res.bookingClass);
    status.value = sanitizeSegmentStatus(res.segmentStatus);
    enableDirections.checked = !!res.enableDirectionButtons;
  });

  saveBtn.addEventListener('click', () => {
    const bc = sanitizeBookingClass(booking.value);
    const ss = sanitizeSegmentStatus(status.value);
    const enableDir = !!enableDirections.checked;
    chrome.storage.sync.set({ bookingClass: bc, segmentStatus: ss, enableDirectionButtons: enableDir }, () => {
      okEl.textContent = 'Saved';
      okEl.style.display = 'inline-block';
      setTimeout(() => { window.close(); }, 600);
    });
  });

  convertBtn.addEventListener('click', () => {
    clearMessages();
    copyBtn.disabled = true;
    const raw = (viInput.value || '').trim();
    if(!raw){
      showError('Paste VI* text first.');
      outputEl.value = '';
      return;
    }
    const options = {
      bookingClass: sanitizeBookingClass(booking.value),
      segmentStatus: sanitizeSegmentStatus(status.value),
      baseYear: parseYear(yearInput.value)
    };
    try {
      const result = convertViToI(raw, options);
      outputEl.value = result;
      if(result){
        copyBtn.disabled = false;
        const lines = result.split('\n');
        showStatus(`Converted ${lines.length} segment${lines.length === 1 ? '' : 's'}.`);
      } else {
        showError('No segments found in VI* text.');
      }
    } catch(err){
      outputEl.value = '';
      showError(err && err.message ? err.message : 'Could not convert itinerary.');
    }
  });

  copyBtn.addEventListener('click', () => {
    const text = (outputEl.value || '').trim();
    if(!text){
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showStatus('Copied to clipboard.');
    }).catch(() => {
      showError('Copy failed.');
    });
  });

  viInput.addEventListener('input', clearMessages);
  yearInput.addEventListener('input', clearMessages);

  function sanitizeBookingClass(value){
    const clean = (value || 'J').toUpperCase().replace(/[^A-Z]/g,'').slice(0,1);
    return clean || 'J';
  }

  function sanitizeSegmentStatus(value){
    const clean = (value || 'SS1').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3);
    return clean || 'SS1';
  }

  function parseYear(value){
    const year = parseInt(value, 10);
    if(Number.isFinite(year) && year >= 1900 && year <= 2100){
      return year;
    }
    return null;
  }

  function clearMessages(){
    convertErrorEl.style.display = 'none';
    convertErrorEl.textContent = '';
    convertStatusEl.style.display = 'none';
    convertStatusEl.textContent = '';
    copyBtn.disabled = true;
  }

  function showError(message){
    convertStatusEl.style.display = 'none';
    convertStatusEl.textContent = '';
    convertErrorEl.textContent = message;
    convertErrorEl.style.display = 'block';
  }

  function showStatus(message){
    convertErrorEl.style.display = 'none';
    convertErrorEl.textContent = '';
    convertStatusEl.textContent = message;
    convertStatusEl.style.display = 'block';
  }

  function convertViToI(rawText, options){
    const opts = options || {};
    const segments = extractSegments(rawText);
    if(segments.length === 0){
      throw new Error('No segments found in VI* text.');
    }
    assignSegmentDates(segments, opts.baseYear);
    return formatSegments(segments, opts);
  }

  function extractSegments(rawText){
    const segments = [];
    if(!rawText) return segments;
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    for(const line of lines){
      if(!/^\s*\d+\s+/.test(line || '')) continue;
      const tokens = line.trim().split(/\s+/);
      if(tokens.length < 7) continue;

      const indexToken = tokens.shift();
      if(!/^\d+$/.test(indexToken)) continue;

      const flightTokens = [];
      while(tokens.length && !/^\d{1,2}[A-Z]{3}$/i.test(tokens[0])){
        flightTokens.push(tokens.shift());
      }
      if(flightTokens.length === 0) continue;
      const flightJoined = flightTokens.join('');
      const flightMatch = flightJoined.match(/^([A-Z0-9]{2})(\*?)([A-Z0-9]+)$/i);
      if(!flightMatch) continue;

      const airlineCode = flightMatch[1].toUpperCase();
      const flightNumber = flightMatch[3].toUpperCase();

      if(tokens.length === 0) continue;
      const dateToken = (tokens.shift() || '').toUpperCase();
      const dateMatch = dateToken.match(/^(\d{1,2})([A-Z]{3})$/);
      if(!dateMatch) continue;
      const day = parseInt(dateMatch[1], 10);
      const monthKey = dateMatch[2];
      if(!Object.prototype.hasOwnProperty.call(MONTH_INDEX, monthKey)) continue;
      const monthIndex = MONTH_INDEX[monthKey];

      if(tokens.length < 4) continue;
      const depAirport = (tokens.shift() || '').toUpperCase();
      const arrAirport = (tokens.shift() || '').toUpperCase();
      if(!/^[A-Z]{3}$/.test(depAirport) || !/^[A-Z]{3}$/.test(arrAirport)) continue;

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
    if(!trimmed){
      return { time: '', offset: 0 };
    }
    const offsetMatch = trimmed.match(/(?:¥|\+)(\d+)/i);
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) || 0 : 0;
    const base = trimmed.replace(/(?:¥|\+)\s*\d+/gi, '');
    const cleaned = base.replace(/[^0-9AP]/gi, '');
    const match = cleaned.match(/(\d{3,4})([AP])?/i);
    if(!match){
      return { time: cleaned.toUpperCase(), offset };
    }
    const time = match[1] + (match[2] ? match[2].toUpperCase() : '');
    return { time, offset };
  }

  function assignSegmentDates(segments, baseYear){
    if(segments.length === 0) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let workingYear = Number.isFinite(baseYear) ? baseYear : now.getFullYear();

    let firstDep = new Date(workingYear, segments[0].depMonth, segments[0].depDay);
    if(!Number.isFinite(baseYear)){
      const nextCandidate = new Date(workingYear + 1, segments[0].depMonth, segments[0].depDay);
      if(firstDep < today && Math.abs(nextCandidate - today) < Math.abs(firstDep - today)){
        workingYear += 1;
        firstDep = nextCandidate;
      }
    }
    applyDatesToSegment(segments[0], firstDep);
    let lastArrMidnight = toMidnight(segments[0].arrDateObj);

    for(let i = 1; i < segments.length; i++){
      let candidate = new Date(workingYear, segments[i].depMonth, segments[i].depDay);
      while(candidate < lastArrMidnight){
        workingYear += 1;
        candidate = new Date(workingYear, segments[i].depMonth, segments[i].depDay);
      }
      applyDatesToSegment(segments[i], candidate);
      const arrMidnight = toMidnight(segments[i].arrDateObj);
      if(arrMidnight > lastArrMidnight){
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
    for(let i = 0; i < segments.length; i++){
      const seg = segments[i];
      const segNumber = String(i + 1).padStart(2, ' ');
      const flightField = formatFlightField(seg.airlineCode, seg.flightNumber, bookingClass);
      const dateField = seg.depDow ? `${seg.depDateString} ${seg.depDow}` : seg.depDateString;
      const cityField = segmentStatus
        ? `${seg.depAirport}${seg.arrAirport}*${segmentStatus}`
        : `${seg.depAirport}${seg.arrAirport}`;
      const parts = [segNumber, flightField, dateField, cityField];
      if(seg.depTime){ parts.push(seg.depTime); }
      if(seg.arrTime){ parts.push(seg.arrTime); }
      if(seg.arrOffset > 0){
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
