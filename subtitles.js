(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Subtitles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function decodeEntity(entity) {
    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\""
    };
    const value = entity.slice(1, -1);
    if (namedEntities[value.toLowerCase()]) return namedEntities[value.toLowerCase()];
    if (value[0] !== "#") return entity;

    const hexadecimal = value[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return entity;
    }
    return String.fromCodePoint(codePoint);
  }

  function cleanText(value) {
    let text = String(value);
    for (let pass = 0; pass < 2; pass += 1) {
      text = text.replace(/&(?:#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity);
    }
    return text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .trim();
  }

  return { cleanText };
});
