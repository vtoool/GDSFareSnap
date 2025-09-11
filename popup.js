// Add these helpers:
function isVisible(el){
  if(!el) return false;
  const r = el.getBoundingClientRect();
  return el.offsetParent !== null && r.width > 120 && r.height > 120 && r.bottom > 0 && r.top < (window.innerHeight || 1000);
}
function autoFindCard(){
  // 1) Try obvious “details” containers first
  const detail = document.querySelector('[data-test*="ItineraryLegs"], [data-test*="LegDetails"], [aria-expanded="true"]');
  if (detail) {
    const card = detail.closest('article, [data-resultid], [class*="resultCard"], [class*="resultInner"]') || detail;
    if (isVisible(card)) return card;
  }
  // 2) Score visible cards
  const cards = Array.from(document.querySelectorAll('article, [data-resultid], [class*="resultCard"], [class*="resultInner"]')).filter(isVisible);
  let best = null, bestScore = -1;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]m\b/i;
  const iataRe = /\b[A-Z]{3}\b/g;
  for (const c of cards) {
    const t = (c.innerText || '').replace(/[\u200b\u200e\u200f]/g,'');
    let s = 0;
    // two times? (dep/arr)
    const times = (t.match(timeRe) || []).length; if (times >= 2) s += 3;
    // at least two IATA codes?
    const iatas = (t.match(iataRe) || []).filter(x => x !== 'USD'); if (iatas.length >= 2) s += 3;
    // contains a route arrow or “Depart •” header style
    if (/\b[A-Z]{3}\s*[→>\-–]\s*[A-Z]{3}\b/.test(t)) s += 2;
    if (/^\s*Depart\s*·/m.test(t)) s += 1;
    // larger text blocks tend to be expanded cards
    if (t.length > 500) s += 1;
    // prefer the card closer to the viewport center
    const r = c.getBoundingClientRect(); const centerPenalty = Math.abs((r.top + r.bottom)/2 - (window.innerHeight||800)/2) / 1000;
    s -= centerPenalty;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

// Replace your old pickCard with this:
function pickCard(force){
  if (!force) {
    const found = autoFindCard();
    if (found) return found;
  }
  // fallback: interactive picker
  return new Promise(resolve=>{
    const CSS='kayak-gds-picker';
    const st=document.createElement('style');
    st.textContent = `.${CSS}{outline:2px solid #7c5cff;border-radius:8px;}`;
    document.documentElement.appendChild(st);
    function onClick(e){ const card=e.target.closest('article, [data-resultid], [class*="resultCard"], [class*="resultInner"]'); if(card){ cleanup(); resolve(card);} }
    function onMove(e){ const c=e.target.closest('article, [data-resultid], [class*="resultCard"], [class*="resultInner"]'); document.querySelectorAll('.'+CSS).forEach(x=>x.classList.remove(CSS)); if(c)c.classList.add(CSS); }
    function cleanup(){ document.removeEventListener('click',onClick,true); document.removeEventListener('mousemove',onMove,true); st.remove(); }
    document.addEventListener('click',onClick,true);
    document.addEventListener('mousemove',onMove,true);
  });
}
