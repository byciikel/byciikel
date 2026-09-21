#!/usr/bin/env node
// Generates stats.svg and languages.svg for the profile README.
// Runs in GitHub Actions with GITHUB_TOKEN, so no shared rate-limited
// instance is in the loop.

import fs from 'node:fs';

const TOKEN = process.env.GITHUB_TOKEN;
const USER = 'byciikel';
const OUT = 'docs/assets';
const API = 'https://api.github.com';
const MAX_LANG_REPOS = 30;

const C = {
  bg: '#0A0A14',
  magenta: '#FF2E88',
  text: '#E8E6F0',
  amber: '#FFD166',
  cyan: '#22D3EE',
  violet: '#A78BFA',
  dim: '#8B87A0',
  bar: '#1E1E32',
};

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}

async function gh(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'profile-stats-generator',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`; // omitted for local unauthenticated runs
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function statsSvg({ stars, forks, contribs, repos, ageYears }) {
  const W = 400, H = 195, PAD = 24, LH = 27, barW = 150;
  const rows = [
    { label: 'Total Stars', value: stars },
    { label: 'Total Forks', value: forks },
    { label: 'Recent activity', value: contribs },
    { label: 'Public Repos', value: repos },
  ];
  const maxV = Math.max(...rows.map((r) => r.value), 1);
  const body = rows
    .map((r, i) => {
      const y = 56 + i * LH;
      const w = Math.max(4, Math.round((r.value / maxV) * barW));
      return `<text x="${PAD}" y="${y}" font-size="11" fill="${C.dim}">${esc(r.label)}</text>
  <text x="${W - PAD}" y="${y + 12}" text-anchor="end" font-size="15" font-weight="bold" fill="${C.text}">${fmt(r.value)}</text>
  <rect x="${PAD}" y="${y + 19}" width="${barW}" height="3" rx="1.5" fill="${C.bar}"/>
  <rect x="${PAD}" y="${y + 19}" width="${w}" height="3" rx="1.5" fill="${C.cyan}"/>`;
    })
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub stats for ${USER}">
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${C.violet}" stroke-opacity="0.35"/>
  <text x="${PAD}" y="34" font-family="Menlo, Consolas, monospace" font-size="13" fill="${C.magenta}" textLength="120" lengthAdjust="spacing">PLAYER STATS</text>
  <text x="${W - PAD}" y="34" text-anchor="end" font-size="11" fill="${C.dim}">@${USER} · ${ageYears}y</text>
  ${body}
</svg>
`;
}

function langSvg(langs) {
  const W = 400, H = 195, PAD = 24;
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  const top = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const palette = [C.magenta, C.cyan, C.amber, C.violet, '#4ADE80'];
  const y0 = 62, LH = 22;
  const segs = [];
  let acc = 0;
  const BAR_Y = 166, BAR_W = W - 2 * PAD, BAR_H = 8;
  const segRects = top.map(([name, bytes], i) => {
    const w = (bytes / total) * BAR_W;
    const x = PAD + acc;
    acc += w;
    segs.push(`<rect x="${x}" y="${BAR_Y}" width="${w.toFixed(1)}" height="${BAR_H}" fill="${palette[i % palette.length]}"/>`);
    return `<circle cx="${PAD + 6}" cy="${y0 + i * LH - 4}" r="5" fill="${palette[i % palette.length]}"/>
  <text x="${PAD + 20}" y="${y0 + i * LH}" font-size="12" fill="${C.text}">${esc(name)}</text>
  <text x="${W - PAD}" y="${y0 + i * LH}" text-anchor="end" font-size="12" fill="${C.dim}">${((bytes / total) * 100).toFixed(1)}%</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Top languages for ${USER}">
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${C.violet}" stroke-opacity="0.35"/>
  <text x="${PAD}" y="34" font-family="Menlo, Consolas, monospace" font-size="13" fill="${C.cyan}" textLength="120" lengthAdjust="spacing">TOP LANGUAGES</text>
  <text x="${W - PAD}" y="34" text-anchor="end" font-size="11" fill="${C.violet}">@${USER}</text>
  ${segRects.join('\n  ')}
  ${segs.join('')}
</svg>
`;
}

async function main() {
  if (!TOKEN) console.warn('GITHUB_TOKEN not set — running unauthenticated (low rate limits, fine for a local test)');

  const [user, repos, events] = await Promise.all([
    `/users/${USER}`,
    `/users/${USER}/repos?per_page=100&sort=updated`,
    `/users/${USER}/events?per_page=100`,
  ].map(gh));

  const stars = repos.reduce((a, r) => a + r.stargazers_count, 0);
  const forks = repos.reduce((a, r) => a + r.forks_count, 0);
  const contribs = events.filter((e) => e.type === 'PushEvent' || e.type === 'CreateEvent').length;
  const ageYears = Math.max(1, Math.round(
    (Date.now() - new Date(user.created_at).getTime()) / (365.25 * 24 * 3600 * 1000)
  ));

  const langs = {};
  for (const r of repos.slice(0, MAX_LANG_REPOS)) {
    const l = await gh(`/repos/${USER}/${r.name}/languages`);
    for (const [k, v] of Object.entries(l)) langs[k] = (langs[k] || 0) + v;
  }

  fs.writeFileSync(`${OUT}/stats.svg`, statsSvg({
    stars, forks, contribs, repos: user.public_repos, ageYears,
  }));
  fs.writeFileSync(`${OUT}/languages.svg`, langSvg(langs));
  console.log('wrote stats.svg and languages.svg');
}

main();
