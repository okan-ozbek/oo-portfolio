import {enhanceArtwork} from './visuals.js';
export async function enhanceContent(root=document) {
  enhanceArtwork(root);
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
more?.addEventListener('click',async()=>{
  const status=document.getElementById('blog-load-status');more.disabled=true;status.textContent='Loading more writing…';
  try{const response=await fetch(`/api/public/blogs?cursor=${encodeURIComponent(more.dataset.cursor)}`);if(!response.ok)throw new Error();const page=await response.json();document.getElementById('blog-feed').insertAdjacentHTML('beforeend',page.html);enhanceArtwork(document.getElementById('blog-feed'));more.dataset.cursor=page.nextCursor??'';more.parentElement.hidden=!page.nextCursor;status.textContent=`${page.posts.length} more posts loaded.`;}
  catch{status.textContent='Could not load more posts. Please try again.';}finally{more.disabled=false;}
});
