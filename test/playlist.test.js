const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("../playlist");

test("parses extended M3U entries and their metadata", () => {
  const channels = parse(`#EXTM3U
#EXTINF:-1 tvg-id="news.br" tvg-logo="https://example.com/logo.png" group-title="Notícias",Canal Notícias HD
https://example.com/live.m3u8
#EXTINF:-1 group-title="Filmes",Filme de exemplo
https://example.com/movie.mp4
#EXTINF:-1 group-title="Séries",Série exemplo S01E01
https://example.com/series/episode`);

  assert.equal(channels.length, 3);
  assert.deepEqual(channels[0], {
    id: "news.br",
    name: "Canal Notícias HD",
    url: "https://example.com/live.m3u8",
    group: "Notícias",
    logo: "https://example.com/logo.png",
    category: "live"
  });
  assert.equal(channels[1].category, "movies");
  assert.equal(channels[2].category, "series");
  assert.equal(channels[2].seriesName, "Série exemplo");
  assert.equal(channels[2].season, 1);
  assert.equal(channels[2].episode, 1);
});

test("handles a BOM, CRLF lines, and missing metadata", () => {
  const channels = parse("\uFEFF#EXTM3U\r\n#EXTINF:-1,Canal sem grupo\r\nhttps://example.com/tv\r\n");
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "Canal sem grupo");
  assert.equal(channels[0].group, "");
  assert.equal(channels[0].category, "live");
});

test("ignores comments and invalid entries without an EXTINF header", () => {
  assert.deepEqual(parse("#EXTM3U\n# comentário\nhttps://example.com/ignored\n#EXTINF:-1,Canal\n#EXTVLCOPT:network-caching=1000\nhttps://example.com/tv"), [
    {
      id: "Canal|https://example.com/tv",
      name: "Canal",
      url: "https://example.com/tv",
      group: "",
      logo: "",
      category: "live"
    }
  ]);
});

test("asynchronous parsing returns the same entries and reports progress", async () => {
  const text = `#EXTM3U\n${Array.from({ length: 8000 }, (_, index) =>
    `#EXTINF:-1 group-title="TV",Canal ${index}\nhttps://example.com/${index}.m3u8`
  ).join("\n")}`;
  const progress = [];
  const channels = await require("../playlist").parseAsync(text, (percent) => progress.push(percent));

  assert.equal(channels.length, 8000);
  assert.deepEqual(channels, parse(text));
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.length > 1);
});

test("extracts series episodes using SxxExx and 1x02 naming", () => {
  const channels = parse(`#EXTM3U
#EXTINF:-1 group-title="VOD/Netflix/Series",Minha Série S02E03 - O retorno
https://example.com/s02e03.mkv
#EXTINF:-1 group-title="Netflix",Outra Série 1x02 - O começo
https://example.com/1x02.mp4
#EXTINF:-1 group-title="Filmes/Netflix",Filme Netflix
https://example.com/movie.mp4`);

  assert.equal(channels[0].category, "series");
  assert.deepEqual(
    [channels[0].seriesName, channels[0].season, channels[0].episode],
    ["Minha Série", 2, 3]
  );
  assert.deepEqual(
    [channels[1].seriesName, channels[1].season, channels[1].episode],
    ["Outra Série", 1, 2]
  );
  assert.equal(channels[2].category, "movies");
});

test("recognizes Portuguese series group names and season/episode labels", () => {
  const channels = parse(`#EXTM3U
#EXTINF:-1 group-title="Séries/Netflix",Série de teste - 2ª Temporada - Episódio 04
https://example.com/teste-s02e04.mkv`);

  assert.equal(channels[0].category, "series");
  assert.equal(channels[0].seriesName, "Série de teste");
  assert.equal(channels[0].season, 2);
  assert.equal(channels[0].episode, 4);
});

test("does not turn off live-buffer latency chasing unless configured for live playback", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /liveBufferLatencyChasing:\s*false/);
  assert.match(renderer, /maxLiveSyncPlaybackRate:\s*1/);
});

