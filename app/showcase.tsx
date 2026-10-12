"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowDownRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { DataVisual } from "./data-visual";
import { about, contact, projects } from "./project-content";

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Showcase() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, () => false);
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const playing = motionOverride ?? !reducedMotion;
  const projectCount = String(projects.length).padStart(2, "0");

  return (
    <div className="site-frame" id="top" data-motion={playing ? "on" : "off"}>
      <a className="skip-link" href="#projects">Skip to projects</a>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Pixelware, home">
          <span className="brand-icon" aria-hidden="true" />Pixelware<span className="brand-period">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="nav-projects" href="#projects">Projects <span>{projectCount}</span></a>
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
              <article className={`project-card project-card--${project.visual}`} key={project.id} aria-labelledby={`project-${project.id}`}>
                <div className="project-visual" aria-hidden="true">
                  <div className="project-visual-top mono"><span>{project.code}</span><span className="visual-index">{project.id}</span></div>
                  <DataVisual kind={project.visual} playing={playing} />
                  {project.visual === "network" && <div className="network-readout mono"><span>NODE / 008</span><span>CONNECTED</span></div>}
                  {project.visual === "latency" && <div className="metrics-legend mono"><span><i />P50</span><span><i />P99</span><span>SIMULATED · ms</span></div>}
                  <div className="visual-bottom-line" />
                </div>
                <div className="project-info">
                  <div className="project-category mono">{project.category}</div>
                  <div className="project-title-row">
                    <h3 id={`project-${project.id}`}>
                      {project.href ? <a className="project-link" href={project.href} target="_blank" rel="noopener noreferrer" aria-label={`View ${project.name} (opens in a new tab)`}>{project.name}</a> : project.name}
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

        <section className="contact-strip" id="contact" aria-labelledby="contact-title">
          <div><span className="eyebrow">AN OPEN CHANNEL</span><h2 id="contact-title">Have something in mind?</h2></div>
          <a href={`mailto:${contact.email}`}>Let’s build it.<ArrowUpRight size={22} aria-hidden="true" /></a>
        </section>
      </main>

      <footer className="site-footer">
        <p className="mono">© {new Date().getFullYear()} PIXELWARE</p>
        <div className="footer-links"><a href={contact.github} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} aria-hidden="true" /></a><a href={`mailto:${contact.email}`}>Email <ArrowUpRight size={13} aria-hidden="true" /></a></div>
        <button className="motion-control" type="button" aria-label={playing ? "Pause animations" : "Play animations"} aria-pressed={!playing} onClick={() => setMotionOverride(!playing)}>{playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}<span>Motion {playing ? "on" : "off"}</span></button>
      </footer>
    </div>
  );
}
