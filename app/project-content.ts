export const projects = [
  {
    id: "01",
    name: "Project 01",
    category: "Trading systems",
    description: "A space for the next trading idea.",
    visual: "market" as const,
    code: "PXW / MARKET",
  },
  {
    id: "02",
    name: "Visual Hardware IDE",
    href: "https://systems.pixelware.nl/",
    category: "Educational tools",
    description: "Explore CPU, cache, and memory behavior through interactive 3D simulations and an experimental C++ workspace.",
    visual: "network" as const,
    code: "PXW / NETWORK",
  },
  {
    id: "03",
    name: "Project 03",
    category: "Experimental software",
    description: "A space for something a little different.",
    visual: "binary" as const,
    code: "PXW / RESEARCH",
  },
];

export const about = [
  "I’m Okan Can Özbek, a backend and systems engineer in Amsterdam with 5+ years of production experience. At Warner Bros. Discovery, I led caching work that reduced search latency by approximately 98% and cut upstream requests by approximately 40%.",
  "At FANSTR, I redesigned API integrations to reduce failed external transactions by approximately 25-30%. Through Pixelware, I build in C++, Go, and TypeScript, evaluating latency, contention, and correctness. I use tests and observability to validate decisions and take systems from architecture through production rollout.",
];

export const contact = {
  email: "o.ozbek@pixelware.nl",
  github: "https://github.com/okan-ozbek",
};
