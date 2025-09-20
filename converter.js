
/* converter.js — pure conversion to *I */
(function(){
  'use strict';

  // Expect global AIRLINE_CODES from airlines.js
  const MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const MONTH_3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DOW_CODE = { SUN:'S', MON:'M', TUE:'T', WED:'W', THU:'Q', FRI:'F', SAT:'J' };
  const UNKNOWN_AIRLINE_CODE = 'XX';

  function pad2(n){ return String(n).padStart(2,'0'); }
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
      const gds = `${pad2(((hh+11)%12)+1)}${pad2(mm)}${ap[0]}`; // 13:05 -> 105P style
      return { mins, gds };
    }

    m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if(m){
      let hh = parseInt(m[1],10), mm = parseInt(m[2],10);
      if(hh > 23 || mm > 59) return { mins:null, gds:s };
      const mins = hh*60 + mm;
      const isPm = hh >= 12;
      let disp = hh % 12;
      if(disp === 0) disp = 12;
      const gds = `${pad2(disp)}${pad2(mm)}${isPm ? 'P' : 'A'}`;
      return { mins, gds };
    }

    return { mins:null, gds:s };
  }

  function parseHeaderDate(line){
    // "Depart • Sat, Oct 4" -> {dow:'J', day:'04', mon:'OCT'}
    const cleaned = line.replace(/\(.*?\)/g, ' ').replace(/\s+/g,' ').trim();
    const m = cleaned.match(/(Depart(?:ure)?|Return|Outbound|Inbound)\s*(?:[•·-]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dowKey = m[2] ? m[2].toUpperCase().slice(0,3) : '';
    const dow = dowKey ? (DOW_CODE[dowKey] || '') : '';
    const mon = m[3].toUpperCase().slice(0,3);
    const day = pad2(m[4]);
    return { dow, mon, day };
  }

  function parseArrivesDate(line){
    // "Arrives Fri, Oct 24"
    const cleaned = line.replace(/\(.*?\)/g, ' ').replace(/\s*\+\s?\d+(?:\s*day(?:s)?)?/ig,' ').replace(/\s+/g,' ').trim();
    const m = cleaned.match(/Arrives\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dowKey = m[1] ? m[1].toUpperCase().slice(0,3) : '';
    const dow = dowKey ? (DOW_CODE[dowKey] || '') : '';
    const mon = m[2].toUpperCase().slice(0,3);
    const day = pad2(m[3]);
    return { dow, mon, day };
  }

  function parseDepartsDate(line){
    const cleaned = line.replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = cleaned.match(/Departs(?:\s+on)?\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dowKey = m[1] ? m[1].toUpperCase().slice(0,3) : '';
    const dow = dowKey ? (DOW_CODE[dowKey] || '') : '';
    const mon = m[2].toUpperCase().slice(0,3);
    const day = pad2(m[3]);
    return { dow, mon, day };
  }

  function parseInlineOnDate(line){
    const cleaned = line.replace(/\(.*?\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = cleaned.match(/\bon\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)?[,\s]*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dowKey = m[1] ? m[1].toUpperCase().slice(0,3) : '';
    const dow = dowKey ? (DOW_CODE[dowKey] || '') : '';
    const mon = m[2].toUpperCase().slice(0,3);
    const day = pad2(m[3]);
    return { dow, mon, day };
  }

  function extractAirportCode(line){
    const m = line.match(/\(([A-Z]{3})\)/);
    return m ? m[1] : null;
  }

  function parseRouteHeaderLine(line){
    const cleaned = (line || '').replace(/[•·]/g, ' ').replace(/\s+/g,' ').trim();
    if(!cleaned) return null;
    if(!/\bto\b/i.test(cleaned) || !/\bon\s+/i.test(cleaned)) return null;
    const codeRx = /\(([A-Z]{3})\)/g;
    const codes = [];
    let match;
    while((match = codeRx.exec(cleaned))){
      codes.push(match[1]);
      if(codes.length === 2) break;
    }
    if(codes.length < 2) return null;
    const headerDate = parseInlineOnDate(cleaned);
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
    const name = line.trim().toUpperCase();
    return !!AIRLINE_CODES[name];
  }

  function extractFlightNumberLine(line){
    // e.g., "United Airlines 949" or "Scandinavian Airlines 661 (operated by Cityjet)"
    const cleaned = (line || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g,' ')
      .trim();
    if(!cleaned) return null;
    if(isLikelyEquipmentLine(cleaned)) return null;
    const m = cleaned.match(/^([A-Za-z][A-Za-z\s'&.-]*?)\s+(\d{1,4})\b/);
    if(!m) return null;
    const airlineName = m[1].trim().toUpperCase();
    if(/\bOPERATED BY\b/.test(airlineName)) return null;
    const num = m[2];
    return { airlineName, num };
  }

  function looksLikeAirlineName(name){
    const normalized = (name || '')
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if(!normalized) return false;
    if(/\bOPERATED BY\b/.test(normalized)) return false;
    if(/\b(AIRBUS|BOEING|EMBRAER|BOMBARDIER|CANADAIR|DE HAVILLAND|MCDONNELL|DOUGLAS|LOCKHEED|SUKHOI|SUPERJET|FOKKER|TUP|ANTONOV|IL-\d+|SAAB|ATR|TURBOPROP|JETLINER|AIRCRAFT|E-?JET|CRJ|MAX|NEO)\b/.test(normalized)) return false;
    if(AIRLINE_CODES[normalized]) return true;
    if(/\bAIR\s/.test(normalized)) return true;
    return /\b(AIRLINES?|AIRWAYS|AVIATION|FLY|JET |JETBLUE|JET2|CONDOR|ICELANDAIR|TRANSAT|PORTER|VIRGIN|SKY|AERO|WING)\b/.test(normalized);
  }

  function determineAirlineCodeFromName(name){
    const normalized = (name || '').trim().toUpperCase();
    if(!normalized) return { code: UNKNOWN_AIRLINE_CODE, isKnown: false };
    if(AIRLINE_CODES[normalized]){
      return { code: AIRLINE_CODES[normalized], isKnown: true };
    }
    if(/^[A-Z0-9]{2,3}$/.test(normalized)){
      return { code: resolveAirlineCode(normalized, null), isKnown: false };
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
      const name = (lines[look] || '').trim().toUpperCase();
      if(name && AIRLINE_CODES[name]) return AIRLINE_CODES[name];
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
    const nameOnly = raw.trim().toUpperCase();
    if(looksLikeAirlineName(nameOnly) && (idx + 1) < lines.length){
      const next = (lines[idx + 1] || '').trim();
      if(/^\d{1,4}$/.test(next)){
        const info = determineAirlineCodeFromName(nameOnly);
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

  function collectSegments(lines, headerDate){
    const segs = [];
    let i = 0;
    let currentDate = headerDate ? { ...headerDate } : null;
    let lastRouteInfo = null;
    let homeAirport = null;
    let inboundActive = false;

    const applyDepartsOverride = (line) => {
      const depInfo = parseDepartsDate(line || '');
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

    while(i < lines.length){
      let flightInfo = null;
      let j = i;
      for(; j < lines.length; j++){
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

      const routeLookup = findRouteHeaderBefore(flightInfo.index);
      const routeInfo = routeLookup ? routeLookup.info : null;
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
        const prevDow = currentDate ? currentDate.dow : '';
        const nextDow = routeInfo.headerDate.dow || prevDow || '';
        currentDate = {
          day: routeInfo.headerDate.day,
          mon: routeInfo.headerDate.mon,
          dow: nextDow
        };
      }

      for(; k < lines.length; k++){
        if(applyDepartsOverride(lines[k])) continue;
        if(parseRouteHeaderLine(lines[k])) break;
        const t = toAmPmMinutes(lines[k]);
        if(t.mins != null){ depTime = t; k++; break; }
      }
      if(!routeInfo){
        for(; k < lines.length; k++){
          if(applyDepartsOverride(lines[k])) continue;
          if(parseRouteHeaderLine(lines[k])) break;
          const code = extractAirportCode(lines[k]);
          if(code){ depAirport = code; k++; break; }
        }
      }
      for(; k < lines.length; k++){
        if(applyDepartsOverride(lines[k])) continue;
        if(parseRouteHeaderLine(lines[k])) break;
        const t = toAmPmMinutes(lines[k]);
        if(t.mins != null){ arrTime = t; k++; break; }
      }
      if(!routeInfo){
        for(; k < lines.length; k++){
          if(applyDepartsOverride(lines[k])) continue;
          if(parseRouteHeaderLine(lines[k])) break;
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
          const bc = extractBookingClass(lines[look]);
          if(bc){ bookingClass = bc; break; }
        }
      }

      if(depTime && depAirport && arrTime && arrAirport){
        const airlineCode = flightInfo.airlineCode;
        const flightNumber = flightInfo.number;
        const depDateString = currentDate ? `${currentDate.day}${currentDate.mon}` : '';
        const depDow = currentDate ? currentDate.dow : '';
        const arrDateString = arrivesDate
          ? `${arrivesDate.day}${arrivesDate.mon}${arrivesDate.dow ? ` ${arrivesDate.dow}` : ''}`
          : "";
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
          headerRef: currentDate ? { ...currentDate } : null,
          bookingClass,
          arrDate: arrDateString,
          direction: inboundActive ? 'inbound' : 'outbound'
        });
        if(arrivesDate){
          const prevDow = currentDate ? currentDate.dow : '';
          const nextDow = arrivesDate.dow || prevDow || '';
          currentDate = {
            day: arrivesDate.day,
            mon: arrivesDate.mon,
            dow: nextDow
          };
        }
        i = k;
      }else{
        i = flightInfo.index + 1;
      }
    }

    return segs;
  }

  function formatSegmentsToILines(segs, opts){
    const out = [];
    if(segs.length === 0) return out;
    const connIndicator = (segs.length > 1) ? '*' : ' ';

    const formatFlightDesignator = (airlineCode, number, bookingClass) => {
      const base = number.length < 4
        ? `${airlineCode} ${number}`
        : `${airlineCode}${number}`;
      return `${base}${bookingClass}`;
    };

    for(let idx = 0; idx < segs.length; idx++){
      const s = segs[idx];
      const segNumber = String(idx + 1).padStart(2, '0');
      const bookingClass = (s.bookingClass || opts.bookingClass || '').toUpperCase();
      const flightField = formatFlightDesignator(s.airlineCode, s.number, bookingClass).padEnd(10, ' ');
      const dateField = `${s.depDate} ${s.depDOW}`.trim().padEnd(11, ' ');
      const cityField = `${s.depAirport}${s.arrAirport}${connIndicator}${opts.segmentStatus}`.padEnd(13, ' ');
      const depTime = String(s.depGDS || '').padStart(6, ' ');
      const arrTime = String(s.arrGDS || '').padStart(6, ' ');

      let line = `${segNumber} ${flightField}${dateField}${cityField}${depTime} ${arrTime}`.replace(/\s+$/, '');
      if (s.arrDate) line += ` ${s.arrDate}`;
      line += ` /DC${s.airlineCode} /E`;
      out.push(line);
    }

    return out;
  }

  function determineSectionKind(headerLine){
    const normalized = (headerLine || '').toLowerCase();
    if(/\b(return|inbound)\b/.test(normalized)) return 'inbound';
    return 'outbound';
  }

  function splitIntoSections(lines){
    // return [{headerDate, lines: [...]}, ...] for Depart and Return
    const indices = [];
    for(let i=0;i<lines.length;i++){
      if(/^(Depart(?:ure)?|Return|Outbound|Inbound)(?:\s*[•·-])?\s+/i.test(lines[i])) indices.push(i);
    }
    if(indices.length===0) return [];
    const sections = [];
    for(let s=0; s<indices.length; s++){
      const start = indices[s];
      const end = (s+1<indices.length) ? indices[s+1] : lines.length;
      const headerLine = lines[start];
      const headerDate = parseHeaderDate(headerLine);
      const kind = determineSectionKind(headerLine);
      sections.push({ headerDate, lines: lines.slice(start+1, end), kind });
    }
    return sections;
  }

  function sanitize(raw){
    const base = raw.split(/\r?\n/)
      .map(s => s.replace(/\s+/g,' ').trim())
      .filter(Boolean);
    const expanded = [];
    const timeRe = /(\d{1,2}:\d{2}\s*(?:[ap]m)?)/ig;

    for(const line of base){
      if(/^(Depart|Departure|Return|Outbound|Inbound)\b/i.test(line)){
        expanded.push(line);
        continue;
      }

      const bulletParts = line.split(/\s*[•·]\s*/).map(p => p.trim()).filter(Boolean);
      if(bulletParts.length > 1){
        expanded.push(...bulletParts);
        continue;
      }

      timeRe.lastIndex = 0;
      const timeMatches = [];
      let match;
      while((match = timeRe.exec(line))){
        timeMatches.push(match[0].trim());
      }
      if(timeMatches.length >= 1){
        expanded.push(...timeMatches);
        const leftover = line.replace(timeRe, ' ')
          .replace(/[-–—]/g,' ')
          .replace(/\s+/g,' ')
          .trim();
        if(leftover) expanded.push(leftover);
        continue;
      }

      expanded.push(line);
    }

    const normalized = [];
    const headerOnly = /^(Depart(?:ure)?|Return|Outbound|Inbound)$/i;

    for (let i = 0; i < expanded.length; i++) {
      const line = expanded[i];
      if (headerOnly.test(line)) {
        let combined = line;
        let consumed = 0;
        for (let look = 1; look <= 3 && (i + look) < expanded.length; look++) {
          combined += ' ' + expanded[i + look];
          if (parseHeaderDate(combined)) {
            normalized.push(combined);
            consumed = look;
            break;
          }
        }
        if (consumed) {
          i += consumed;
          continue;
        }
      }
      normalized.push(line);
    }

    return normalized;
  }

  function parseSectionsWithSegments(rawText){
    const lines = sanitize(rawText);
    const sections = splitIntoSections(lines);
    if(sections.length === 0){
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
    }
    return sections.map(sec => ({
      headerDate: sec.headerDate,
      kind: sec.kind,
      segments: collectSegments(sec.lines, sec.headerDate)
    }));
  }

  function filterSectionsByDirection(sections, desired){
    if(desired === 'all') return sections;
    return sections.filter(sec => desired === 'inbound' ? sec.kind === 'inbound' : sec.kind !== 'inbound');
  }

  function buildAvailabilityCommandFromSegments(segments){
    if(!segments || segments.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }
    const first = segments[0];
    const last = segments[segments.length - 1];
    if(!first || !last || !first.depDate || !first.depAirport || !last.arrAirport){
      throw new Error('Missing required data for availability search.');
    }

    const rawDay = first.depDate.slice(0, 2);
    const month = first.depDate.slice(2);
    const dayNumeric = parseInt(rawDay, 10);
    if(!Number.isFinite(dayNumeric) || dayNumeric <= 0 || !month){
      throw new Error('Invalid departure date for availability search.');
    }
    const dayPart = String(dayNumeric);

    let command = `1${dayPart}${month}${first.depAirport}${last.arrAirport}`;

    const transitAirports = segments.slice(0, -1).map(seg => seg.arrAirport).filter(Boolean);
    if(transitAirports.length){
      command += `12A${transitAirports.join('/')}`;
    }

    for(const seg of segments){
      const code = (seg.airlineCode || '').trim();
      if(!code) continue;
      command += `¥${code}`;
    }

    return command;
  }

  // Public API
  window.convertTextToI = function(rawText, options){
    const opts = Object.assign({ bookingClass:'J', segmentStatus:'SS1', direction:'all' }, options||{});
    const sections = parseSectionsWithSegments(rawText);
    const desired = (opts.direction || 'all').toLowerCase();
    const filteredSections = filterSectionsByDirection(sections, desired);

    if(desired !== 'all' && filteredSections.length === 0){
      throw new Error(desired === 'inbound' ? 'No inbound segments found.' : 'No outbound segments found.');
    }

    const outLines = [];
    for(const sec of filteredSections){
      if(!sec.headerDate || !sec.segments.length) continue;
      const segLines = formatSegmentsToILines(sec.segments, opts);
      outLines.push(...segLines);
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
    const filteredSections = filterSectionsByDirection(sections, desired);
    if(filteredSections.length === 0){
      throw new Error(desired === 'inbound' ? 'No inbound segments found.' : 'No outbound segments found.');
    }
    const segments = [];
    for(const sec of filteredSections){
      segments.push(...sec.segments);
    }
    if(segments.length === 0){
      throw new Error('No segments parsed from itinerary.');
    }
    return buildAvailabilityCommandFromSegments(segments);
  };

  // Dead-stub helpers for later
  window.copyPnrText = function(){ /* keep for future */ };

})();
