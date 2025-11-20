const SUMMARY_URL = 'https://raw.githubusercontent.com/Bitris-Ai/status/master/history/summary.json';
const API_BASE = 'https://raw.githubusercontent.com/Bitris-Ai/status/master/api';
const GRAPH_BASE = 'https://raw.githubusercontent.com/Bitris-Ai/status/master/graphs';
const GITHUB_REPO = 'Bitris-Ai/status';
const GITHUB_ISSUES_ENDPOINT = `https://api.github.com/repos/${GITHUB_REPO}/issues`;
const INCIDENT_REPORT_URL = `https://github.com/${GITHUB_REPO}/issues/new?labels=incident`;
const STORAGE_KEYS = {
  githubToken: 'bitris-status-github-token'
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
const searchInput = document.getElementById('service-search');
const incidentsMeta = document.getElementById('incidents-meta');
const incidentGroups = document.getElementById('incident-groups');
const githubAuthBtn = document.getElementById('github-auth-btn');
const githubAuthHint = document.getElementById('github-auth-hint');
const reportIncidentLink = document.getElementById('report-incident');

const insights = {
  availability: document.getElementById('insight-availability'),
  attention: document.getElementById('insight-attention'),
  coverage: document.getElementById('insight-coverage'),
  incidents: document.getElementById('insight-incidents'),
  latency: document.getElementById('insight-latency')
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

let services = [];
let currentRange = 'week';
let currentFilter = 'all';
let searchQuery = '';
let incidentsState = { open: 0, maintenance: 0 };
let githubToken = localStorage.getItem(STORAGE_KEYS.githubToken) || '';
let hydrateTimer = null;
let hydrateInFlight = false;
let lastIncidentSync = 0;

document.addEventListener('DOMContentLoaded', () => {
  if (reportIncidentLink) {
    reportIncidentLink.href = INCIDENT_REPORT_URL;
  }
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
    services = await fetchJSON(`${SUMMARY_URL}?t=${Date.now()}`);
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

    card.innerHTML = `
      <header>
        <div>
          <p class="eyebrow">${service.url.replace(/^https?:\/\//, '')}</p>
          <h4>${service.name}</h4>
        </div>
        <span class="status-chip ${service.status}">
          <span class="dot"></span>
          ${service.status === 'up' ? 'Operational' : 'Attention'}
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
          <strong>${formatMs(service.time)}</strong>
        </div>
      </div>
      <div class="graph-shell">
        <img src="${graphUrl(service.slug)}" alt="${service.name} response-time graph" loading="lazy" />
      </div>
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

  const latencies = services.map((svc) => Number(svc.time)).filter((ms) => Number.isFinite(ms) && ms > 0);
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
      fetchIssues('state=open&labels=incident&per_page=5'),
      fetchIssues('state=open&labels=maintenance&per_page=5'),
      fetchIssues('state=closed&labels=incident&per_page=5')
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
