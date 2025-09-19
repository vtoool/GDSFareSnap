
/* converter.js — pure conversion to *I */
(function(){
  'use strict';

  // Expect global AIRLINE_CODES from airlines.js
  const MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const MONTH_3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DOW_CODE = { SUN:'S', MON:'M', TUE:'T', WED:'W', THU:'Q', FRI:'F', SAT:'J' };

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

  function extractAirportCode(line){
    const m = line.match(/\(([A-Z]{3})\)/);
    return m ? m[1] : null;
  }

  function isAirlineLine(line){
    // We consider a line starting with airline name in AIRLINE_CODES
    const name = line.trim().toUpperCase();
    return !!AIRLINE_CODES[name];
  }

  function extractFlightNumberLine(line){
    // e.g., "United Airlines 949"
    const cleaned = line.replace(/[•·]/g, ' ').replace(/\s+/g,' ').trim();
    const m = cleaned.match(/^([A-Za-z].*?)\s+(\d{1,4})$/);
    if(!m) return null;
    const airlineName = m[1].trim().toUpperCase();
    const num = m[2];
    return { airlineName, num };
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

    const direct = extractFlightNumberLine(raw);
    if(direct && AIRLINE_CODES[direct.airlineName]){
      return {
        airlineCode: AIRLINE_CODES[direct.airlineName],
        number: direct.num,
        index: idx
      };
    }

    // Support airline name on one line and flight number on the next
    const nameOnly = raw.trim().toUpperCase();
    if(AIRLINE_CODES[nameOnly] && (idx + 1) < lines.length){
      const next = (lines[idx + 1] || '').trim();
      if(/^\d{1,4}$/.test(next)){
        return {
          airlineCode: AIRLINE_CODES[nameOnly],
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

  function convertSection(lines, headerDate, opts){
    // Build segments by scanning patterns: Airline [optional], "Airline NNNN", times and airports
    const segs = [];
    let i=0;
    while(i<lines.length){
      // Seek a flight number line
      let flightInfo=null, j=i;
      for(; j<lines.length; j++){
        const maybe = getFlightInfo(lines, j);
        if(maybe){ flightInfo = maybe; break; }
      }
      if(!flightInfo){ break; }
      // After that, find two times and two airports in order (dep time, dep airport, arr time, arr airport)
      let depTime=null, depAirport=null, arrTime=null, arrAirport=null, arrivesDate=null;
      // Move past flight line
      let k = flightInfo.index + 1;
      // Find dep time
      for(; k<lines.length; k++){
        const t = toAmPmMinutes(lines[k]);
        if(t.mins!=null){ depTime=t; k++; break; }
      }
      // Find dep airport (line with (XXX))
      for(; k<lines.length; k++){
        const code = extractAirportCode(lines[k]);
        if(code){ depAirport=code; k++; break; }
      }
      // Skip duration lines etc until next time
      for(; k<lines.length; k++){
        const t = toAmPmMinutes(lines[k]);
        if(t.mins!=null){ arrTime=t; k++; break; }
      }
      // Find arr airport
      for(; k<lines.length; k++){
        const code = extractAirportCode(lines[k]);
        if(code){ arrAirport=code; k++; break; }
      }
      // Optionally check following lines for "Arrives ..." date
      for(let z=k; z<Math.min(k+4, lines.length); z++){
        const ad = parseArrivesDate(lines[z]);
        if(ad){ arrivesDate = ad; break; }
        // If we see a new flight number line, stop
        if(extractFlightNumberLine(lines[z])) break;
      }

      if(depTime && depAirport && arrTime && arrAirport){
        const airlineCode = flightInfo.airlineCode;
        const flightNumber = flightInfo.number;
        segs.push({
          airlineCode,
          number: flightNumber,
          depDate: `${headerDate.day}${headerDate.mon}`,
          depDOW: headerDate.dow,
          depAirport,
          arrAirport,
          depGDS: depTime.gds,
          arrGDS: arrTime.gds,
          arrDate: arrivesDate ? `${arrivesDate.day}${arrivesDate.mon} ${arrivesDate.dow}` : ""
        });
        i = k; // continue scan after what we consumed
      }else{
        i = flightInfo.index + 1;
      }
    }

    // Format to *I lines
    const out = [];
    const connIndicator = (segs.length > 1) ? '*' : ' ';

    function formatFlightDesignator(airlineCode, number, bookingClass){
      const base = number.length < 4
        ? `${airlineCode} ${number}`
        : `${airlineCode}${number}`;
      return `${base}${bookingClass}`;
    }

    for(let idx = 0; idx < segs.length; idx++){
      const s = segs[idx];
      const segNumber = String(idx + 1).padStart(2, '0');
      const flightField = formatFlightDesignator(s.airlineCode, s.number, opts.bookingClass).padEnd(10, ' ');
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
      const headerDate = parseHeaderDate(lines[start]);
      sections.push({ headerDate, lines: lines.slice(start+1, end) });
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

  // Public API
  window.convertTextToI = function(rawText, options){
    const opts = Object.assign({ bookingClass:'J', segmentStatus:'SS1' }, options||{});
    const lines = sanitize(rawText);
    const sections = splitIntoSections(lines);
    const outLines = [];
    for(const sec of sections){
      if(!sec.headerDate) continue;
      const segLines = convertSection(sec.lines, sec.headerDate, opts);
      outLines.push(...segLines);
    }
    if(outLines.length===0){
      throw new Error("No segments parsed from itinerary.");
    }
    // Renumber across whole journey
    let n=1;
    const numbered = outLines.map(l => l.replace(/^\s*\d+/, String(n++).padStart(2,' ')));
    return numbered.join('\\n');
  };

  // Dead-stub helpers for later
  window.generateAvailabilityCommand = function(type){ /* keep for future */ };
  window.copyPnrText = function(){ /* keep for future */ };

})();