test("accepts only valid HTTP playlist URLs", () => {
  const { validateUrl } = require("../playlist");

  assert.equal(validateUrl("http://example.com/list.m3u"), "http://example.com/list.m3u");
  assert.throws(
    () => validateUrl("https://example.com/list.m3u"),
    /Endereços HTTPS não são aceitos/
  );
  assert.throws(() => validateUrl("ftp://example.com/list.m3u"), /Somente endereços HTTP são aceitos/);
  assert.throws(() => validateUrl("não é um link"), /Informe um endereço válido iniciado por http:\/\//);
});

test("detects MPEG-TS and HLS formats in IPTV query URLs and proxy URLs", () => {
  const { streamFormat } = require("../playlist");

  assert.equal(streamFormat("http://iptv.example.com/get.php?username=user&output=ts"), "mpegts");
  assert.equal(streamFormat("http://iptv.example.com/get.php?type=mpegts"), "mpegts");
  assert.equal(streamFormat("http://iptv.example.com/get.php?output=m3u8"), "hls");
  assert.equal(streamFormat("https://player.example.com/api/proxy?token=encrypted&ext=.m3u8"), "hls");
  assert.equal(streamFormat("https://player.example.com/api/proxy?token=encrypted&ext=.ts"), "mpegts");
  assert.equal(streamFormat("https://iptv.example.com/video/movie.mp4"), "unknown");
});

test("preserves stream format hints when IPTV URLs contain multiple output parameters", () => {
  const { proxiedTarget } = require("../api/proxy-utils");
  const secret = "12".repeat(32);
  const hlsProxy = new URL(
    proxiedTarget(
      "http://iptv.example.com/get.php?username=user&type=m3u_plus&output=m3u8",
      "http://iptv.example.com/list.m3u",
      secret
    ),
    "https://player.example.com"
  );
  const tsProxy = new URL(
    proxiedTarget(
      "http://iptv.example.com/get.php?username=user&type=m3u_plus&output=ts",
      "http://iptv.example.com/list.m3u",
      secret
    ),
    "https://player.example.com"
  );

  assert.equal(hlsProxy.searchParams.get("ext"), ".m3u8");
  assert.equal(tsProxy.searchParams.get("ext"), ".ts");
});

test("PWA manifest and app-shell resources are packaged", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const packageConfig = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const installerConfig = packageConfig.build.nsis;
  const shellAssets = [
    "index.html",
    "styles.css",
    "playlist.js",
    "service-worker.js",
    "subtitles.js",
    "renderer.js",
    "manifest.webmanifest",
    "icon.png",
    ...manifest.icons.map((icon) => icon.src),
    "vendor/hls.min.js",
    "vendor/mpegts.js"
  ];

  for (const asset of shellAssets) {
    assert.ok(fs.existsSync(path.join(root, asset)), `Missing PWA asset: ${asset}`);
  }
  assert.match(serviceWorker, /APP_SHELL_URLS\.has\(url\.href\)/);
  assert.match(serviceWorker, /player-m3u-shell-v2/);
  assert.match(packageConfig.build.files.join("\n"), /service-worker\.js/);
  assert.match(packageConfig.build.files.join("\n"), /subtitles\.js/);
  assert.match(packageConfig.build.files.join("\n"), /icons\/\*\*/);
  assert.match(packageConfig.build.files.join("\n"), /vendor\/\*\*/);
  assert.equal(packageConfig.scripts["build:exe"], "electron-builder --win nsis --x64");
  assert.equal(packageConfig.build.win.icon, "icon.ico");
  assert.equal(packageConfig.build.win.target[0].target, "nsis");
  assert.equal(installerConfig.artifactName, "Player M3U.exe");
  assert.equal(installerConfig.createDesktopShortcut, "always");
  assert.equal(installerConfig.createStartMenuShortcut, true);
  assert.equal(installerConfig.installerIcon, "icon.ico");
  assert.equal(installerConfig.uninstallerIcon, "icon.ico");
  assert.equal(packageConfig.version, "1.0.9");
});

test("cleans HTML formatting from subtitle cues without losing the caption", () => {
  const { cleanText } = require("../subtitles");

  assert.equal(
    cleanText("<font color=#FFFF00>Conforme declarações oficiais,</font>"),
    "Conforme declarações oficiais,"
  );
  assert.equal(cleanText("&lt;font color=&quot;yellow&quot;&gt;Legenda&lt;/font&gt;"), "Legenda");
  assert.equal(cleanText("Primeira<br>Segunda"), "Primeira\nSegunda");
});

