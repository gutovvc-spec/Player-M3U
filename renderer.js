const STORAGE_KEYS = {
  playlists: "streambox.playlists.v1",
  activePlaylist: "streambox.activePlaylist.v1",
  favorites: "streambox.favorites.v1",
  progress: "streambox.progress.v1",
  userName: "streambox.userName.v1"
};

const palettes = ["#9f76ee", "#d37e8b", "#68a4c5", "#d1a05f", "#6fb49a", "#ac83c9", "#6788cb", "#d47a61"];
const PAGE_SIZE = 120;
const state = {
  playlists: readStorage(STORAGE_KEYS.playlists, []),
  activePlaylistId: readStorage(STORAGE_KEYS.activePlaylist, ""),
  favorites: new Set(readStorage(STORAGE_KEYS.favorites, [])),
  progress: readStorage(STORAGE_KEYS.progress, {}),
  userName: readStorage(STORAGE_KEYS.userName, ""),
  channels: [],
  view: "home",
  category: "all",
  group: "all",
  selectedSeries: "",
  selectedSeason: "all",
  visibleLimit: PAGE_SIZE,
  globalSearch: "",
  groupSearch: "",
  loadingPlaylist: false,
  loadingMessage: "",
  playlistLoadError: "",
  diagnosedPlaylist: null,
  cacheStatus: "",
  cacheStatusUrl: "",
  playing: null,
  hls: null,
  mpegts: null,
  progressTimer: null,
  installPrompt: null,
  subtitleTrackListHandler: null,
  subtitleTrackHandlers: new Map()
};

