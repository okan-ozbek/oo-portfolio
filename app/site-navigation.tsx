"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { contact, navigation } from "./portfolio-content";

function PixelwareWordmark() {
  return <span className="pixelware-brand"><span className="pixelware-logo" aria-hidden="true" /><span>Pixelware<span className="pixelware-period">.</span></span></span>;
}

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
        <a className="wordmark" href="#top" aria-label="Pixelware, back to top">
          <PixelwareWordmark />
        </a>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" className="menu-trigger" aria-label="Open navigation">
              <span>Menu</span><Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent className="mobile-menu" aria-describedby={undefined} showCloseButton={false} onCloseAutoFocus={(event) => {
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
              <SheetTitle className="menu-brand"><PixelwareWordmark /></SheetTitle>
              <SheetClose asChild><Button variant="ghost" className="menu-close" aria-label="Close navigation"><X aria-hidden="true" /></Button></SheetClose>
            </div>
            <nav aria-label="Portfolio sections">
              {navigation.map((item, index) => (
                <a key={item.href} href={item.href} onClick={() => navigate(item.href)}>
                  <span className="menu-link-number">0{index + 1}</span><span className="menu-link-title">{item.label}</span><ArrowUpRight aria-hidden="true" />
                </a>
              ))}
            </nav>
            <div className="menu-footer">
              <a className="mobile-menu-contact" href="#contact" onClick={() => navigate("#contact")}>Let’s talk<ArrowUpRight aria-hidden="true" /></a>
              <a className="mobile-menu-email" href={`mailto:${contact.email}`}>{contact.email}<ArrowUpRight aria-hidden="true" /></a>
            </div>
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
