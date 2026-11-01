
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

// Numbered pages remain available without JavaScript and to search engines.
// Readers progressively load the next page as they approach the end of the feed.
const feed=document.getElementById('blog-feed');
const pagination=document.querySelector('.blog-pagination');
if(feed&&pagination&&'IntersectionObserver' in window){
  let next=pagination.querySelector('a[rel="next"]')?.href;
  if(next){
    const area=document.createElement('div');area.className='blog-load-area';
    const button=document.createElement('button');button.type='button';button.textContent='Load more posts';
    const status=document.createElement('p');status.className='blog-load-status';status.setAttribute('role','status');
    area.append(button,status);pagination.before(area);pagination.hidden=true;
    let loading=false;
    const seen=new Set([...feed.querySelectorAll('.blog-feed-image')].map(link=>link.getAttribute('href')));
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMore();},{rootMargin:'0px 0px 500px 0px'});
    async function loadMore(){
      if(loading||!next)return;
      loading=true;button.disabled=true;status.textContent='Loading more posts…';feed.setAttribute('aria-busy','true');
      try{
        const response=await fetch(next,{headers:{Accept:'text/html'}});
        if(!response.ok)throw new Error('Could not load posts');
        const page=new DOMParser().parseFromString(await response.text(),'text/html');
        const rows=[...page.querySelectorAll('#blog-feed > .blog-feed-row')];
        if(!rows.length)throw new Error('Missing posts');
        for(const row of rows){
          const href=row.querySelector('.blog-feed-image')?.getAttribute('href');
          if(href&&!seen.has(href)){seen.add(href);feed.append(document.importNode(row,true));}
        }
        const nextLink=page.querySelector('.blog-pagination a[rel="next"]')?.getAttribute('href');
        next=nextLink?new URL(nextLink,response.url).href:null;
        await enhanceContent(feed);
        status.textContent=next?'':'You’re all caught up.';button.hidden=!next;
        pagination.hidden=true;
        if(next){observer.unobserve(area);observer.observe(area);}
        else observer.disconnect();
      }catch{
        observer.disconnect();
        status.textContent='Couldn’t load more posts. Try again or use the page links below.';
        pagination.hidden=false;
      }finally{loading=false;button.disabled=false;feed.removeAttribute('aria-busy');}
    }
    button.addEventListener('click',()=>void loadMore());
    observer.observe(area);
  }
}
