"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowDownRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { DataVisual } from "./data-visual";
import { BlogArtwork } from './blog-artwork';
import { BlogFeed } from './blog-feed';
import { about, contact, projects as initialProjects } from "./project-content";

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type ProjectCard = {id:string;name:string;category:string;description:string;href?:string;visual?:typeof initialProjects[number]['visual'];code:string;thumbnail:string};
const fallbackProjects:ProjectCard[] = initialProjects.map(project=>({...project,thumbnail:'project-'+project.visual}));
export type HomeData={projects:ProjectCard[];blogPage:import('./blog-feed').BlogPage;resumeAvailable:boolean};
export function Showcase({initialData}:{initialData?:HomeData}={}) {
  const [projects,setProjects]=useState<ProjectCard[]>(initialData?.projects??fallbackProjects);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/public/projects',{signal:controller.signal,cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then(data=>{
      if(controller.signal.aborted)return;
      setProjects(data.projects.map((project:{id:string;title:string;caption:string;description:string;url:string;state:string;thumbnail:string})=>{
        const original=initialProjects.find(item=>'project-'+item.visual===project.thumbnail);
        return {id:project.id,name:project.title,category:project.caption,description:project.description,href:project.state==='published'?project.url:undefined,visual:original?.visual,code:original?.code??'PXW / PROJECT',thumbnail:project.thumbnail};
      }));
    }).catch(()=>{/* Preserve the static showcase if the service is unavailable. */});
    return()=>controller.abort();
  },[initialData]);
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, () => false);
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(initialData?.resumeAvailable??false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/public/resume', { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setResumeAvailable(data?.available === true); })
      .catch(() => { /* The portfolio remains usable when no resume is published. */ });
    return () => controller.abort();
  }, [initialData]);
  const playing = motionOverride ?? !reducedMotion;
  const projectCount = String(projects.length).padStart(2, "0");

  return (
    <div className="site-frame" id="top" data-motion={playing ? "on" : "off"}>
      <a className="skip-link" href="#projects">Skip to projects</a>
      <header className="site-header">
        <a className="wordmark site-wordmark" href="#top" aria-label="Pixelware, home">
          <span className="brand-icon" aria-hidden="true" />Pixelware<span className="brand-period">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="nav-projects" href="#projects">Projects <span>{projectCount}</span></a>
          <a href="/blog">Blog</a>
          <a className="nav-contact" href={`mailto:${contact.email}`}>Let’s talk <ArrowUpRight size={15} aria-hidden="true" /></a>
        </nav>
      </header>

      <main>
        <section className="intro" aria-labelledby="intro-title">
          <div className="intro-copy">
            <h1 id="intro-title">Software.<br /><span>With an edge.</span></h1>
            <p className="intro-description">Systems, tools, and experiments.<br />Built with understanding and quality.</p>
            <a className="explore-link" href="#projects">Explore the projects <ArrowDownRight size={18} aria-hidden="true" /></a>
          </div>
          <div className="intro-visual" aria-hidden="true">
            <div className="visual-corner corner-tl" /><div className="visual-corner corner-tr" />
            <div className="hero-visual-label"><span>ORDER IN THE NOISE</span></div>
            <DataVisual kind="terrain" playing={playing} />
            <div className="visual-corner corner-bl" /><div className="visual-corner corner-br" />
          </div>
          <div className="intro-bottom"><span className="intro-coordinate mono">52.3676° N · 4.9041° E</span></div>
        </section>

        <section className="projects-section" id="projects" aria-labelledby="projects-title">
          <div className="section-heading">
            <div className="section-heading-title"><h2 id="projects-title">Project index<span className="title-count">({projectCount})</span></h2></div>
          </div>
          <div className="project-grid">
            {projects.map(project => (
              <article className={`project-card project-card--${project.visual??'static'}`} key={project.id} aria-labelledby={`project-${project.id}`}>
                <div className="project-visual" aria-hidden="true">
                  <BlogArtwork preset={project.thumbnail} seed={project.id} src={`/blog/art/${project.thumbnail}.svg?seed=${encodeURIComponent(project.id)}`} playing={playing}/>
                </div>
                <div className="project-info">
                  <div className="project-category mono">{project.category}</div>
                  <div className="project-title-row">
                    <h3 id={`project-${project.id}`}>
                      {project.href ? <a className="project-link" href={project.href} onClick={()=>{navigator.sendBeacon?.(`/api/public/projects/${project.id}/view`);}} onAuxClick={event=>{if(event.button===1)navigator.sendBeacon?.(`/api/public/projects/${project.id}/view`);}} target="_blank" rel="noopener noreferrer" aria-label={`View ${project.name} (opens in a new tab)`}>{project.name}</a> : project.name}
                    </h3>
                    <span className="project-status">{project.href ? <>View project <ArrowUpRight size={11} aria-hidden="true" /></> : "Coming soon"}</span>
                  </div>
                  <p>{project.description}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="projects-footnote">The development and exploration of systems engineering.</p>
        </section>

        <section className="about-section" id="about" aria-labelledby="about-title">
          <h2 id="about-title">About me</h2>
          <div className="about-copy">{about.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
        </section>

        <BlogFeed initialPage={initialData?.blogPage} playing={playing} />

        <section className="contact-strip" id="contact" aria-labelledby="contact-title">
          <div><span className="eyebrow">AN OPEN CHANNEL</span><h2 id="contact-title">Have something in mind?</h2></div>
          <a href={`mailto:${contact.email}`}>Let’s build it.<ArrowUpRight size={22} aria-hidden="true" /></a>
        </section>
      </main>

      <footer className="site-footer">
        <p className="mono">© {new Date().getFullYear()} PIXELWARE</p>
        <div className="footer-links">{resumeAvailable && <a href="/resume.pdf" download>Resume PDF <ArrowDownRight size={13} aria-hidden="true" /></a>}<a href={contact.github} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} aria-hidden="true" /></a><a href={`mailto:${contact.email}`}>Email <ArrowUpRight size={13} aria-hidden="true" /></a></div>
        <button className="motion-control" type="button" aria-label={playing ? "Pause animations" : "Play animations"} aria-pressed={!playing} onClick={() => setMotionOverride(!playing)}>{playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}<span>Motion {playing ? "on" : "off"}</span></button>
      </footer>
    </div>
  );
}
