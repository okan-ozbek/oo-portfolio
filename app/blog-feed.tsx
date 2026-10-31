"use client";
/* Images come from the blog's WebP pipeline; the static frontend has no Next image server. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { BlogArtwork } from './blog-artwork';
export type BlogPost = {id:string;slug:string;title:string;summary:string;tags:string[];thumbnailUrl:string;thumbnailPosition:string;thumbnailPreset:string|null;publishedAt:string;author:{name:string;linkedinUrl:string;avatarId:string|null}};
export type BlogPage = {posts:BlogPost[];nextCursor:string|null};
export function BlogFeed({initialPage,playing=true}:{initialPage?:BlogPage;playing?:boolean}) {
  const [posts,setPosts]=useState<BlogPost[]>(initialPage?.posts??[]),[cursor,setCursor]=useState<string|null>(initialPage?.nextCursor??null);
  useEffect(()=>{if(initialPage)return;const controller=new AbortController();fetch('/api/public/blogs',{signal:controller.signal,cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then((page:BlogPage)=>{setPosts(page.posts);setCursor(page.nextCursor);}).catch(()=>{ /* Keep an unavailable or empty blog off the homepage. */ });return()=>controller.abort();},[initialPage]);
  if(!posts.length)return null;
  return <section className="home-blog-section" id="blog" aria-labelledby="home-blog-title">
    <div className="home-blog-heading"><h2 id="home-blog-title">Blog</h2></div>
    <div className="home-blog-list">{posts.map(post=><article className="home-blog-row" key={post.id}>
      <a className="home-blog-image" href={`/blog/${post.slug}`} tabIndex={-1} aria-hidden="true"><BlogArtwork preset={post.thumbnailPreset} seed={post.id} src={post.thumbnailUrl} position={post.thumbnailPosition} playing={playing}/></a>
      <div className="home-blog-copy"><h3><a href={`/blog/${post.slug}`}>{post.title}</a></h3><p className="home-blog-summary">{post.summary}</p><div className="home-blog-meta"><span className="home-blog-author">{post.author.avatarId?<img src={`/blog/media/${post.author.avatarId}?size=avatar`} alt="" loading="lazy"/>:<span className="home-blog-avatar" aria-hidden="true">{post.author.name.slice(0,1)}</span>}{post.author.linkedinUrl?<a href={post.author.linkedinUrl} target="_blank" rel="noopener noreferrer">{post.author.name}</a>:<span>{post.author.name}</span>}</span><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(post.publishedAt))}</time></div></div>
    </article>)}</div>
    {cursor&&<div className="home-blog-more"><a href="/blog?page=2">Read more</a></div>}
  </section>;
}
