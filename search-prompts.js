(() => {
  const input=document.querySelector('#main-search'),field=input.closest('.search-field');
  const phrases=['What do you want to play?','Search for a game','Find your next game','Looking for something specific?','Pick something to play','Search by game title','Something new or an old favorite?','What’s next in your library?','Find a game to download','Ready to play something else?'];
  const hint=document.createElement('span');hint.className='rotating-search-hint';hint.setAttribute('aria-hidden','true');hint.textContent=phrases[0];field.append(hint);input.classList.add('rotating-placeholder');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let position=0,changing=false,animation;
  function sync(){hint.hidden=Boolean(input.value);hint.style.left=input.offsetLeft+'px';hint.style.width=input.offsetWidth+'px';if(hint.hidden){animation?.cancel();animation=null;}}
  new ResizeObserver(sync).observe(field);input.addEventListener('input',sync);input.addEventListener('keydown',()=>requestAnimationFrame(sync));document.querySelector('#search-clear').addEventListener('click',sync);
  new MutationObserver(sync).observe(document.querySelector('#search-page'),{attributes:true,attributeFilter:['class','hidden']});
  async function advance(){
    sync();if(changing||hint.hidden||document.hidden||document.querySelector('#search-page').hidden)return;
    changing=true;
    try{
      if(!reduced.matches){animation=hint.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],{duration:220,easing:'ease-in',fill:'forwards'});await animation.finished;}
      position=(position+1)%phrases.length;hint.textContent=phrases[position];input.placeholder=phrases[position];animation?.cancel();
      if(!reduced.matches){animation=hint.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});await animation.finished;}
    }catch{}finally{changing=false;animation=null;}
  }
  sync();setInterval(advance,10000);
})();
