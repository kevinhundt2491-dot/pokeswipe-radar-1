// Bestätigung einer Kündigung ohne Anmeldung (Link aus der E-Mail an die Konto-Adresse) – ausgelagert für die strikte CSP
(function(){
  var f=document.getElementById('cc'); if(!f) return;
  var $=function(i){return document.getElementById(i)};
  f.addEventListener('submit',function(ev){
    ev.preventDefault(); $('err').textContent='';
    $('go').disabled=true; $('go').textContent='Wird bestätigt …';
    fetch('/api/legal/cancel/confirm',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({ref:f.getAttribute('data-ref'),token:f.getAttribute('data-token')})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
      .then(function(x){
        if(!x.ok) throw new Error(x.d.error||'Fehler');
        f.hidden=true; var box=$('done'); box.hidden=false;
        var ok=document.createElement('div'); ok.className='ok'; ok.textContent=x.d.message||'Bestätigt.'; box.appendChild(ok);
      })
      .catch(function(e){ $('err').textContent=e.message||'Bestätigung fehlgeschlagen – bitte erneut versuchen.'; $('go').disabled=false; $('go').textContent='Kündigung jetzt bestätigen'; });
  });
})();
