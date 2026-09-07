"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { contact, navigation } from "./portfolio-content";

export function SiteNavigation() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(`#${entry.target.id}`);
    }, { rootMargin: "-18% 0px -62% 0px", threshold: 0 });
    document.querySelectorAll("main > section[id]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return (
    <header className="site-header"><div className="nav-shell">
      <a className="wordmark" href="#top" aria-label={`${contact.name}, back to top`}><span className="wordmark-symbol" aria-hidden="true">o.</span><span>{contact.name}</span></a>
      <nav className="desktop-nav" aria-label="Portfolio sections">{navigation.map((item) => <a key={item.href} href={item.href} aria-current={active === item.href ? "location" : undefined}>{item.label}</a>)}</nav>
      <a className="nav-contact" href="#contact">Let’s talk<ArrowUpRight aria-hidden="true" /></a>
      <div className="mobile-nav"><Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild><Button variant="ghost" className="menu-trigger" aria-label="Open navigation"><Menu aria-hidden="true" /></Button></SheetTrigger>
        <SheetContent className="mobile-menu" showCloseButton={false}>
          <div className="mobile-menu-top"><SheetTitle>{contact.name}</SheetTitle><SheetClose asChild><Button variant="ghost" className="menu-close" aria-label="Close navigation"><X aria-hidden="true" /></Button></SheetClose></div>
          <SheetDescription className="mobile-menu-description">Backend & systems engineering</SheetDescription>
          <nav aria-label="Mobile portfolio sections">{navigation.map((item, index) => <a key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active === item.href ? "location" : undefined}><span>0{index + 1}</span>{item.label}<ArrowUpRight aria-hidden="true" /></a>)}</nav>
          <a className="mobile-menu-contact" href="#contact" onClick={() => setOpen(false)}>Let’s talk<ArrowUpRight aria-hidden="true" /></a>
          <a className="mobile-menu-email" href={`mailto:${contact.email}`}>{contact.email}</a>
        </SheetContent>
      </Sheet></div>
    </div></header>
  );
}

export function PageEffects() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.remove("reveal-pending"); observer.unobserve(entry.target); } });
    }, { rootMargin: "0px 0px 40px 0px", threshold: 0.06 });
    if (!preference.matches) elements.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight) { element.classList.add("reveal-pending"); observer.observe(element); }
    });
    const showAll = () => { if (preference.matches) { elements.forEach((element) => element.classList.remove("reveal-pending")); observer.disconnect(); } };
    preference.addEventListener("change", showAll);
    return () => { observer.disconnect(); preference.removeEventListener("change", showAll); elements.forEach((element) => element.classList.remove("reveal-pending")); };
  }, []);
  return null;
}
