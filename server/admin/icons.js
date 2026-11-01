const paths = {
  h1: ['M3 4v12M11 4v12M3 10h8','m15 8 2-2v10m-2 0h4'],
  h2: ['M2 4v12M10 4v12M2 10h8','M14 8c0-3 5-3 5 0 0 2-5 4-5 7h5'],
  h3: ['M2 4v12M10 4v12M2 10h8','M14 6h3a2 2 0 0 1 0 4h-2m2 0a2.5 2.5 0 0 1 0 5h-3'],
  subtext: ['M3 4h14M3 8h14M3 13h8M3 16h6'],
  bold: ['M6 3h5a3.5 3.5 0 0 1 0 7H6V3Zm0 7h6a3.5 3.5 0 0 1 0 7H6v-7Z'],
  italic: ['M9 3h8M3 17h8M13 3 7 17'],
  strike: ['M15 5c-3-4-10-2-9 2 1 3 9 2 9 6 0 5-9 5-11 1','M2 10h16'],
  underline: ['M5 3v7a5 5 0 0 0 10 0V3M3 18h14'],
  bullet: ['M8 5h10M8 10h10M8 15h10M2 5h1M2 10h1M2 15h1'],
  ordered: ['M9 5h9M9 10h9M9 15h9M2 3h1v5M1 8h4M1 12c0-2 4-2 4 0 0 1-4 3-4 4h4'],
  todo: ['M3 3h14v14H3V3Z','m6 10 3 3 5-6'],
  quote: ['M3 5h5v6H4l-1 4M12 5h5v6h-4l-1 4'],
  code: ['m6 5-5 5 5 5m8-10 5 5-5 5M12 3 8 17'],
  mermaid: ['M7 2h6v4H7V2ZM2 14h6v4H2v-4Zm10 0h6v4h-6v-4ZM10 6v4M5 14v-4h10v4'],
  image: ['M2 3h16v14H2V3Z','m2 14 5-5 5 5 3-3 3 3M12 6h1v1h-1Z'],
  embed: ['M2 3h16v14H2V3ZM2 7h16','m8 10 5 2-5 3v-5Z'],
  link: ['m8 6 2-2a4 4 0 0 1 6 6l-2 2M12 14l-2 2a4 4 0 0 1-6-6l2-2M7 13l6-6'],
  trash: ['M3 6h14', 'M8 3h4l1 3H7l1-3Z', 'M5 6l1 11h8l1-11', 'M8 9v5', 'M12 9v5'],
  pause: ['M6 4v12', 'M14 4v12'],
  play: ['m6 3 10 7-10 7V3Z'],
  edit: ['m12 4 4 4', 'm4 12 9-9 4 4-9 9-5 1 1-5Z'],
  eye: ['M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z', 'M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'],
  download: ['M10 2v10', 'm6 8 4 4 4-4', 'M3 13v4h14v-4'],
  verified: ['M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', 'm6 10 3 3 5-6'],
  bookmark: ['M5 3h10v15l-5-4-5 4V3Z'],
  notes: ['M4 2h8l4 4v12H4V2Z', 'M12 2v4h4', 'M7 9h6M7 12h6M7 15h4'],
};

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('action-icon');
  if (name === 'ellipsis') {
    for (const x of [4, 10, 16]) {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', '10'); dot.setAttribute('r', '1'); svg.append(dot);
    }
  } else for (const d of paths[name]) {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
