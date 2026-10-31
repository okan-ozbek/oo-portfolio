// Retain the select as the filter's value source; share the analytics picker UI.
export function initFilterPicker(select, { calendar=false } = {}) {
  const label=document.querySelector(`label[for="${select.id}"]`)?.textContent ?? 'Filter';
  const root=document.createElement('div');root.className='range-picker library-filter-picker';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='range-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const text=document.createElement('span');
  const glyph=document.createElement('span');glyph.className='range-icon';glyph.setAttribute('aria-hidden','true');glyph.textContent='≡';
  if(calendar){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('fill','none');const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [key,value]of Object.entries({x:3,y:4.5,width:14,height:12.5,rx:2}))rect.setAttribute(key,value);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6.5 3v3M13.5 3v3M3 8.5h14M6.5 12h2M11.5 12h2');svg.append(rect,path);glyph.replaceChildren(svg);}
  const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 16 16');arrow.setAttribute('class','range-chevron');arrow.setAttribute('fill','none');arrow.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m4 6 4 4 4-4');arrow.append(path);trigger.append(glyph,text,arrow);
  const menu=document.createElement('div');menu.className='range-menu';menu.id=select.id+'-menu';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);trigger.setAttribute('aria-controls',menu.id);
  const options=[...select.options].map(option=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.dataset.value=option.value;const title=document.createElement('span');title.textContent=option.textContent;const check=document.createElement('span');check.className='range-check';check.textContent='✓';check.setAttribute('aria-hidden','true');button.append(title,check);menu.append(button);button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));close(true);});return button;});
  function sync(){text.textContent=select.selectedOptions[0]?.textContent;trigger.setAttribute('aria-label',`${label}: ${text.textContent}`);for(const option of options){const active=option.dataset.value===select.value;option.setAttribute('aria-selected',String(active));option.tabIndex=active?0:-1;}}
  function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function open(){menu.hidden=false;trigger.setAttribute('aria-expanded','true');(options.find(option=>option.dataset.value===select.value)??options[0]).focus();}
  trigger.addEventListener('click',()=>menu.hidden?open():close());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}const index=options.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(index+1)%options.length:event.key==='ArrowUp'?(index-1+options.length)%options.length:null;if(next!==null){event.preventDefault();options[next].focus();}});
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(!root.contains(event.target))close();});
  select.addEventListener('change',sync);select.hidden=true;select.after(root);root.append(trigger,menu);sync();
}
