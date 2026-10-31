import { initContentChart } from './content-chart.js';
import { icon } from './icons.js';
import { formatMarkdown } from './blog-format.js';
import { enhanceContent } from '/blog/assets/reader.js';
import {technicalPresets,projectPresets,artworkNode,replaceArtwork,enhanceArtwork} from '/blog/assets/visuals.js';
const $=id=>document.getElementById(id);
// Keep legacy banner data intact when saving existing posts and revisions.
const postFields=['title','slug','summary','tags','markdown','thumbnail','banner','relatedIds'];
const node=(tag,className='',text)=>{const value=document.createElement(tag);value.className=className;if(text!==undefined)value.textContent=text;return value;};
const button=(text,action,className='secondary')=>{const value=node('button',className,text);value.type='button';value.addEventListener('click',action);return value;};
const art=(spec,id)=>spec.assetId?`/blog/media/${spec.assetId}?size=thumbnail`:`/blog/art/${spec.preset}.svg?seed=${encodeURIComponent(id)}`;
const formatDate=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const snapshot=post=>Object.fromEntries(postFields.map(key=>[key,structuredClone(post[key])]));
const slugify=value=>value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'');
const imagePattern=/!\[((?:\\.|[^\]])*)\]\((\/blog\/media\/[a-f0-9-]{36})(?: "((?:\\.|[^"])*)")?\)(?:\{width=(\d{1,3}) align=(left|center|right)\})?/g;

