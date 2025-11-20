const SUMMARY_URL = 'https://raw.githubusercontent.com/Bitris-Ai/status/main/history/summary.json';
const API_BASE = 'https://raw.githubusercontent.com/Bitris-Ai/status/main/api';
const GRAPH_BASE = 'https://raw.githubusercontent.com/Bitris-Ai/status/main/graphs';
const LIVE_SERVICE_CONFIG = [
  {
    slug: 'bitris-ai-platform',
    name: 'Bitris AI Platform',
    liveUrl: 'https://www.bitris.ai/api/status',
    url: 'https://www.bitris.ai/api/status'
  },
  {
    slug: 'voice-services',
    name: 'Voice Services',
    liveUrl: 'https://www.bitris.ai/api/voice/status',
    url: 'https://www.bitris.ai/api/voice/status'
  },
  {
    slug: 'bitris-web-interface',
    name: 'Bitris Web Interface',
    liveUrl: 'https://www.bitris.ai/api/web-interface/status',
    url: 'https://bitris.ai'
  }
];
const GITHUB_REPO = 'Bitris-Ai/status';
const GITHUB_ISSUES_ENDPOINT = `https://api.github.com/repos/${GITHUB_REPO}/issues`;
const INCIDENT_REPORT_URL = `https://github.com/${GITHUB_REPO}/issues/new?labels=incident`;
const STORAGE_KEYS = {
  githubToken: 'bitris-status-github-token',
  theme: 'bitris-status-theme'
};
const STATUS_REFRESH_INTERVAL = 30_000; // 30s interval for live telemetry polling
const INCIDENT_REFRESH_INTERVAL = 120_000; // keep incidents fresh every 2 minutes

const RANGE_LABEL = {
  day: '24h',
  week: '7d',
  month: '30d',
  year: '1y'
};

const GRAPH_RANGE_MAP = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year'
};

const rangeButtons = document.querySelectorAll('[data-range]');
const filterButtons = document.querySelectorAll('[data-filter]');
const servicesContainer = document.getElementById('services');
const servicesEmpty = document.getElementById('services-empty');
const statusTitle = document.getElementById('status-title');
const statusSubtitle = document.getElementById('status-subtitle');
const statusBanner = document.getElementById('status-banner');
const lastUpdated = document.getElementById('last-updated');
const refreshButton = document.getElementById('refresh-now');
const searchInput = document.getElementById('service-search');
const incidentsMeta = document.getElementById('incidents-meta');
const incidentGroups = document.getElementById('incident-groups');
const githubAuthBtn = document.getElementById('github-auth-btn');
const githubAuthHint = document.getElementById('github-auth-hint');
const incidentModal = document.getElementById('incident-modal');
const incidentForm = document.getElementById('incident-form');
const incidentFormFeedback = document.getElementById('incident-form-feedback');
const openIncidentModalBtn = document.getElementById('open-incident-modal');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleText = document.querySelector('.theme-toggle__text');
const themeToggleIcon = document.querySelector('.theme-toggle__icon');

const insights = {
  availability: document.getElementById('insight-availability'),
  attention: document.getElementById('insight-attention'),
  coverage: document.getElementById('insight-coverage'),
  incidents: document.getElementById('insight-incidents'),
  latency: document.getElementById('insight-latency')
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

let services = [];
let liveTelemetry = new Map();
let currentRange = 'week';
let currentFilter = 'all';
let searchQuery = '';
let incidentsState = { open: 0, maintenance: 0 };
let githubToken = localStorage.getItem(STORAGE_KEYS.githubToken) || '';
let hydrateTimer = null;
let hydrateInFlight = false;
let lastIncidentSync = 0;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateGithubUI();
  registerControls();
  hydrate().finally(startAutoRefresh);
});

function startAutoRefresh() {
  if (hydrateTimer) return;
  hydrateTimer = setInterval(() => {
    hydrate({ reason: 'interval', silent: true });
  }, STATUS_REFRESH_INTERVAL);
}

