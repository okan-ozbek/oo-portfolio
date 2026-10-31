"use client";
/* Images come from the blog's WebP pipeline; the static frontend has no Next image server. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
type BlogPost = {id:string;slug:string;title:string;summary:string;tags:string[];thumbnailUrl:string;thumbnailPosition:string;publishedAt:string;author:{name:string;linkedinUrl:string;avatarId:string|null}};
type BlogPage = {posts:BlogPost[];nextCursor:string|null};
export function BlogFeed() {
  const [posts,setPosts]=useState<BlogPost[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const pending=useRef(false);
  useEffect(()=>{const controller=new AbortController();fetch('/api/public/blogs',{signal:controller.signal,cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then((page:BlogPage)=>{setPosts(page.posts);setCursor(page.nextCursor);setReady(true);}).catch(()=>{if(!controller.signal.aborted){setError('The notebook is temporarily unavailable.');setReady(true);}});return()=>controller.abort();},[]);
  async function more(){if(pending.current||!cursor)return;pending.current=true;setBusy(true);setError('');try{const response=await fetch(`/api/public/blogs?cursor=${encodeURIComponent(cursor)}`,{cache:'no-store'});if(!response.ok)throw new Error();const page:BlogPage=await response.json();setPosts(existing=>[...existing,...page.posts.filter(post=>!existing.some(item=>item.id===post.id))]);setCursor(page.nextCursor);}catch{setError('Could not load more posts. Please try again.');}finally{pending.current=false;setBusy(false);}}
  return <section className="home-blog-section" id="writing" aria-labelledby="home-blog-title">
    <div className="home-blog-heading"><div><p className="home-blog-eyebrow">THE ENGINEERING NOTEBOOK</p><h2 id="home-blog-title">Writing<span>.</span></h2></div><a href="/blog">All writing ↗</a></div>
    <p className="home-blog-intro">Notes on systems, software, and the ideas in between.</p>
    <div className="home-blog-list">{posts.map(post=><article className="home-blog-row" key={post.id}>
      <a className="home-blog-image" href={`/blog/${post.slug}`} tabIndex={-1} aria-hidden="true"><img src={post.thumbnailUrl} alt="" loading="lazy" style={{objectPosition:post.thumbnailPosition}}/></a>
      <div className="home-blog-copy"><p className="home-blog-tags">{post.tags.join(' · ')}</p><h3><a href={`/blog/${post.slug}`}>{post.title}</a></h3><div className="home-blog-meta"><span className="home-blog-author">{post.author.avatarId?<img src={`/blog/media/${post.author.avatarId}?size=avatar`} alt="" loading="lazy"/>:<span className="home-blog-avatar" aria-hidden="true">{post.author.name.slice(0,1)}</span>}{post.author.linkedinUrl?<a href={post.author.linkedinUrl} target="_blank" rel="noopener noreferrer">{post.author.name}</a>:<span>{post.author.name}</span>}</span><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(post.publishedAt))}</time></div><p className="home-blog-summary">{post.summary}</p></div>
    </article>)}</div>
    {!ready&&<p className="home-blog-note" role="status">Opening the notebook…</p>}{ready&&!posts.length&&!error&&<p className="home-blog-note">The first entry is on its way.</p>}
    {cursor&&<div className="home-blog-more"><button type="button" onClick={more} disabled={busy}>{busy?'Loading…':'Read more ↓'}</button></div>}
    {error&&<p className="home-blog-note" role="status">{error} <a href="/blog">Visit the blog ↗</a></p>}
  </section>;
}