export function initBlogs({api,toast}) {
  const activity=initContentChart({api,kind:'blog',prefix:'blog-view-'});
  let posts=[],author=null,editor=null,epoch=0,loading=0,uploadTarget=null,imageEditing=null,publishAction='publish',authorBusy=false;
  const tagTone=tag=>`book-tag tone-${[...tag.toLowerCase()].reduce((sum,char)=>sum+char.codePointAt(0),0)%6}`;
  const tagChips=node('div','book-tag-chips'),tagInput=node('input'),tagSuggestions=node('div','book-tag-suggestions');
  tagInput.id='blog-tag-input';tagInput.maxLength=60;tagInput.placeholder='Add a tag…';tagInput.autocomplete='off';
  $('blog-tags').append(tagChips,tagInput,tagSuggestions);
  const knownTags=()=>[...new Set(posts.flatMap(post=>post.tags))].sort((a,b)=>a.localeCompare(b));
  function addTag(value,focus=true){
    if(!editor)return;const tag=value.trim();if(!tag)return;
    if(!editor.post.tags.some(item=>item.toLowerCase()===tag.toLowerCase())){
      if(editor.post.tags.length>=20){tagInput.setCustomValidity('Use up to 20 tags.');tagInput.reportValidity();return;}
      editor.post.tags.push(knownTags().find(item=>item.toLowerCase()===tag.toLowerCase())??tag);changed(false);
    }
    tagInput.value='';tagInput.setCustomValidity('');renderTags();if(focus)tagInput.focus();
  }
  function renderTagSuggestions(){
    tagSuggestions.replaceChildren();if(!editor)return;
    const query=tagInput.value.trim().toLowerCase(),selected=editor.post.tags.map(tag=>tag.toLowerCase());
    for(const tag of knownTags().filter(tag=>!selected.includes(tag.toLowerCase())&&tag.toLowerCase().includes(query)))tagSuggestions.append(button(tag,()=>addTag(tag),`${tagTone(tag)} tag-suggestion`));
    if(query&&!knownTags().some(tag=>tag.toLowerCase()===query)&&!selected.includes(query))tagSuggestions.append(button(`＋ Create “${tagInput.value.trim()}”`,()=>addTag(tagInput.value),'book-create-tag'));
  }
  function renderTags(){
    tagChips.replaceChildren();if(!editor)return;
    for(const tag of editor.post.tags){const chip=node('span',tagTone(tag)),remove=button('×',()=>{editor.post.tags=editor.post.tags.filter(item=>item!==tag);tagInput.setCustomValidity('');changed(false);renderTags();},'book-tag-remove');remove.setAttribute('aria-label',`Remove tag ${tag}`);chip.append(node('span','',tag),remove);tagChips.append(chip);}
    renderTagSuggestions();
  }
  tagInput.addEventListener('input',()=>{tagInput.setCustomValidity('');renderTagSuggestions();});
  tagInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addTag(tagInput.value);}else if(event.key==='Backspace'&&!tagInput.value&&editor?.post.tags.length){editor.post.tags.pop();changed(false);renderTags();}});
  // Preserve a typed tag when leaving the field without requiring a Save button.
  tagInput.addEventListener('blur',event=>{if(!$('blog-tags').contains(event.relatedTarget)&&tagInput.value.trim())addTag(tagInput.value,false);});
  function setError(error){$('blog-edit-error').textContent=error?.message??error??'';}
  function status(text,error=false){$('blog-save-status').textContent=text;$('blog-save-status').classList.toggle('is-error',error);$('blog-save-retry').hidden=!error;}
  function dirty(){return editor&&editor.sequence!==editor.savedSequence;}
  function rowAuthor(){const wrap=node('span','blog-author');if(author?.avatarId){const image=node('img');image.src=`/blog/media/${author.avatarId}`;image.alt='';wrap.append(image);}else wrap.append(node('span','blog-avatar',author?.name?.slice(0,1)??'O'));wrap.append(node('span','',author?.name??'Author'));return wrap;}
  function renderList(){
    const query=$('blog-search').value.toLowerCase(),filter=$('blog-status').value;
    const selected=posts.filter(post=>(filter==='all'||post.status===filter)&&[post.title,post.summary,...post.tags].join(' ').toLowerCase().includes(query));
    $('blog-count').textContent=String(posts.length);$('blog-rows').replaceChildren();$('blog-empty').hidden=posts.length>0;$('blog-no-results').hidden=!posts.length||selected.length>0;$('blog-table-wrap').hidden=!selected.length;
    for(const post of selected){
      const row=node('tr');row.tabIndex=0;row.setAttribute('aria-label',`Edit ${post.title}`);row.addEventListener('click',event=>{if(!event.target.closest('a,button'))void openPost(post.id);});row.addEventListener('keydown',event=>{if(event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();void openPost(post.id);}});
      const cover=node('td');cover.append(artworkNode(post.thumbnail,post.id,false,'blog-table-thumbnail'));
      const identity=node('td');identity.append(node('span','blog-table-title',post.title||'Untitled draft'),node('span','blog-table-summary',post.summary||'A thought waiting to take shape.'));
      const state=node('td');state.append(node('span',`blog-status ${post.status}`,post.status==='published'?'Published':'Draft'));if(post.hasUnpublishedChanges)state.append(node('span','blog-status-note','Unpublished changes'));
      const byline=node('td','blog-table-author');byline.append(rowAuthor());const date=node('td','blog-table-date',formatDate(post.updatedAt));
      const actions=node('td');const edit=button('',()=>void openPost(post.id),'action-button');edit.append(icon('edit'));edit.setAttribute('aria-label',`Edit ${post.title}`);edit.title='Edit post';actions.append(edit);const views=node('td','unique-views',new Intl.NumberFormat().format(post.uniqueViews??0));views.setAttribute('aria-label',`${post.uniqueViews??0} unique device views`);row.append(cover,identity,state,byline,date,views,actions);$('blog-rows').append(row);
    }
    enhanceArtwork($('blog-rows'));
  }
  async function refresh(){const version=++loading,currentEpoch=epoch;const [data]=await Promise.all([api('blogs'),activity.refresh()]);if(version!==loading||currentEpoch!==epoch)return;posts=data.posts;author=data.author;renderList();}
  function updatePost(post){posts=posts.some(item=>item.id===post.id)?posts.map(item=>item.id===post.id?post:item):[post,...posts];renderList();}
  function renderState(){if(!editor)return;const post=editor.post;$('blog-edit-state').textContent=post.status==='published'?(dirty()||post.hasUnpublishedChanges?'PUBLISHED · UNPUBLISHED CHANGES':'PUBLISHED'):'PRIVATE DRAFT';$('blog-publish').textContent=post.status==='published'?'Publish changes':'Publish';$('blog-unpublish').hidden=post.status!=='published';$('blog-preview-link').href=`/admin/blog-preview/${post.id}`;$('blog-slug').disabled=true;}
  async function save(){
    const active=editor;if(!active)return true;
    clearTimeout(active.timer);
    if(active.saving){const success=await active.saving;if(!success||editor!==active)return success;return dirty()?save():true;}
    if(!dirty())return true;
    const sequence=active.sequence,post=snapshot(active.post);status('Saving…');setError('');
    active.saving=(async()=>{try{
      const data=await api(`blogs/${active.post.id}`,{method:'PATCH',body:{post,version:active.post.version,sessionId:active.sessionId}});
      if(editor!==active)return false;
      active.savedSequence=sequence;active.post.version=data.post.version;active.post.hasUnpublishedChanges=data.post.hasUnpublishedChanges;active.post.updatedAt=data.post.updatedAt;updatePost(data.post);status(active.sequence===sequence?'All changes saved':'Unsaved changes');renderState();void loadHistory(false);return true;
    }catch(error){if(editor===active){status('Changes not saved',true);setError(error);}return false;}finally{active.saving=null;}})();
    const success=await active.saving;if(success&&editor===active&&dirty())return save();return success;
  }
  function changed(preview=true){if(!editor)return;editor.sequence++;status('Unsaved changes');clearTimeout(editor.timer);editor.timer=setTimeout(()=>void save(),700);renderState();if(preview)schedulePreview();}
  function schedulePreview(){const active=editor;if(!active)return;clearTimeout(active.previewTimer);active.previewTimer=setTimeout(()=>void preview(),400);}
  async function preview(){
    const active=editor;if(!active)return;const sequence=++active.previewSequence;
    $('blog-word-count').textContent=`${active.post.markdown.trim()?active.post.markdown.trim().split(/\s+/).length:0} words`;
    try{const data=await api(`blogs/${active.post.id}/preview`,{method:'POST',body:{post:snapshot(active.post)}});if(editor!==active||sequence!==active.previewSequence)return;$('blog-live-preview').innerHTML=data.html||'<p class="blog-muted">Your ideas take shape here.</p>';await enhanceContent($('blog-live-preview'));if(editor===active&&sequence===active.previewSequence)attachImageControls();}
    catch(error){if(editor===active&&sequence===active.previewSequence)$('blog-live-preview').textContent=error.message;}
  }
  async function leave(){return !editor||await save();}
  async function openPost(id){
    if(!(await leave()))return;const currentEpoch=epoch;
    try{const {post}=await api(`blogs/${id}`);if(currentEpoch!==epoch)return;
      if(editor){clearTimeout(editor.timer);clearTimeout(editor.previewTimer);}
      editor={post,sequence:0,savedSequence:0,saving:null,sessionId:crypto.randomUUID(),previewSequence:0,assets:[],autoSlug:!post.publishedAt&&post.slug.startsWith('post-')};
      $('blog-library').hidden=true;$('blog-editor').hidden=false;$('blog-title').value=post.title;$('blog-summary').value=post.summary;$('blog-slug').value=post.slug;tagInput.value='';tagInput.setCustomValidity('');renderTags();$('blog-markdown').value=post.markdown;setError('');status('All changes saved');renderState();selectTab('content');renderArtwork();void loadMedia();void loadHistory();void preview();$('blog-title').focus();if(post.title==='Untitled draft')$('blog-title').select();
    }catch(error){$('blog-library-error').textContent=error.message;}
  }
  async function create(){if(!(await leave()))return;$('blog-new').disabled=true;try{const {post}=await api('blogs',{method:'POST',body:{}});updatePost(post);await openPost(post.id);}catch(error){$('blog-library-error').textContent=error.message;}finally{$('blog-new').disabled=false;}}
  function selectTab(name){for(const tab of document.querySelectorAll('[data-blog-tab]')){const active=tab.dataset.blogTab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(`blog-panel-${tab.dataset.blogTab}`).hidden=!active;}if(name==='history')void loadHistory();if(name==='suggestions')renderSuggestions();if(name==='artwork')renderArtwork();}
  for(const tab of document.querySelectorAll('[data-blog-tab]')){tab.addEventListener('click',()=>selectTab(tab.dataset.blogTab));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-blog-tab]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[next].dataset.blogTab);tabs[next].focus();});}
  for(const mode of document.querySelectorAll('[data-blog-mode]'))mode.addEventListener('click',()=>{$('blog-composer-panes').dataset.mode=mode.dataset.blogMode;for(const button of document.querySelectorAll('[data-blog-mode]'))button.setAttribute('aria-pressed',String(button===mode));});
  for(const key of ['title','summary','markdown'])$(`blog-${key}`).addEventListener('input',()=>{
    if(!editor)return;const value=$(`blog-${key}`).value;editor.post[key]=value;
    
    if(key==='title'&&editor.autoSlug){editor.post.slug=slugify(value)||editor.post.slug;$('blog-slug').value=editor.post.slug;}
    changed(key==='markdown'||key==='title'||key==='summary');
  });
  function showLibrary(){clearTimeout(editor?.timer);clearTimeout(editor?.previewTimer);editor=null;$('blog-editor').hidden=true;$('blog-library').hidden=false;$('blog-new').focus();}
  $('blog-save-draft').addEventListener('click',async()=>{
    const active=editor,control=$('blog-save-draft');
    if(!active||active.publishing||control.disabled)return;
    control.disabled=true;$('blog-publish').disabled=true;
    try{if(!(await save())||editor!==active)return;showLibrary();toast('Draft saved.');}
    finally{control.disabled=false;$('blog-publish').disabled=false;}
  });
  $('blog-back').addEventListener('click',async()=>{if(!(await leave()))return;showLibrary();await refresh();});
  $('blog-new').addEventListener('click',()=>void create());$('blog-empty-new').addEventListener('click',()=>void create());$('blog-search').addEventListener('input',renderList);$('blog-status').addEventListener('change',renderList);$('blog-refresh').addEventListener('click',()=>refresh().catch(error=>{$('blog-library-error').textContent=error.message;}));$('blog-save-retry').addEventListener('click',()=>void save());
  $('blog-preview-link').addEventListener('click',event=>{if(dirty()||editor?.saving){event.preventDefault();void save().then(ok=>{if(ok)toast('Draft saved. Click Preview article to open it.');});}});
  const insert=(text)=>{const input=$('blog-markdown');input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');editor.post.markdown=input.value;changed();input.focus();};
  const snippets={heading:'\n## A closer look\n\n',code:'\n```cpp\n// Your code here\n```\n',mermaid:'\n```mermaid\nflowchart LR\n  A[Request] --> B[Service]\n  B --> C[(Database)]\n```\n',embed:'\n```embed\nhttps://codepen.io/your-name/pen/your-demo\n```\n',link:'[Link text](https://example.com)'};
  for(const tool of document.querySelectorAll('[data-blog-icon]'))tool.append(icon(tool.dataset.blogIcon));
  for(const tool of document.querySelectorAll('[data-blog-insert]'))tool.addEventListener('click',()=>{
    if(!editor)return;const input=$('blog-markdown'),edit=formatMarkdown(input.value,input.selectionStart,input.selectionEnd,tool.dataset.blogInsert);
    if(edit){input.focus();input.setRangeText(edit.text,edit.start,edit.end,'end');input.setSelectionRange(edit.selectionStart,edit.selectionEnd);editor.post.markdown=input.value;changed();}
    else insert(snippets[tool.dataset.blogInsert]);
  });
  $('blog-markdown').addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();insert('  ');}if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();void save();}});
  function renderArtwork(){if(!editor)return;const post=editor.post;
    for(const [container,collection]of [[$('blog-presets'),technicalPresets],[$('blog-project-presets'),projectPresets]]){
      container.replaceChildren();for(const preset of collection){
        const choice=button('',()=>{editor.post.thumbnail={preset:preset.id,assetId:null,position:'center'};changed(false);renderArtwork();},'blog-preset');
        choice.dataset.preset=preset.id;choice.setAttribute('aria-label',`Use ${preset.name} thumbnail`);choice.setAttribute('aria-pressed',String(post.thumbnail.preset===preset.id&&!post.thumbnail.assetId));
        const caption=node('div','blog-preset-caption');caption.append(node('strong','',preset.name),node('small','',preset.topic),node('i','blog-preset-check',choice.getAttribute('aria-pressed')==='true'?'✓':'↗'));
        choice.append(artworkNode({preset:preset.id},post.id),caption);container.append(choice);
      }enhanceArtwork(container);
    }
    for(const key of ['thumbnail']){replaceArtwork($(`blog-${key}-preview`),post[key],post.id,false);$(`blog-${key}-position`).value=post[key].position;$(`blog-${key}-crop`).hidden=!post[key].assetId;$(`blog-${key}-reset`).hidden=!post[key].assetId;}
  }
  for(const key of ['thumbnail']){$(`blog-${key}-upload`).addEventListener('click',()=>chooseUpload(key));$(`blog-${key}-reset`).addEventListener('click',()=>{editor.post[key].assetId=null;changed(false);renderArtwork();});$(`blog-${key}-position`).addEventListener('change',()=>{editor.post[key].position=$(`blog-${key}-position`).value;changed(false);renderArtwork();});}
  function renderMedia(){if(!editor)return;$('blog-media-library').replaceChildren();for(const asset of editor.assets){const item=button('',()=>openImage({asset}), 'blog-media-item'),image=node('img');image.src=asset.url;image.alt='';item.append(image,node('span','',asset.name));item.title=`Insert ${asset.name}`;$('blog-media-library').append(item);}}
  async function loadMedia(){const active=editor;try{const data=await api(`blogs/${active.post.id}/media`);if(editor!==active)return;active.assets=data.assets;renderMedia();}catch(error){if(editor===active)setError(error);}}
  function chooseUpload(target){uploadTarget=target;$('blog-image-file').value='';$('blog-image-file').click();}
  async function upload(file,target){
    if(!file)return;const active=editor,currentEpoch=epoch;
    if(file.size>12*1024*1024)return toast('Choose an image smaller than 12 MB.');
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))return toast('Choose a PNG, JPEG, WebP, or GIF.');
    if(!active&&target!=='author')return;
    toast('Uploading image…');
    try{const {asset}=await api(target==='author'?`blogs/author/media?name=${encodeURIComponent(file.name)}`:`blogs/${active.post.id}/media?name=${encodeURIComponent(file.name)}`,{method:'POST',file});if(currentEpoch!==epoch)return;
      if(target==='author'){author.avatarId=asset.id;renderAuthorPhoto();toast('Photo ready. Save your profile to apply it.');return;}
      if(editor!==active)return;active.assets.push(asset);renderMedia();if(target==='thumbnail'){active.post[target].assetId=asset.id;changed(false);renderArtwork();toast('Image uploaded.');}else{selectTab('content');openImage({asset});}
    }catch(error){toast(error.message);}
  }
  $('blog-image-file').addEventListener('change',()=>void upload($('blog-image-file').files[0],uploadTarget));$('blog-insert-image').addEventListener('click',()=>chooseUpload('inline'));$('blog-media-upload').addEventListener('click',()=>chooseUpload('inline'));
  $('blog-markdown').addEventListener('paste',event=>{const file=[...event.clipboardData.items].find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile();if(file){event.preventDefault();void upload(file,'inline');}});
  $('blog-markdown').addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});$('blog-markdown').addEventListener('drop',event=>{const file=event.dataTransfer.files[0];if(file){event.preventDefault();void upload(file,'inline');}});
  const imageMatches=()=>[...editor.post.markdown.matchAll(imagePattern)];
  function imageText({src,alt,caption,width,align}){const escape=value=>value.replace(/\\/g,'\\\\').replace(/[\[\]"]/g,char=>`\\${char}`).replace(/\n/g,' ');return `![${escape(alt)}](${src}${caption?` "${escape(caption)}"`:''}){width=${width} align=${align}}`;}
  function replaceImage(match,spec){const input=$('blog-markdown');input.setRangeText(imageText(spec),match.index,match.index+match[0].length,'end');editor.post.markdown=input.value;changed();}
  function openImage({asset,match}){imageEditing={asset,match};$('blog-image-preview').src=asset.url;$('blog-image-alt').value=match?match[1].replace(/\\(.)/g,'$1'):'';$('blog-image-caption').value=match?(match[3]??'').replace(/\\(.)/g,'$1'):'';$('blog-image-width').value=match?.[4]??'100';$('blog-image-align').value=match?.[5]??'center';$('blog-image-dialog').showModal();$('blog-image-alt').focus();}
  $('blog-image-form').addEventListener('submit',event=>{event.preventDefault();if(!editor||!imageEditing)return;const spec={src:imageEditing.asset.url,alt:$('blog-image-alt').value,caption:$('blog-image-caption').value,width:Number($('blog-image-width').value),align:$('blog-image-align').value};if(imageEditing.match)replaceImage(imageEditing.match,spec);else insert(`\n${imageText(spec)}\n`);$('blog-image-dialog').close();});
  function attachImageControls(){
    const counts=new Map();for(const image of $('blog-live-preview').querySelectorAll('[data-image-src]')){
      const src=image.dataset.imageSrc,index=counts.get(src)??0;counts.set(src,index+1);const matching=()=>imageMatches().filter(match=>match[2]===src)[index];
      image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','Edit image size and caption');const edit=()=>{const match=matching();if(match)openImage({asset:{url:src},match});};image.addEventListener('click',event=>{if(!event.target.closest('.blog-image-resize'))edit();});image.addEventListener('keydown',event=>{if(event.target===image&&['Enter',' '].includes(event.key)){event.preventDefault();edit();}});
      const handle=node('button','blog-image-resize');handle.type='button';handle.setAttribute('aria-label','Resize image');image.append(handle);
      handle.addEventListener('click',event=>event.stopPropagation());handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const match=matching();if(match)replaceImage(match,{src,alt:match[1].replace(/\\(.)/g,'$1'),caption:(match[3]??'').replace(/\\(.)/g,'$1'),width:Math.max(10,Math.min(100,Number(match[4]??100)+(event.key==='ArrowRight'?5:-5))),align:match[5]??'center'});});
      handle.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();const active=editor,match=matching();if(!match)return;const start=event.clientX,width=Number(image.dataset.imageWidth),parent=image.parentElement.getBoundingClientRect().width;let next=width;handle.setPointerCapture(event.pointerId);const move=event=>{next=Math.max(10,Math.min(100,Math.round(width+(event.clientX-start)/parent*100)));image.style.width=`${next}%`;};const finish=event=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);if(editor===active&&event.type!=='pointercancel'&&next!==width)replaceImage(match,{src,alt:match[1].replace(/\\(.)/g,'$1'),caption:(match[3]??'').replace(/\\(.)/g,'$1'),width:next,align:match[5]??'center'});else image.style.width=`${width}%`;};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);});
    }
  }
  function renderSuggestions(){if(!editor)return;const chosen=editor.post.relatedIds;$('blog-related-selected').replaceChildren();$('blog-related-picker').replaceChildren(new Option('Choose a published post…',''));$('blog-related-empty').hidden=chosen.length>0;
    chosen.forEach((id,index)=>{const post=posts.find(post=>post.id===id),row=node('div','blog-related-item');if(post){const img=node('img');img.src=art(post.thumbnail,id);img.alt='';row.append(img);}row.append(node('strong','',post?.title??'Unavailable post'));for(const [text,label,offset]of[['↑','Move suggestion up',-1],['↓','Move suggestion down',1]]){const move=button(text,()=>{const next=index+offset;[chosen[index],chosen[next]]=[chosen[next],chosen[index]];changed(false);renderSuggestions();},'');move.disabled=index+offset<0||index+offset>=chosen.length;move.setAttribute('aria-label',`${label}: ${post?.title??'post'}`);row.append(move);}const remove=button('×',()=>{editor.post.relatedIds=chosen.filter(value=>value!==id);changed(false);renderSuggestions();},'');remove.setAttribute('aria-label',`Remove suggestion: ${post?.title??'post'}`);row.append(remove);$('blog-related-selected').append(row);});
    for(const post of posts.filter(post=>post.id!==editor.post.id&&post.status==='published'&&!chosen.includes(post.id)))$('blog-related-picker').append(new Option(post.title,post.id));$('blog-related-picker').disabled=chosen.length>=6;
  }
  $('blog-related-picker').addEventListener('change',()=>{if(editor&&$('blog-related-picker').value){editor.post.relatedIds.push($('blog-related-picker').value);changed(false);renderSuggestions();}});
  async function loadHistory(flush=true){const active=editor;if(!active)return;if(flush&&!(await save()))return;try{const {revisions}=await api(`blogs/${active.post.id}/revisions`);if(editor!==active)return;$('blog-history').replaceChildren();for(const rev of revisions){const row=node('article','blog-revision'),info=node('div');info.append(node('strong','',rev.kind==='draft'?'Draft edited':rev.kind),node('p','',rev.note||rev.fields.map(field=>field==='markdown'?'content':field==='relatedIds'?'suggested posts':field).join(', ')||'No content changes'));const time=node('time','',formatDate(rev.createdAt));time.dateTime=rev.createdAt;info.append(time);row.append(info);row.append(button('Restore as draft',async()=>{if(!(await save()))return;try{const data=await api(`blogs/${active.post.id}/restore`,{method:'POST',body:{version:active.post.version,revisionId:rev.id}});updatePost(data.post);await openPost(data.post.id);toast('Revision restored to your draft.');}catch(error){setError(error);}},'secondary'));$('blog-history').append(row);}}catch(error){if(editor===active)setError(error);}}
  function openPublish(action){if(!editor)return;publishAction=action;$('blog-publish-note-field').hidden=action!=='publish'||!editor.post.publishedAt;$('blog-publish-title').textContent=action==='unpublish'?'Return to draft?':'Ready to share?';$('blog-publish-description').textContent=action==='unpublish'?'This removes the article from the website. Your writing, images, and history stay here.':editor.post.status==='published'?'Your saved changes will replace the live article.':'This article will appear on your website and in the reading list.';$('blog-publish-confirm').textContent=action==='unpublish'?'Unpublish article':'Publish article';$('blog-publish-note').value='';$('blog-publish-error').textContent='';$('blog-publish-dialog').showModal();}
  $('blog-publish').addEventListener('click',()=>openPublish('publish'));$('blog-unpublish').addEventListener('click',()=>openPublish('unpublish'));
  $('blog-publish-form').addEventListener('submit',async event=>{event.preventDefault();const active=editor;if(!active||active.publishing)return;active.publishing=true;for(const control of $('blog-publish-form').elements)control.disabled=true;
    try{if(!(await save()))throw new Error('Save your draft successfully before continuing.');const {post}=await api(`blogs/${active.post.id}/${publishAction}`,{method:'POST',body:{version:active.post.version,note:$('blog-publish-note').value}});if(editor!==active)return;active.post=post;updatePost(post);renderState();status('All changes saved');$('blog-publish-dialog').close();if(publishAction==='publish')showLibrary();void activity.refresh();toast(publishAction==='publish'?'Article published.':'Article returned to draft.');}catch(error){$('blog-publish-error').textContent=error.message;}finally{active.publishing=false;for(const control of $('blog-publish-form').elements)control.disabled=false;}
  });
  for(const dialog of ['blog-publish-dialog','blog-author-dialog'])$(dialog).addEventListener('cancel',event=>{if(dialog==='blog-publish-dialog'?editor?.publishing:authorBusy)event.preventDefault();});
  for(const control of document.querySelectorAll('[data-blog-close]'))control.addEventListener('click',()=>$(control.dataset.blogClose).close());
  function renderAuthorPhoto(){$('blog-author-photo-preview').replaceChildren();if(author.avatarId){const img=node('img');img.src=`/blog/media/${author.avatarId}`;img.alt='Author profile photo';$('blog-author-photo-preview').append(img);}else $('blog-author-photo-preview').append(node('span','blog-avatar',author.name.slice(0,1)));}
  $('blog-author-open').addEventListener('click',async()=>{try{const data=await api('blogs/author');author=data.author;$('blog-author-name').value=author.name;$('blog-author-linkedin').value=author.linkedinUrl;$('blog-author-id').textContent=author.linkedinId?`Connected LinkedIn profile ID: ${author.linkedinId}`:'';$('blog-linkedin-connect').hidden=!data.linkedinAvailable;$('blog-linkedin-note').textContent=data.linkedinAvailable?'Connect LinkedIn to import your name and profile photo. Your profile URL is the link readers will open.':'Set your name, photo, and LinkedIn link here. Automatic profile import becomes available once LinkedIn is configured for this website.';$('blog-author-error').textContent='';renderAuthorPhoto();$('blog-author-dialog').showModal();}catch(error){toast(error.message);}});
  $('blog-author-photo').addEventListener('click',()=>chooseUpload('author'));
  $('blog-author-form').addEventListener('submit',async event=>{event.preventDefault();if(authorBusy)return;authorBusy=true;for(const control of $('blog-author-form').elements)control.disabled=true;try{const data=await api('blogs/author',{method:'PUT',body:{name:$('blog-author-name').value,linkedinUrl:$('blog-author-linkedin').value,avatarId:author.avatarId}});author=data.author;renderList();$('blog-author-dialog').close();toast('Author profile saved.');}catch(error){$('blog-author-error').textContent=error.message;}finally{authorBusy=false;for(const control of $('blog-author-form').elements)control.disabled=false;}});
  $('blog-linkedin-connect').addEventListener('click',async()=>{if(authorBusy)return;authorBusy=true;try{const saved=await api('blogs/author',{method:'PUT',body:{name:$('blog-author-name').value,linkedinUrl:$('blog-author-linkedin').value,avatarId:author.avatarId}});author=saved.author;const data=await api('blogs/author/linkedin',{method:'POST',body:{}});location.assign(data.url);}catch(error){$('blog-author-error').textContent=error.message;authorBusy=false;}});
  window.addEventListener('beforeunload',event=>{if(dirty()||editor?.saving){event.preventDefault();event.returnValue='';}});
  return {refresh,leave,reset(){activity.reset();epoch++;loading++;if(editor){clearTimeout(editor.timer);clearTimeout(editor.previewTimer);}editor=null;posts=[];author=null;$('blog-editor').hidden=true;$('blog-library').hidden=false;$('blog-rows').replaceChildren();for(const id of ['blog-author-dialog','blog-publish-dialog','blog-image-dialog'])$(id).close();}};
}
