export const CSV_COLUMNS = [
  "paper_id",
  "title",
  "author",
  "venue_name",
  "publish_date",
  "year",
  "url",
  "code",
  "code_confidence",
  "abstract",
  "doi",
  "arxiv_id",
  "source",
  "sources",
  "citations",
  "tags",
  "relevance_score",
  "ranking_score",
  "crawl_timestamp"
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type Paper = Record<CsvColumn, string> & {
  topic: string;
};

export type SortKey =
  | "title"
  | "year"
  | "citations"
  | "relevance_score"
  | "ranking_score";

export const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  year: "Year",
  citations: "Citations",
  relevance_score: "Relevance",
  ranking_score: "Ranking"
};

export function toNumber(value: string | number | undefined, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function splitList(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasCode(paper: Paper, includeLow = false) {
  const confidence = paper.code_confidence.toLowerCase();
  if (!paper.code) {
    return false;
  }

  if (includeLow) {
    return ["high", "medium", "low"].includes(confidence);
  }

  return ["high", "medium"].includes(confidence);
}

export function shortenAuthors(authors: string, maxAuthors = 2) {
  const list = splitList(authors.replace(/\band\b/g, ","));

  if (list.length === 0) {
    return "Unknown authors";
  }

  if (list.length <= maxAuthors) {
    return list.join(", ");
  }

  return `${list.slice(0, maxAuthors).join(", ")} et al.`;
}

export function formatNumber(value: string | number | undefined) {
  const number = toNumber(value);
  return new Intl.NumberFormat("en-US").format(number);
}

export function getFoundationScore(paper: Paper, maxCitations: number, maxRelevance: number) {
  const citations = Math.log1p(toNumber(paper.citations));
  const citationBase = maxCitations > 0 ? citations / maxCitations : 0.5;
  const relevanceBase =
    maxRelevance > 0 ? toNumber(paper.relevance_score) / maxRelevance : 0.5;
  const year = toNumber(paper.year, new Date().getFullYear());
  const age = Math.max(0, new Date().getFullYear() - year);
  const ageScore = age >= 3 ? Math.min(1, age / 15) : 0.15;

  return citationBase * 0.45 + relevanceBase * 0.35 + ageScore * 0.2;
}
