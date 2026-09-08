import {
  ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, Check, Code2,
  Gauge, Layers3, MapPin, Network,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNavigation, PageEffects } from "./site-navigation";
import { WaveCanvas } from "./wave-canvas";
import { RadishArchitecture } from "./radish-architecture";
import { contact, experience, expertise, leadership, projectOutcomes, proofPoints, stackGroups } from "./portfolio-content";

function SectionIntro({ number, label, title, description, id }: {
  number: string; label: string; title: string; description: string; id: string;
}) {
  return (
    <header className="section-intro" data-reveal>
      <p className="section-label"><span>{number}</span>{label}</p>
      <div className="section-intro-copy"><h2 id={id}>{title}</h2><p>{description}</p></div>
    </header>
  );
}

function TechList({ items }: { items: string[] }) {
  return <ul className="tech-list" aria-label="Technologies and focus">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export default function Home() {
  const expertiseIcons = [Network, Gauge, Code2];
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <PageEffects />
      <main id="main-content">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <WaveCanvas variant="hero" />
          <div className="hero-scrim" aria-hidden="true" />
          <div className="shell hero-inner">
            <SiteNavigation />
            <div className="hero-copy">
              <p className="hero-kicker"><span className="accent-dot" />Okan Can Özbek / Backend & systems engineer</p>
              <div className="hero-title-row">
                <h1 id="hero-title"><span className="hero-title-main">Complexity.</span><span className="hero-title-finish">Under control.</span></h1>
                <div className="hero-art-caption" aria-hidden="true"><span className="signal-cross">+</span><span>FIELD NOTES — 001<br />Order, from complexity.</span><span className="signal-cross">+</span></div>
              </div>
              <div className="hero-support"><p className="hero-description">I build the systems you don’t see.<br />And the reliability you do.</p><p className="hero-context">From the first byte to global scale.<br />Architecture, performance, and everything in between.</p></div>
              <div className="hero-actions">
                <Button asChild className="button button-signal"><a href="#work">Explore my work<ArrowDownRight aria-hidden="true" /></a></Button>
                <Button asChild variant="ghost" className="button button-outline-light"><a href="#contact">Let’s talk<ArrowUpRight aria-hidden="true" /></a></Button>
              </div>
            </div>
            <div className="hero-bottom">
              <p><MapPin aria-hidden="true" />Amsterdam, Netherlands</p>
              <p className="hero-focus">Distributed systems <span>/</span> Reliability <span>/</span> Performance</p>
              <a className="scroll-link" href="#expertise" aria-label="Scroll to expertise"><ArrowDown aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className="proof-section" aria-label="Experience and selected results">
          <div className="shell proof-grid">{proofPoints.map((point) => <div className="proof-item" key={point.label}><strong>{point.value}</strong><span>{point.label}</span><p>{point.context}</p></div>)}</div>
        </section>

        <section className="section expertise-section" id="expertise" aria-labelledby="expertise-title">
          <div className="shell">
            <SectionIntro number="01" label="The approach" id="expertise-title" title="Behind every effortless experience. A system that holds." description="I’m Okan, a backend and systems engineer in Amsterdam. I work where software gets demanding: concurrent workloads, unreliable networks, and milliseconds that matter." />
            <div className="expertise-grid">{expertise.map((item, index) => {
              const Icon = expertiseIcons[index];
              return <article className="expertise-item" key={item.title} data-reveal><div className="expertise-top"><span className="expertise-step">0{index + 1} / {['Connect', 'Refine', 'Understand'][index]}</span><span className="expertise-icon"><Icon aria-hidden="true" strokeWidth={1.5} /></span></div><h3>{item.title}</h3><p>{item.copy}</p><span className="expertise-detail">{item.detail}</span></article>;
            })}</div>
          </div>
        </section>

        <section className="section dark-section projects-section" id="work" aria-labelledby="projects-title">
          <div className="shell">
            <SectionIntro number="02" label="The evidence" id="projects-title" title="Less friction. More possibility." description="The approach becomes tangible here. A database built from first principles. Faster search. Integrations that recover when the network doesn’t cooperate." />
            <article className="featured-project" data-reveal>
              <div className="feature-bokeh" aria-hidden="true"><span className="bokeh-orb bokeh-orb--carmine" /><span className="bokeh-orb bokeh-orb--ash" /><span className="bokeh-orb bokeh-orb--sand" /></div>
              <div className="featured-copy">
                <p className="overline"><span className="accent-dot" />01 / Independent engineering · C++23</p>
                <h3>Radish</h3>
                <p className="featured-subtitle">Fast in memory.<br />Persistent by design.</p>
                <p className="featured-description">A Redis-inspired key-value store built around TTL-aware data, durable persistence, and deterministic crash recovery.</p>
                <ul className="feature-points"><li><Check aria-hidden="true" />RESP2 / RESP3 server compatible with redis-cli</li><li><Check aria-hidden="true" />Append-only logging and atomic compaction</li><li><Check aria-hidden="true" />Recovery, protocol, and TCP regression tests</li></ul>
                <TechList items={["C++23", "Asio", "CMake", "TCP"]} />
                <Button asChild className="button button-dark"><a href={contact.radish} target="_blank" rel="noreferrer">Explore on GitHub<ArrowUpRight aria-hidden="true" /></a></Button>
              </div>
              <RadishArchitecture />
            </article>
            <div className="outcomes-header"><span>Selected production work</span><span>Performance. Reliability. Delivery.</span></div>
            <div className="outcomes-grid">{projectOutcomes.map((project, index) => <article className="outcome-card" key={project.title} data-reveal><p className="outcome-company"><span>0{index + 2}</span>{project.company}</p><div className="outcome-result"><strong>{project.result}</strong><span>{project.resultLabel}</span></div><div className="outcome-copy"><h3>{project.title}</h3><p className="outcome-description">{project.copy}</p><TechList items={project.stack} /></div></article>)}</div>
            <div className="graphics-note" data-reveal><Layers3 aria-hidden="true" /><p><strong>Also exploring the visual side of systems.</strong> A ray tracer built from scratch in C++ and SDL, plus low-level graphics work with Vulkan and DirectX.</p></div>
          </div>
        </section>

        <section className="section experience-section" id="experience" aria-labelledby="experience-title">
          <div className="shell">
            <SectionIntro number="03" label="The progression" id="experience-title" title="Closer to the metal. Further in scale." description="Device protocols taught me precision. Event-sourced platforms taught me consistency. Global consumer systems put both to the test." />
            <div className="experience-list">{experience.map((item) => <article className={`experience-row${item.current ? " experience-current" : ""}`} key={item.company} data-reveal>
              <div className="experience-date"><span className="timeline-dot" aria-hidden="true" /><p>{item.years}</p>{item.current && <span className="current-label">Current role</span>}</div>
              <div className="experience-body"><div className="experience-heading"><div><h3>{item.company}</h3><p>{item.role}</p></div><span className="experience-location">{item.location}</span></div><p className="experience-summary">{item.summary}</p><ul className="contribution-list">{item.contributions.map((point) => <li key={point}>{point}</li>)}</ul><p className="experience-stack">{item.stack}</p></div>
            </article>)}</div>
          </div>
        </section>

        <section className="section leadership-section" id="entrepreneurship" aria-labelledby="leadership-title">
          <div className="shell">
            <SectionIntro number="04" label="The responsibility" id="leadership-title" title="Build the system. Bring the team." description="Good architecture needs shared understanding. In independent and founding roles, I connect technical decisions to the people who deliver them." />
            <div className="leadership-grid">{leadership.map((item) => <article className="leadership-card" key={item.company} data-reveal><div className="leadership-card-top"><span className="role-type">{item.type}</span><span>{item.years}</span></div><h3>{item.company}</h3><p className="leadership-role">{item.role}</p><p className="leadership-location">{item.location}</p><p className="leadership-summary">{item.summary}</p><ul className="contribution-list">{item.contributions.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
          </div>
        </section>

        <section className="section dark-section stack-section" id="skills" aria-labelledby="skills-title">
          <div className="shell">
            <SectionIntro number="05" label="The toolkit" id="skills-title" title="Different layers. One connected practice." description="From memory and protocols to services and infrastructure. I choose tools around the problem, with correctness and operability as the constants." />
            <div className="stack-grid">{stackGroups.map((group, index) => <article className="stack-card" key={group.title} data-reveal><div className="stack-card-heading"><span className="stack-number">0{index + 1}</span><div><h3>{group.title}</h3><p>{group.description}</p><p className="stack-detail">{group.detail}</p></div></div><ul className="tool-grid">{group.tools.map((tool) => <li key={tool.name}><span className="tool-logo" aria-hidden="true"><img src={`/icons/${tool.icon}.svg`} alt="" width="28" height="28" loading="lazy" /></span><span>{tool.name}</span></li>)}</ul></article>)}</div>
            <div className="personal-strip" data-reveal><div><span className="overline">In conversation</span><p>Dutch <span>Native</span><i aria-hidden="true" />English <span>Fluent</span></p></div><div><span className="overline">Beyond work</span><p>Guitar · Hiking · Gaming</p><span className="personal-interests">Graphics programming · Trading systems</span></div></div>
          </div>
        </section>

        <section className="contact-section" id="contact" aria-labelledby="contact-title">
          <div className="contact-panel">
            <WaveCanvas variant="footer" />
            <div className="contact-scrim" aria-hidden="true" />
            <div className="shell contact-inner">
              <div className="contact-copy" data-reveal><p className="section-label"><span>06</span>The next chapter</p><h2 id="contact-title">Your next challenge.<br /><span>Under control.</span></h2><p>A demanding backend, an ambitious product, or a team that cares about its craft. Let’s build what comes next.</p><Button asChild className="button button-paper"><a href={`mailto:${contact.email}`}>Start a conversation<ArrowUpRight aria-hidden="true" /></a></Button><a className="contact-email" href={`mailto:${contact.email}`}>{contact.email}<ArrowUpRight aria-hidden="true" /></a></div>
              <div className="contact-details"><span>Based in Amsterdam, Netherlands</span><div><a href={contact.linkedin} target="_blank" rel="noreferrer">LinkedIn<ArrowUpRight aria-hidden="true" /></a><a href={contact.github} target="_blank" rel="noreferrer">GitHub<ArrowUpRight aria-hidden="true" /></a><a href={contact.phoneHref}>{contact.phone}<ArrowUpRight aria-hidden="true" /></a></div></div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer shell"><p>© 2026 {contact.name}</p><span>Backend & systems engineering</span><a href="#top">Back to top<ArrowRight aria-hidden="true" /></a></footer>
    </>
  );
}
