"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { contact, navigation } from "./portfolio-content";

export function SiteNavigation() {
  const [open, setOpen] = useState(false);
  const navigationTarget = useRef<HTMLElement | null>(null);
  const navigate = (href: string) => {
    navigationTarget.current = document.getElementById(href.slice(1));
    setOpen(false);
  };
  return (
    <header className="site-header">
      <div className="nav-shell">
        <a className="wordmark" href="#top" aria-label={`${contact.name}, back to top`}>
          <span className="wordmark-symbol" aria-hidden="true">o.</span>
          <span>{contact.name}</span>
        </a>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" className="menu-trigger" aria-label="Open navigation">
              <span>Menu</span><Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent className="mobile-menu" showCloseButton={false} onCloseAutoFocus={(event) => {
            const target = navigationTarget.current;
            navigationTarget.current = null;
            if (!target) return;
            // A section link should not restore focus to the now-offscreen trigger.
            event.preventDefault();
            const temporaryTabIndex = !target.hasAttribute("tabindex");
            if (temporaryTabIndex) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
            if (temporaryTabIndex) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
          }}>
            <div className="mobile-menu-top">
              <SheetTitle>{contact.name}</SheetTitle>
              <SheetClose asChild><Button variant="ghost" className="menu-close" aria-label="Close navigation"><X aria-hidden="true" /></Button></SheetClose>
            </div>
            <SheetDescription className="mobile-menu-description">Backend & systems engineering</SheetDescription>
            <nav aria-label="Portfolio sections">
              {navigation.map((item, index) => (
                <a key={item.href} href={item.href} onClick={() => navigate(item.href)}>
                  <span>0{index + 1}</span>{item.label}<ArrowUpRight aria-hidden="true" />
                </a>
              ))}
            </nav>
            <a className="mobile-menu-contact" href="#contact" onClick={() => navigate("#contact")}>Let’s talk<ArrowUpRight aria-hidden="true" /></a>
            <a className="mobile-menu-email" href={`mailto:${contact.email}`}>{contact.email}</a>
          </SheetContent>
        </Sheet>
      </div>
    </header>
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
