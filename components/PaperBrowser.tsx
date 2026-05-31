"use client";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Database,
  Download,
  ExternalLink,
  Filter,
  Github,
  Layers3,
  Search,
  Trophy
} from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";

import {
  CSV_COLUMNS,
  Paper,
  SORT_LABELS,
  SortKey,
  formatNumber,
  getFoundationScore,
  hasCode,
  shortenAuthors,
  splitList,
  toNumber
} from "@/lib/papers";
import { DEFAULT_TOPIC, TOPICS, TopicKey, getTopic } from "@/lib/topics";

type CodeFilter = "all" | "with_code" | "trusted_code" | "no_code";
type ViewMode = "browser" | "rankings";
type RankMode =
  | "top"
  | "relevant"
  | "recent"
  | "cited"
  | "foundational"
  | "code"
  | "tags";

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const PAGE_SIZES = [10, 25, 50, 100];
const SEARCH_FIELDS = [
  "title",
  "author",
  "venue_name",
  "abstract",
  "tags",
  "source",
  "sources"
] as const;

const RANK_MODES: Array<{ key: RankMode; label: string }> = [
  { key: "top", label: "Top Ranked" },
  { key: "relevant", label: "Most Relevant" },
  { key: "recent", label: "Recent Papers" },
  { key: "cited", label: "Most Cited" },
  { key: "foundational", label: "Foundational Papers" },
  { key: "code", label: "Papers with Code" },
  { key: "tags", label: "By Topic Tags" }
];

function cleanCsvRow(row: Partial<Paper>, topic: TopicKey): Paper {
  return CSV_COLUMNS.reduce(
    (paper, column) => {
      paper[column] = String(row[column] ?? "").trim();
      return paper;
    },
    { topic } as Paper
  );
}

function getPaperDateValue(paper: Paper) {
  const publishDate = paper.publish_date.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(publishDate)) {
    const time = new Date(`${publishDate}T00:00:00Z`).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  return toNumber(paper.year) * 1000;
}

function sortPapers(papers: Paper[], sortKey: SortKey, direction: "asc" | "desc") {
  const sorted = [...papers].sort((a, b) => {
    if (sortKey === "title") {
      return a.title.localeCompare(b.title);
    }

    const valueA = toNumber(a[sortKey]);
    const valueB = toNumber(b[sortKey]);
    return valueA - valueB;
  });

  return direction === "asc" ? sorted : sorted.reverse();
}

function getSourceLabel(paper: Paper) {
  return paper.sources || paper.source || "unknown";
}

