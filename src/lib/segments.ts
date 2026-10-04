/**
 * Splits an assistant answer ("text [[q:0]] , [[q:1]] and more") into text and quote segments for display.
 * Quote cards are block elements, so connector-only fragments left between them ("," / ", and" / ".")
 * would render as stray lines. We drop those and trim punctuation that now dangles after a card.
 */
export type Segment = { type: "text"; text: string } | { type: "quote"; id: number };

const CONNECTOR_ONLY = /^(?:(?:and|or|but)\W*)?$/i;

export function segmentContent(content: string): Segment[] {
  const out: Segment[] = [];
  for (const part of content.split(/(\[\[q:\d+\]\])/g)) {
    const m = part.match(/^\[\[q:(\d+)\]\]$/);
    if (m) { out.push({ type: "quote", id: Number(m[1]) }); continue; }
    if (out.length && out[out.length - 1].type === "quote") {
      const text = part.replace(/^[\s,.;:]+/, "");        // punctuation that used to follow the quote inline
      if (CONNECTOR_ONLY.test(text.trim())) continue;     // nothing left but "and"/"," -> drop
      out.push({ type: "text", text });
    } else if (part) {
      out.push({ type: "text", text: part });
    }
  }
  return out;
}
