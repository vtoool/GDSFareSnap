
/* converter.js — pure conversion to *I */
(function(){
  'use strict';

  // Expect global AIRLINE_CODES from airlines.js
  const MONTHS = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  const MONTH_3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const DOW_CODE = { SUN:'S', MON:'M', TUE:'T', WED:'W', THU:'Q', FRI:'F', SAT:'J' };

  function pad2(n){ return String(n).padStart(2,'0'); }
  function toAmPmMinutes(s){ // "12:20 pm" -> minutes from midnight and GDS "1220P"
    const m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if(!m) return { mins:null, gds:s };
    let hh = parseInt(m[1],10), mm = parseInt(m[2],10);
    const ap = m[3].toUpperCase();
    if(ap==='PM' && hh!==12) hh += 12;
    if(ap==='AM' && hh===12) hh = 0;
    const mins = hh*60+mm;
    const gds = `${pad2(((hh+11)%12)+1)}${pad2(mm)}${ap[0]}`; // 13:05 -> 105P style
    return { mins, gds };
  }

  function parseHeaderDate(line){
    // "Depart • Sat, Oct 4" -> {dow:'J', day:'04', mon:'OCT'}
    const m = line.match(/(Depart|Return)\s*(?:[•·-]\s*)?(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dow = DOW_CODE[m[2].toUpperCase().slice(0,3)];
    const mon = m[3].toUpperCase().slice(0,3);
    const day = pad2(m[4]);
    return { dow, mon, day };
  }

  function parseArrivesDate(line){
    // "Arrives Fri, Oct 24"
    const m = line.match(/Arrives\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*([A-Za-z]{3,})\s*(\d{1,2})/i);
    if(!m) return null;
    const dow = DOW_CODE[m[1].toUpperCase().slice(0,3)];
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
    const m = line.match(/^\s*([A-Za-z].*?)\s+(\d{1,4})\s*$/);
    if(!m) return null;
    const airlineName = m[1].trim().toUpperCase();
    const num = m[2];
    return { airlineName, num };
  }

  function convertSection(lines, headerDate, opts){
    // Build segments by scanning patterns: Airline [optional], "Airline NNNN", times and airports
    const segs = [];
    let i=0;
    while(i<lines.length){
      // Seek a flight number line
      let fnInfo=null, j=i;
      for(; j<lines.length; j++){
        const maybe = extractFlightNumberLine(lines[j]);
        if(maybe && AIRLINE_CODES[maybe.airlineName]){ fnInfo = maybe; break; }
      }
      if(!fnInfo){ break; }
      // After that, find two times and two airports in order (dep time, dep airport, arr time, arr airport)
      let depTime=null, depAirport=null, arrTime=null, arrAirport=null, arrivesDate=null;
      // Look backwards up to 3 lines for an immediate preceding airline name (not required)
      // Move past flight line
      let k = j+1;
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
        const airlineCode = AIRLINE_CODES[fnInfo.airlineName];
        segs.push({
          airlineCode,
          number: fnInfo.num,
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
        i = j+1;
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
      if(/^Depart(?:\s*[•·-])?\s+/i.test(lines[i]) || /^Return(?:\s*[•·-])?\s+/i.test(lines[i])) indices.push(i);
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
    return raw.split(/\r?\n/).map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean);
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