function getScoreLabel(value: string) {
  const numeric = toNumber(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

export function PaperBrowser() {
  const [topicKey, setTopicKey] = useState<TopicKey>(DEFAULT_TOPIC);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("browser");
  const [rankMode, setRankMode] = useState<RankMode>("top");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("ranking_score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const activeTopic = getTopic(topicKey);

  useEffect(() => {
    let alive = true;

    async function loadPapers() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${BASE_PATH}/data/${activeTopic.csvFile}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`Could not load ${activeTopic.csvFile}`);
        }

        const text = await response.text();
        const parsed = Papa.parse<Partial<Paper>>(text, {
          header: true,
          skipEmptyLines: "greedy"
        });
        const nextPapers = parsed.data
          .map((row) => cleanCsvRow(row, topicKey))
          .filter((paper) => paper.paper_id || paper.title);

        if (alive) {
          setPapers(nextPapers);
        }
      } catch (nextError) {
        if (alive) {
          setPapers([]);
          setError(nextError instanceof Error ? nextError.message : "Could not load paper data");
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    loadPapers();

    return () => {
      alive = false;
    };
  }, [activeTopic.csvFile, topicKey]);

  useEffect(() => {
    setPage(1);
    setExpandedRows(new Set());
  }, [topicKey, search, yearFilter, sourceFilter, tagFilter, codeFilter, sortKey, sortDirection, pageSize]);

  const yearOptions = useMemo(
    () =>
      Array.from(new Set(papers.map((paper) => paper.year).filter(Boolean))).sort(
        (a, b) => toNumber(b) - toNumber(a)
      ),
    [papers]
  );

  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(papers.map(getSourceLabel).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [papers]
  );

  const tagOptions = useMemo(
    () =>
      Array.from(new Set(papers.flatMap((paper) => splitList(paper.tags)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [papers]
  );

  const filteredPapers = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return papers.filter((paper) => {
      const matchesSearch =
        !needle ||
        SEARCH_FIELDS.some((field) => paper[field].toLowerCase().includes(needle));
      const matchesYear = yearFilter === "all" || paper.year === yearFilter;
      const matchesSource =
        sourceFilter === "all" || getSourceLabel(paper).toLowerCase() === sourceFilter.toLowerCase();
      const paperTags = splitList(paper.tags);
      const matchesTag = tagFilter === "all" || paperTags.includes(tagFilter);
      const matchesCode =
        codeFilter === "all" ||
        (codeFilter === "with_code" && hasCode(paper, true)) ||
        (codeFilter === "trusted_code" && hasCode(paper)) ||
        (codeFilter === "no_code" && !paper.code);

      return matchesSearch && matchesYear && matchesSource && matchesTag && matchesCode;
    });
  }, [codeFilter, papers, search, sourceFilter, tagFilter, yearFilter]);

  const sortedPapers = useMemo(
    () => sortPapers(filteredPapers, sortKey, sortDirection),
    [filteredPapers, sortDirection, sortKey]
  );

  const pageCount = Math.max(1, Math.ceil(sortedPapers.length / pageSize));
  const visiblePapers = sortedPapers.slice((page - 1) * pageSize, page * pageSize);

  const maxLogCitations = useMemo(
    () => Math.max(...papers.map((paper) => Math.log1p(toNumber(paper.citations))), 0),
    [papers]
  );
  const maxRelevance = useMemo(
    () => Math.max(...papers.map((paper) => toNumber(paper.relevance_score)), 0),
    [papers]
  );

  const rankingItems = useMemo(() => {
    if (rankMode === "tags") {
      return [];
    }

    const base = [...papers];

    if (rankMode === "code") {
      return base
        .filter((paper) => hasCode(paper))
        .sort((a, b) => toNumber(b.ranking_score) - toNumber(a.ranking_score))
        .slice(0, 20);
    }

    if (rankMode === "foundational") {
      return base
        .sort(
          (a, b) =>
            getFoundationScore(b, maxLogCitations, maxRelevance) -
            getFoundationScore(a, maxLogCitations, maxRelevance)
        )
        .slice(0, 20);
    }

    if (rankMode === "recent") {
      return base.sort((a, b) => getPaperDateValue(b) - getPaperDateValue(a)).slice(0, 20);
    }

    if (rankMode === "cited") {
      return base.sort((a, b) => toNumber(b.citations) - toNumber(a.citations)).slice(0, 20);
    }

    if (rankMode === "relevant") {
      return base
        .sort((a, b) => toNumber(b.relevance_score) - toNumber(a.relevance_score))
        .slice(0, 20);
    }

    return base.sort((a, b) => toNumber(b.ranking_score) - toNumber(a.ranking_score)).slice(0, 20);
  }, [maxLogCitations, maxRelevance, papers, rankMode]);

  const tagGroups = useMemo(() => {
    const groups = new Map<string, Paper[]>();

    papers.forEach((paper) => {
      splitList(paper.tags).forEach((tag) => {
        groups.set(tag, [...(groups.get(tag) ?? []), paper]);
      });
    });

    return Array.from(groups.entries())
      .map(([tag, rows]) => ({
        tag,
        rows: rows.sort((a, b) => toNumber(b.ranking_score) - toNumber(a.ranking_score)),
        averageRelevance:
          rows.reduce((sum, paper) => sum + toNumber(paper.relevance_score), 0) /
          Math.max(1, rows.length)
      }))
      .sort((a, b) => b.rows.length - a.rows.length || b.averageRelevance - a.averageRelevance);
  }, [papers]);

  function exportCsv() {
    const rows = sortedPapers.map((paper) =>
      CSV_COLUMNS.reduce<Record<string, string>>((row, column) => {
        row[column] = paper[column];
        return row;
      }, {})
    );
    const csv = Papa.unparse(rows, { columns: [...CSV_COLUMNS] });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${topicKey}_papers.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleRow(paperId: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-panel/88 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-line bg-wash px-3 py-1 text-sm font-medium text-muted">
                <Database aria-hidden="true" size={16} />
                TrustFed by Lucaz
              </div>
              <h1 className="text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
                Influence Tracing Research Papers
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
                Browse and rank research papers on influence tracing, continual learning,
                federated learning, and federated continual learning.
              </p>
            </div>

            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
              {TOPICS.map((topic) => (
                <button
                  key={topic.key}
                  type="button"
                  aria-pressed={topic.key === topicKey}
                  onClick={() => setTopicKey(topic.key)}
                  className={`rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
                    topic.key === topicKey
                      ? "border-teal bg-teal text-white"
                      : "border-line bg-panel text-ink hover:border-teal hover:text-teal"
                  }`}
                >
                  {topic.shortName}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">{activeTopic.displayName}</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">{activeTopic.description}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Layers3 aria-hidden="true" size={18} className="text-teal" />
              <span>
                <strong className="text-ink">{papers.length}</strong> papers in topic
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-full rounded-md border border-line bg-panel p-1 sm:w-auto">
            {(["browser", "rankings"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`flex-1 rounded px-4 py-2 text-sm font-semibold capitalize sm:flex-none ${
                  viewMode === mode ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={sortedPapers.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 py-2 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download aria-hidden="true" size={18} />
            Export CSV
          </button>
        </div>

        {viewMode === "browser" ? (
          <>
            <section className="mb-5 rounded-md border border-line bg-panel p-4 shadow-soft">
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(6,minmax(130px,auto))]">
                <label className="relative block">
                  <span className="sr-only">Search papers</span>
                  <Search
                    aria-hidden="true"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search title, author, venue, abstract, tags"
                    className="h-11 w-full rounded-md border border-line bg-white pl-10 pr-3 text-sm text-ink"
                  />
                </label>

                <FilterSelect label="Year" value={yearFilter} onChange={setYearFilter}>
                  <option value="all">All years</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </FilterSelect>

                <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter}>
                  <option value="all">All sources</option>
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </FilterSelect>

                <FilterSelect label="Tag" value={tagFilter} onChange={setTagFilter}>
                  <option value="all">All tags</option>
                  {tagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </FilterSelect>

                <FilterSelect
                  label="Code"
                  value={codeFilter}
                  onChange={(value) => setCodeFilter(value as CodeFilter)}
                >
                  <option value="all">All code</option>
                  <option value="trusted_code">High/medium code</option>
                  <option value="with_code">Any code</option>
                  <option value="no_code">No code</option>
                </FilterSelect>

                <FilterSelect
                  label="Sort"
                  value={sortKey}
                  onChange={(value) => setSortKey(value as SortKey)}
                >
                  {Object.entries(SORT_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </FilterSelect>

                <div className="flex gap-2">
                  <button
                    type="button"
                    title="Toggle sort direction"
                    onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-muted hover:border-teal hover:text-teal"
                  >
                    {sortDirection === "asc" ? (
                      <ArrowDownAZ aria-hidden="true" size={18} />
                    ) : (
                      <ArrowUpAZ aria-hidden="true" size={18} />
                    )}
                  </button>
                  <FilterSelect
                    label="Page size"
                    value={String(pageSize)}
                    onChange={(value) => setPageSize(Number(value))}
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </FilterSelect>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-line bg-panel shadow-soft">
              <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Filter aria-hidden="true" size={17} className="text-coral" />
                  <span>
                    Showing <strong className="text-ink">{sortedPapers.length}</strong> of{" "}
                    <strong className="text-ink">{papers.length}</strong> papers
                  </span>
                </div>
                <Pagination page={page} pageCount={pageCount} setPage={setPage} />
              </div>

              {loading ? (
                <StateBlock title="Loading paper data" body="Reading CSV metadata for the selected topic." />
              ) : error ? (
                <StateBlock title="Paper data is unavailable" body={error} />
              ) : papers.length === 0 ? (
                <StateBlock
                  title="No paper data yet"
                  body="Run python scripts/crawl_papers.py --all to generate paper data."
                />
              ) : sortedPapers.length === 0 ? (
                <StateBlock title="No matching papers" body="Adjust the search or filters." />
              ) : (
                <div className="paper-scroll overflow-x-auto">
                  <table className="min-w-[1080px] table-fixed border-collapse text-left text-sm">
                    <thead className="bg-wash text-xs uppercase tracking-normal text-muted">
                      <tr>
                        <th className="w-[34%] px-4 py-3 font-semibold">Paper</th>
                        <th className="w-[18%] px-4 py-3 font-semibold">Authors</th>
                        <th className="w-[16%] px-4 py-3 font-semibold">Venue</th>
                        <th className="w-[9%] px-4 py-3 font-semibold">Citations</th>
                        <th className="w-[13%] px-4 py-3 font-semibold">Scores</th>
                        <th className="w-[10%] px-4 py-3 font-semibold">Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePapers.map((paper) => {
                        const rowId = paper.paper_id || paper.title;
                        const expanded = expandedRows.has(rowId);

                        return (
                          <tr key={rowId} className="border-t border-line align-top">
                            <td className="px-4 py-4">
                              <div className="space-y-3">
                                <a
                                  href={paper.url || undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold leading-6 text-ink hover:text-teal"
                                >
                                  {paper.title || "Untitled paper"}
                                </a>
                                <TagList tags={splitList(paper.tags)} />
                                {paper.abstract ? (
                                  <div className="text-sm leading-6 text-muted">
                                    <p className={expanded ? "" : "line-clamp-2"}>{paper.abstract}</p>
                                    <button
                                      type="button"
                                      onClick={() => toggleRow(rowId)}
                                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-teal"
                                    >
                                      {expanded ? (
                                        <>
                                          <ChevronUp aria-hidden="true" size={16} />
                                          Collapse
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown aria-hidden="true" size={16} />
                                          Expand
                                        </>
                                      )}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-muted">{shortenAuthors(paper.author, 3)}</td>
                            <td className="px-4 py-4">
                              <div className="font-medium text-ink">{paper.venue_name || "Unknown venue"}</div>
                              <div className="mt-1 text-muted">{paper.publish_date || paper.year || "No date"}</div>
                              <div className="mt-1 text-xs text-muted">{getSourceLabel(paper)}</div>
                            </td>
                            <td className="px-4 py-4 text-ink">{formatNumber(paper.citations)}</td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-2">
                                <ScorePill label="Rel" value={getScoreLabel(paper.relevance_score)} />
                                <ScorePill label="Rank" value={getScoreLabel(paper.ranking_score)} tone="gold" />
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-2">
                                {paper.url ? (
                                  <IconLink href={paper.url} label="Open paper">
                                    <ExternalLink aria-hidden="true" size={17} />
                                  </IconLink>
                                ) : null}
                                {paper.code ? (
                                  <IconLink href={paper.code} label={`Open code (${paper.code_confidence})`}>
                                    <Github aria-hidden="true" size={17} />
                                  </IconLink>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted">
                  Page {page} of {pageCount}
                </span>
                <Pagination page={page} pageCount={pageCount} setPage={setPage} />
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-coral">
                  <Trophy aria-hidden="true" size={18} />
                  Rankings
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-ink">{RANK_MODES.find((mode) => mode.key === rankMode)?.label}</h2>
              </div>

              <div className="paper-scroll flex gap-2 overflow-x-auto pb-1">
                {RANK_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setRankMode(mode.key)}
                    className={`whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold ${
                      rankMode === mode.key
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-white text-muted hover:border-teal hover:text-teal"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <StateBlock title="Loading rankings" body="Reading CSV metadata for the selected topic." />
            ) : papers.length === 0 ? (
              <StateBlock
                title="No rankings yet"
                body="Run python scripts/crawl_papers.py --all to generate paper data."
              />
            ) : rankMode === "tags" ? (
              <TagMap groups={tagGroups} />
            ) : rankingItems.length === 0 ? (
              <StateBlock title="No papers in this ranking" body="This view needs matching metadata." />
            ) : (
              <div className="grid gap-3">
                {rankingItems.map((paper, index) => (
                  <RankingItem key={paper.paper_id || paper.title} paper={paper} rank={index + 1} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="border-t border-line py-6 text-center text-sm text-muted">
        © 2026 Lucaz — TrustFed
      </footer>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm text-ink"
      >
        {children}
      </select>
    </label>
  );
}

function ScorePill({ label, value, tone = "teal" }: { label: string; value: string; tone?: "teal" | "gold" }) {
  const classes =
    tone === "gold"
      ? "border-gold/30 bg-gold/10 text-gold"
      : "border-teal/30 bg-teal/10 text-teal";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${classes}`}>
      {label} {value}
    </span>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 8).map((tag) => (
        <span key={tag} className="rounded-md border border-line bg-wash px-2 py-1 text-xs font-medium text-muted">
          {tag}
        </span>
      ))}
    </div>
  );
}

function IconLink({
  href,
  label,
  children
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-teal hover:text-teal"
    >
      {children}
    </a>
  );
}

function Pagination({
  page,
  pageCount,
  setPage
}: {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title="Previous page"
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-muted hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-45"
      >
        <ChevronLeft aria-hidden="true" size={17} />
      </button>
      <span className="min-w-16 text-center text-sm font-semibold text-ink">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        title="Next page"
        onClick={() => setPage(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-muted hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-45"
      >
        <ChevronRight aria-hidden="true" size={17} />
      </button>
    </div>
  );
}

function StateBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-line bg-wash text-teal">
        <Database aria-hidden="true" size={22} />
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

function RankingItem({ paper, rank }: { paper: Paper; rank: number }) {
  return (
    <article className="grid gap-4 rounded-md border border-line bg-white p-4 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-teal text-base font-bold text-white">
        {rank}
      </div>
      <div className="min-w-0">
        <a
          href={paper.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="font-semibold leading-6 text-ink hover:text-teal"
        >
          {paper.title || "Untitled paper"}
        </a>
        <p className="mt-1 text-sm text-muted">
          {shortenAuthors(paper.author)} · {paper.year || "No year"} · {paper.venue_name || "Unknown venue"}
        </p>
        <div className="mt-3">
          <TagList tags={splitList(paper.tags).slice(0, 6)} />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2 sm:justify-end">
        <ScorePill label="Cites" value={formatNumber(paper.citations)} />
        <ScorePill label="Rel" value={getScoreLabel(paper.relevance_score)} />
        <ScorePill label="Rank" value={getScoreLabel(paper.ranking_score)} tone="gold" />
        {paper.url ? (
          <IconLink href={paper.url} label="Open paper">
            <ExternalLink aria-hidden="true" size={17} />
          </IconLink>
        ) : null}
        {paper.code ? (
          <IconLink href={paper.code} label={`Open code (${paper.code_confidence})`}>
            <Code2 aria-hidden="true" size={17} />
          </IconLink>
        ) : null}
      </div>
    </article>
  );
}

function TagMap({
  groups
}: {
  groups: Array<{ tag: string; rows: Paper[]; averageRelevance: number }>;
}) {
  const maxCount = Math.max(...groups.map((group) => group.rows.length), 1);

  if (groups.length === 0) {
    return <StateBlock title="No tags available" body="Tag groups will appear after the crawler writes metadata." />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <article key={group.tag} className="rounded-md border border-line bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-ink">{group.tag}</h3>
            <span className="rounded-md bg-wash px-2 py-1 text-sm font-semibold text-muted">
              {group.rows.length}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-wash">
            <div
              className="h-full rounded-full bg-coral"
              style={{ width: `${Math.max(6, (group.rows.length / maxCount) * 100)}%` }}
            />
          </div>
          <div className="mt-3 space-y-2">
            {group.rows.slice(0, 3).map((paper) => (
              <a
                key={paper.paper_id || paper.title}
                href={paper.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium text-ink hover:text-teal"
              >
                {paper.title}
              </a>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
