// § 312k BGB – Kündigungsformular auf /kuendigen (ausgelagert für die strikte Content-Security-Policy)
(function(){
  var f=document.getElementById('kf'),$=function(i){return document.getElementById(i)};
  function sync(){ $('reasonBox').hidden=!$('k2').checked; $('dateBox').hidden=!$('t2').checked; }
  f.addEventListener('change',sync); sync();
  var tok=''; try{ var u=JSON.parse(localStorage.getItem('gotrue.user')||'null'); tok=(u&&u.token&&u.token.access_token)||''; if(u&&u.email&&!$('email').value) $('email').value=u.email; }catch(e){}
  f.addEventListener('submit',function(ev){
    ev.preventDefault(); $('err').textContent='';
    var body={kind:$('k2').checked?'ausserordentlich':'ordentlich',reason:$('reason').value,name:$('name').value,email:$('email').value,contractRef:$('contract').value,timing:$('t2').checked?'date':'next',requestedDate:$('date').value,confirmEmail:$('confirmEmail').value};
    if(!body.name.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)){ $('err').textContent='Bitte Name und eine gültige E-Mail-Adresse angeben.'; return; }
    if(body.kind==='ausserordentlich'&&!body.reason.trim()){ $('err').textContent='Bitte gib für die außerordentliche Kündigung den Grund an.'; return; }
    if(body.timing==='date'&&!body.requestedDate){ $('err').textContent='Bitte das gewünschte Datum wählen.'; return; }
    $('go').disabled=true; $('go').textContent='Wird übermittelt …';
    var headers={'Content-Type':'application/json',Accept:'application/json'}; if(tok) headers.Authorization='Bearer '+tok;
    fetch('/api/legal/cancel',{method:'POST',headers:headers,body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})}).then(function(x){
      if(!x.ok) throw new Error(x.d.error||'Fehler');
      f.hidden=true; var box=$('done'); box.hidden=false;
      var ok=document.createElement('div'); ok.className='ok'; ok.textContent=x.d.confirmation; box.appendChild(ok);
      var a=document.createElement('a'); a.className='btn y'; a.style.marginTop='12px'; a.textContent='📄 Bestätigung speichern';
      a.href=URL.createObjectURL(new Blob([x.d.confirmation],{type:'text/plain;charset=utf-8'})); a.download='kuendigung-'+x.d.reference+'.txt'; box.appendChild(a);
      var p=document.createElement('button'); p.className='btn s'; p.style.marginLeft='8px'; p.style.border='0'; p.textContent='🖨️ Drucken'; p.onclick=function(){window.print()}; box.appendChild(p);
      window.scrollTo(0,0);
    }).catch(function(e){ $('err').textContent=e.message||'Übermittlung fehlgeschlagen – bitte erneut versuchen oder per E-Mail kündigen.'; $('go').disabled=false; $('go').textContent='Jetzt kündigen'; });
  });
})();
