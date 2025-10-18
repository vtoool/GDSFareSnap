
/* converter.js — pure conversion to *I */
(function(){
  'use strict';

  const GLOBAL_ROOT = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof self !== 'undefined' ? self : {});
  const CABIN_FALLBACK_BOOKING = { FIRST:'F', BUSINESS:'J', PREMIUM:'N', ECONOMY:'Y' };

  // Expect global AIRLINE_CODES from airlines.js
  const MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTH_3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DOW_CODE = { SUN:'S', MON:'M', TUE:'T', WED:'W', THU:'Q', FRI:'F', SAT:'J' };
  const DOW_SEQUENCE = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const DOW_FROM_CODE = { S:'SUN', M:'MON', T:'TUE', W:'WED', Q:'THU', F:'FRI', J:'SAT' };
  const UNKNOWN_AIRLINE_CODE = 'XX';

  function pad2(n){ return String(n).padStart(2,'0'); }

  function cloneDateInfo(info){
    if(!info) return null;
    return {
      day: info.day || '',
      mon: info.mon || '',
      dow: info.dow || ''
    };
  }

  function addDaysToDateInfo(info, offset, fallbackDow){
    if(!info || !Number.isFinite(offset) || offset === 0) return info ? cloneDateInfo(info) : null;
    const monKey = normalizeMonthToken(info.mon);
    const dayVal = parseInt(info.day, 10);
    if(!monKey || !Number.isFinite(dayVal)){
      return cloneDateInfo(info);
    }
    const monthIndex = MONTHS[monKey];
    const base = new Date(Date.UTC(2024, monthIndex, dayVal));
    base.setUTCDate(base.getUTCDate() + offset);
    const nextDay = pad2(base.getUTCDate());
    const nextMon = MONTH_3[base.getUTCMonth()];
    const resolveDowIndex = (code) => {
      if(!code) return null;
      const key = String(code).trim().toUpperCase();
      const dowName = DOW_FROM_CODE[key];
      if(!dowName) return null;
      const idx = DOW_SEQUENCE.indexOf(dowName);
      return idx >= 0 ? idx : null;
    };
    const baseDowIdx = resolveDowIndex(info.dow) != null
      ? resolveDowIndex(info.dow)
      : resolveDowIndex(fallbackDow);
    let nextDow = '';
    if(baseDowIdx != null){
      const normalized = ((baseDowIdx + offset) % DOW_SEQUENCE.length + DOW_SEQUENCE.length) % DOW_SEQUENCE.length;
      const dowName = DOW_SEQUENCE[normalized];
      nextDow = DOW_CODE[dowName] || '';
    }else if(info.dow){
      nextDow = info.dow;
    }
    return { day: nextDay, mon: nextMon, dow: nextDow };
  }

  function normalizeDowToken(value){
    if(!value) return '';
    const key = String(value).toUpperCase().slice(0,3);
    return DOW_CODE[key] || '';
  }

  function normalizeMonthToken(value){
    if(!value) return '';
    const key = String(value).toUpperCase().slice(0,3);
    return Object.prototype.hasOwnProperty.call(MONTHS, key) ? key : '';
  }

  function normalizeDayToken(value){
    if(!value) return '';
    const cleaned = String(value).replace(/(?:st|nd|rd|th)$/i, '');
    const num = parseInt(cleaned, 10);
    if(!Number.isFinite(num)) return '';
    return pad2(num);
  }

  function dateInfoToUtcDate(info){
    if(!info) return null;
    const monKey = normalizeMonthToken(info.mon);
    const dayVal = parseInt(info.day, 10);
    if(!monKey || !Number.isFinite(dayVal)) return null;
    const monthIndex = MONTHS[monKey];
    return new Date(Date.UTC(2024, monthIndex, dayVal));
  }

  function dateInfoDifferenceInDays(a, b){
    const dateA = dateInfoToUtcDate(a);
    const dateB = dateInfoToUtcDate(b);
    if(!dateA || !dateB) return null;
    const diff = dateB.getTime() - dateA.getTime();
    return Math.round(diff / DAY_MS);
  }

  function buildDateFromMatch(match, cfg){
    if(!match) return null;
    const monIdx = typeof cfg.month === 'number' ? cfg.month : null;
    const dayIdx = typeof cfg.day === 'number' ? cfg.day : null;
    if(monIdx == null || dayIdx == null) return null;
    const mon = normalizeMonthToken(match[monIdx]);
    const day = normalizeDayToken(match[dayIdx]);
    if(!mon || !day) return null;
    const dowIdx = typeof cfg.dow === 'number' ? cfg.dow : null;
    const dow = dowIdx != null ? normalizeDowToken(match[dowIdx]) : '';
    return { dow, mon, day };
  }

  function matchDatePatterns(cleaned, patterns){
    if(!cleaned) return null;
    for(const cfg of patterns){
      const m = cleaned.match(cfg.regex);
      if(!m) continue;
      const date = buildDateFromMatch(m, cfg);
      if(date) return date;
    }
    return null;
  }

  function minutesToGds(mins){
    if(!Number.isFinite(mins)) return '';
    const normalized = ((mins % (24*60)) + (24*60)) % (24*60);
    const hh = Math.floor(normalized / 60);
    const mm = normalized % 60;
    const period = hh >= 12 ? 'P' : 'A';
    const hourToken = (() => {
      if(hh === 0) return '00';
      if(hh === 12) return '12';
      const base = hh % 12;
      return pad2(base);
    })();
    return `${hourToken}${pad2(mm)}${period}`;
  }

  function toAmPmMinutes(s){ // "12:20 pm" -> minutes from midnight and GDS "1220P"
    if(!s) return { mins:null, gds:s };
    let cleaned = s.replace(/\(.*?\)/g, ' ')
                   .replace(/\s*\+\s?\d+(?:\s*day(?:s)?)?/ig, ' ')
                   .replace(/\s*next day/ig, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();
    if(!cleaned) return { mins:null, gds:s };

    let m = cleaned.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if(m){
      let hh = parseInt(m[1],10), mm = parseInt(m[2],10);
      const ap = m[3].toUpperCase();
      if(ap==='PM' && hh!==12) hh += 12;
      if(ap==='AM' && hh===12) hh = 0;
      const mins = hh*60+mm;
      const gds = minutesToGds(mins);
      return { mins, gds };
    }

    m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if(m){
      let hh = parseInt(m[1],10), mm = parseInt(m[2],10);
      if(hh > 23 || mm > 59) return { mins:null, gds:s };
      const mins = hh*60 + mm;
      const gds = minutesToGds(mins);
      return { mins, gds };
    }

    return { mins:null, gds:s };
  }

  function extractSegmentDurationMinutes(segment){
    if(!segment) return null;
    if(Number.isFinite(segment.durationMinutes)) return segment.durationMinutes;
    if(Number.isFinite(segment.elapsedMinutes)) return segment.elapsedMinutes;
    if(Number.isFinite(segment.elapsedHours)) return Math.round(segment.elapsedHours * 60);
    return null;
  }

  function extractDurationMinutesFromLine(line){
    const cleaned = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!cleaned) return null;
    if(/\b(layover|change\s+planes|stopover|connection)\b/i.test(cleaned)) return null;
    const lower = cleaned.toLowerCase();
    const hourMatch = lower.match(/(\d{1,2})\s*h(?:ours?)?(?:\s*(\d{1,2})\s*m(?:in(?:ute)?s?)?)?/);
    if(hourMatch){
      const hours = parseInt(hourMatch[1], 10);
      const minutes = hourMatch[2] != null ? parseInt(hourMatch[2], 10) : 0;
      if(Number.isFinite(hours) && Number.isFinite(minutes)){
        return (hours * 60) + minutes;
      }
    }
    const minuteMatch = lower.match(/(\d{1,3})\s*m(?:in(?:ute)?s?)?/);
    if(minuteMatch){
      const mins = parseInt(minuteMatch[1], 10);
      if(Number.isFinite(mins)){
        return mins;
      }
    }
    return null;
  }

  function normalizeShortHaulCabin(cabinEnum, durationMinutes, depAirport, arrAirport){
    if(!cabinEnum) return cabinEnum;
    const shortHaulFn = GLOBAL_ROOT && typeof GLOBAL_ROOT.shouldTreatSegmentAsShortHaul === 'function'
      ? GLOBAL_ROOT.shouldTreatSegmentAsShortHaul
      : null;
    let treatAsShort = false;
    if(shortHaulFn){
      try {
        treatAsShort = !!shortHaulFn({
          durationMinutes,
          origin: depAirport,
          destination: arrAirport
        });
      } catch (err) {
        treatAsShort = false;
      }
    } else if(durationMinutes != null && durationMinutes <= 360){
      treatAsShort = true;
    }
    if(treatAsShort){
      if(cabinEnum === 'FIRST') return 'BUSINESS';
      if(cabinEnum === 'PREMIUM') return 'ECONOMY';
    }
    return cabinEnum;
  }

  function parseHeaderDate(line){
    // "Depart • Sat, Oct 4" -> {dow:'J', day:'04', mon:'OCT'}
    const cleaned = line.replace(/\(.*?\)/g, ' ').replace(/\s+/g,' ').trim();
    const patterns = [
      {
        regex: /(Depart(?:ure)?|Return|Outbound|Inbound)\s*(?:[•·-]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})[,\s]*(\d{1,2})(?:st|nd|rd|th)?/i,
        dow: 2,
        month: 3,
        day: 4
      },
      {
        regex: /(Depart(?:ure)?|Return|Outbound|Inbound)\s*(?:[•·-]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s]*([A-Za-z]{3,})/i,
        dow: 2,
        day: 3,
        month: 4
      }
    ];
    const direct = matchDatePatterns(cleaned, patterns);
    if(direct) return direct;
    return parseLooseDate(cleaned);
  }

  function parseJourneyHeader(line){
    const normalized = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!/^Flight\s+\d+/i.test(normalized)) return null;

    const indexMatch = normalized.match(/^Flight\s+(\d+)/i);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : null;

    const datePatterns = [
      {
        regex: /^Flight\s+\d+(?:\s*(?:of|\/|-)\s*\d+)?\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})[,\s]*(\d{1,2})(?:st|nd|rd|th)?/i,
        dow: 1,
        month: 2,
        day: 3
      },
      {
        regex: /^Flight\s+\d+(?:\s*(?:of|\/|-)\s*\d+)?\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s]*([A-Za-z]{3,})/i,
        dow: 1,
        day: 2,
        month: 3
      }
    ];

    let headerDate = matchDatePatterns(normalized, datePatterns);

    if(!headerDate){
      headerDate = parseLooseDate(normalized);
    }

    return { index: Number.isFinite(index) ? index : null, headerDate };
  }

  function parseArrivesDate(line){
    // "Arrives Fri, Oct 24"
    if(!/\bArrives\b/i.test(line || '')) return null;
    const cleaned = line.replace(/\(.*?\)/g, ' ').replace(/\s*\+\s?\d+(?:\s*day(?:s)?)?/ig,' ').replace(/\s+/g,' ').trim();
    const patterns = [
      {
        regex: /Arrives\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})[,\s]*(\d{1,2})(?:st|nd|rd|th)?/i,
        dow: 1,
        month: 2,
        day: 3
      },
      {
        regex: /Arrives\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s]*([A-Za-z]{3,})/i,
        dow: 1,
        day: 2,
        month: 3
      }
    ];
    const direct = matchDatePatterns(cleaned, patterns);
    if(direct) return direct;
    return parseLooseDate(cleaned);
  }

  function parseDepartsDate(line){
    const cleaned = line.replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const patterns = [
      {
        regex: /Dep(?:arts|arture)(?:\s+on)?\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})[,\s]*(\d{1,2})(?:st|nd|rd|th)?/i,
        dow: 1,
        month: 2,
        day: 3
      },
      {
        regex: /Dep(?:arts|arture)(?:\s+on)?\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s]*([A-Za-z]{3,})/i,
        dow: 1,
        day: 2,
        month: 3
      }
    ];
    const direct = matchDatePatterns(cleaned, patterns);
    if(direct) return direct;
    return parseLooseDate(cleaned);
  }

  function parseInlineOnDate(line){
    const cleaned = line.replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const patterns = [
      {
        regex: /\bon\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})[,\s]*(\d{1,2})(?:st|nd|rd|th)?/i,
        dow: 1,
        month: 2,
        day: 3
      },
      {
        regex: /\bon\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s]*([A-Za-z]{3,})/i,
        dow: 1,
        day: 2,
        month: 3
      }
    ];
    const direct = matchDatePatterns(cleaned, patterns);
    if(direct) return direct;
    return parseLooseDate(cleaned);
  }

  function resolveCabinEnum(value){
    if(!value) return null;
    if(GLOBAL_ROOT && typeof GLOBAL_ROOT.normalizeCabinEnum === 'function'){
      try {
        const normalized = GLOBAL_ROOT.normalizeCabinEnum(value);
        if(normalized) return normalized;
      } catch (err) {}
    }
    const normalized = String(value).trim().toLowerCase();
    if(!normalized) return null;
    if(normalized === 'first' || normalized === 'f') return 'FIRST';
    if(normalized === 'business' || normalized === 'b' || normalized === 'j') return 'BUSINESS';
    if(normalized === 'premium' || normalized === 'premium economy' || normalized === 'w') return 'PREMIUM';
    if(normalized === 'economy' || normalized === 'coach' || normalized === 'y') return 'ECONOMY';
    if(normalized.startsWith('first')) return 'FIRST';
    if(normalized.startsWith('business') || normalized.includes('biz')) return 'BUSINESS';
    if(normalized.startsWith('premium')) return 'PREMIUM';
    if(normalized.startsWith('economy') || normalized.startsWith('coach')) return 'ECONOMY';
    return null;
  }

  function parseLooseDate(line){
    const cleaned = (line || '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!cleaned) return null;

    let candidate = cleaned
      .replace(/\bFlight\s+\d+(?:\s*(?:of|\/|-)\s*\d+)?\b/ig, ' ')
      .replace(/\b(?:Leg|Segment)\s+\d+\b/ig, ' ')
      .replace(/\bof\s+\d+\b/ig, ' ')
      .replace(/\b(?:Depart(?:s|ure)?|Return|Outbound|Inbound|Journey|Trip|Itinerary)\b/ig, ' ')
      .replace(/\b20\d{2}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!candidate) candidate = cleaned;

    const monthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    const dowPattern = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat)';
    const dayPattern = '(\\d{1,2})(?:st|nd|rd|th)?';

    const patterns = [
      {
        regex: new RegExp(`${dowPattern}[,\\s-]+${monthPattern}[,\\s-]+${dayPattern}`, 'i'),
        dow: 1,
        month: 2,
        day: 3
      },
      {
        regex: new RegExp(`${dowPattern}[,\\s-]+${dayPattern}[,\\s-]+${monthPattern}`, 'i'),
        dow: 1,
        day: 2,
        month: 3
      },
      {
        regex: new RegExp(`${monthPattern}[,\\s-]*${dayPattern}(?:[,\\s-]+${dowPattern})?`, 'i'),
        month: 1,
        day: 2,
        dow: 3
      },
      {
        regex: new RegExp(`${dayPattern}[,\\s-]+${monthPattern}(?:[,\\s-]+${dowPattern})?`, 'i'),
        day: 1,
        month: 2,
        dow: 3
      }
    ];

    const loose = matchDatePatterns(candidate, patterns);
    if(loose) return loose;

    return null;
  }

  function extractAirportCode(line){
    const m = line.match(/\(([A-Z]{3})\)/);
    return m ? m[1] : null;
  }

  function parseRouteHeaderLine(line){
    const cleaned = (line || '').replace(/[•·]/g, ' ').replace(/\s+/g,' ').trim();
    if(!cleaned) return null;
    if(!/\bto\b/i.test(cleaned)) return null;
    const codeRx = /\(([A-Z]{3})\)/g;
    const codes = [];
    let match;
    while((match = codeRx.exec(cleaned))){
      codes.push(match[1]);
      if(codes.length === 2) break;
    }
    if(codes.length < 2) return null;
    let headerDate = parseInlineOnDate(cleaned);
    if(!headerDate){
      const tailPatterns = [
        {
          regex: /((?:Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?))?[,\s]*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s\.]*(\d{1,2})(?:st|nd|rd|th)?$/i,
          dow: 1,
          month: 2,
          day: 3
        },
        {
          regex: /((?:Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?))?[,\s]*(\d{1,2})(?:st|nd|rd|th)?[,\s\.]*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)$/i,
          dow: 1,
          day: 2,
          month: 3
        }
      ];
      const tail = matchDatePatterns(cleaned, tailPatterns);
      if(tail) headerDate = tail;
    }
    if(!headerDate){
      headerDate = parseLooseDate(cleaned);
    }
    if(!headerDate) return null;
    return { origin: codes[0], dest: codes[1], headerDate };
  }

  function extractBookingClass(line){
    const cleaned = (line || '').replace(/[•·]/g, ' ').replace(/\s+/g,' ').trim();
    if(!cleaned) return null;
    const match = cleaned.match(/\(([A-Z0-9]{1,2})\)/);
    if(!match) return null;
    if(!/(Economy|Business|First|Premium|Coach|Cabin|Class)/i.test(cleaned)) return null;
    return match[1].toUpperCase();
  }

  function isAirlineLine(line){
    // We consider a line starting with airline name in AIRLINE_CODES
    const name = line.trim();
    if(typeof lookupAirlineCodeByName === 'function'){
      return !!lookupAirlineCodeByName(name);
    }
    const upper = name.toUpperCase();
    return !!(typeof AIRLINE_CODES !== 'undefined' && AIRLINE_CODES[upper]);
  }

  function extractFlightNumberLine(line){
    // e.g., "United Airlines 949" or "Scandinavian Airlines 661 (operated by Cityjet)"
    const cleaned = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g,' ')
      .trim();
    if(!cleaned) return null;
    if(isLikelyEquipmentLine(cleaned)) return null;
    const m = cleaned.match(/^([A-Za-z][A-Za-z\s'&.()/-]*?)\s+(\d{1,4})\b/);
    if(!m) return null;
    const airlineName = m[1].trim();
    if(/\bOPERATED BY\b/i.test(airlineName)) return null;
    const num = m[2];
    return { airlineName, num };
  }

  function looksLikeAirlineName(name){
    const cleaned = (name || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!cleaned) return false;
    const normalized = cleaned.toUpperCase();
    if(/\bOPERATED BY\b/.test(normalized)) return false;
    if(/\b(AIRBUS|BOEING|EMBRAER|BOMBARDIER|CANADAIR|DE HAVILLAND|MCDONNELL|DOUGLAS|LOCKHEED|SUKHOI|SUPERJET|FOKKER|TUP|ANTONOV|IL-\d+|SAAB|ATR|TURBOPROP|JETLINER|AIRCRAFT|E-?JET|CRJ|MAX|NEO)\b/.test(normalized)) return false;
    if(typeof lookupAirlineCodeByName === 'function'){
      const code = lookupAirlineCodeByName(cleaned);
      if(code) return true;
    } else if(typeof AIRLINE_CODES !== 'undefined' && AIRLINE_CODES[normalized]){
      return true;
    }
    if(/\bAIR\s/.test(normalized)) return true;
    return /\b(AIRLINES?|AIRWAYS|AVIATION|FLY|JET |JETBLUE|JET2|CONDOR|ICELANDAIR|TRANSAT|PORTER|VIRGIN|SKY|AERO|WING)\b/.test(normalized);
  }

  function determineAirlineCodeFromName(name){
    const raw = (name || '').trim();
    if(!raw){
      return { code: UNKNOWN_AIRLINE_CODE, isKnown: false };
    }
    let resolved = null;
    if(typeof lookupAirlineCodeByName === 'function'){
      try {
        resolved = lookupAirlineCodeByName(raw);
      } catch (err) {
        resolved = null;
      }
    } else {
      const upper = raw.toUpperCase();
      if(typeof AIRLINE_CODES !== 'undefined' && Object.prototype.hasOwnProperty.call(AIRLINE_CODES, upper)){
        resolved = AIRLINE_CODES[upper];
      }
    }
    if(resolved){
      return { code: resolved, isKnown: true };
    }
    const designator = raw.toUpperCase();
    if(/^[A-Z0-9]{2,3}$/.test(designator)){
      return { code: resolveAirlineCode(designator, null), isKnown: false };
    }
    return { code: UNKNOWN_AIRLINE_CODE, isKnown: false };
  }

  function isLikelyEquipmentLine(line){
    const cleaned = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!cleaned) return false;
    if(/\bOPERATED BY\b/i.test(cleaned)) return false;
    if(/\b(AIRLINES?|AIRWAYS|AVIATION)\b/i.test(cleaned)) return false;

    const keywordRx = /\b(AIRBUS|BOEING|EMBRAER|BOMBARDIER|CANADAIR|DE HAVILLAND|MCDONNELL|DOUGLAS|LOCKHEED|SUKHOI|SUPERJET|FOKKER|TUP|ANTONOV|IL-?\d*|SAAB|ATR|CITATION|GULFSTREAM|TURBOPROP|JETLINER|AIRCRAFT|DASH|E-?JET|CRJ|MD-?\d*)\b/i;
    if(keywordRx.test(cleaned)) return true;

    const rjContextRx = /\b(CANADAIR|BOMBARDIER|REGIONAL JET|CITYJET|SKYWEST|ENVOY|GOJET|EXPRESSJET|AMERICAN EAGLE)\b/i;
    if(/\bRJ\s?\d{2,3}\b/i.test(cleaned) && rjContextRx.test(cleaned)) return true;

    if(/\b(?:MAX|NEO)\b/i.test(cleaned) && /\d/.test(cleaned)) return true;
    if(/\b\d{3,4}-\d{2,3}\b/.test(cleaned)) return true;

    if(/^(?:E-?\d{2,3}(?:-E2)?|CRJ ?\d{2,3}|Q\d{3,4}|Dash ?\d(?:-?\d{2,3})?)$/i.test(cleaned)) return true;

    const abModelRx = /\b(?:A|B)\d{3,4}(?:-?\d+)?\b/i;
    if(abModelRx.test(cleaned) && (/(AIRBUS|BOEING)/i.test(cleaned) || /\b(?:MAX|NEO)\b/i.test(cleaned) || /-/.test(cleaned))){
      return true;
    }

    return false;
  }

  function findAirlineCodeNearby(lines, idx){
    for(let look = idx; look >= 0 && look >= idx - 3; look--){
      const rawName = (lines[look] || '').trim();
      if(!rawName) continue;
      if(typeof lookupAirlineCodeByName === 'function'){
        const resolved = lookupAirlineCodeByName(rawName);
        if(resolved) return resolved;
      } else {
        const upper = rawName.toUpperCase();
        if(typeof AIRLINE_CODES !== 'undefined' && AIRLINE_CODES[upper]) return AIRLINE_CODES[upper];
      }
    }
    return null;
  }

  function resolveAirlineCode(candidate, contextCode){
    if(contextCode) return contextCode;
    if(candidate.length === 3 && /^[A-Z]{3}$/.test(candidate)){
      return candidate.slice(0,2);
    }
    return candidate;
  }

  function getFlightInfo(lines, idx){
    const raw = (lines[idx] || '').replace(/[•·]/g, ' ').replace(/\s+/g,' ').trim();
    if(isSegmentNoiseLine(lines[idx])) return null;
    if(!raw) return null;
    if(isLikelyEquipmentLine(raw)) return null;

    const direct = extractFlightNumberLine(raw);
    if(direct && looksLikeAirlineName(direct.airlineName)){
      const info = determineAirlineCodeFromName(direct.airlineName);
      return {
        airlineCode: info.code,
        number: direct.num,
        index: idx
      };
    }

    // Support airline name on one line and flight number on the next
    const nameOnlyRaw = raw.trim();
    const nameOnly = nameOnlyRaw.toUpperCase();
    if(looksLikeAirlineName(nameOnlyRaw) && (idx + 1) < lines.length){
      const next = (lines[idx + 1] || '').trim();
      if(/^\d{1,4}$/.test(next)){
        const info = determineAirlineCodeFromName(nameOnlyRaw);
        return {
          airlineCode: info.code,
          number: next,
          index: idx + 1
        };
      }
    }

    const designatorRe = /\b([A-Z0-9]{2,3})(?:\s|-)?(\d{1,4})\b/g;
    let match;
    while((match = designatorRe.exec(raw))){
      const candidate = match[1].toUpperCase();
      const number = match[2];
      if(!/[A-Z]/.test(candidate)) continue; // skip if no letters (pure numeric)
      const before = raw.slice(0, match.index).trim();
      const prevWord = before.split(/\s+/).pop() || '';
      if(/(Boeing|Airbus|Embraer|Bombardier|Dreamliner|neo|MAX|CRJ|E-?Jet)/i.test(prevWord)){
        continue;
      }
      const contextCode = findAirlineCodeNearby(lines, idx);
      const airlineCode = resolveAirlineCode(candidate, contextCode);
      return { airlineCode, number, index: idx };
    }

    return null;
  }

  function collectSegments(lines, headerDate, collector){
    const segs = [];
    let i = 0;
    let currentDate = headerDate ? { ...headerDate } : null;
    let lastRouteInfo = null;
    let homeAirport = null;
    let inboundActive = false;
    let lastArrivalInfo = null;

    const tracking = collector && typeof collector === 'object' ? collector : null;
    const journeys = tracking ? [] : null;
    let currentJourney = null;
    let pendingJourneyHeader = null;
    let journeyBoundaryPending = false;

    const finalizeJourney = () => {
      if(!currentJourney) return;
      const startIdx = currentJourney.startIdx;
      const endIdx = segs.length - 1;
      if(endIdx < startIdx){
        currentJourney = null;
        return;
      }
      const firstSeg = segs[startIdx];
      const lastSeg = segs[endIdx];
      currentJourney.origin = currentJourney.origin || (firstSeg ? firstSeg.depAirport : null);
      currentJourney.dest = currentJourney.dest || (lastSeg ? lastSeg.arrAirport : null);
      currentJourney.startIdx = startIdx;
      currentJourney.endIdx = endIdx;
      if(journeys){
        journeys.push(currentJourney);
      }
      currentJourney = null;
    };

    const startJourney = (meta) => {
      lastArrivalInfo = null;
      journeyBoundaryPending = true;
      if(!journeys) return;
      if(currentJourney){
        const startIdx = currentJourney.startIdx;
        if(segs.length > startIdx){
          finalizeJourney();
        }else{
          currentJourney = null;
        }
      }
      const info = meta || {};
      let headerRef = null;
      if(info.headerDate){
        headerRef = { ...info.headerDate };
      }else if(currentDate){
        headerRef = { ...currentDate };
      }
      let indexHint = null;
      if(typeof info.indexHint === 'number' && Number.isFinite(info.indexHint)){
        indexHint = info.indexHint;
      }
      currentJourney = {
        startIdx: segs.length,
        origin: info.origin || null,
        dest: info.dest || null,
        explicit: !!info.explicit,
        indexHint,
        headerDate: headerRef
      };
    };

    const ensureJourneyActive = () => {
      if(!journeys) return;
      if(!currentJourney){
        startJourney({ explicit: false });
      }
    };

    if(journeys && headerDate){
      startJourney({ explicit: false, headerDate });
    }

    const applyDepartsOverride = (line) => {
      if(!line) return false;
      const raw = String(line);
      if(/\bArriv/i.test(raw)) return false;
      if(!/\bDep(?:art|arts|arture|arting)\b/i.test(raw)) return false;
      const depInfo = parseDepartsDate(raw);
      if(depInfo){
        const nextDow = depInfo.dow || (currentDate ? currentDate.dow : '');
        currentDate = { day: depInfo.day, mon: depInfo.mon, dow: nextDow };
        return true;
      }
      return false;
    };

    const findRouteHeaderBefore = (idx) => {
      for(let look = idx; look >= 0 && look >= idx - 8; look--){
        const info = parseRouteHeaderLine(lines[look]);
        if(info) return { info, index: look };
      }
      return null;
    };

    const findNearestDepartureDate = (idx) => {
      const maxLook = 6;
      if(!Array.isArray(lines) || !lines.length) return null;
      const base = Number.isFinite(idx) ? idx : 0;
      const activeJourneyIndex = currentJourney && Number.isFinite(currentJourney.indexHint)
        ? currentJourney.indexHint
        : null;

      const considerJourneyHeader = (raw, idx, context) => {
        if(!raw) return null;
        const info = parseJourneyHeader(raw);
        if(!info) return null;
        const headerIdx = Number.isFinite(info.index) ? info.index : null;
        if(pendingJourneyHeader && pendingJourneyHeader.deferred){
          const pendingSource = Number.isFinite(pendingJourneyHeader.sourceIndex)
            ? pendingJourneyHeader.sourceIndex
            : null;
          if(pendingSource != null && Number.isFinite(idx) && pendingSource === idx){
            return { skip:true };
          }
        }
        if(pendingJourneyHeader){
          const pendingIdx = pendingJourneyHeader.indexHint != null && Number.isFinite(Number(pendingJourneyHeader.indexHint))
            ? Number(pendingJourneyHeader.indexHint)
            : null;
          if(pendingIdx != null && headerIdx != null && pendingIdx === headerIdx){
            return { skip:true };
          }
        }
        if(activeJourneyIndex != null && headerIdx != null && headerIdx !== activeJourneyIndex){
          return { skip:true };
        }
        if(context && context.connectionHint){
          return { skip:true };
        }
        if(info.headerDate){
          return { date: info.headerDate };
        }
        return null;
      };

      const connectionHintRx = /\b(Change planes|Long layover|Overnight flight)\b/i;
      let sawConnectionBack = false;
      for(let back = 0; back <= maxLook; back++){
        const lookIdx = base - back;
        if(lookIdx < 0) break;
        const raw = lines[lookIdx] || '';
        if(connectionHintRx.test(raw)){
          sawConnectionBack = true;
          continue;
        }
        const journeyCheck = considerJourneyHeader(raw, lookIdx, { connectionHint: sawConnectionBack });
        if(journeyCheck){
          if(journeyCheck.skip) continue;
          if(journeyCheck.date) return journeyCheck.date;
        }
        if(isSegmentNoiseLine(raw)) continue;
        if(/Arrives\b/i.test(raw)) continue;
        if(/Layover/i.test(raw)) continue;
        const depCandidate = parseDepartsDate(raw) || parseInlineOnDate(raw) || parseLooseDate(raw);
        if(depCandidate) return depCandidate;
      }
      let sawConnectionForward = false;
      for(let forward = 1; forward <= maxLook; forward++){
        const lookIdx = base + forward;
        if(lookIdx >= lines.length) break;
        const raw = lines[lookIdx] || '';
        if(connectionHintRx.test(raw)){
          sawConnectionForward = true;
          continue;
        }
        const journeyCheck = considerJourneyHeader(raw, lookIdx, { connectionHint: sawConnectionForward });
        if(journeyCheck){
          if(journeyCheck.skip) continue;
          if(journeyCheck.date) return journeyCheck.date;
        }
        if(isSegmentNoiseLine(raw)) continue;
        if(/Arrives\b/i.test(raw)) continue;
        if(/^\d{1,2}:\d{2}/.test(raw)) break;
        if(/Layover/i.test(raw)) continue;
        const normalizedForward = raw.replace(/[\s\u00a0]+/g, ' ').trim();
        if(!normalizedForward) continue;
        const forwardJourney = considerJourneyHeader(normalizedForward, lookIdx, { connectionHint: sawConnectionForward });
        if(forwardJourney){
          if(forwardJourney.skip) continue;
          if(forwardJourney.date) return forwardJourney.date;
        }
        if(/\b(Return|Outbound|Inbound|Journey|Trip|Itinerary)\b/i.test(normalizedForward)) break;
        const depCandidate = parseDepartsDate(raw) || parseInlineOnDate(raw) || parseLooseDate(raw);
        if(depCandidate) return depCandidate;
      }
      return null;
    };

    while(i < lines.length){
      let flightInfo = null;
      let j = i;
      for(; j < lines.length; j++){
        const journeyInfo = parseJourneyHeader(lines[j]);
        if(journeyInfo){
          const headerRef = journeyInfo.headerDate ? { ...journeyInfo.headerDate } : null;
          if(journeys && currentJourney && currentJourney.explicit && journeyInfo.index != null){
            const currentIndex = (typeof currentJourney.indexHint === 'number' && Number.isFinite(currentJourney.indexHint))
              ? currentJourney.indexHint
              : null;
            if(currentIndex != null && currentIndex === journeyInfo.index){
              if(headerRef){
                currentJourney.headerDate = { ...headerRef };
                const prevDow = currentDate ? currentDate.dow : '';
                const nextDow = headerRef.dow || prevDow || '';
                currentDate = { day: headerRef.day, mon: headerRef.mon, dow: nextDow };
              } else if(!currentJourney.headerDate && currentDate){
                currentJourney.headerDate = { ...currentDate };
              }
              pendingJourneyHeader = null;
              continue;
            }
          }
          pendingJourneyHeader = {
            headerDate: headerRef,
            indexHint: (typeof journeyInfo.index === 'number' && Number.isFinite(journeyInfo.index))
              ? journeyInfo.index
              : null,
            explicit: true,
            sourceIndex: j,
            deferred: false,
            boundaryPending: false
          };
          continue;
        }
        if(applyDepartsOverride(lines[j])) continue;
        const maybe = getFlightInfo(lines, j);
        if(maybe){ flightInfo = maybe; break; }
      }
      if(!flightInfo) break;

      let depTime = null;
      let depAirport = null;
      let arrTime = null;
      let arrAirport = null;
      let arrivesDate = null;
      let k = flightInfo.index + 1;
      let explicitDurationMinutes = null;

      const isNextFlightBoundary = (idx) => {
        if(idx == null || idx <= flightInfo.index || idx >= lines.length) return false;
        const boundaryInfo = getFlightInfo(lines, idx);
        if(!boundaryInfo) return false;
        if(boundaryInfo.index === flightInfo.index) return false;
        return boundaryInfo.index >= idx;
      };

      const routeLookup = findRouteHeaderBefore(flightInfo.index);
      const routeInfo = routeLookup ? routeLookup.info : null;
      let referenceDate = null;
      if(routeInfo){
        lastRouteInfo = routeInfo;
        if(!homeAirport && routeInfo.origin){
          homeAirport = routeInfo.origin;
        }
        if(homeAirport && routeInfo.dest === homeAirport){
          inboundActive = true;
        }
        if(!inboundActive && homeAirport && routeLookup && routeLookup.index > 0){
          const prevLookup = findRouteHeaderBefore(routeLookup.index - 1);
          if(prevLookup && prevLookup.info.dest === homeAirport){
            inboundActive = true;
          }
        }
        if(routeInfo.headerDate){
          referenceDate = { ...routeInfo.headerDate };
        }
      }
      if(!referenceDate){
        const searchIdx = routeLookup ? routeLookup.index : flightInfo.index;
        const derived = findNearestDepartureDate(searchIdx);
        if(derived){
          referenceDate = derived;
          if(routeInfo && !routeInfo.headerDate){
            routeInfo.headerDate = { ...derived };
          }
        }
      }
      if(referenceDate){
        let shouldOverrideCurrent = true;
        if(currentDate){
          const diff = dateInfoDifferenceInDays(currentDate, referenceDate);
          if(diff != null && diff < 0){
            shouldOverrideCurrent = false;
          }
        }
        if(shouldOverrideCurrent){
          const prevDow = currentDate ? currentDate.dow : '';
          const nextDow = referenceDate.dow || prevDow || '';
          currentDate = {
            day: referenceDate.day,
            mon: referenceDate.mon,
            dow: nextDow
          };
        }
      }

      for(; k < lines.length; k++){
        const headerCheck = parseJourneyHeader(lines[k]);
        if(headerCheck) break;
        if(isSegmentNoiseLine(lines[k])) continue;
        if(applyDepartsOverride(lines[k])) continue;
        if(parseRouteHeaderLine(lines[k])) break;
        if(isNextFlightBoundary(k)) break;
        const t = toAmPmMinutes(lines[k]);
        if(t.mins != null){ depTime = t; k++; break; }
      }
      if(!routeInfo){
        for(; k < lines.length; k++){
          const headerCheck = parseJourneyHeader(lines[k]);
          if(headerCheck) break;
          if(isSegmentNoiseLine(lines[k])) continue;
          if(applyDepartsOverride(lines[k])) continue;
          if(parseRouteHeaderLine(lines[k])) break;
          if(isNextFlightBoundary(k)) break;
          const code = extractAirportCode(lines[k]);
          if(code){ depAirport = code; k++; break; }
        }
      }
      for(; k < lines.length; k++){
        const headerCheck = parseJourneyHeader(lines[k]);
        if(headerCheck) break;
        if(isSegmentNoiseLine(lines[k])) continue;
        if(applyDepartsOverride(lines[k])) continue;
        if(parseRouteHeaderLine(lines[k])) break;
        if(isNextFlightBoundary(k)) break;
        const durCandidate = extractDurationMinutesFromLine(lines[k]);
        if(durCandidate != null){
          explicitDurationMinutes = durCandidate;
          continue;
        }
        const t = toAmPmMinutes(lines[k]);
        if(t.mins != null){ arrTime = t; k++; break; }
      }
      if(!routeInfo){
        for(; k < lines.length; k++){
          const headerCheck = parseJourneyHeader(lines[k]);
          if(headerCheck) break;
          if(isSegmentNoiseLine(lines[k])) continue;
          if(applyDepartsOverride(lines[k])) continue;
          if(parseRouteHeaderLine(lines[k])) break;
          if(isNextFlightBoundary(k)) break;
          const durCandidate = extractDurationMinutesFromLine(lines[k]);
          if(durCandidate != null){
            explicitDurationMinutes = durCandidate;
            continue;
          }
          const code = extractAirportCode(lines[k]);
          if(code){ arrAirport = code; k++; break; }
        }
      }

      if(routeInfo){
        depAirport = depAirport || routeInfo.origin || depAirport;
        arrAirport = arrAirport || routeInfo.dest || arrAirport;
      }

      if(flightInfo.index > 0){
        const backTimes = [];
        for(let look = flightInfo.index - 1; look >= 0 && backTimes.length < 3; look--){
          const info = parseRouteHeaderLine(lines[look]);
          if(info) break;
          if(isSegmentNoiseLine(lines[look])) continue;
          const t = toAmPmMinutes(lines[look]);
          if(t.mins != null){
            backTimes.push(t);
          }
        }
        if(backTimes.length){
          backTimes.reverse();
          if((!depTime || depTime.mins == null) && backTimes[0] && backTimes[0].mins != null){
            depTime = backTimes[0];
          }
          if((!arrTime || arrTime.mins == null) && backTimes.length > 1 && backTimes[1] && backTimes[1].mins != null){
            arrTime = backTimes[1];
          }
        }
      }

      let bookingClass = null;
      for(let z = k; z < Math.min(k + 6, lines.length); z++){
        const headerCheck = parseJourneyHeader(lines[z]);
        if(headerCheck) break;
        if(isSegmentNoiseLine(lines[z])) continue;
        if(applyDepartsOverride(lines[z])) continue;
        if(!bookingClass){
          const bc = extractBookingClass(lines[z]);
          if(bc){
            bookingClass = bc;
            continue;
          }
        }
        const ad = parseArrivesDate(lines[z]);
        if(ad){ arrivesDate = ad; break; }
        if(extractFlightNumberLine(lines[z])) break;
      }

      if(!bookingClass){
        for(let look = flightInfo.index + 1; look < Math.min(flightInfo.index + 6, lines.length); look++){
          if(isSegmentNoiseLine(lines[look])) continue;
          const bc = extractBookingClass(lines[look]);
          if(bc){ bookingClass = bc; break; }
        }
      }

      if(depTime && depAirport && arrTime && arrAirport){
        if(pendingJourneyHeader){
          const lastSeg = segs.length ? segs[segs.length - 1] : null;
          const matchesPrevArrival = lastSeg && lastSeg.arrAirport && depAirport && lastSeg.arrAirport === depAirport;
          if(matchesPrevArrival){
            pendingJourneyHeader.deferred = true;
            pendingJourneyHeader.boundaryPending = true;
          } else {
            const headerDate = pendingJourneyHeader.headerDate ? { ...pendingJourneyHeader.headerDate } : null;
            if(headerDate){
              const prevDow = currentDate ? currentDate.dow : '';
              const nextDow = headerDate.dow || prevDow || '';
              currentDate = { day: headerDate.day, mon: headerDate.mon, dow: nextDow };
            }
            startJourney({
              explicit: !!pendingJourneyHeader.explicit,
              indexHint: pendingJourneyHeader.indexHint != null ? Number(pendingJourneyHeader.indexHint) : null,
              headerDate: pendingJourneyHeader.headerDate || currentDate
            });
            pendingJourneyHeader = null;
          }
        }
        const boundaryFromHeader = pendingJourneyHeader && pendingJourneyHeader.boundaryPending === true;
        const isJourneyBoundary = journeyBoundaryPending || boundaryFromHeader;
        journeyBoundaryPending = false;
        if(boundaryFromHeader && pendingJourneyHeader){
          pendingJourneyHeader.boundaryPending = false;
        }
        const lastArrivalMatches = lastArrivalInfo && depAirport && lastArrivalInfo.airport === depAirport;
        let segmentDate = currentDate ? cloneDateInfo(currentDate) : null;
        const initialSegmentDate = segmentDate ? cloneDateInfo(segmentDate) : null;
        if(segmentDate && lastArrivalInfo && lastArrivalInfo.date){
          const forwardGap = dateInfoDifferenceInDays(segmentDate, lastArrivalInfo.date);
          if(Number.isFinite(forwardGap) && forwardGap > 0){
            segmentDate = cloneDateInfo(lastArrivalInfo.date);
            currentDate = cloneDateInfo(lastArrivalInfo.date);
          }
        }
        let shouldInheritArrivalContext = lastArrivalMatches && !isJourneyBoundary;
        if(shouldInheritArrivalContext && segmentDate && lastArrivalInfo && lastArrivalInfo.date){
          const dateGap = dateInfoDifferenceInDays(lastArrivalInfo.date, segmentDate);
          if(dateGap != null && dateGap !== 0){
            shouldInheritArrivalContext = false;
          }
        }
        if(shouldInheritArrivalContext && lastArrivalInfo && lastArrivalInfo.date && initialSegmentDate){
          const diffDays = dateInfoDifferenceInDays(lastArrivalInfo.date, initialSegmentDate);
          if(diffDays != null && Math.abs(diffDays) >= 2){
            shouldInheritArrivalContext = false;
          }
        }
        if(shouldInheritArrivalContext){
          let base = lastArrivalInfo.date ? cloneDateInfo(lastArrivalInfo.date) : null;
          if(!base && segmentDate){
            base = cloneDateInfo(segmentDate);
          }else if(!base && currentDate){
            base = cloneDateInfo(currentDate);
          }
          if(base){
            if(lastArrivalInfo.minutes != null && depTime && depTime.mins != null && depTime.mins < lastArrivalInfo.minutes){
              base = addDaysToDateInfo(base, 1, base.dow || (segmentDate ? segmentDate.dow : ''));
            }
            segmentDate = cloneDateInfo(base);
            currentDate = cloneDateInfo(base);
          }
        }

        const airlineCode = flightInfo.airlineCode || UNKNOWN_AIRLINE_CODE; // ensure unknown carriers default to XX
        const flightNumber = flightInfo.number;
        const depDateString = segmentDate ? `${segmentDate.day}${segmentDate.mon}` : '';
        const depDow = segmentDate ? segmentDate.dow : '';
        const arrDateString = arrivesDate
          ? `${arrivesDate.day}${arrivesDate.mon}${arrivesDate.dow ? ` ${arrivesDate.dow}` : ''}`
          : "";
        const depDateInfo = segmentDate ? cloneDateInfo(segmentDate) : null;
        let nextDateContext = null;
        if(arrivesDate){
          nextDateContext = {
            day: arrivesDate.day,
            mon: arrivesDate.mon,
            dow: arrivesDate.dow || (segmentDate ? segmentDate.dow : '')
          };
        } else if(segmentDate){
          nextDateContext = cloneDateInfo(segmentDate);
          if(arrTime && arrTime.mins != null && depTime && depTime.mins != null && arrTime.mins < depTime.mins){
            nextDateContext = addDaysToDateInfo(nextDateContext, 1, nextDateContext.dow || (segmentDate ? segmentDate.dow : ''));
          }
        }
        const arrivalDateInfo = nextDateContext ? cloneDateInfo(nextDateContext) : (currentDate ? cloneDateInfo(currentDate) : null);
        let durationMinutes = null;
        const depMinutes = depTime && Number.isFinite(depTime.mins) ? depTime.mins : null;
        const arrMinutes = arrTime && Number.isFinite(arrTime.mins) ? arrTime.mins : null;
        if(depMinutes != null && arrMinutes != null){
          let dayOffset = null;
          if(depDateInfo && arrivalDateInfo){
            const diffDays = dateInfoDifferenceInDays(depDateInfo, arrivalDateInfo);
            if(Number.isFinite(diffDays)){
              dayOffset = diffDays;
            }
          }
          if(dayOffset == null){
            dayOffset = arrMinutes < depMinutes ? 1 : 0;
          }
          let candidate = (arrMinutes + dayOffset * (24 * 60)) - depMinutes;
          if(candidate < 0 && arrMinutes < depMinutes){
            candidate += 24 * 60;
          }
          if(candidate >= 0 && candidate <= 7 * 24 * 60){
            durationMinutes = candidate;
          }
        }
        if(explicitDurationMinutes != null){
          if(!Number.isFinite(durationMinutes) || Math.abs(explicitDurationMinutes - durationMinutes) >= 30){
            durationMinutes = explicitDurationMinutes;
          }
        }
        segs.push({
          airlineCode,
          number: flightNumber,
          depDate: depDateString,
          depDOW: depDow,
          depAirport,
          arrAirport,
          depGDS: depTime.gds,
          arrGDS: arrTime.gds,
          routeOrigin: lastRouteInfo ? lastRouteInfo.origin : null,
          routeDest: lastRouteInfo ? lastRouteInfo.dest : null,
          headerRef: segmentDate ? cloneDateInfo(segmentDate) : (currentDate ? cloneDateInfo(currentDate) : null),
          bookingClass,
          arrDate: arrDateString,
          direction: inboundActive ? 'inbound' : 'outbound',
          durationMinutes
        });
        if(currentJourney){
          if(!currentJourney.origin) currentJourney.origin = depAirport || currentJourney.origin || null;
          currentJourney.dest = arrAirport || currentJourney.dest || null;
        } else {
          ensureJourneyActive();
          if(currentJourney){
            if(!currentJourney.origin) currentJourney.origin = depAirport || currentJourney.origin || null;
            currentJourney.dest = arrAirport || currentJourney.dest || null;
          }
        }
        if(nextDateContext){
          const prevDow = currentDate ? currentDate.dow : (segmentDate ? segmentDate.dow : '');
          const nextDow = nextDateContext.dow || prevDow || '';
          currentDate = {
            day: nextDateContext.day,
            mon: nextDateContext.mon,
            dow: nextDow
          };
        }

        lastArrivalInfo = {
          airport: arrAirport || null,
          minutes: arrTime && Number.isFinite(arrTime.mins) ? arrTime.mins : null,
          date: currentDate ? cloneDateInfo(currentDate) : null
        };
        i = k;
      }else{
        i = flightInfo.index + 1;
      }
    }

    finalizeJourney();
    if(journeys){
      tracking.journeys = journeys;
      tracking.segments = segs;
    }

    return segs;
  }

  function formatSegmentsToILines(segs, opts){
    const out = [];
    if(segs.length === 0) return out;

    const formatFlightDesignator = (airlineCode, number, bookingClass) => {
      const base = number.length < 4
        ? `${airlineCode} ${number}`
        : `${airlineCode}${number}`;
      return `${base}${bookingClass}`;
    };

    const formatGdsTime = (value) => {
      if(!value) return '';
      const trimmed = String(value).trim();
      if(/^00(\d{2}[AP])$/i.test(trimmed)){
        return trimmed.replace(/^00/, '12');
      }
      return trimmed.replace(/^0+(\d)/, '$1');
    };

    const formatDateField = (depDate, depDow) => {
      const date = (depDate || '').trim();
      const dow = (depDow || '').trim();
      if(date && dow){
        return `${date} ${dow}`;
      }
      return date || dow;
    };

    const preferredRbdFn = GLOBAL_ROOT && typeof GLOBAL_ROOT.getPreferredRBD === 'function'
      ? GLOBAL_ROOT.getPreferredRBD
      : null;
    const autoCabinEnum = opts && opts.autoCabin ? resolveCabinEnum(opts.autoCabin) : null;
    const baseBookingClass = (opts && opts.bookingClass) ? String(opts.bookingClass).trim().toUpperCase() : '';

    for(let idx = 0; idx < segs.length; idx++){
      const s = segs[idx];
      const segNumber = String(idx + 1).padStart(2, ' ');
      let bookingClass = (s && s.bookingClass) ? String(s.bookingClass).trim().toUpperCase() : '';
      if(!bookingClass){
        const segmentDurationMinutes = extractSegmentDurationMinutes(s);
        if(preferredRbdFn && autoCabinEnum){
          try {
            const candidate = preferredRbdFn({
              airlineCode: s ? s.airlineCode || '' : '',
              marketedCabin: autoCabinEnum,
              durationMinutes: segmentDurationMinutes,
              origin: s ? s.depAirport || '' : '',
              destination: s ? s.arrAirport || '' : ''
            });
            if(candidate){
              bookingClass = String(candidate).trim().toUpperCase();
            }
          } catch (err) {}
        }
        const fallbackCabin = normalizeShortHaulCabin(autoCabinEnum, segmentDurationMinutes, s && s.depAirport, s && s.arrAirport);
        if(!bookingClass && fallbackCabin && CABIN_FALLBACK_BOOKING[fallbackCabin]){
          bookingClass = CABIN_FALLBACK_BOOKING[fallbackCabin];
        }
        if(!bookingClass && baseBookingClass){
          bookingClass = baseBookingClass;
        }
      }
      if(!bookingClass){
        bookingClass = CABIN_FALLBACK_BOOKING.ECONOMY;
      }
      const flightField = formatFlightDesignator(s.airlineCode, s.number, bookingClass);
      const dateField = formatDateField(s.depDate, s.depDOW);
      const status = (opts.segmentStatus || '').trim();
      const indicator = status ? '*' : '';
      const cityField = `${s.depAirport}${s.arrAirport}${indicator}${status}`.trim();
      const depTime = formatGdsTime(s.depGDS);
      const arrTime = formatGdsTime(s.arrGDS);

      const parts = [
        segNumber,
        flightField,
        dateField,
        cityField,
        depTime,
        arrTime
      ].filter(part => part && part.length);

      if(s.arrDate){
        parts.push(String(s.arrDate).trim());
      }

      parts.push(`/DC${s.airlineCode}`);
      parts.push('/E');

      out.push(parts.join(' '));
    }

    return out;
  }

  function determineSectionKind(headerLine){
    const normalized = (headerLine || '').toLowerCase();
    if(/\b(return|inbound)\b/.test(normalized)) return 'inbound';
    return 'outbound';
  }

  function inferHeaderDateFromLines(lines){
    if(!Array.isArray(lines) || !lines.length) return null;
    const normalized = lines
      .map(line => (line || '').replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if(!normalized.length) return null;

    const attemptParse = (value) => {
      if(!value) return null;
      return parseHeaderDate(value) || parseDepartsDate(value) || parseLooseDate(value);
    };

    const maxWindow = Math.min(normalized.length, 6);
    for(let span = 1; span <= Math.min(3, maxWindow); span++){
      for(let start = 0; start + span <= maxWindow; start++){
        const merged = normalized.slice(start, start + span).join(' ');
        const parsed = attemptParse(merged);
        if(parsed) return parsed;
      }
    }

    return attemptParse(normalized.join(' '));
  }

  function hasFlightClues(lines){
    if(!Array.isArray(lines) || !lines.length) return false;
    let airportHits = 0;
    let timeHits = 0;
    let flightHits = 0;
    for(const raw of lines){
      if(!raw) continue;
      if(extractAirportCode(raw)) airportHits++;
      const timeInfo = toAmPmMinutes(raw);
      if(timeInfo && Number.isFinite(timeInfo.mins)) timeHits++;
      if(extractFlightNumberLine(raw)) flightHits++;
    }
    if(flightHits && (airportHits || timeHits)) return true;
    if(airportHits >= 2 && timeHits >= 1) return true;
    if(timeHits >= 2 && airportHits >= 1) return true;
    return false;
  }

  function splitIntoSections(lines){
    // return [{headerDate, lines: [...]}, ...] for Depart and Return
    const indices = [];
    for(let i=0;i<lines.length;i++){
      if(/^(Depart(?:ure)?|Return|Outbound|Inbound)(?:\s*[•·-])?\s+/i.test(lines[i])) indices.push(i);
    }
    if(indices.length===0){
      const leadingDate = inferHeaderDateFromLines(lines);
      return leadingDate || hasFlightClues(lines)
        ? [{ headerDate: leadingDate, lines: lines.slice(), kind: 'outbound', synthetic: true }]
        : [];
    }
    const sections = [];
    if(indices[0] > 0){
      const leading = lines.slice(0, indices[0]);
      if(hasFlightClues(leading)){
        sections.push({
          headerDate: inferHeaderDateFromLines(leading),
          lines: leading,
          kind: 'outbound',
          synthetic: true
        });
      }
    }
    for(let s=0; s<indices.length; s++){
      const start = indices[s];
      const end = (s+1<indices.length) ? indices[s+1] : lines.length;
      const headerLine = lines[start];
      let headerDate = parseHeaderDate(headerLine);
      if(!headerDate){
        const windowLines = [headerLine].concat(lines.slice(start + 1, Math.min(end, start + 4)));
        headerDate = inferHeaderDateFromLines(windowLines);
      }
      const kind = determineSectionKind(headerLine);
      sections.push({ headerDate, lines: lines.slice(start+1, end), kind });
    }
    return sections;
  }

  function isSegmentNoiseLine(line){
    const normalized = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!normalized) return true;
    if(/^Overnight flight\b/i.test(normalized)) return true;
    if(/^Long layover\b/i.test(normalized)) return true;
    if(/^Change planes in\b/i.test(normalized)) return true;
    if(/^Operated by\b/i.test(normalized)) return true;
    if(!/\([A-Z]{3}\)/.test(normalized) && isLikelyEquipmentLine(normalized)) return true;
    return false;
  }

  function sanitize(raw){
    const base = raw.split(/\r?\n/)
      .map(s => s.replace(/[•·]+/g, '•').replace(/\s+/g,' ').trim())
      .filter(Boolean);
    const expanded = [];
    const timeRe = /(\d{1,2}:\d{2}\s*(?:[ap]m)?)/ig;

    for(const rawLine of base){
      const lineWithBullets = rawLine.replace(/[•·]+/g, '•');
      if(isSegmentNoiseLine(lineWithBullets)) continue;
      const normalizedForNoise = lineWithBullets.replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
      if(!normalizedForNoise) continue;

      if(/^(Depart|Departure|Return|Outbound|Inbound)\b/i.test(lineWithBullets)){
        expanded.push(lineWithBullets);
        continue;
      }

      if(/^\s*Flight\s+\d+\s*[•·]/i.test(lineWithBullets)){
        expanded.push(lineWithBullets.replace(/[•·]/g, ' '));
        continue;
      }

      const bulletParts = lineWithBullets
        .split(/\s*[•·]\s*/)
        .map(p => p.trim())
        .filter(part => {
          if(!part) return false;
          const norm = part.replace(/\s+/g, ' ').trim();
          if(!norm) return false;
          if(isSegmentNoiseLine(norm)) return false;
          return true;
        });
      if(bulletParts.length > 1){
        expanded.push(...bulletParts);
        continue;
      }

      timeRe.lastIndex = 0;
      const timeMatches = [];
      let match;
      while((match = timeRe.exec(lineWithBullets))){
        timeMatches.push(match[0].trim());
      }
      if(timeMatches.length >= 1){
        expanded.push(...timeMatches);
        const leftover = lineWithBullets.replace(timeRe, ' ')
          .replace(/[-–—]/g,' ')
          .replace(/\s+/g,' ')
          .trim();
        if(leftover) expanded.push(leftover);
        continue;
      }

      expanded.push(lineWithBullets);
    }

    const normalized = [];
    const consumed = new Set();
    const headerPrefix = /^(Depart(?:ure)?|Return|Outbound|Inbound)/i;
    const departsPrefix = /^Departs?\b/i;
    const arrivesPrefix = /^Arrives\b/i;
    const skipBetweenDate = [
      /^\*I/i,
      /^\d+h(?:\s?\d+m)?$/i,
      /^\d+\s?m$/i,
      /^Overnight flight/i,
      /^Long (?:layover|stopover)/i,
      /^Change planes in/i,
      /^Layover/i,
      /^Limited seats/i
    ];

    const dateTokenPatterns = [
      /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[,]?$/i,
      /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\.?|,)?$/i,
      /^\d{1,2}(?:st|nd|rd|th)?$/i,
      /^\d{4}$/,
      /^on$/i
    ];

    const isDateToken = (value) => {
      if(!value) return false;
      const trimmed = String(value).replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
      if(!trimmed) return false;
      return dateTokenPatterns.some(rx => rx.test(trimmed));
    };

    const normalizeCombined = (value) => {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\s+,/g, ',')
        .replace(/,\s+/g, ', ')
        .trim();
    };

    const inlineMonthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    const inlineDowPattern = '(Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)';
    const inlineDayPattern = '(?:\\d{1,2})(?:st|nd|rd|th)?';
    const dateFragmentPatterns = [
      new RegExp(`${inlineDowPattern}[,\\s-]+${inlineMonthPattern}[,\\s-]+${inlineDayPattern}`, 'i'),
      new RegExp(`${inlineDowPattern}[,\\s-]+${inlineDayPattern}[,\\s-]+${inlineMonthPattern}`, 'i'),
      new RegExp(`${inlineMonthPattern}[,\\s-]*${inlineDayPattern}(?:[,\\s-]+${inlineDowPattern})?`, 'i'),
      new RegExp(`${inlineDayPattern}[,\\s-]+${inlineMonthPattern}(?:[,\\s-]+${inlineDowPattern})?`, 'i')
    ];

    const extractDateFragment = (value) => {
      if(!value) return '';
      for(const rx of dateFragmentPatterns){
        const match = value.match(rx);
        if(match && match[0]){
          return match[0];
        }
      }
      return '';
    };

    const tryMergeWithFollowing = (startIndex, parseFn, options) => {
      let combined = normalizeCombined(expanded[startIndex]);
      const consumedOffsets = [];
      let appendedDate = false;
      const maxLook = options && Number.isFinite(options.maxLook) ? options.maxLook : 8;
      for(let look = 1; look <= maxLook; look++){
        const idx = startIndex + look;
        if(idx >= expanded.length) break;
        if(consumed.has(idx)) continue;
        const candidate = expanded[idx];
        if(!candidate) continue;
        const normalizedCandidate = candidate.replace(/\s+/g,' ').trim();
        if(!normalizedCandidate) continue;
        if(isDateToken(normalizedCandidate)){
          combined = normalizeCombined(`${combined} ${normalizedCandidate}`);
          consumedOffsets.push(idx);
          appendedDate = true;
          if(parseFn(combined)){
            return { merged: combined, consumed: consumedOffsets };
          }
          continue;
        }
        if(options && Array.isArray(options.skipPatterns) && options.skipPatterns.some(rx => rx.test(normalizedCandidate))){
          continue;
        }
        const extracted = extractDateFragment(normalizedCandidate);
        if(extracted){
          combined = normalizeCombined(`${combined} ${extracted}`);
          appendedDate = true;
          if(parseFn(combined)){
            return { merged: combined, consumed: consumedOffsets };
          }
          continue;
        }
      }
      if(options && options.requireDate && !appendedDate){
        return null;
      }
      return null;
    };

    for (let i = 0; i < expanded.length; i++) {
      if(consumed.has(i)) continue;
      const line = expanded[i];
      if(!line) continue;
      const trimmed = line.replace(/\s+/g, ' ').trim();
      if(!trimmed) continue;

      if(headerPrefix.test(trimmed)){
        const parsed = parseHeaderDate(trimmed);
        if(parsed){
          normalized.push(trimmed);
          continue;
        }
        const merged = tryMergeWithFollowing(i, parseHeaderDate, { skipPatterns: skipBetweenDate, maxLook: 10, requireDate: true });
        if(merged){
          merged.consumed.forEach(idx => consumed.add(idx));
          normalized.push(merged.merged);
          continue;
        }
      }

      if(departsPrefix.test(trimmed)){
        const parsedDep = parseDepartsDate(trimmed);
        if(parsedDep){
          normalized.push(trimmed);
          continue;
        }
        const mergedDep = tryMergeWithFollowing(i, parseDepartsDate, { skipPatterns: skipBetweenDate, maxLook: 6, requireDate: true });
        if(mergedDep){
          mergedDep.consumed.forEach(idx => consumed.add(idx));
          normalized.push(mergedDep.merged);
          continue;
        }
      }

      if(arrivesPrefix.test(trimmed)){
        const parsedArr = parseArrivesDate(trimmed);
        if(parsedArr){
          normalized.push(trimmed);
          continue;
        }
        const mergedArr = tryMergeWithFollowing(i, parseArrivesDate, { skipPatterns: skipBetweenDate, maxLook: 6, requireDate: true });
        if(mergedArr){
          mergedArr.consumed.forEach(idx => consumed.add(idx));
          normalized.push(mergedArr.merged);
          continue;
        }
      }

      normalized.push(trimmed);
    }

    return normalized;
  }

  function parseSectionsWithSegments(rawText){
    const lines = sanitize(rawText);
    const deriveFromSegments = () => {
      const allSegments = collectSegments(lines, null);
      if(allSegments.length === 0) return [];
      const firstSeg = allSegments[0];
      const homeAirport = firstSeg ? (firstSeg.routeOrigin || firstSeg.depAirport) : null;
      const outbound = [];
      const inbound = [];
      let inboundSeen = false;
      for(const seg of allSegments){
        if(!inboundSeen && homeAirport && seg.routeDest === homeAirport){
          inboundSeen = true;
        }
        if(seg.direction === 'inbound' || inboundSeen){
          inbound.push(seg);
        } else {
          outbound.push(seg);
        }
      }
      const headerFromSeg = (seg) => (seg && seg.headerRef) ? { ...seg.headerRef } : null;
      const derived = [];
      if(outbound.length){
        derived.push({ headerDate: headerFromSeg(outbound[0]), kind:'outbound', segments: outbound });
      }
      if(inbound.length){
        derived.push({ headerDate: headerFromSeg(inbound[0]), kind:'inbound', segments: inbound });
      }
      if(derived.length === 0){
        derived.push({ headerDate: headerFromSeg(firstSeg), kind:'outbound', segments: allSegments });
      }
      return derived;
    };

    const sections = splitIntoSections(lines);
    if(sections.length === 0){
      return deriveFromSegments();
    }
    const mapped = sections.map(sec => ({
      headerDate: sec.headerDate,
      kind: sec.kind,
      segments: collectSegments(sec.lines, sec.headerDate)
    }));
    const nonEmpty = mapped.filter(sec => sec.segments && sec.segments.length);
    if(nonEmpty.length > 0){
      return nonEmpty;
    }
    return deriveFromSegments();
  }

  function filterSectionsByDirection(sections, desired){
    if(desired === 'all') return sections;
    return sections.filter(sec => desired === 'inbound' ? sec.kind === 'inbound' : sec.kind !== 'inbound');
  }

  function normalizeDirectionKind(value){
    if(!value && value !== 0) return '';
    const text = String(value).trim().toLowerCase();
    if(text.startsWith('in')) return 'inbound';
    if(text.startsWith('out')) return 'outbound';
    return text || '';
  }

  function clampIndex(value, min, max){
    if(!Number.isFinite(value)) return min;
    if(max < min) return min;
    return Math.max(min, Math.min(value, max));
  }

  function buildDirectionDescriptor(segments, startIdx, endIdx, index, kindHint){
    if(!Array.isArray(segments) || segments.length === 0){
      return null;
    }
    const total = segments.length;
    const safeStart = clampIndex(startIdx, 0, total - 1);
    const safeEnd = clampIndex(endIdx, safeStart, total - 1);
    const slice = [];
    for(let i = safeStart; i <= safeEnd; i++){
      const seg = segments[i];
      if(seg) slice.push({ seg, absoluteIndex: i });
    }
    if(slice.length === 0){
      return null;
    }
    let origin = '';
    let destination = '';
    let dateToken = '';
    const carriers = new Set();
    const connections = [];
    let resolvedKind = normalizeDirectionKind(kindHint);
    let prevArr = null;
    let lastConnection = null;
    for(let idx = 0; idx < slice.length; idx++){
      const seg = slice[idx].seg;
      if(!seg) continue;
      if(!origin && seg.depAirport){
        origin = seg.depAirport;
      }
      if(seg.arrAirport){
        destination = seg.arrAirport;
      }
      if(!dateToken && seg.depDate){
        dateToken = seg.depDate;
      }
      const carrier = (seg.marketingCarrier || seg.airlineCode || '').trim().toUpperCase();
      if(carrier){
        carriers.add(carrier);
      }
      if(idx > 0){
        const connection = seg.depAirport || prevArr;
        if(connection && connection !== origin && connection !== destination && connection !== lastConnection){
          connections.push(connection);
          lastConnection = connection;
        }
      }
      prevArr = seg.arrAirport || prevArr;
      if(!resolvedKind){
        resolvedKind = normalizeDirectionKind(seg.direction);
      }
    }
    const firstIdx = slice[0].absoluteIndex;
    const lastIdx = slice[slice.length - 1].absoluteIndex;
    return {
      index: Number.isFinite(index) ? index : 0,
      od: [origin || '', destination || ''],
      date: dateToken || '',
      carriers,
      connections,
      kind: resolvedKind || '',
      range: [firstIdx, lastIdx]
    };
  }

  function computeDirectionsFromSegments(segments, options){
    const opts = options && typeof options === 'object' ? options : {};
    const allSegments = Array.isArray(segments) ? segments : [];
    const journeys = Array.isArray(opts.journeys) ? opts.journeys.slice() : [];
    const directions = [];

    const pushRange = (start, end, kindHint) => {
      const descriptor = buildDirectionDescriptor(allSegments, start, end, directions.length, kindHint);
      if(descriptor){
        descriptor.index = directions.length;
        directions.push(descriptor);
      }
    };

    if(journeys.length && allSegments.length){
      journeys.sort((a, b) => {
        const aStart = Number.isFinite(a?.startIdx) ? a.startIdx : 0;
        const bStart = Number.isFinite(b?.startIdx) ? b.startIdx : 0;
        if(aStart !== bStart) return aStart - bStart;
        const aEnd = Number.isFinite(a?.endIdx) ? a.endIdx : aStart;
        const bEnd = Number.isFinite(b?.endIdx) ? b.endIdx : bStart;
        return aEnd - bEnd;
      });
      for(const journey of journeys){
        if(!journey) continue;
        const start = clampIndex(journey.startIdx, 0, allSegments.length - 1);
        const end = clampIndex(journey.endIdx, start, allSegments.length - 1);
        pushRange(start, end, journey.sectionKind || journey.kind || null);
      }
      if(directions.length){
        return directions;
      }
    }

    let currentStart = null;
    let currentEnd = null;
    let currentKind = '';
    for(let idx = 0; idx < allSegments.length; idx++){
      const seg = allSegments[idx];
      if(!seg){
        continue;
      }
      const segKind = normalizeDirectionKind(seg.direction);
      if(currentStart == null){
        currentStart = idx;
        currentEnd = idx;
        currentKind = segKind || '';
        continue;
      }
      if(segKind && currentKind && segKind !== currentKind){
        pushRange(currentStart, currentEnd, currentKind);
        currentStart = idx;
        currentEnd = idx;
        currentKind = segKind;
        continue;
      }
      currentEnd = idx;
      if(!currentKind && segKind){
        currentKind = segKind;
      }
    }

    if(currentStart != null){
      pushRange(currentStart, currentEnd != null ? currentEnd : currentStart, currentKind);
    }

    if(directions.length){
      return directions;
    }

    if(allSegments.length){
      const descriptor = buildDirectionDescriptor(allSegments, 0, allSegments.length - 1, 0, null);
      return descriptor ? [descriptor] : [];
    }

    return [];
  }

  function toAirportCode(value){
    if(!value && value !== 0) return '';
    return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeDirectionRange(range, total){
    if(!Array.isArray(range) || range.length !== 2 || !Number.isFinite(total) || total <= 0){
      return null;
    }
    const start = clampIndex(parseInt(range[0], 10), 0, total - 1);
    const end = clampIndex(parseInt(range[1], 10), start, total - 1);
    return [start, end];
  }

  function gdsTimeToMinutes(value){
    if(!value && value !== 0) return null;
    const trimmed = String(value).trim().toUpperCase();
    const match = trimmed.match(/^(\d{2})(\d{2})([AP])$/);
    if(!match) return null;
    let hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    if(!Number.isFinite(hours) || !Number.isFinite(mins) || mins < 0 || mins > 59) return null;
    const suffix = match[3];
    if(suffix === 'P' && hours < 12){
      hours += 12;
    }else if(suffix === 'A' && hours === 12){
      hours = 0;
    }
    return hours * 60 + mins;
  }

  function formatAvailabilityTimeToken(value){
    if(!value && value !== 0) return '';
    const trimmed = String(value).trim();
    if(!trimmed) return '';
    if(/^[0-9]{4}[AP]$/i.test(trimmed)){
      return trimmed.replace(/^0(?=\d)/, '');
    }
    return trimmed;
  }

  function collectDirectionConnections(direction, segments){
    const seen = new Set();
    const connections = [];
    const origin = toAirportCode(direction && direction.od && direction.od[0]);
    const destination = toAirportCode(direction && direction.od && direction.od[1]);
    const raw = [];
    if(direction){
      if(Array.isArray(direction.connections)){
        raw.push(...direction.connections);
      }else if(direction.connections && typeof direction.connections.forEach === 'function'){
        direction.connections.forEach((value) => raw.push(value));
      }
    }
    const total = Array.isArray(segments) ? segments.length : 0;
    const range = normalizeDirectionRange(direction && direction.range, total);
    if(!raw.length && range){
      const [start, end] = range;
      for(let idx = start + 1; idx <= end; idx++){
        const seg = segments[idx];
        if(seg && seg.depAirport){
          raw.push(seg.depAirport);
        }
      }
    }
    raw.forEach((code) => {
      const airport = toAirportCode(code);
      if(!airport || airport === origin || airport === destination) return;
      if(seen.has(airport)) return;
      seen.add(airport);
      connections.push(airport);
    });
    return connections;
  }

  function computeAvailabilityConnectionDetails(direction, segments){
    const total = Array.isArray(segments) ? segments.length : 0;
    if(!direction || !total){
      return { departureTimeToken:'', connections: [] };
    }
    const range = normalizeDirectionRange(direction.range, total) || [0, total - 1];
    const [start, end] = range;
    if(end <= start){
      return { departureTimeToken:'', connections: [] };
    }
    const subSegments = segments.slice(start, end + 1);
    const departureOrdinals = [];
    let ordinalCursor = null;
    for(let idx = 0; idx < subSegments.length; idx++){
      ordinalCursor = approximateSegmentOrdinal(subSegments[idx], ordinalCursor);
      departureOrdinals.push(ordinalCursor);
    }
    const departureMinutes = subSegments.map(seg => gdsTimeToMinutes(seg && seg.depGDS));
    const arrivalMinutes = subSegments.map(seg => gdsTimeToMinutes(seg && seg.arrGDS));
    const arrivalOrdinals = subSegments.map((seg, idx) => {
      let ordinal = departureOrdinals[idx];
      if(seg && seg.arrDate){
        const info = parseMonthDayFromString(seg.arrDate);
        if(info){
          ordinal = adjustOrdinal(info.month, info.day, departureOrdinals[idx]);
        }
      }
      if(!Number.isFinite(ordinal)){
        ordinal = departureOrdinals[idx];
      }
      if((!seg || !seg.arrDate) && Number.isFinite(arrivalMinutes[idx]) && Number.isFinite(departureMinutes[idx]) && arrivalMinutes[idx] < departureMinutes[idx]){
        if(Number.isFinite(ordinal)){
          ordinal = ordinal + 1;
        }
      }
      return ordinal;
    });

    const firstSeg = subSegments[0] || null;
    const lastSeg = subSegments[subSegments.length - 1] || null;
    const origin = toAirportCode(firstSeg && firstSeg.depAirport);
    const destination = toAirportCode(lastSeg && lastSeg.arrAirport);
    const departureTimeToken = formatAvailabilityTimeToken(firstSeg ? firstSeg.depGDS : '');
    const seen = new Set();
    if(origin) seen.add(origin);
    if(destination) seen.add(destination);
    const connections = [];
    for(let idx = 1; idx < subSegments.length; idx++){
      const seg = subSegments[idx];
      const airport = toAirportCode(seg && seg.depAirport);
      if(!airport || airport === origin || airport === destination) continue;
      if(seen.has(airport)) continue;
      seen.add(airport);
      let layoverMinutes = null;
      const prevArrivalOrdinal = arrivalOrdinals[idx - 1];
      const prevArrivalMinutes = arrivalMinutes[idx - 1];
      const nextDepartureOrdinal = departureOrdinals[idx];
      const nextDepartureMinutes = departureMinutes[idx];
      if(
        Number.isFinite(prevArrivalOrdinal) &&
        Number.isFinite(prevArrivalMinutes) &&
        Number.isFinite(nextDepartureOrdinal) &&
        Number.isFinite(nextDepartureMinutes)
      ){
        const prevTotal = prevArrivalOrdinal * 1440 + prevArrivalMinutes;
        const nextTotal = nextDepartureOrdinal * 1440 + nextDepartureMinutes;
        const diff = nextTotal - prevTotal;
        if(Number.isFinite(diff) && diff >= 0){
          layoverMinutes = diff;
        }
      }
      connections.push({ airport, layoverMinutes });
    }

    return { departureTimeToken: connections.length ? departureTimeToken : '', connections };
  }

  function buildAvailabilityConnectionSuffix(direction, segments, options){
    const detailed = !!(options && options.detailed);
    if(detailed){
      try {
        const info = computeAvailabilityConnectionDetails(direction, segments);
        if(info && Array.isArray(info.connections) && info.connections.length){
          const parts = info.connections
            .map((entry) => {
              if(!entry || !entry.airport) return '';
              const airport = String(entry.airport).trim().toUpperCase();
              if(!airport) return '';
              const layover = Number.isFinite(entry.layoverMinutes)
                ? Math.max(0, Math.round(entry.layoverMinutes))
                : null;
              return layover != null ? `${airport}-${layover}` : airport;
            })
            .filter(Boolean);
          if(parts.length){
            const prefix = info.departureTimeToken ? String(info.departureTimeToken).trim() : '';
            return `${prefix}${parts.join('/')}`;
          }
        }
      } catch (err) {
        console.warn('Detailed availability suffix build failed:', err);
      }
    }
    const basic = collectDirectionConnections(direction, segments);
    if(basic.length){
      return `12A${basic.join('/')}`;
    }
    return '';
  }

  function collectCarriersForDirection(direction, segments){
    const carriers = [];
    const pushCarrier = (value) => {
      const code = (value || '').trim().toUpperCase();
      if(code){
        carriers.push(code);
      }
    };

    const totalSegments = Array.isArray(segments) ? segments.length : 0;

    if(direction && Array.isArray(direction.range) && direction.range.length === 2 && totalSegments){
      const [start, end] = direction.range;
      const safeStart = clampIndex(start, 0, totalSegments - 1);
      const safeEnd = clampIndex(end, safeStart, totalSegments - 1);
      for(let idx = safeStart; idx <= safeEnd; idx++){
        const seg = segments[idx];
        if(!seg) continue;
        pushCarrier(seg.marketingCarrier || seg.airlineCode);
      }
    }

    if(carriers.length === 0 && direction && direction.carriers instanceof Set && direction.carriers.size){
      direction.carriers.forEach(pushCarrier);
    }

    if(carriers.length === 0 && Array.isArray(segments)){
      for(const seg of segments){
        if(!seg) continue;
        pushCarrier(seg.marketingCarrier || seg.airlineCode);
      }
    }

    return carriers;
  }

  function buildAvailabilityCommandForDirection(direction, segments, options){
    if(!direction){
      throw new Error('Missing required data for availability search.');
    }
    const origin = direction.od && direction.od[0] ? direction.od[0] : '';
    const destination = direction.od && direction.od[1] ? direction.od[1] : '';
    if(!origin || !destination){
      throw new Error('Missing required data for availability search.');
    }
    const dateToken = (direction.date || '').trim().toUpperCase();
    if(!dateToken || dateToken.length < 5){
      throw new Error('Invalid departure date for availability search.');
    }
    const rawDay = dateToken.slice(0, 2);
    const month = dateToken.slice(2);
    const dayNumeric = parseInt(rawDay, 10);
    if(!Number.isFinite(dayNumeric) || dayNumeric <= 0 || !month){
      throw new Error('Invalid departure date for availability search.');
    }
    const dayPart = String(dayNumeric);

    let command = `1${dayPart}${month}${origin}${destination}`;

    const connectionSuffix = buildAvailabilityConnectionSuffix(direction, segments, options);
    if(connectionSuffix){
      command += connectionSuffix;
    }

    const carriers = collectCarriersForDirection(direction, segments || []);
    if(carriers.length){
      for(const carrier of carriers){
        command += `¥${carrier}`;
      }
    }

    return command;
  }

  function buildAvailabilityCommandFromSegments(segments, options){
    if(!segments || segments.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }
    const directions = computeDirectionsFromSegments(segments);
    if(!directions.length){
      throw new Error('Missing required data for availability search.');
    }
    const target = directions[0] || null;
    if(!target){
      throw new Error('Missing required data for availability search.');
    }
    return buildAvailabilityCommandForDirection(target, segments, options);
  }

  const MONTH_DAY_OFFSETS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const ORDINAL_YEAR_SPAN = 365;
  const JOURNEY_DATE_GAP_THRESHOLD = 1;

  function parseMonthDayFromString(value){
    if(!value) return null;
    const text = String(value).toUpperCase();
    const monthMatch = text.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
    if(!monthMatch) return null;
    const monthKey = monthMatch[1];
    if(!Object.prototype.hasOwnProperty.call(MONTHS, monthKey)) return null;
    const monthIndex = MONTHS[monthKey];
    let dayValue = null;
    if(monthMatch.index != null && monthMatch.index > 0){
      const before = text.slice(0, monthMatch.index);
      const beforeMatch = before.match(/(\d{1,2})\s*$/);
      if(beforeMatch){
        dayValue = parseInt(beforeMatch[1], 10);
      }
    }
    if(!Number.isFinite(dayValue)){
      const after = text.slice(monthMatch.index + 3);
      const afterMatch = after.match(/^\s*(\d{1,2})/);
      if(afterMatch){
        dayValue = parseInt(afterMatch[1], 10);
      }
    }
    if(!Number.isFinite(dayValue) || dayValue <= 0 || dayValue > 31){
      return null;
    }
    return { month: monthIndex, day: dayValue };
  }

  function adjustOrdinal(monthIndex, dayValue, prevOrdinal){
    if(monthIndex == null || !Number.isFinite(dayValue)) return prevOrdinal;
    const monthOffset = MONTH_DAY_OFFSETS[monthIndex] != null ? MONTH_DAY_OFFSETS[monthIndex] : (monthIndex * 31);
    let ordinal = monthOffset + dayValue;
    if(prevOrdinal != null){
      while(ordinal < prevOrdinal){
        ordinal += ORDINAL_YEAR_SPAN;
      }
    }
    return ordinal;
  }

  function approximateSegmentOrdinal(seg, prevOrdinal){
    if(seg){
      if(seg.depDate){
        const depInfo = parseMonthDayFromString(seg.depDate);
        if(depInfo){
          return adjustOrdinal(depInfo.month, depInfo.day, prevOrdinal);
        }
      }
      if(seg.headerRef && seg.headerRef.day && seg.headerRef.mon){
        const dayVal = parseInt(seg.headerRef.day, 10);
        const monKey = String(seg.headerRef.mon || '').toUpperCase().slice(0, 3);
        if(Number.isFinite(dayVal) && Object.prototype.hasOwnProperty.call(MONTHS, monKey)){
          return adjustOrdinal(MONTHS[monKey], dayVal, prevOrdinal);
        }
      }
      if(seg.arrDate){
        const arrInfo = parseMonthDayFromString(seg.arrDate);
        if(arrInfo){
          return adjustOrdinal(arrInfo.month, arrInfo.day, prevOrdinal);
        }
      }
    }
    return prevOrdinal;
  }

  function deriveJourneysByDateGaps(segments){
    if(!Array.isArray(segments) || segments.length === 0) return [];
    const ranges = [];
    let groupStart = 0;
    let lastOrdinal = null;

    for(let idx = 0; idx < segments.length; idx++){
      const seg = segments[idx];
      const ordinal = approximateSegmentOrdinal(seg, lastOrdinal);
      if(lastOrdinal != null && ordinal != null && (ordinal - lastOrdinal) > JOURNEY_DATE_GAP_THRESHOLD){
        const prevEnd = idx - 1;
        if(prevEnd >= groupStart){
          ranges.push({ startIdx: groupStart, endIdx: prevEnd });
        }
        groupStart = idx;
      }
      if(ordinal != null){
        lastOrdinal = ordinal;
      }
    }

    if(groupStart < segments.length){
      ranges.push({ startIdx: groupStart, endIdx: segments.length - 1 });
    }

    return ranges
      .filter(range => range.startIdx <= range.endIdx)
      .map((range, idx) => {
        const firstSeg = segments[range.startIdx] || null;
        const lastSeg = segments[range.endIdx] || null;
        let headerDate = null;
        if(firstSeg && firstSeg.headerRef){
          headerDate = { ...firstSeg.headerRef };
        }else if(lastSeg && lastSeg.headerRef){
          headerDate = { ...lastSeg.headerRef };
        }
        return {
          startIdx: range.startIdx,
          endIdx: range.endIdx,
          origin: firstSeg ? firstSeg.depAirport : null,
          dest: lastSeg ? lastSeg.arrAirport : null,
          explicit: false,
          indexHint: idx + 1,
          headerDate
        };
      });
  }

  function normalizeJourneyForMerge(journey, segments){
    if(!journey || !Array.isArray(segments) || segments.length === 0) return null;
    const total = segments.length;
    const safeStart = Number.isFinite(journey.startIdx) ? Math.max(0, Math.min(journey.startIdx, total - 1)) : 0;
    const safeEndRaw = Number.isFinite(journey.endIdx) ? journey.endIdx : safeStart;
    const safeEnd = Math.max(safeStart, Math.min(safeEndRaw, total - 1));
    const firstSeg = segments[safeStart] || null;
    const lastSeg = segments[safeEnd] || null;
    const headerDate = journey.headerDate
      ? { ...journey.headerDate }
      : (firstSeg && firstSeg.headerRef ? { ...firstSeg.headerRef } : null);
    return {
      startIdx: safeStart,
      endIdx: safeEnd,
      origin: journey.origin || (firstSeg ? firstSeg.depAirport : null),
      dest: journey.dest || (lastSeg ? lastSeg.arrAirport : null),
      explicit: !!journey.explicit,
      headerDate,
      sectionKind: journey.sectionKind || null
    };
  }

  function mergeJourneysByDateProximity(segments, journeys, ordinals){
    if(!Array.isArray(journeys) || journeys.length === 0 || !Array.isArray(segments) || segments.length === 0){
      return [];
    }
    const normalized = journeys
      .map(j => normalizeJourneyForMerge(j, segments))
      .filter(Boolean)
      .sort((a, b) => {
        if(a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
        return a.endIdx - b.endIdx;
      });
    if(normalized.length === 0) return [];

    const merged = [];
    const safeOrdinals = Array.isArray(ordinals) ? ordinals : [];

    for(const entry of normalized){
      if(!entry) continue;
      if(merged.length === 0){
        merged.push({ ...entry });
        continue;
      }
      const prev = merged[merged.length - 1];
      const prevOrdinal = (prev.endIdx != null && prev.endIdx < safeOrdinals.length)
        ? safeOrdinals[prev.endIdx]
        : null;
      const nextOrdinal = (entry.startIdx != null && entry.startIdx < safeOrdinals.length)
        ? safeOrdinals[entry.startIdx]
        : prevOrdinal;
      let gap = 0;
      if(prevOrdinal != null && nextOrdinal != null){
        gap = nextOrdinal - prevOrdinal;
        if(gap >= ORDINAL_YEAR_SPAN){
          const normalizedGap = gap % ORDINAL_YEAR_SPAN;
          if(normalizedGap <= JOURNEY_DATE_GAP_THRESHOLD){
            gap = normalizedGap;
          }
        }
      }
      if(gap <= JOURNEY_DATE_GAP_THRESHOLD){
        if(entry.endIdx > prev.endIdx){
          prev.endIdx = entry.endIdx;
          prev.dest = segments[prev.endIdx] ? segments[prev.endIdx].arrAirport : prev.dest;
        }
        prev.explicit = prev.explicit && entry.explicit;
        if(!prev.headerDate && entry.headerDate){
          prev.headerDate = { ...entry.headerDate };
        }
        if(!prev.origin && entry.origin){
          prev.origin = entry.origin;
        }
        continue;
      }
      merged.push({ ...entry });
    }

    for(let idx = 0; idx < merged.length; idx++){
      merged[idx].indexHint = idx + 1;
      const segStart = merged[idx].startIdx;
      const segEnd = merged[idx].endIdx;
      const firstSeg = segments[segStart] || null;
      const lastSeg = segments[segEnd] || null;
      if(firstSeg && !merged[idx].origin){
        merged[idx].origin = firstSeg.depAirport || merged[idx].origin;
      }
      if(lastSeg && !merged[idx].dest){
        merged[idx].dest = lastSeg.arrAirport || merged[idx].dest;
      }
    }

    return merged;
  }

  function buildJourneySlice(base, startIdx, endIdx, segments){
    if(!Array.isArray(segments) || segments.length === 0){
      return null;
    }
    const total = segments.length;
    const safeStart = Math.max(0, Math.min(Number.isFinite(startIdx) ? startIdx : 0, total - 1));
    const safeEnd = Math.max(safeStart, Math.min(Number.isFinite(endIdx) ? endIdx : safeStart, total - 1));
    const firstSeg = segments[safeStart] || null;
    const lastSeg = segments[safeEnd] || null;
    const headerDate = base && base.headerDate
      ? { ...base.headerDate }
      : (firstSeg && firstSeg.headerRef ? { ...firstSeg.headerRef } : null);
    return {
      startIdx: safeStart,
      endIdx: safeEnd,
      origin: firstSeg ? (firstSeg.depAirport || (base ? base.origin : null)) : (base ? base.origin : null),
      dest: lastSeg ? (lastSeg.arrAirport || (base ? base.dest : null)) : (base ? base.dest : null),
      explicit: base ? !!base.explicit : false,
      headerDate,
      sectionKind: base && base.sectionKind ? base.sectionKind : null
    };
  }

  function splitJourneysByContinuity(journeys, segments){
    if(!Array.isArray(journeys) || journeys.length === 0 || !Array.isArray(segments) || segments.length === 0){
      return [];
    }
    const result = [];
    for(const journey of journeys){
      if(!journey) continue;
      const start = Number.isFinite(journey.startIdx) ? journey.startIdx : 0;
      const end = Number.isFinite(journey.endIdx) ? journey.endIdx : start;
      if(end < start){
        continue;
      }
      let blockStart = start;
      for(let idx = start + 1; idx <= end; idx++){
        const prevSeg = segments[idx - 1];
        const nextSeg = segments[idx];
        const contiguous = prevSeg && nextSeg && prevSeg.arrAirport && nextSeg.depAirport && prevSeg.arrAirport === nextSeg.depAirport;
        if(!contiguous){
          const slice = buildJourneySlice(journey, blockStart, idx - 1, segments);
          if(slice) result.push(slice);
          blockStart = idx;
        }
      }
      const finalSlice = buildJourneySlice(journey, blockStart, end, segments);
      if(finalSlice) result.push(finalSlice);
    }
    return result;
  }

  window.peekSegments = function(rawText){
    const lines = sanitize(rawText || '');
    const sections = splitIntoSections(lines);
    const allSegments = [];
    const journeys = [];
    let offset = 0;

    const appendSection = (sectionLines, headerDate, sectionKind) => {
      const collector = {};
      collectSegments(sectionLines, headerDate, collector);
      const segs = collector.segments || [];
      const localJourneys = collector.journeys || [];
      segs.forEach(seg => allSegments.push(seg));
      localJourneys.forEach(j => {
        const localStart = typeof j.startIdx === 'number' ? j.startIdx : 0;
        const localEnd = typeof j.endIdx === 'number' ? j.endIdx : (segs.length ? segs.length - 1 : 0);
        const startIdx = localStart + offset;
        const endIdx = localEnd + offset;
        const firstSeg = segs[localStart] || null;
        const lastSeg = segs[localEnd] || null;
        journeys.push({
          startIdx,
          endIdx,
          origin: j.origin || (firstSeg ? firstSeg.depAirport : null),
          dest: j.dest || (lastSeg ? lastSeg.arrAirport : null),
          explicit: !!j.explicit,
          indexHint: typeof j.indexHint === 'number' && Number.isFinite(j.indexHint) ? j.indexHint : null,
          headerDate: j.headerDate || null,
          sectionKind: sectionKind || null
        });
      });
      offset += segs.length;
    };

    if(sections.length === 0){
      appendSection(lines, null, null);
    }else{
      sections.forEach(sec => appendSection(sec.lines, sec.headerDate, sec.kind));
    }

    const segmentOrdinals = [];
    let ordinalCursor = null;
    for(let idx = 0; idx < allSegments.length; idx++){
      ordinalCursor = approximateSegmentOrdinal(allSegments[idx], ordinalCursor);
      segmentOrdinals[idx] = ordinalCursor;
    }

    const hasExplicitJourneys = journeys.some(j => j.explicit);
    if(allSegments.length > 1 && (!hasExplicitJourneys || journeys.length <= 1)){
      const derived = deriveJourneysByDateGaps(allSegments);
      if(derived.length > 1){
        journeys.length = 0;
        derived.forEach(j => journeys.push(j));
      }
    }

    if(allSegments.length > 1){
      const merged = mergeJourneysByDateProximity(allSegments, journeys, segmentOrdinals);
      if(merged.length){
        journeys.length = 0;
        merged.forEach(j => journeys.push(j));
      }
    }

    if(journeys.length > 0){
      const continuitySplit = splitJourneysByContinuity(journeys, allSegments);
      if(continuitySplit.length){
        journeys.length = 0;
        continuitySplit.forEach((entry, idx) => {
          if(entry){
            entry.indexHint = idx + 1;
            journeys.push(entry);
          }
        });
      }
    }

    const explicitJourneyCount = journeys.filter(j => j.explicit).length;
    let isMultiCity = explicitJourneyCount > 1;
    if(!isMultiCity){
      if(journeys.length > 2){
        isMultiCity = true;
      }else if(journeys.length === 2){
        const first = journeys[0];
        const second = journeys[1];
        if(first && second){
          const hasOutAndBack = first.origin && second.dest && first.origin === second.dest && first.dest && second.origin && first.dest === second.origin;
          if(!hasOutAndBack){
            isMultiCity = true;
          }
        }
      }
    }

    return { segments: allSegments, journeys, isMultiCity };
  };

  window.computeDirectionsFromSegments = function(segments, options){
    return computeDirectionsFromSegments(segments, options);
  };

  // Public API
  window.convertTextToI = function(rawText, options){
    const opts = Object.assign({ bookingClass:'J', segmentStatus:'SS1', direction:'all' }, options||{});
    const sections = parseSectionsWithSegments(rawText);
    const desired = (opts.direction || 'all').toLowerCase();
    const filteredSections = filterSectionsByDirection(sections, desired);

    if(desired !== 'all' && filteredSections.length === 0){
      throw new Error(desired === 'inbound' ? 'No inbound segments found.' : 'No outbound segments found.');
    }

    let effectiveRange = null;
    if(typeof opts.journeyIndex === 'number' && opts.journeyIndex >= 0){
      try {
        const preview = window.peekSegments ? window.peekSegments(rawText) : null;
        if(preview && Array.isArray(preview.journeys) && preview.journeys[opts.journeyIndex]){
          const journey = preview.journeys[opts.journeyIndex];
          if(journey && typeof journey.startIdx === 'number' && typeof journey.endIdx === 'number'){
            effectiveRange = [journey.startIdx, journey.endIdx];
          }
        }
      } catch (err) {
        console.warn('peekSegments failed during conversion:', err);
      }
    }
    if(!effectiveRange && Array.isArray(opts.segmentRange) && opts.segmentRange.length === 2){
      effectiveRange = opts.segmentRange.slice(0, 2);
    }

    const outLines = [];
    if(effectiveRange){
      const flattened = [];
      for(const sec of filteredSections){
        if(!sec || !Array.isArray(sec.segments)) continue;
        flattened.push(...sec.segments);
      }
      if(flattened.length === 0){
        throw new Error('No segments parsed from itinerary.');
      }
      const start = Math.max(0, parseInt(effectiveRange[0], 10));
      const endRaw = parseInt(effectiveRange[1], 10);
      const end = Math.min(flattened.length - 1, Number.isFinite(endRaw) ? endRaw : start);
      if(!Number.isFinite(start) || !Number.isFinite(end) || end < start){
        throw new Error('No segments parsed from itinerary.');
      }
      const selected = flattened.slice(start, end + 1);
      if(selected.length === 0){
        throw new Error('No segments parsed from itinerary.');
      }
      const segLines = formatSegmentsToILines(selected, opts);
      outLines.push(...segLines);
    }else{
      for(const sec of filteredSections){
        if(!sec || !Array.isArray(sec.segments) || sec.segments.length === 0) continue;
        const segLines = formatSegmentsToILines(sec.segments, opts);
        if(segLines.length){
          outLines.push(...segLines);
        }
      }
    }
    if(outLines.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }

    let n = 1;
    const numbered = outLines.map(l => l.replace(/^\s*\d+/, String(n++).padStart(2, ' ')));
    return numbered.join('\n');
  };

  window.convertTextToAvailability = function(rawText, options){
    const opts = Object.assign({ direction:'outbound' }, options||{});
    const sections = parseSectionsWithSegments(rawText);
    if(sections.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }
    const desired = (opts.direction || 'outbound').toLowerCase();
    let filteredSections = sections;
    if(desired !== 'all'){
      filteredSections = filterSectionsByDirection(sections, desired);
      if(filteredSections.length === 0){
        throw new Error(desired === 'inbound' ? 'No inbound segments found.' : 'No outbound segments found.');
      }
    }
    const segments = [];
    for(const sec of filteredSections){
      if(!sec || !Array.isArray(sec.segments)) continue;
      segments.push(...sec.segments);
    }
    if(segments.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }

    let effectiveRange = null;
    if(typeof opts.journeyIndex === 'number' && opts.journeyIndex >= 0){
      try {
        const preview = window.peekSegments ? window.peekSegments(rawText) : null;
        if(preview && Array.isArray(preview.journeys) && preview.journeys[opts.journeyIndex]){
          const journey = preview.journeys[opts.journeyIndex];
          if(journey && typeof journey.startIdx === 'number' && typeof journey.endIdx === 'number'){
            effectiveRange = [journey.startIdx, journey.endIdx];
          }
        }
      } catch (err) {
        console.warn('peekSegments failed during availability conversion:', err);
      }
    }
    if(!effectiveRange && Array.isArray(opts.segmentRange) && opts.segmentRange.length === 2){
      effectiveRange = opts.segmentRange.slice(0, 2);
    }

    if(effectiveRange){
      const start = Math.max(0, parseInt(effectiveRange[0], 10));
      const endRaw = parseInt(effectiveRange[1], 10);
      const end = Math.min(segments.length - 1, Number.isFinite(endRaw) ? endRaw : start);
      if(!Number.isFinite(start) || !Number.isFinite(end) || end < start){
        throw new Error('No segments parsed from itinerary.');
      }
      const selected = segments.slice(start, end + 1);
      if(selected.length === 0){
        throw new Error('No segments parsed from itinerary.');
      }
      return buildAvailabilityCommandFromSegments(selected, opts);
    }

    return buildAvailabilityCommandFromSegments(segments, opts);
  };

  window.computeAvailabilityConnectionDetails = function(direction, segments){
    return computeAvailabilityConnectionDetails(direction, segments);
  };

  if(false){
    const sampleMultiCity = [
      'Flight 1 Tue, Nov 10',
      'Pegasus Airlines 746',
      '12:30 am',
      '(HKG)',
      '4:50 am',
      '(ICN)',
      'Pegasus Airlines 222',
      '9:00 am',
      '(ICN)',
      '9:15 am',
      '(JFK)',
      'Pegasus Airlines 485',
      '2:30 pm',
      '(JFK)',
      '4:15 pm',
      '(RDU)',
      'Flight 2 Fri, Dec 18',
      'Tarom 101',
      '1:20 pm',
      '(NRT)',
      '3:55 pm',
      '(ICN)',
      'Tarom 745',
      '7:35 pm',
      '(ICN)',
      '10:30 pm',
      '(HKG)',
      'Flight 3 Wed, Jan 22',
      'FlyOne 3475',
      '7:00 am',
      '(LAX)',
      '8:29 am',
      '(SFO)',
      'Flight 4 Thu, Mar 12',
      'Aegean Airlines 211',
      '11:30 pm',
      '(SFO)',
      '4:30 am',
      '(ICN)',
      'Aegean Airlines 102',
      '9:00 am',
      '(ICN)',
      '11:20 am',
      '(NRT)'
    ].join('\n');
    const preview = window.peekSegments(sampleMultiCity);
    console.log('Sample journeys', preview && preview.journeys ? preview.journeys.map(j => `${j.origin}-${j.dest}`) : []);
  }

  // Dead-stub helpers for later
  window.copyPnrText = function(){ /* keep for future */ };

})();
