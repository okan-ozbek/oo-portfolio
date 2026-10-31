const paths = {
  trash: ['M3 6h14', 'M8 3h4l1 3H7l1-3Z', 'M5 6l1 11h8l1-11', 'M8 9v5', 'M12 9v5'],
  pause: ['M6 4v12', 'M14 4v12'],
  play: ['m6 3 10 7-10 7V3Z'],
  edit: ['m12 4 4 4', 'm4 12 9-9 4 4-9 9-5 1 1-5Z'],
  eye: ['M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z', 'M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'],
  download: ['M10 2v10', 'm6 8 4 4 4-4', 'M3 13v4h14v-4'],
  verified: ['M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', 'm6 10 3 3 5-6'],
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
