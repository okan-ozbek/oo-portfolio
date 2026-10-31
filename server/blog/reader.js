
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
const more=document.querySelector('[data-blog-more]');
if(more)more.hidden=false;
more?.addEventListener('click',async()=>{
  const status=document.getElementById('blog-load-status');more.disabled=true;status.textContent='Loading more writing…';
  try{const response=await fetch(`/api/public/blogs?cursor=${encodeURIComponent(more.dataset.cursor)}`);if(!response.ok)throw new Error();const page=await response.json();document.getElementById('blog-feed').insertAdjacentHTML('beforeend',page.html);void enhanceContent(document.getElementById('blog-feed'));more.dataset.cursor=page.nextCursor??'';more.parentElement.hidden=!page.nextCursor;status.textContent=`${page.posts.length} more posts loaded.`;}
  catch{status.textContent='Could not load more posts. Please try again.';}finally{more.disabled=false;}
});

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