function initTheme() {
  const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const prefersDark = media?.matches;
  const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light');
  applyTheme(initialTheme);

  themeToggle?.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });

  if (media) {
    const syncSystemPreference = (event) => {
      if (!localStorage.getItem(STORAGE_KEYS.theme)) {
        applyTheme(event.matches ? 'dark' : 'light');
      }
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncSystemPreference);
    } else if (typeof media.addListener === 'function') {
      media.addListener(syncSystemPreference);
    }
  }
}

function applyTheme(theme, persist = false) {
  document.body.dataset.theme = theme;
  if (persist) {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }
  if (themeToggle) {
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  }
  if (themeToggleText) {
    themeToggleText.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }
  if (themeToggleIcon) {
    themeToggleIcon.textContent = theme === 'dark' ? '🌙' : '🌤️';
  }
}

function registerControls() {
  rangeButtons.forEach((btn) =>
    btn.addEventListener('click', () => handleRangeChange(btn.dataset.range))
  );

  filterButtons.forEach((btn) =>
    btn.addEventListener('click', () => handleFilterChange(btn.dataset.filter))
  );

  searchInput?.addEventListener('input', (event) => {
    searchQuery = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  githubAuthBtn?.addEventListener('click', handleGithubAuthToggle);
  refreshButton?.addEventListener('click', () => hydrate({ reason: 'manual-refresh' }));
  openIncidentModalBtn?.addEventListener('click', openIncidentModal);
  incidentModal?.querySelectorAll('[data-close-modal]')?.forEach((node) =>
    node.addEventListener('click', closeIncidentModal)
  );
  incidentForm?.addEventListener('submit', handleIncidentSubmit);
}

async function hydrate(options = {}) {
  const { reason = 'manual', silent = false } = options;
  if (hydrateInFlight) return;
  hydrateInFlight = true;
  const shouldRefreshIncidents = Date.now() - lastIncidentSync >= INCIDENT_REFRESH_INTERVAL;
  try {
    if (!silent || services.length === 0) {
      setServicesPlaceholder('Loading live telemetry…');
    }
    const [summaryData, liveData] = await Promise.all([
      fetchJSON(`${SUMMARY_URL}?t=${Date.now()}`),
      fetchLiveTelemetry()
    ]);
    liveTelemetry = liveData;
    services = mergeServiceData(summaryData, liveData);
    renderServices();
    updateGlobalStatus();
    updateInsights();
    applyFilters();
    await updateRangeMetrics();
    lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()} (${reason})`;
    if (shouldRefreshIncidents) {
      await loadIncidents();
      lastIncidentSync = Date.now();
    }
  } catch (error) {
    console.error('Unable to hydrate status UI', error);
    if (!silent) {
      servicesContainer.innerHTML = getErrorMarkup(error.message);
      servicesEmpty?.setAttribute('hidden', 'hidden');
      document.getElementById('retry')?.addEventListener('click', () => hydrate({ reason: 'retry' }));
      statusTitle.textContent = 'Telemetry unavailable';
      statusSubtitle.textContent = 'We could not reach the monitoring API. Please retry shortly.';
      statusBanner.classList.add('status-warning');
    }
  } finally {
    hydrateInFlight = false;
  }
}

function renderServices() {
  if (!servicesContainer) return;
  servicesContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const sortedServices = [...services].sort((a, b) => {
    if (a.status === b.status) return a.name.localeCompare(b.name);
    return a.status === 'up' ? 1 : -1;
  });

  sortedServices.forEach((service) => {
    const card = document.createElement('article');
    card.className = 'service-card fade-in';
    card.dataset.slug = service.slug;
    card.dataset.status = service.status;
    card.dataset.match = `${service.name} ${service.url}`.toLowerCase();
    const attentionLabel = service.status !== 'up' ? 'attention' : 'up';
    const latencyLabel = service.live?.latency ? formatMs(service.live.latency) : formatMs(service.time);
    const liveMessage = service.live?.message || service.url.replace(/^https?:\/\//, '');
    const statusLabel = service.status === 'up' ? 'Operational' : service.status === 'degraded' ? 'Degraded' : 'Attention';

    card.innerHTML = `
      <header>
        <div>
          <p class="eyebrow">${service.url.replace(/^https?:\/\//, '')}</p>
          <h4>${service.name}</h4>
        </div>
        <span class="status-chip ${attentionLabel}">
          <span class="dot"></span>
          ${statusLabel}
        </span>
      </header>
      <div class="metric-grid">
        <div class="metric">
          <span>Lifetime uptime</span>
          <strong>${service.uptime}</strong>
        </div>
        <div class="metric" data-kind="range">
          <span>${RANGE_LABEL[currentRange]} uptime</span>
          <strong>—</strong>
        </div>
        <div class="metric">
          <span>Avg response</span>
          <strong>${latencyLabel}</strong>
        </div>
      </div>
      <div class="graph-shell">
        <img src="${graphUrl(service.slug)}" alt="${service.name} response-time graph" loading="lazy" />
      </div>
      <footer class="service-footer">
        <p class="muted">${liveMessage}</p>
        <a class="btn ghost" href="https://github.com/${GITHUB_REPO}/issues?q=${service.slug}" target="_blank" rel="noopener">Open incidents ↗</a>
      </footer>
    `;

    fragment.appendChild(card);
  });

  servicesContainer.appendChild(fragment);
}

function updateGlobalStatus() {
  const unhealthy = services.filter((svc) => svc.status !== 'up');
  if (unhealthy.length === 0) {
    statusTitle.textContent = 'All systems operational';
    statusSubtitle.textContent = 'Every Bitris surface is online and meeting SLO targets.';
    statusBanner.classList.remove('status-warning');
  } else {
    statusTitle.textContent = `${unhealthy.length} service${unhealthy.length > 1 ? 's' : ''} require attention`;
    statusSubtitle.textContent = unhealthy.map((svc) => svc.name).join(', ');
    statusBanner.classList.add('status-warning');
  }
}

function updateInsights() {
  if (!services.length) return;
  const uptimeValues = services.map((svc) => parseFloat((svc.uptimeMonth || svc.uptime || '0').replace('%', '')) || 0);
  const avgAvailability = average(uptimeValues);
  setInsightText(insights.availability, isFinite(avgAvailability) ? `${avgAvailability.toFixed(2)}%` : '—');

  const flagged = services.filter((svc) => svc.status !== 'up').length;
  setInsightText(insights.attention, flagged === 0 ? 'All clear' : `${flagged} surface${flagged === 1 ? '' : 's'}`);

  setInsightText(
    insights.coverage,
    `${services.length} surface${services.length === 1 ? '' : 's'}`
  );

  const latencies = services
    .map((svc) => Number(svc.live?.latency ?? svc.time))
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  const medianLatency = latencies.length ? median(latencies) : 0;
  setInsightText(insights.latency, medianLatency ? formatMs(medianLatency) : '—');

  updateIncidentInsight();
}

async function updateRangeMetrics() {
  await Promise.all(
    services.map(async (service) => {
      try {
        const uptimeBadge = await fetchJSON(`${API_BASE}/${service.slug}/uptime-${currentRange}.json?t=${Date.now()}`);
        const card = document.querySelector(`.service-card[data-slug="${service.slug}"]`);
        const metric = card?.querySelector('[data-kind="range"]');
        if (metric) {
          metric.querySelector('span').textContent = `${RANGE_LABEL[currentRange]} uptime`;
          metric.querySelector('strong').textContent = uptimeBadge.message || 'n/a';
        }
        const graph = card?.querySelector('.graph-shell img');
        if (graph) {
          graph.src = graphUrl(service.slug);
        }
      } catch (error) {
        console.warn('Range metric failed', service.slug, error);
      }
    })
  );
}

function handleRangeChange(range) {
  if (!range || range === currentRange) return;
  currentRange = range;
  rangeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.range === range));
  updateRangeMetrics();
}

function handleFilterChange(filter) {
  if (!filter) return;
  currentFilter = filter;
  filterButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === filter));
  applyFilters();
}

function applyFilters() {
  const cards = document.querySelectorAll('.service-card');
  let visible = 0;
  cards.forEach((card) => {
    const matchesQuery = !searchQuery || card.dataset.match?.includes(searchQuery);
    const matchesStatus =
      currentFilter === 'all' ||
      (currentFilter === 'up' && card.dataset.status === 'up') ||
      (currentFilter === 'attention' && card.dataset.status !== 'up');
    const shouldShow = matchesQuery && matchesStatus;
    card.classList.toggle('is-hidden', !shouldShow);
    if (shouldShow) visible += 1;
  });

  if (servicesEmpty) {
    servicesEmpty.hidden = visible !== 0;
  }
}

function setServicesPlaceholder(message) {
  if (!servicesContainer) return;
  servicesContainer.innerHTML = `<p class="muted">${message}</p>`;
}

function setInsightText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

function formatMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '—';
  if (parsed < 1000) return `${Math.round(parsed)} ms`;
  return `${(parsed / 1000).toFixed(2)} s`;
}

function graphUrl(slug) {
  const suffix = GRAPH_RANGE_MAP[currentRange] || 'week';
  return `${GRAPH_BASE}/${slug}/response-time-${suffix}.png?t=${Date.now()}`;
}

function average(values) {
  if (!values.length) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function updateIncidentInsight() {
  const open = incidentsState.open;
  const maintenance = incidentsState.maintenance;
  if (!insights.incidents) return;
  if (open === 0 && maintenance === 0) {
    insights.incidents.textContent = '0 open';
    return;
  }

  const parts = [];
  if (open) parts.push(`${open} incident${open === 1 ? '' : 's'}`);
  if (maintenance) parts.push(`${maintenance} maintenance`);
  insights.incidents.textContent = parts.join(' · ');
}

async function loadIncidents() {
  if (!incidentsMeta || !incidentGroups) return;
  incidentsMeta.textContent = githubToken ? 'Syncing GitHub incidents (authenticated)…' : 'Syncing GitHub incidents…';
  try {
    const [openIncidents, maintenance, recent] = await Promise.all([
      fetchIssuesByAnyLabel(['incident', 'status'], 'open', 8),
      fetchIssuesByAnyLabel(['maintenance'], 'open', 5),
      fetchIssuesByAnyLabel(['incident', 'status'], 'closed', 8)
    ]);

    incidentsState = { open: openIncidents.length, maintenance: maintenance.length };
    renderIncidentGroups({ open: openIncidents, maintenance, recent });
    updateIncidentInsight();
    incidentsMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error('Incident feed failed', error);
    incidentsMeta.textContent = githubToken
      ? 'GitHub API rejected the request. Double-check your token scopes.'
      : 'GitHub rate limited the feed. Connect with a token to continue.';
    incidentGroups.innerHTML = '<p class="muted">Try refreshing or connect GitHub to reload the feed.</p>';
  }
}

async function fetchIssues(query) {
  const response = await fetch(`${GITHUB_ISSUES_ENDPOINT}?${query}`, {
    headers: getGitHubHeaders()
  });
  if (!response.ok) {
    if (response.status === 403 && !githubToken) {
      throw new Error('GitHub rate limit (connect a token to continue).');
    }
    if (response.status === 401) {
      throw new Error('Invalid GitHub token.');
    }
    throw new Error(`GitHub API ${response.status}`);
  }
  return response.json();
}

async function fetchIssuesByAnyLabel(labels = [], state = 'open', perPage = 5) {
  if (!labels.length) return [];
  const requests = labels.map((label) =>
    fetchIssues(`state=${state}&labels=${encodeURIComponent(label)}&per_page=${perPage}`)
  );
  const results = await Promise.all(requests);
  const merged = results.flat();
  return dedupeIssues(merged).sort((a, b) => issueTimestamp(b) - issueTimestamp(a));
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) {
      return false;
    }
    seen.add(issue.id);
    return true;
  });
}

function issueTimestamp(issue) {
  const date = issue?.closed_at || issue?.updated_at || issue?.created_at;
  return date ? new Date(date).getTime() : 0;
}

function renderIncidentGroups({ open = [], maintenance = [], recent = [] }) {
  if (!incidentGroups) return;
  const groups = [
    { title: 'Active incidents', tone: 'warn', items: open, empty: 'No active incidents 🎉', isPast: false },
    { title: 'Scheduled maintenance', tone: 'info', items: maintenance, empty: 'No maintenance windows', isPast: false },
    { title: 'Recent history', tone: 'muted', items: recent, empty: 'No incident history yet', isPast: true }
  ];

  incidentGroups.innerHTML = '';
  groups.forEach((group) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'incident-group';
    const heading = document.createElement('h4');
    heading.textContent = group.title;
    wrapper.appendChild(heading);

    if (!group.items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = group.empty;
      wrapper.appendChild(empty);
    } else {
      group.items.forEach((issue) => wrapper.appendChild(createIncidentCard(issue, group.tone, group.isPast)));
    }

    incidentGroups.appendChild(wrapper);
  });
}

function createIncidentCard(issue, tone, isPast) {
  const card = document.createElement('article');
  card.className = 'incident-card';

  const title = document.createElement('h5');
  title.textContent = issue.title;
  card.appendChild(title);

  const summary = document.createElement('p');
  summary.textContent = parseIssueSummary(issue.body);
  card.appendChild(summary);

  const meta = document.createElement('div');
  meta.className = 'incident-meta';

  const tag = document.createElement('span');
  tag.className = `tag ${tone}`;
  tag.textContent = isPast ? 'Resolved' : issue.state === 'open' ? 'Open' : 'Scheduled';
  meta.appendChild(tag);

  const timestamp = isPast ? issue.closed_at || issue.updated_at : issue.created_at;
  const timeText = timestamp ? `${formatDateTime(timestamp)} • ${relativeTimeFrom(timestamp)}` : '—';
  const time = document.createElement('span');
  time.textContent = timeText;
  meta.appendChild(time);

  const link = document.createElement('a');
  link.href = issue.html_url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Details ↗';
  meta.appendChild(link);

  card.appendChild(meta);
  return card;
}

function parseIssueSummary(body = '') {
  const sanitized = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
    .trim();
  const firstLine = sanitized.split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine || 'See GitHub for the full write-up.';
}

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch (error) {
    return value;
  }
}

function relativeTimeFrom(value) {
  if (!value) return '';
  const divisions = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' }
  ];

  let duration = (new Date(value).getTime() - Date.now()) / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return relativeTimeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return '';
}

function getErrorMarkup(message) {
  return `<div class="error">
      <strong>Unable to load data.</strong>
      <p>${message}</p>
      <button id="retry">Retry</button>
    </div>`;
}

function handleGithubAuthToggle() {
  if (!githubAuthBtn) return;
  if (githubToken) {
    const confirmDisconnect = window.confirm('Disconnect GitHub token from this browser?');
    if (!confirmDisconnect) return;
    githubToken = '';
    localStorage.removeItem(STORAGE_KEYS.githubToken);
    updateGithubUI();
    loadIncidents().finally(() => {
      lastIncidentSync = Date.now();
    });
    return;
  }

  const tokenInput = window.prompt(
    'Paste a GitHub Personal Access Token with repo or public_repo scope. It will be stored locally only.'
  );
  if (!tokenInput) return;
  const cleaned = tokenInput.trim();
  if (!cleaned) return;
  githubToken = cleaned;
  localStorage.setItem(STORAGE_KEYS.githubToken, githubToken);
  updateGithubUI();
  loadIncidents().finally(() => {
    lastIncidentSync = Date.now();
  });
}

function updateGithubUI() {
  if (githubAuthBtn) {
    githubAuthBtn.textContent = githubToken ? 'Disconnect GitHub' : 'Connect GitHub';
  }
  if (githubAuthHint) {
    githubAuthHint.textContent = githubToken
      ? 'Authenticated with GitHub. Token never leaves this browser.'
      : 'Connect with a GitHub token to avoid rate limits and fetch private incidents. Tokens stay in your browser only.';
  }
}

function getGitHubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  return headers;
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

async function fetchLiveTelemetry() {
  const timestamp = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();
  const results = await Promise.allSettled(
    LIVE_SERVICE_CONFIG.map(async (service) => {
      const start = timestamp();
      const response = await fetch(service.liveUrl, { cache: 'no-store' });
      const latency = timestamp() - start;
      let payload = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }
      return {
        slug: service.slug,
        ok: response.ok,
        status: payload.status || (response.ok ? 'up' : 'down'),
        message: payload.message || payload.description || response.statusText,
        latency,
        updatedAt: payload.updatedAt || new Date().toISOString()
      };
    })
  );

  const map = new Map();
  results.forEach((result, index) => {
    const config = LIVE_SERVICE_CONFIG[index];
    if (result.status === 'fulfilled') {
      map.set(config.slug, result.value);
    } else {
      map.set(config.slug, {
        slug: config.slug,
        status: 'unknown',
        message: 'Live probe unavailable',
        latency: NaN,
        updatedAt: new Date().toISOString()
      });
    }
  });
  return map;
}

function mergeServiceData(summary = [], liveMap = new Map()) {
  const summaryBySlug = new Map(summary.map((svc) => [svc.slug, svc]));
  return LIVE_SERVICE_CONFIG.map((svc) => {
    const summaryEntry = summaryBySlug.get(svc.slug) || {};
    const liveEntry = liveMap.get(svc.slug);
    const status = normalizeStatus(liveEntry?.status || summaryEntry.status || 'unknown');
    return {
      ...summaryEntry,
      ...svc,
      live: liveEntry,
      status,
      uptime: summaryEntry.uptime || liveEntry?.uptime || '—',
      uptimeMonth: summaryEntry.uptimeMonth || summaryEntry.uptime,
      time: summaryEntry.time || liveEntry?.latency || 0,
      url: summaryEntry.url || svc.url
    };
  });
}

function normalizeStatus(status = 'unknown') {
  const normalized = status.toLowerCase();
  if (normalized.includes('degrad')) return 'degraded';
  if (normalized.includes('down') || normalized.includes('incident')) return 'down';
  if (normalized.includes('attention') || normalized.includes('maintenance')) return 'attention';
  if (normalized.includes('up')) return 'up';
  return 'attention';
}

function openIncidentModal() {
  if (!incidentModal) return;
  incidentModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeIncidentModal() {
  if (!incidentModal) return;
  incidentModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  incidentForm?.reset();
  if (incidentFormFeedback) incidentFormFeedback.textContent = '';
}

async function handleIncidentSubmit(event) {
  event.preventDefault();
  if (!incidentForm || !incidentFormFeedback) return;
  if (!githubToken) {
    incidentFormFeedback.textContent = 'Connect GitHub to submit incidents.';
    incidentFormFeedback.style.color = 'var(--danger)';
    return;
  }
  const formData = new FormData(incidentForm);
  const title = formData.get('title')?.toString().trim();
  const service = formData.get('service')?.toString();
  const impact = formData.get('impact')?.toString();
  const bodyInput = formData.get('body')?.toString().trim();
  if (!title || !service || !impact || !bodyInput) {
    incidentFormFeedback.textContent = 'Fill every field before submitting.';
    incidentFormFeedback.style.color = 'var(--danger)';
    return;
  }
  incidentFormFeedback.textContent = 'Submitting to GitHub…';
  incidentFormFeedback.style.color = 'var(--text-muted)';
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        ...getGitHubHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        body: buildIncidentBody({ title, service, impact, body: bodyInput }),
        labels: ['incident', service, impact]
      })
    });
    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}`);
    }
    incidentFormFeedback.textContent = 'Incident logged successfully.';
    incidentFormFeedback.style.color = 'var(--success)';
    incidentForm.reset();
    setTimeout(() => {
      closeIncidentModal();
      loadIncidents();
    }, 1200);
  } catch (error) {
    incidentFormFeedback.textContent = error.message;
    incidentFormFeedback.style.color = 'var(--danger)';
  }
}

function buildIncidentBody({ title, service, impact, body }) {
  return `### Service
${service}

### Impact
${impact}

### Details
${body}

---
Submitted via Bitris Status UI at ${new Date().toISOString()}`;
}
