// Small first-party outline icons keep messaging controls consistent without an icon CDN.
const paths={
  calendar:'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 2v5m10-5v5M3 10h18m-14 4h2m2 0h2m2 0h2m-10 3h2m2 0h2',
  arrow:'M5 12h14m-5-5 5 5-5 5',
  back:'m15 5-7 7 7 7',
  info:'M12 8h.01M12 11v6m9-5a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  settings:'m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l1-3 3-1 2-3-2-2 1-3-3-2-1-3H9Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  compose:'M13 5H4v16h16v-9M16 3l5 5M9 15l1-5 9-9 4 4-9 9-5 1',
  photo:'M3 5h18v15H3V5Zm0 11 5-5 5 5 3-3 5 5M16 8h.01',
  paperclip:'m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L14 2m-4 9 6-6a2 2 0 0 1 3 3L8 19a4 4 0 0 1-6-6',
  mic:'M8 4a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0V4Zm-4 6v1a8 8 0 0 0 16 0v-1m-8 9v4m-4 0h8',
  play:'m8 5 11 7-11 7V5',
  pause:'M8 5v14m8-14v14',
  stop:'M6 6h12v12H6V6',
  send:'m3 3 19 9-19 9 4-9-4-9Zm4 9h15',
  more:'M5 12h.01M12 12h.01M19 12h.01',
  edit:'m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4',
  forward:'m14 5 7 7-7 7m7-7H9a6 6 0 0 0-6 6',
  share:'M12 16V2m-5 5 5-5 5 5M5 12H3v10h18V12h-2',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  shield:'m12 2 8 3v7c0 4-5 7-8 10-3-3-8-6-8-10V5l8-3Zm-4 10 3 3 5-6',
  close:'m6 6 12 12M6 18 18 6',
  message:'M3 3h18v14H8l-5 4V3m4 5h10M7 12h6'
};
export function appIcon(name,size=20){
  return `<svg class="app-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]||paths.message}"/></svg>`;
}