test("proxy rewrites playlist media, logos, and HLS references without exposing upstream URLs", () => {
  const {
    decodeTarget,
    isPublicIPv4,
    parseAllowedHosts,
    rewritePlaylist,
    validateTarget
  } = require("../api/proxy-utils");
  const secret = "ab".repeat(32);
  const baseUrl = "http://iptv.example.com/lists/main.m3u";
  const source = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-logo="http://cdn.example.com/poster.png",Filme',
    "http://cdn.example.com/video/movie.mp4?user=secret",
    "#EXTINF:-1,Canal",
    "../live/channel.m3u8"
  ].join("\n");
  const rewritten = rewritePlaylist(source, baseUrl, secret);
  const parsed = parse(rewritten);
  const lines = rewritten.split("\n");
  const allowedHosts = parseAllowedHosts("iptv.example.com, cdn.example.com");
  const proxiedMedia = new URL(parsed[0].url, "https://player.example.com");
  const mediaToken = proxiedMedia.searchParams.get("token");

  assert.match(lines[1], /tvg-id="proxy-[\da-f]{32}"/);
  assert.match(lines[1], /tvg-logo="\/api\/proxy\?token=[^"]+&ext=\.png"/);
  assert.equal(parsed[0].category, "movies");
  assert.doesNotMatch(rewritten, /user=secret/);
  assert.equal(decodeTarget(mediaToken, secret).href, "http://cdn.example.com/video/movie.mp4?user=secret");
  assert.match(parsed[1].url, /[?&]ext=\.m3u8$/);
  assert.equal(
    decodeTarget(new URL(parsed[1].url, "https://player.example.com").searchParams.get("token"), secret).href,
    "http://iptv.example.com/live/channel.m3u8"
  );
  assert.equal(validateTarget("http://cdn.example.com/video.mp4", allowedHosts).hostname, "cdn.example.com");
  assert.throws(() => validateTarget("http://unlisted.example.com/list.m3u", allowedHosts), /não está autorizado/);
  assert.throws(() => validateTarget("http://127.0.0.1/list.m3u", parseAllowedHosts("127.0.0.1")), /rede privada/);
  assert.equal(isPublicIPv4("127.0.0.1"), false);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
});

test("proxy preserves stable item IDs and rewrites HLS resources", () => {
  const { decodeTarget, rewritePlaylist } = require("../api/proxy-utils");
  const secret = "cd".repeat(32);
  const baseUrl = "https://iptv.example.com/live/master.m3u8";
  const source = [
    "#EXTM3U",
    "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/key.bin\"",
    "#EXT-X-STREAM-INF:BANDWIDTH=1200000",
    "media/episode.m3u8"
  ].join("\n");
  const output = rewritePlaylist(source, baseUrl, secret, "/api/proxy/", false);
  const keyUri = output.match(/URI="([^"]+)"/)[1];
  const playlistUrl = output.split("\n").at(-1);
  const tokenFor = (value) => new URL(value, "https://player.example.com").searchParams.get("token");

  assert.equal(decodeTarget(tokenFor(keyUri), secret).href, "https://iptv.example.com/live/keys/key.bin");
  assert.equal(decodeTarget(tokenFor(playlistUrl), secret).href, "https://iptv.example.com/live/media/episode.m3u8");
  const segments = rewritePlaylist(
    "#EXTM3U\n#EXTINF:4.0,\nsegment.ts",
    baseUrl,
    secret,
    "/api/proxy/",
    false
  );
  assert.match(segments, /#EXTINF:4\.0,\n\/api\/proxy\?token=/);
  assert.doesNotMatch(segments, /tvg-id/);

  const itemSource = "#EXTM3U\n#EXTINF:-1,Canal\nhttp://iptv.example.com/live/123.ts";
  const first = rewritePlaylist(itemSource, baseUrl, secret).match(/tvg-id="([^"]+)"/)[1];
  const second = rewritePlaylist(itemSource, baseUrl, secret).match(/tvg-id="([^"]+)"/)[1];
  assert.equal(first, second);
});

test("streaming proxy rewrite handles split UTF-8 and M3U lines", async () => {
  const { createPlaylistRewriteStream } = require("../api/proxy-utils");
  const source = Buffer.from(
    "#EXTM3U\n#EXTINF:-1,Canção ao vivo\nhttp://iptv.example.com/live/1.ts\n",
    "utf8"
  );
  const splitAt = source.indexOf(Buffer.from("ç")) + 1;
  const transformer = createPlaylistRewriteStream(
    "http://iptv.example.com/list.m3u",
    "ef".repeat(32),
    "/api/proxy/",
    true
  );
  const output = [];
  transformer.on("data", (chunk) => output.push(chunk));
  transformer.write(source.subarray(0, splitAt));
  transformer.end(source.subarray(splitAt));
  await new Promise((resolve, reject) => {
    transformer.once("end", resolve);
    transformer.once("error", reject);
  });

  const rewritten = Buffer.concat(output).toString("utf8");
  assert.match(rewritten, /#EXTINF:-1 tvg-id="proxy-[\da-f]{32}",Canção ao vivo/);
  assert.match(rewritten, /\/api\/proxy\?token=[^\s]+&ext=\.ts/);
  assert.doesNotMatch(rewritten, /�/);
});