const elements = {
  playlistModal: document.getElementById("playlist-modal"),
  playlistForm: document.getElementById("playlist-form"),
  playlistName: document.getElementById("playlist-name"),
  playlistUrl: document.getElementById("playlist-url"),
  playlistSubmit: document.getElementById("playlist-submit"),
  forcePlaylistRefresh: document.getElementById("force-playlist-refresh"),
  diagnoseHosts: document.getElementById("diagnose-hosts"),
  domainDiagnosis: document.getElementById("domain-diagnosis"),
  domainDiagnosisSummary: document.getElementById("domain-diagnosis-summary"),
  domainList: document.getElementById("domain-list"),
  removePlaylist: document.getElementById("remove-playlist"),
  removePlaylistInline: document.getElementById("remove-playlist-inline"),
  removePlaylistModal: document.getElementById("remove-playlist-modal"),
  removePlaylistForm: document.getElementById("remove-playlist-form"),
  removePlaylistDescription: document.getElementById("remove-playlist-description"),
  installApp: document.getElementById("install-app"),
  pwaInstallModal: document.getElementById("pwa-install-modal"),
  pwaInstallInstructions: document.getElementById("pwa-install-instructions"),
  globalSearch: document.getElementById("global-search"),
  groupSearch: document.getElementById("group-search"),
  clearGroupSearch: document.getElementById("clear-group-search"),
  welcomeModal: document.getElementById("welcome-modal"),
  welcomeForm: document.getElementById("welcome-form"),
  userName: document.getElementById("user-name"),
  profileButton: document.getElementById("profile-button"),
  heroGreeting: document.getElementById("hero-greeting"),
  modalError: document.getElementById("modal-error"),
  playlistStatus: document.getElementById("playlist-status-text"),
  playlistBanner: document.getElementById("playlist-banner"),
  bannerTitle: document.getElementById("banner-title"),
  bannerSubtitle: document.getElementById("banner-subtitle"),
  mediaGrid: document.getElementById("media-grid"),
  continueGrid: document.getElementById("continue-grid"),
  continueSection: document.getElementById("continue-section"),
  continueCount: document.getElementById("continue-count"),
  emptyState: document.getElementById("empty-state"),
  playerModal: document.getElementById("player-modal"),
  video: document.getElementById("video-player"),
  videoError: document.getElementById("video-error"),
  playerTitle: document.getElementById("player-title"),
  playerGroup: document.getElementById("player-group"),
  playerCategory: document.getElementById("player-category"),
  playerFavorite: document.getElementById("player-favorite")
};

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (error) {
    console.error(`Não foi possível ler os dados locais (${key}).`, error);
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Não foi possível salvar os dados locais (${key}).`, error);
    showError("Não foi possível salvar os dados. Verifique o espaço disponível no dispositivo.");
  }
}

function showError(message) {
  elements.modalError.textContent = message;
}

async function diagnosePlaylistHosts(url) {
  url = Playlist.validateUrl(url);
  let content = state.diagnosedPlaylist?.url === url ? state.diagnosedPlaylist.content : "";
  if (!content && !window.playerApp?.platform) {
    const cached = await getCachedPlaylist(url);
    content = cached?.content || "";
  }
  if (!content) {
    content = await requestPlaylist(url);
    if (!window.playerApp?.platform) cachePlaylist(url, content);
  }
  const hosts = content.match(/^#PLAYER-M3U-HOSTS:(.*)$/m)?.[1]
    .split(",")
    .filter(Boolean) || [];
  const unauthorizedHosts = content.match(/^#PLAYER-M3U-BLOCKED:(.*)$/m)?.[1]
    .split(",")
    .filter(Boolean) || [];
  if (hosts.length === 0) {
    throw new Error("Não foi possível identificar os domínios. Atualize a página e tente novamente.");
  }
  state.diagnosedPlaylist = { url, content };
  return { hosts, unauthorizedHosts };
}

async function getCachedPlaylist(url) {
  if (window.playerApp?.platform) return null;
  try {
    return await PlaylistCache.get(url);
  } catch (error) {
    console.error("Não foi possível ler a cópia local da playlist.", error);
    state.cacheStatus = "failed";
    return null;
  }
}

function cachePlaylist(url, content) {
  if (window.playerApp?.platform) return;
  state.cacheStatus = "saving";
  state.cacheStatusUrl = url;
  PlaylistCache.put(url, content).then(() => {
    state.cacheStatus = "saved";
    if (activePlaylist()?.url === url) render();
  }).catch((error) => {
    console.error("Não foi possível salvar a cópia local da playlist.", error);
    state.cacheStatus = "failed";
    if (activePlaylist()?.url === url) render();
  });
}

function activePlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.activePlaylistId);
}

function openPlaylistModal() {
  elements.modalError.textContent = "";
  const playlist = activePlaylist();
  if (!elements.playlistUrl.value && playlist) {
    elements.playlistName.value = playlist.name;
    elements.playlistUrl.value = playlist.url;
  }
  elements.playlistModal.showModal();
}

function setActivePlaylist(playlist) {
  state.activePlaylistId = playlist.id;
  state.channels = playlist.channels;
  state.category = "all";
  saveStorage(STORAGE_KEYS.activePlaylist, playlist.id);
  render();
}

function savePlaylists() {
  saveStorage(STORAGE_KEYS.playlists, state.playlists.map(({ id, name, url }) => ({ id, name, url })));
}

async function requestPlaylist(url) {
  url = Playlist.validateUrl(url);
  if (window.playerApp?.loadPlaylist) return window.playerApp.loadPlaylist(url);

  let response;
  try {
    response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    console.error("Não foi possível carregar a playlist no navegador.", error);
    throw new Error("Não foi possível acessar o proxy IPTV da web. Confira se a API /api/proxy está publicada na Vercel e tente novamente.");
  }
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `O proxy IPTV retornou o erro HTTP ${response.status}.`);
  }
  return response.text();
}

function mediaPlaybackUrl(url) {
  if (window.playerApp?.platform) return url;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

async function loadPlaylist(url, name, forceRefresh = false) {
  url = Playlist.validateUrl(url);
  state.playlistLoadError = "";
  state.loadingPlaylist = true;
  state.loadingMessage = "Conectando e baixando a playlist...";
  render();
  let content;
  try {
    if (!forceRefresh && state.diagnosedPlaylist?.url === url) {
      content = state.diagnosedPlaylist.content;
      state.loadingMessage = "Organizando os itens...";
    } else {
      const cached = forceRefresh ? null : await getCachedPlaylist(url);
      if (cached) {
        content = cached.content;
        state.cacheStatus = "saved";
        state.cacheStatusUrl = url;
        state.loadingMessage = "Abrindo cópia local...";
      } else {
        content = await requestPlaylist(url);
        cachePlaylist(url, content);
      }
    }
    state.diagnosedPlaylist = null;
  } catch (error) {
    state.loadingPlaylist = false;
    state.loadingMessage = "";
    render();
    const message = error.message?.replace(/^Error invoking remote method '[^']+': Error: /, "");
    throw new Error(message || "Não foi possível carregar a playlist. Confira a conexão e o endereço.");
  }

  state.loadingMessage = "Organizando os itens...";
  const channels = await Playlist.parseAsync(content, (percent) => {
    state.loadingMessage = `Organizando os itens... ${percent}%`;
    elements.playlistSubmit.textContent = state.loadingMessage;
  });
  if (channels.length === 0) {
    state.loadingPlaylist = false;
    state.loadingMessage = "";
    render();
    throw new Error("Nenhum canal encontrado. Confira se o endereço aponta para uma playlist M3U válida.");
  }

  const playlist = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Minha playlist",
    url,
    channels
  };

  const existingIndex = state.playlists.findIndex((entry) => entry.url === url);
  if (existingIndex >= 0) {
    playlist.id = state.playlists[existingIndex].id;
    state.playlists[existingIndex] = playlist;
  } else {
    state.playlists.push(playlist);
  }
  savePlaylists();
  if (window.playerApp?.platform) state.cacheStatus = "";
  if (window.playerApp?.platform) state.cacheStatusUrl = "";
  state.loadingPlaylist = false;
  state.loadingMessage = "";
  setActivePlaylist(playlist);
}

function displayName(name) {
  return name.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function categoryLabel(category) {
  return { live: "AO VIVO", movies: "FILME", series: "SÉRIE" }[category] || "MÍDIA";
}

function normalizeKey(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function groupLabel(group) {
  const parts = group.split(/\s*[|/\\>]\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:tv|live|ao vivo|vod|filmes?|movies?|series?|s[eé]ries?)$/i.test(part));
  return parts.join(" • ") || "Sem grupo";
}

function seriesGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const name = item.seriesName || item.name;
    const key = normalizeKey(name);
    let group = groups.get(key);
    if (!group) {
      group = { key, name, logo: item.logo, group: item.group, episodes: [] };
      groups.set(key, group);
    }
    if (!group.logo && item.logo) group.logo = item.logo;
    group.episodes.push(item);
  }
  for (const group of groups.values()) {
    group.episodes.sort((a, b) => {
      const seasonA = a.season ?? Number.MAX_SAFE_INTEGER;
      const seasonB = b.season ?? Number.MAX_SAFE_INTEGER;
      return seasonA - seasonB || (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function posterColor(item) {
  let hash = 0;
  for (const char of item.name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % palettes.length;
}

function cardMarkup(item, showProgress = false) {
  const isFavorite = state.favorites.has(item.id);
  const progress = state.progress[item.id];
  const percent = progress && progress.duration > 0
    ? Math.min(100, Math.round((progress.time / progress.duration) * 100))
    : 0;
  const poster = item.logo
    ? `<img class="poster-logo" src="${displayName(item.logo)}" alt="${displayName(item.name)}" loading="lazy">`
    : `<span class="poster-symbol">${displayName(item.name.trim().slice(0, 1).toUpperCase())}</span>`;

  return `<article class="media-card" data-play="${displayName(item.id)}">
    <button class="card-favorite${isFavorite ? " saved" : ""}" data-favorite="${displayName(item.id)}" aria-label="${isFavorite ? "Remover dos" : "Adicionar aos"} favoritos">${isFavorite ? "♥" : "♡"}</button>
    <div class="media-poster poster-tone-${posterColor(item)}">
      ${poster}
      <span class="poster-category${item.category === "live" ? " live-badge" : ""}">${categoryLabel(item.category)}</span>
    </div>
    <div class="media-copy"><h3 title="${displayName(item.name)}">${displayName(item.name)}</h3>
      <p>${displayName(item.group || (item.category === "live" ? "Canal de TV" : "Sem categoria"))}</p>
      ${showProgress && percent > 0 ? `<div class="progress-track"><span style="width:${percent}%"></span></div>` : ""}
    </div>
  </article>`;
}

function seriesCardMarkup(group) {
  const representative = { name: group.name, logo: group.logo || "", category: "series" };
  const poster = representative.logo
    ? `<img class="poster-logo" src="${displayName(representative.logo)}" alt="${displayName(group.name)}" loading="lazy">`
    : `<span class="poster-symbol">${displayName(group.name.trim().slice(0, 1).toUpperCase())}</span>`;
  const episodeCount = group.episodes.length;
  const seasons = new Set(group.episodes.map((episode) => episode.season).filter(Number.isFinite));
  const seasonLabel = seasons.size ? `${seasons.size} ${seasons.size === 1 ? "temporada" : "temporadas"}` : "Episódios";

  return `<article class="media-card series-card" data-open-series="${displayName(group.key)}">
    <div class="media-poster poster-tone-${posterColor(representative)}">
      ${poster}
      <span class="poster-category">SÉRIE</span>
    </div>
    <div class="media-copy"><h3 title="${displayName(group.name)}">${displayName(group.name)}</h3>
      <p>${episodeCount} ${episodeCount === 1 ? "episódio" : "episódios"} • ${displayName(seasonLabel)}</p>
      <p>${displayName(groupLabel(group.group))}</p>
    </div>
  </article>`;
}

function openRemovePlaylistDialog() {
  const playlist = activePlaylist();
  if (!playlist || state.loadingPlaylist) return;
  elements.removePlaylistDescription.textContent =
    `A playlist “${playlist.name}”, seus favoritos e seu progresso salvos neste aparelho serão removidos.`;
  elements.removePlaylistModal.showModal();
}

async function activateSavedPlaylist(playlist) {
  state.activePlaylistId = playlist?.id || "";
  state.channels = playlist?.channels || [];
  saveStorage(STORAGE_KEYS.activePlaylist, state.activePlaylistId);
  state.playlistLoadError = "";
  state.loadingPlaylist = false;
  state.loadingMessage = "";
  state.cacheStatus = "";
  state.cacheStatusUrl = "";

  if (!playlist) {
    render();
    return;
  }

  if (state.channels.length > 0) {
    render();
    return;
  }

  state.loadingPlaylist = true;
  state.loadingMessage = "conectando...";
  render();
  try {
    const cached = await getCachedPlaylist(playlist.url);
    const content = cached?.content || await requestPlaylist(playlist.url);
    state.cacheStatus = cached ? "saved" : "";
    state.cacheStatusUrl = cached ? playlist.url : "";
    if (!cached) cachePlaylist(playlist.url, content);
    const channels = await Playlist.parseAsync(content);
    if (channels.length === 0) throw new Error("A playlist salva não contém itens válidos.");
    playlist.channels = channels;
    state.channels = channels;
    savePlaylists();
  } catch (error) {
    console.error("Não foi possível recarregar a playlist salva.", error);
    state.playlistLoadError = error.message || "Confira sua conexão e tente novamente.";
  } finally {
    state.loadingPlaylist = false;
    state.loadingMessage = "";
    render();
  }
}

async function removeActivePlaylist() {
  const playlist = activePlaylist();
  if (!playlist || state.loadingPlaylist) return;
  if (!window.playerApp?.platform) {
    try {
      await PlaylistCache.remove(playlist.url);
    } catch (error) {
      console.error("Não foi possível remover a cópia local da playlist.", error);
      elements.removePlaylistDescription.textContent =
        "Não foi possível apagar a cópia local da playlist. Verifique o armazenamento do navegador e tente novamente.";
      return;
    }
  }

  const removedIds = new Set(state.channels.map((item) => item.id));
  state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
  state.favorites = new Set([...state.favorites].filter((id) => !removedIds.has(id)));
  for (const id of removedIds) delete state.progress[id];

  savePlaylists();
  saveStorage(STORAGE_KEYS.favorites, [...state.favorites]);
  saveStorage(STORAGE_KEYS.progress, state.progress);

  const nextPlaylist = state.playlists[0] || null;
  state.view = "home";
  state.group = "all";
  state.selectedSeries = "";
  state.selectedSeason = "all";
  state.groupSearch = "";
  state.globalSearch = "";
  elements.globalSearch.value = "";
  elements.groupSearch.value = "";
  elements.removePlaylistModal.close();
  activateSavedPlaylist(nextPlaylist);
}

function render() {
  const playlist = activePlaylist();
  elements.playlistStatus.textContent = playlist
    ? `${playlist.name}${state.loadingPlaylist ? ` • ${state.loadingMessage || "carregando..."}` : ""}`
    : "Nenhuma playlist";
  elements.playlistBanner.classList.toggle("hidden", !playlist);
  elements.removePlaylist.classList.toggle("hidden", !playlist);
  elements.removePlaylist.disabled = state.loadingPlaylist;
  elements.removePlaylistInline.classList.toggle("hidden", !playlist);
  elements.bannerTitle.textContent = playlist?.name || "Sua playlist";
  const cacheStatusLabel = state.cacheStatusUrl === playlist?.url ? ({
    saved: " • cópia salva neste aparelho",
    saving: " • salvando cópia local...",
    failed: " • não foi possível salvar a cópia local"
  }[state.cacheStatus] || "") : "";
  elements.bannerSubtitle.textContent = playlist
    ? `${state.channels.length} itens disponíveis${cacheStatusLabel}`
    : "Pronta para explorar";

  const savedProgress = state.channels
    .filter((item) => state.progress[item.id] && state.progress[item.id].time > 10)
    .sort((a, b) => state.progress[b.id].updatedAt - state.progress[a.id].updatedAt)
    .slice(0, 6);
  elements.continueSection.classList.toggle("hidden", savedProgress.length === 0 || state.view === "favorites");
  elements.continueCount.textContent = savedProgress.length ? `${savedProgress.length} ${savedProgress.length === 1 ? "item" : "itens"}` : "";
  elements.continueGrid.innerHTML = savedProgress.slice(0, 12).map((item) => cardMarkup(item, true)).join("");

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  const titles = { home: "Início", live: "TV ao vivo", movies: "Filmes", series: "Séries", favorites: "Minha lista" };
  document.getElementById("current-section").textContent = titles[state.view];
  document.getElementById("browse-title").textContent = state.view === "favorites" ? "Seus favoritos" : titles[state.view] === "Início" ? "Seu conteúdo" : titles[state.view];
  document.getElementById("browse-kicker").textContent = state.view === "favorites" ? "SALVOS NESTE DISPOSITIVO" : state.globalSearch ? "RESULTADOS EM TODA A PLAYLIST" : "EXPLORE SEU CATÁLOGO";

  const allSeries = seriesGroups(state.channels.filter((item) => item.category === "series"));
  let sourceItems = state.channels;
  if (state.globalSearch) {
    sourceItems = sourceItems.filter((item) =>
      `${item.name} ${item.seriesName || ""} ${item.episodeName || ""} ${item.group}`.toLowerCase().includes(state.globalSearch)
    );
  } else {
    if (state.view === "favorites") sourceItems = sourceItems.filter((item) => state.favorites.has(item.id));
    else if (state.view !== "home") sourceItems = sourceItems.filter((item) => item.category === state.view);
  }
  if (state.group !== "all") sourceItems = sourceItems.filter((item) => normalizeKey(groupLabel(item.group)) === state.group);
  if (state.groupSearch) {
    sourceItems = sourceItems.filter((item) =>
      `${item.name} ${item.seriesName || ""} ${item.episodeName || ""} ${item.group}`.toLowerCase().includes(state.groupSearch)
    );
  }

  const seriesMode = state.view !== "favorites" && (Boolean(state.globalSearch) || state.view === "series");
  const seriesItems = seriesMode ? sourceItems.filter((item) => item.category === "series") : [];
  const series = seriesGroups(seriesItems);
  const regularItems = sourceItems.filter((item) => !seriesMode || item.category !== "series");
  const isSeriesDetail = seriesMode && Boolean(state.selectedSeries);
  const selectedSeries = isSeriesDetail ? series.find((item) => item.key === state.selectedSeries) : null;
  if (isSeriesDetail && !selectedSeries) {
    state.selectedSeries = "";
    state.selectedSeason = "all";
  }

  const groupFilterSource = state.globalSearch
    ? state.channels
    : state.view === "favorites"
      ? state.channels.filter((item) => state.favorites.has(item.id))
      : state.view === "home"
        ? state.channels
        : state.channels.filter((item) => item.category === state.view);
  const groupCounts = new Map();
  for (const item of groupFilterSource) {
    const label = groupLabel(item.group);
    groupCounts.set(label, (groupCounts.get(label) || 0) + 1);
  }
  const groupFilters = document.getElementById("group-filters");
  const groupEntries = [...groupCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  document.getElementById("group-sidebar").classList.toggle("hidden", groupEntries.length === 0 || isSeriesDetail);
  document.getElementById("group-count").textContent = groupEntries.length;
  groupFilters.innerHTML = groupEntries.length > 0
    ? `<button class="group-button${state.group === "all" ? " active" : ""}" data-group="all">Todos os grupos<span>${groupFilterSource.length}</span></button>
      ${groupEntries.map(([label, count]) => `<button class="group-button${state.group === normalizeKey(label) ? " active" : ""}" data-group="${displayName(normalizeKey(label))}" title="${displayName(label)}"><span>${displayName(label)}</span><small>${count}</small></button>`).join("")}`
    : "";

  const detailToolbar = document.getElementById("series-detail-toolbar");
  detailToolbar.classList.toggle("hidden", !isSeriesDetail);
  document.getElementById("browse-title").textContent = isSeriesDetail
    ? selectedSeries?.name || "Séries"
    : state.globalSearch ? "Busca na playlist inteira" : state.view === "favorites" ? "Seus favoritos" : titles[state.view] === "Início" ? "Seu conteúdo" : titles[state.view];

  elements.globalSearch.value = state.globalSearch;
  elements.groupSearch.value = state.groupSearch;
  elements.groupSearch.placeholder = state.selectedSeries
    ? "Pesquisar nesta série..."
    : state.group !== "all"
      ? "Pesquisar neste grupo..."
      : `Pesquisar em ${titles[state.view] === "Início" ? "todos os itens" : titles[state.view].toLowerCase()}...`;
  elements.clearGroupSearch.classList.toggle("hidden", !state.groupSearch);
  let visible;
  let visibleMarkup;
  if (isSeriesDetail && selectedSeries) {
    const seasons = [...new Set(selectedSeries.episodes.map((item) => item.season).filter(Number.isFinite))].sort((a, b) => a - b);
    const seasonFilters = document.getElementById("season-filters");
    seasonFilters.innerHTML = seasons.length > 0
      ? `<button class="filter-chip${state.selectedSeason === "all" ? " active" : ""}" data-season="all">Todas</button>${seasons.map((season) => `<button class="filter-chip${state.selectedSeason === season ? " active" : ""}" data-season="${season}">Temporada ${season}</button>`).join("")}`
      : "";
    visible = selectedSeries.episodes.filter((item) => state.selectedSeason === "all" || item.season === state.selectedSeason);
    visibleMarkup = visible.slice(0, state.visibleLimit).map((item) => cardMarkup(item)).join("");
  } else {
    document.getElementById("season-filters").innerHTML = "";
    const entries = [
      ...regularItems.map((item) => ({ type: "item", item })),
      ...series.map((item) => ({ type: "series", item }))
    ].sort((a, b) => a.item.name.localeCompare(b.item.name));
    visible = entries;
    visibleMarkup = entries.slice(0, state.visibleLimit).map((entry) =>
      entry.type === "series" ? seriesCardMarkup(entry.item) : cardMarkup(entry.item)
    ).join("");
  }

  const itemCount = visible.length;
  document.getElementById("item-count").textContent = `${itemCount} ${isSeriesDetail ? "episódios" : seriesMode ? "títulos" : "itens"}`;
  const renderedCount = Math.min(itemCount, state.visibleLimit);
  elements.mediaGrid.innerHTML = visibleMarkup;
  const loadMore = document.getElementById("load-more");
  loadMore.classList.toggle("hidden", itemCount <= renderedCount);
  loadMore.textContent = `Carregar mais (${itemCount - renderedCount} restantes)`;
  elements.mediaGrid.classList.toggle("hidden", itemCount === 0);
  elements.emptyState.classList.toggle("visible", itemCount === 0);
  if (state.view === "favorites" && state.favorites.size === 0) {
    elements.emptyState.querySelector("h3").textContent = "Sua lista está vazia";
    elements.emptyState.querySelector("p").textContent = "Marque o coração nos seus conteúdos para guardá-los aqui.";
  } else if (!playlist) {
    elements.emptyState.querySelector("h3").textContent = "Seu catálogo começa aqui";
    elements.emptyState.querySelector("p").textContent = "Adicione uma playlist M3U para explorar canais, filmes e séries.";
  } else if (state.loadingPlaylist) {
    elements.emptyState.querySelector("h3").textContent = "Carregando sua playlist";
    elements.emptyState.querySelector("p").textContent = "Aguarde enquanto buscamos seus canais, filmes e séries.";
  } else if (state.playlistLoadError) {
    elements.emptyState.querySelector("h3").textContent = "Não foi possível carregar a playlist";
    elements.emptyState.querySelector("p").textContent = state.playlistLoadError;
  } else {
    elements.emptyState.querySelector("h3").textContent = "Nenhum conteúdo encontrado";
    elements.emptyState.querySelector("p").textContent = state.globalSearch || state.groupSearch
      ? "Tente buscar por outro nome."
      : "Não há conteúdo nesta categoria.";
  }
  elements.heroGreeting.textContent = state.userName
    ? `Olá, ${state.userName}! Seus canais, filmes e séries favoritos estão a um play de distância.`
    : "Seus canais, filmes e séries favoritos estão a um play de distância.";
  elements.profileButton.textContent = state.userName.trim().slice(0, 1).toUpperCase() || "V";
  elements.profileButton.title = state.userName || "Player local";
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveStorage(STORAGE_KEYS.favorites, [...state.favorites]);
  render();
  if (state.playing?.id === id) updatePlayerFavorite();
}

function updatePlayerFavorite() {
  if (!state.playing) return;
  const saved = state.favorites.has(state.playing.id);
  elements.playerFavorite.innerHTML = `${saved ? "♥" : "♡"} <span>${saved ? "Na minha lista" : "Favoritar"}</span>`;
}

function savePlaybackProgress() {
  if (!state.playing || state.playing.category === "live") return;
  const time = elements.video.currentTime;
  const duration = elements.video.duration;
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;

  if (time > 10 && time < duration - 10) {
    state.progress[state.playing.id] = { time, duration, updatedAt: Date.now() };
  } else if (time >= duration - 10) {
    delete state.progress[state.playing.id];
  }
  saveStorage(STORAGE_KEYS.progress, state.progress);
}

function clearPlayback() {
  clearInterval(state.progressTimer);
  savePlaybackProgress();
  stopSubtitleCleaning();
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  if (state.mpegts) {
    state.mpegts.destroy();
    state.mpegts = null;
  }
  elements.video.pause();
  elements.video.removeAttribute("src");
  elements.video.load();
  state.playing = null;
}

function sanitizeSubtitleTrack(track) {
  if (track.kind !== "subtitles" && track.kind !== "captions") return;
  const cleanCues = (cues) => {
    if (!cues) return;
    for (const cue of cues) {
      const cleanedText = window.Subtitles.cleanText(cue.text);
      if (cleanedText !== cue.text) cue.text = cleanedText;
    }
  };
  const cueChangeHandler = () => cleanCues(track.activeCues);
  if (!state.subtitleTrackHandlers.has(track)) {
    track.addEventListener("cuechange", cueChangeHandler);
    state.subtitleTrackHandlers.set(track, cueChangeHandler);
  }
  cleanCues(track.cues);
  cleanCues(track.activeCues);
}

function startSubtitleCleaning() {
  const tracks = elements.video.textTracks;
  state.subtitleTrackListHandler = () => {
    for (const track of tracks) sanitizeSubtitleTrack(track);
  };
  tracks.addEventListener("addtrack", state.subtitleTrackListHandler);
  tracks.addEventListener("change", state.subtitleTrackListHandler);
  state.subtitleTrackListHandler();
}

function stopSubtitleCleaning() {
  const tracks = elements.video.textTracks;
  if (state.subtitleTrackListHandler) {
    tracks.removeEventListener("addtrack", state.subtitleTrackListHandler);
    tracks.removeEventListener("change", state.subtitleTrackListHandler);
    state.subtitleTrackListHandler = null;
  }
  for (const [track, handler] of state.subtitleTrackHandlers) {
    track.removeEventListener("cuechange", handler);
  }
  state.subtitleTrackHandlers.clear();
}

function showVideoError(message) {
  elements.videoError.textContent = message;
  elements.videoError.classList.remove("hidden");
}

function playItem(item) {
  clearPlayback();
  startSubtitleCleaning();
  state.playing = item;
  elements.videoError.classList.add("hidden");
  elements.videoError.textContent = "";
  elements.playerTitle.textContent = item.name;
  elements.playerGroup.textContent = item.group || "Sem categoria";
  elements.playerCategory.textContent = categoryLabel(item.category);
  updatePlayerFavorite();
  elements.playerModal.showModal();

  const url = mediaPlaybackUrl(item.url);
  const streamFormat = Playlist.streamFormat(url);
  const isHls = streamFormat === "hls";
  const isMpegTs = streamFormat === "mpegts";
  if (isHls && window.Hls?.isSupported()) {
    state.hls = new window.Hls();
    if (item.category === "live") {
      state.hls.updateSettings({
        lowLatencyMode: false,
        maxLiveSyncPlaybackRate: 1
      });
    }
    state.hls.loadSource(url);
    state.hls.attachMedia(elements.video);
    state.hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        showVideoError("A transmissão HLS não respondeu. Confira se o canal está disponível e se o serviço permite reprodução neste player.");
      } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        state.hls?.recoverMediaError();
      } else {
        showVideoError("O formato desta transmissão HLS não é compatível com o player.");
      }
    });
  } else if (
    (isMpegTs || (item.category === "live" && !isHls && streamFormat === "unknown" && !/\.(?:mp4|m4v|mkv|webm|mp3|aac|ogg)(?:$|[?#])/i.test(url)))
    && window.mpegts?.isSupported()
  ) {
    state.mpegts = window.mpegts.createPlayer({
      type: "mpegts",
      isLive: item.category === "live",
      url,
      cors: true,
      withCredentials: false
    }, {
      enableStashBuffer: true,
      stashInitialSize: 512,
      liveBufferLatencyChasing: false
    });
    state.mpegts.attachMediaElement(elements.video);
    state.mpegts.on(window.mpegts.Events.ERROR, (errorType, errorDetail) => {
      console.error("Falha na reprodução MPEG-TS:", errorType, errorDetail);
      if (state.playing?.id === item.id) {
        showVideoError("A transmissão ao vivo não pôde ser reproduzida. Confira se o canal está ativo e se o serviço permite acesso pelo player.");
      }
    });
    state.mpegts.load();
  } else if (elements.video.canPlayType("application/vnd.apple.mpegurl") || (!isHls && !isMpegTs && item.category !== "live")) {
    elements.video.src = url;
  } else {
    showVideoError("Este dispositivo não oferece suporte ao formato desta transmissão.");
    return;
  }

  elements.video.addEventListener("loadedmetadata", function restorePosition() {
    elements.video.removeEventListener("loadedmetadata", restorePosition);
    const saved = state.progress[item.id];
    if (saved && item.category !== "live" && saved.time < elements.video.duration - 10) {
      elements.video.currentTime = saved.time;
    }
    elements.video.play().catch(() => {
      showVideoError("A reprodução automática foi bloqueada. Pressione play no player para iniciar.");
    });
  });

  elements.video.addEventListener("error", () => {
    if (state.playing?.id === item.id) showVideoError("Não foi possível reproduzir este conteúdo. O link pode estar indisponível ou o formato não ser compatível.");
  }, { once: true });

  state.progressTimer = setInterval(savePlaybackProgress, 5000);
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.category = "all";
    state.group = "all";
    state.globalSearch = "";
    state.groupSearch = "";
    elements.globalSearch.value = "";
    elements.groupSearch.value = "";
    state.selectedSeries = "";
    state.selectedSeason = "all";
    state.visibleLimit = PAGE_SIZE;
    render();
  });
});

document.getElementById("load-more").addEventListener("click", () => {
  state.visibleLimit += PAGE_SIZE;
  render();
});

document.addEventListener("click", (event) => {
  const groupButton = event.target.closest("[data-group]");
  if (groupButton) {
    state.group = groupButton.dataset.group;
    state.selectedSeries = "";
    state.selectedSeason = "all";
    state.visibleLimit = PAGE_SIZE;
    render();
    return;
  }

  const seasonButton = event.target.closest("[data-season]");
  if (seasonButton) {
    state.selectedSeason = seasonButton.dataset.season === "all" ? "all" : Number(seasonButton.dataset.season);
    state.visibleLimit = PAGE_SIZE;
    render();
    return;
  }

  if (event.target.closest("#back-to-series")) {
    state.selectedSeries = "";
    state.selectedSeason = "all";
    state.visibleLimit = PAGE_SIZE;
    render();
    return;
  }

  const seriesCard = event.target.closest("[data-open-series]");
  if (seriesCard) {
    state.selectedSeries = seriesCard.dataset.openSeries;
    state.selectedSeason = "all";
    state.visibleLimit = PAGE_SIZE;
    render();
    return;
  }

  const favoriteButton = event.target.closest("[data-favorite]");
  if (favoriteButton) {
    event.stopPropagation();
    toggleFavorite(favoriteButton.dataset.favorite);
    return;
  }

  const card = event.target.closest("[data-play]");
  if (card) {
    const item = state.channels.find((entry) => entry.id === card.dataset.play);
    if (item) playItem(item);
  }
});
document.addEventListener("error", (event) => {
  if (event.target.matches(".poster-logo")) {
    const fallback = document.createElement("span");
    fallback.className = "poster-symbol";
    fallback.textContent = event.target.alt.trim().slice(0, 1).toUpperCase();
    event.target.replaceWith(fallback);
  }
}, true);

for (const id of ["open-playlist", "hero-add", "empty-add", "change-playlist"]) {
  document.getElementById(id).addEventListener("click", openPlaylistModal);
}
elements.removePlaylist.addEventListener("click", openRemovePlaylistDialog);
elements.removePlaylistInline.addEventListener("click", openRemovePlaylistDialog);
document.getElementById("close-remove-playlist").addEventListener("click", () => elements.removePlaylistModal.close());
document.getElementById("cancel-remove-playlist").addEventListener("click", () => elements.removePlaylistModal.close());
elements.removePlaylistModal.addEventListener("click", (event) => {
  if (event.target === elements.removePlaylistModal) elements.removePlaylistModal.close();
});
elements.removePlaylistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await removeActivePlaylist();
});
document.getElementById("close-modal").addEventListener("click", () => elements.playlistModal.close());
elements.playlistModal.addEventListener("click", (event) => {
  if (event.target === elements.playlistModal) elements.playlistModal.close();
});
if (window.playerApp?.platform) {
  elements.diagnoseHosts.classList.add("hidden");
}
elements.diagnoseHosts.addEventListener("click", async () => {
  elements.diagnoseHosts.disabled = true;
  elements.diagnoseHosts.textContent = "Verificando domínios...";
  elements.modalError.textContent = "";
  elements.domainDiagnosis.classList.add("hidden");
  try {
    const result = await diagnosePlaylistHosts(elements.playlistUrl.value.trim());
    elements.domainList.value = result.hosts.join(",");
    elements.domainDiagnosisSummary.textContent = result.unauthorizedHosts.length
      ? `Domínios que ainda precisam ser autorizados: ${result.unauthorizedHosts.join(", ")}.`
      : "Todos os domínios encontrados já estão autorizados no proxy.";
    elements.domainDiagnosis.classList.remove("hidden");
  } catch (error) {
    showError(error.message || "Não foi possível verificar os domínios da playlist.");
  } finally {
    elements.diagnoseHosts.disabled = false;
    elements.diagnoseHosts.textContent = "Ver domínios necessários";
  }
});
elements.domainList.addEventListener("click", () => elements.domainList.select());
elements.playlistUrl.addEventListener("input", () => {
  state.diagnosedPlaylist = null;
  elements.domainDiagnosis.classList.add("hidden");
});
elements.playlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.playlistSubmit.disabled = true;
  elements.playlistSubmit.textContent = "Conectando e baixando a playlist...";
  showError("");

  try {
    await loadPlaylist(
      elements.playlistUrl.value.trim(),
      elements.playlistName.value,
      elements.forcePlaylistRefresh.checked
    );
    elements.playlistModal.close();
    elements.playlistForm.reset();
    elements.forcePlaylistRefresh.checked = false;
  } catch (error) {
    state.loadingPlaylist = false;
    state.loadingMessage = "";
    showError(error.message);
  } finally {
    state.loadingPlaylist = false;
    state.loadingMessage = "";
    elements.playlistSubmit.disabled = false;
    elements.playlistSubmit.innerHTML = "<span>＋</span> Carregar playlist";
  }
});

elements.globalSearch.addEventListener("input", (event) => {
  state.globalSearch = event.target.value.trim().toLowerCase();
  state.groupSearch = "";
  elements.groupSearch.value = "";
  state.selectedSeries = "";
  state.selectedSeason = "all";
  state.group = "all";
  state.visibleLimit = PAGE_SIZE;
  render();
});
elements.groupSearch.addEventListener("input", (event) => {
  state.groupSearch = event.target.value.trim().toLowerCase();
  state.selectedSeries = "";
  state.selectedSeason = "all";
  state.visibleLimit = PAGE_SIZE;
  render();
});
elements.clearGroupSearch.addEventListener("click", () => {
  state.groupSearch = "";
  state.visibleLimit = PAGE_SIZE;
  render();
  elements.groupSearch.focus();
});

elements.installApp.addEventListener("click", async () => {
  if (state.installPrompt) {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") elements.installApp.classList.add("hidden");
      else {
        elements.pwaInstallInstructions.textContent = "A instalação não foi concluída. Você pode instalar depois pelo menu do navegador.";
        elements.pwaInstallModal.showModal();
      }
    } catch (error) {
      console.error("Não foi possível abrir a instalação do PWA.", error);
      elements.pwaInstallInstructions.textContent = "Não foi possível iniciar a instalação automaticamente. Use o menu do navegador para instalar o aplicativo.";
      elements.pwaInstallModal.showModal();
    }
    return;
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  elements.pwaInstallInstructions.textContent = isIOS
    ? "No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”. Depois confirme em Adicionar."
    : "Abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.";
  elements.pwaInstallModal.showModal();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  elements.installApp.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  elements.installApp.classList.add("hidden");
});
document.getElementById("close-pwa-install").addEventListener("click", () => elements.pwaInstallModal.close());
document.getElementById("confirm-pwa-install").addEventListener("click", () => elements.pwaInstallModal.close());

if (
  !window.playerApp?.platform
  && "serviceWorker" in navigator
  && window.isSecureContext
  && !window.matchMedia("(display-mode: standalone)").matches
  && !navigator.standalone
) {
  elements.installApp.classList.remove("hidden");
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch((error) => console.error("Não foi possível ativar o suporte offline do app.", error));
  }, { once: true });
}

elements.welcomeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.userName.value.trim();
  if (!name) {
    elements.userName.focus();
    return;
  }
  state.userName = name;
  saveStorage(STORAGE_KEYS.userName, name);
  render();
  elements.welcomeModal.close();
});

elements.playerFavorite.addEventListener("click", () => {
  if (state.playing) toggleFavorite(state.playing.id);
});
document.getElementById("close-player").addEventListener("click", () => {
  savePlaybackProgress();
  elements.playerModal.close();
});
elements.playerModal.addEventListener("close", clearPlayback);
elements.playerModal.addEventListener("click", (event) => {
  if (event.target === elements.playerModal) elements.playerModal.close();
});
elements.video.addEventListener("timeupdate", () => {
  if (state.playing?.category !== "live" && elements.video.currentTime > 0) savePlaybackProgress();
});
elements.video.addEventListener("waiting", () => {
  if (state.playing?.category === "live") showVideoError("Aguardando o sinal do canal ao vivo...");
});
elements.video.addEventListener("playing", () => {
  elements.videoError.classList.add("hidden");
});
document.getElementById("hero-play").addEventListener("click", () => {
  const firstItem = state.channels[0];
  if (firstItem) playItem(firstItem);
  else openPlaylistModal();
});

for (const playlist of state.playlists) {
  playlist.channels = Array.isArray(playlist.channels) ? playlist.channels : [];
}
const savedPlaylist = activePlaylist() || state.playlists[state.playlists.length - 1];
if (savedPlaylist) {
  activateSavedPlaylist(savedPlaylist);
} else {
  render();
}
if (!state.userName.trim()) {
  elements.welcomeModal.showModal();
  elements.userName.focus();
}
