(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Playlist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseAttributes(line) {
    const attributes = {};
    const expression = /([\w-]+)="([^"]*)"/g;
    let match;
    while ((match = expression.exec(line)) !== null) {
      attributes[match[1].toLowerCase()] = match[2];
    }
    return attributes;
  }

  function classify(name, group, url) {
    const text = `${name} ${group} ${url}`.toLowerCase();
    if (/\b(?:series?|s[eé]ries?|seriados?|epis[oó]dios?|seasons?)\b/i.test(text) || /\bS\d{1,2}[\s._-]*E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i.test(name)) {
      return "series";
    }
    if (/\b(filmes?|movies?|vod|cinema)\b/.test(text) || /\.(mkv|mp4|avi|mov)(?:[?#]|$)/i.test(url)) {
      return "movies";
    }
    return "live";
  }

  function getEpisodeInfo(name, group) {
    const patterns = [
      /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i,
      /\b(\d{1,2})x(\d{1,3})\b/i,
      /\b(?:season|temporada)\s*(\d{1,2})\s*(?:episode|epis[oó]dio|ep\.?)\s*(\d{1,3})\b/i,
      /\b(\d{1,2})[ªº]?\s*(?:temporada|season)\s*[-_. ]*(?:episode|epis[oó]dio|ep\.?)?\s*(\d{1,3})\b/i
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(name);
      if (!match) continue;
      const seriesName = name.slice(0, match.index).replace(/[\s._|:[\]()-]+$/g, "").trim();
      if (!seriesName) continue;
      return {
        seriesName,
        season: Number(match[1]),
        episode: Number(match[2]),
        episodeName: name.slice(match.index + match[0].length).replace(/^[\s._|:[\]()-]+/g, "").trim()
      };
    }

    if (/\b(series?|seriados?)\b/i.test(group)) {
      return { seriesName: name, season: null, episode: null, episodeName: "" };
    }
    return { seriesName: name, season: null, episode: null, episodeName: "" };
  }

  function createParser() {
    const channels = [];
    let pending = null;

    function processLine(rawLine) {
      const line = rawLine.trim();
      if (!line) return;

      if (line.startsWith("#EXTINF:")) {
        const comma = line.indexOf(",");
        const metadata = comma >= 0 ? line.slice(0, comma) : line;
        pending = {
          attributes: parseAttributes(metadata),
          name: comma >= 0 ? line.slice(comma + 1).trim() : "Sem nome"
        };
        return;
      }

      if (line.startsWith("#") || !pending) return;

      const attributes = pending.attributes;
      const group = attributes["group-title"] || "";
      const name = pending.name || attributes["tvg-name"] || line;
      const id = attributes["tvg-id"] || `${name}|${line}`;
      const category = classify(name, group, line);
      channels.push({
        id,
        name,
        url: line,
        group,
        logo: attributes["tvg-logo"] || "",
        category,
        ...(category === "series" ? getEpisodeInfo(name, group) : {})
      });
      pending = null;
    }

    return { channels, processLine };
  }

  function parse(text) {
    const content = String(text).replace(/^\uFEFF/, "");
    const parser = createParser();
    let start = 0;

    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      const end = newline === -1 ? content.length : newline;
      parser.processLine(content.slice(start, end));
      start = end + 1;
    }

    return parser.channels;
  }

  async function parseAsync(text, onProgress) {
    const content = String(text).replace(/^\uFEFF/, "");
    const parser = createParser();
    let start = 0;
    let processed = 0;
    let nextYield = 256 * 1024;

    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      const end = newline === -1 ? content.length : newline;
      parser.processLine(content.slice(start, end));
      start = end + 1;
      processed = start;

      if (processed >= nextYield) {
        onProgress?.(content.length ? Math.min(100, Math.floor((processed / content.length) * 100)) : 100);
        await new Promise((resolve) => setTimeout(resolve, 0));
        nextYield = processed + 256 * 1024;
      }
    }

    onProgress?.(100);
    return parser.channels;
  }

  function validateUrl(value) {
    let url;
    try {
      url = new URL(String(value).trim());
    } catch {
      throw new Error("Informe um endereço válido iniciado por http://.");
    }
    if (url.protocol === "https:") {
      throw new Error("Endereços HTTPS não são aceitos. Informe um link iniciado por http://.");
    }
    if (url.protocol !== "http:") throw new Error("Somente endereços HTTP são aceitos. Informe um link iniciado por http://.");
    return url.href;
  }

  function streamFormat(value) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      return "unknown";
    }
    const extension = url.pathname.match(/\.([a-z\d]+)$/i)?.[1]?.toLowerCase();
    const hints = ["type", "format", "output", "extension", "container", "ext"]
      .map((name) => (url.searchParams.get(name) || "").toLowerCase().replace(/[^a-z\d]/g, ""));
    if (extension === "m3u8" || extension === "m3u" || hints.some((hint) => ["m3u8", "m3u", "hls"].includes(hint))) return "hls";
    if (["ts", "mpegts", "mpeg"].includes(extension) || hints.some((hint) => ["ts", "mpegts", "mpeg"].includes(hint))) return "mpegts";
    return "unknown";
  }

  return { parse, parseAsync, streamFormat, validateUrl };
});
