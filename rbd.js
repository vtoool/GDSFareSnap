(function(root){
  'use strict';

  const GENERIC_RBD_BY_CABIN = {
    FIRST: ['F', 'A', 'P'],
    BUSINESS: ['J', 'C', 'D', 'I', 'Z', 'R', 'U', 'P'],
    PREMIUM: ['W', 'P', 'U', 'E', 'A', 'R', 'O'],
    ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'N', 'O', 'T', 'U', 'E', 'G', 'X']
  };

  const RBD_BY_AIRLINE = {
    // North America
    AA: { FIRST: ['F', 'A'], BUSINESS: ['J', 'I', 'C', 'D', 'R'], PREMIUM: ['W', 'P'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'N', 'O', 'T', 'U', 'E', 'G', 'X'] },
    DL: { BUSINESS: ['J', 'C', 'D', 'I', 'Z'], PREMIUM: ['P', 'A', 'F', 'G'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'T', 'U', 'W', 'X', 'E', 'N'] },
    UA: { BUSINESS: ['J', 'C', 'D', 'Z', 'P', 'I'], PREMIUM: ['O', 'A', 'R'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'T', 'U', 'W', 'X', 'G', 'E', 'N'] },
    AC: { BUSINESS: ['J', 'C', 'D', 'Z', 'P'], PREMIUM: ['O', 'E', 'A'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'T', 'U', 'W'] },
    B6: { BUSINESS: ['J', 'C', 'D', 'I'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'K', 'L', 'V', 'S', 'N', 'O', 'G', 'E', 'X'] },

    // Europe (Star/oneworld/skyteam mix)
    LH: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'Z', 'P'], PREMIUM: ['E', 'G', 'N'], ECONOMY: ['Y', 'B', 'H', 'K', 'L', 'M', 'Q', 'S', 'T', 'U', 'V', 'W'] },
    BA: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'I', 'R'], PREMIUM: ['W', 'E', 'T'], ECONOMY: ['Y', 'B', 'H', 'K', 'L', 'M', 'N', 'S', 'V', 'Q', 'O', 'G'] },
    AF: { FIRST: ['F', 'P'], BUSINESS: ['J', 'C', 'D', 'I', 'Z'], PREMIUM: ['W', 'A', 'T'], ECONOMY: ['Y', 'B', 'M', 'H', 'K', 'Q', 'V', 'N', 'R', 'L', 'G', 'E'] },
    KL: { BUSINESS: ['J', 'C', 'D', 'I', 'Z'], PREMIUM: ['W', 'O', 'Z'], ECONOMY: ['Y', 'B', 'M', 'H', 'K', 'Q', 'L', 'T', 'E', 'U', 'N'] },
    TK: { BUSINESS: ['C', 'D', 'K', 'Z', 'J'], ECONOMY: ['Y', 'B', 'M', 'H', 'A', 'E', 'S', 'L', 'O', 'Q', 'T', 'V'] },
    SK: { BUSINESS: ['C', 'D', 'J', 'Z'] },
    LX: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'Z', 'P'], PREMIUM: ['N', 'E', 'G'], ECONOMY: ['Y', 'B', 'H', 'K', 'M', 'Q', 'S', 'T', 'U', 'V', 'W'] },
    SN: { BUSINESS: ['J', 'C', 'D', 'Z'], PREMIUM: ['G', 'E', 'N'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'V', 'U', 'W', 'S', 'T', 'L', 'K'] },
    LO: { BUSINESS: ['Z', 'D', 'C'], PREMIUM: ['P', 'A', 'R'], ECONOMY: ['Y', 'B', 'M', 'H', 'K', 'Q', 'T', 'V', 'L', 'S', 'O', 'U'] },
    IB: { BUSINESS: ['J', 'C', 'D', 'I'], PREMIUM: ['W', 'P'], ECONOMY: ['Y', 'B', 'H', 'K', 'M', 'L', 'V', 'S', 'N', 'O', 'Q'] },
    OS: { BUSINESS: ['J', 'C', 'D', 'Z'], PREMIUM: ['G', 'E', 'N'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'V', 'W', 'S', 'T', 'L', 'K', 'E'] },
    TP: { BUSINESS: ['C', 'D', 'Z', 'J', 'R'], ECONOMY: ['Y', 'B', 'M', 'H', 'Q', 'V', 'S', 'K', 'L', 'O', 'G', 'W', 'U'] },

    // Middle East / Asia-Pacific (selection)
    QR: { FIRST: ['P', 'F', 'A'], BUSINESS: ['J', 'C', 'D', 'I', 'R'], ECONOMY: ['Y', 'B', 'H', 'K', 'M', 'L', 'V', 'S', 'N', 'Q', 'T', 'O'] },
    EK: { FIRST: ['F', 'A', 'P'], BUSINESS: ['J', 'C', 'I', 'O'], PREMIUM: ['W', 'E'], ECONOMY: ['Y', 'B', 'M', 'U', 'K', 'Q', 'L', 'T', 'V', 'X', 'H'] },
    SQ: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'U', 'Z'], PREMIUM: ['S', 'T', 'P', 'R', 'L'], ECONOMY: ['Y', 'B', 'E', 'M', 'H', 'W', 'Q', 'N', 'V', 'K', 'G', 'O', 'X', 'I'] },
    NH: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'Z', 'P'], PREMIUM: ['G', 'E', 'N'], ECONOMY: ['Y', 'B', 'M', 'U', 'H', 'Q', 'V', 'W', 'S', 'L', 'T', 'K'] },
    JL: { FIRST: ['F', 'A'], BUSINESS: ['J', 'C', 'D', 'X', 'I'], PREMIUM: ['W', 'E'], ECONOMY: ['Y', 'B', 'H', 'K', 'M', 'L', 'V', 'S', 'O', 'Q', 'N'] }
  };

  const CABIN_FALLBACK = {
    FIRST: 'F',
    BUSINESS: 'J',
    PREMIUM: 'N',
    ECONOMY: 'Y'
  };

  function normalizeCabinEnum(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    const collapsed = upper.replace(/\s+/g, ' ');

    if (collapsed === 'FIRST' || collapsed === 'FIRST CLASS' || collapsed === 'F' || /\bFIRST\b/.test(collapsed)) {
      return 'FIRST';
    }
    if (
      collapsed === 'BUSINESS' ||
      collapsed === 'BUSINESS CLASS' ||
      collapsed === 'BIZ' ||
      collapsed === 'BUS' ||
      collapsed === 'J' ||
      collapsed === 'UPPER CLASS' ||
      collapsed === 'POLARIS' ||
      collapsed === 'MINT' ||
      /\bBUSINESS\b/.test(collapsed)
    ) {
      return 'BUSINESS';
    }
    if (
      collapsed === 'PREMIUM' ||
      collapsed === 'PREMIUM ECONOMY' ||
      collapsed === 'PREMIUM ECONOMY CLASS' ||
      collapsed === 'PREMIUM SELECT' ||
      collapsed === 'PREMIUM PLUS' ||
      collapsed === 'PREMIUM CABIN' ||
      collapsed === 'W' ||
      /\bPREMIUM\b/.test(collapsed)
    ) {
      return 'PREMIUM';
    }
    if (
      collapsed === 'ECONOMY' ||
      collapsed === 'ECONOMY CLASS' ||
      collapsed === 'COACH' ||
      collapsed === 'MAIN CABIN' ||
      collapsed === 'STANDARD' ||
      collapsed === 'Y' ||
      /\bECONOMY\b/.test(collapsed) ||
      /\bCOACH\b/.test(collapsed)
    ) {
      return 'ECONOMY';
    }

    return 'ECONOMY';
  }

  function toDurationMinutes(value){
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return null;
  }

  function getPreferredRBD(input, legacyCabin, legacyDuration) {
    let airlineCode = '';
    let marketedCabin = null;
    let durationMinutes = null;

    if (input && typeof input === 'object' && !Array.isArray(input)) {
      airlineCode = input.airlineCode;
      marketedCabin = input.marketedCabin;
      durationMinutes = input.durationMinutes;
    } else {
      airlineCode = input;
      marketedCabin = legacyCabin;
      durationMinutes = legacyDuration;
    }

    const cabinEnum = normalizeCabinEnum(marketedCabin);
    if (!cabinEnum) return null;

    const durationValue = toDurationMinutes(durationMinutes);
    let effectiveCabin = cabinEnum;
    if (cabinEnum === 'FIRST' && durationValue != null && durationValue <= 360) {
      effectiveCabin = 'BUSINESS';
    }

    const code = typeof airlineCode === 'string' ? airlineCode.trim().toUpperCase() : '';
    const map = code && Object.prototype.hasOwnProperty.call(RBD_BY_AIRLINE, code)
      ? RBD_BY_AIRLINE[code]
      : undefined;
    const list = map && map[effectiveCabin] ? map[effectiveCabin] : null;
    if (list && list.length) {
      return list[0] || null;
    }
    if (map && !list) {
      if (effectiveCabin !== cabinEnum && effectiveCabin === 'BUSINESS') {
        const genericBusiness = GENERIC_RBD_BY_CABIN.BUSINESS || [];
        if (genericBusiness.length) {
          return genericBusiness[0];
        }
        return CABIN_FALLBACK.BUSINESS || null;
      }
      return null;
    }
    const generic = GENERIC_RBD_BY_CABIN[effectiveCabin] || [];
    if (generic.length) {
      return generic[0];
    }
    return CABIN_FALLBACK[effectiveCabin] || null;
  }

  if (root) {
    root.RBD_BY_AIRLINE = RBD_BY_AIRLINE;
    root.getPreferredRBD = getPreferredRBD;
    root.normalizeCabinEnum = normalizeCabinEnum;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      RBD_BY_AIRLINE,
      getPreferredRBD,
      normalizeCabinEnum,
      GENERIC_RBD_BY_CABIN
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
