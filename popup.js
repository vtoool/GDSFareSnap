(() => {
  const booking = document.getElementById('bookingClass');
  const status  = document.getElementById('segmentStatus');
  const enableDirections = document.getElementById('enableDirections');
  const okEl    = document.getElementById('ok');
  const saveBtn = document.getElementById('saveBtn');

  chrome.storage.sync.get(['bookingClass','segmentStatus','enableDirectionButtons'], (res)=>{
    booking.value = (res.bookingClass || 'J').toUpperCase().slice(0,1);
    status.value  = (res.segmentStatus || 'SS1').toUpperCase().slice(0,3);
    enableDirections.checked = !!res.enableDirectionButtons;
  });

  saveBtn.addEventListener('click', ()=>{
    const bc = (booking.value || 'J').toUpperCase().slice(0,1);
    const ss = (status.value || 'SS1').toUpperCase().slice(0,3);
    const enableDir = !!enableDirections.checked;
    chrome.storage.sync.set({ bookingClass: bc, segmentStatus: ss, enableDirectionButtons: enableDir }, ()=>{
      okEl.textContent = 'saved';
      okEl.style.display = 'inline-block';
      // close after a short confirmation
      setTimeout(() => { window.close(); }, 600);
    });
  });
})();
