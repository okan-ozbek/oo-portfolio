
export async function enhanceContent(root=document) {
  if(root.querySelector('[data-art-preset]')){try{const {enhanceArtwork}=await import('./visuals.js');enhanceArtwork(root);}catch{/* Static images remain visible if animation tools cannot load. */}}


  for(const button of root.querySelectorAll('[data-copy-code]:not([data-ready]),[data-copy-diagram]:not([data-ready])')) {
    const original=button.textContent;
    button.dataset.ready='true';button.addEventListener('click',async()=>{try{const block=button.closest('.blog-code,.blog-diagram');await navigator.clipboard.writeText(block.dataset.source??block.querySelector('code,pre').textContent);button.textContent='Copied';}catch{button.textContent='Select and copy the source';}setTimeout(()=>{button.textContent=original;},2000);});
  }
  if(root.querySelector('[data-mermaid]:not([data-rendered])')){
    try{const {renderDiagrams}=await import('./mermaid.js');await renderDiagrams(root);}
    catch{for(const diagram of root.querySelectorAll('[data-mermaid]')){const error=document.createElement('p');error.className='blog-diagram-error';error.textContent='Diagram tools could not load. Refresh the page to try again.';diagram.append(error);}}
  }
}
void enhanceContent();
const readingProgress=document.querySelector('.blog-reading-progress');
const article=document.querySelector('.blog-article');
if(readingProgress&&article){
  let queued=false;
  const updateProgress=()=>{
    queued=false;
    const rect=article.getBoundingClientRect();
    const start=Math.max(0,rect.top+window.scrollY);
    const end=Math.max(start,rect.bottom+window.scrollY-window.innerHeight);
    const fraction=end===start?(rect.bottom<=window.innerHeight?1:0):(window.scrollY-start)/(end-start);
    readingProgress.value=Math.round(Math.max(0,Math.min(1,fraction))*100);
  };
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(updateProgress);}};
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  new ResizeObserver(schedule).observe(article);
  updateProgress();
}

const projectCount=document.querySelector('[data-project-count]');
if(projectCount)fetch('/api/public/projects',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{if(data)projectCount.textContent=String(data.projects.length).padStart(2,'0');}).catch(()=>{});
