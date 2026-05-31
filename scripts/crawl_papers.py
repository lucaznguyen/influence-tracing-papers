#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import math
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).resolve().with_name("config.json")

CSV_COLUMNS = [
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
    "crawl_timestamp",
]

SESSION = requests.Session()


def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"<[^>]+>", " ", title)
    title = re.sub(r"[^a-z0-9]+", " ", title)
    return re.sub(r"\s+", " ", title).strip()


def normalize_doi(doi: str | None) -> str:
    if not doi:
        return ""
    doi = doi.strip().lower()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
    doi = doi.removeprefix("doi:")
    return doi.strip()


def normalize_arxiv_id(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip()
    value = re.sub(r"^https?://arxiv\.org/(abs|pdf)/", "", value)
    value = value.removesuffix(".pdf")
    return value.strip()


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", strip_html(value)).strip()


def paper_key(paper: dict[str, Any]) -> str:
    doi = normalize_doi(str(paper.get("doi", "")))
    arxiv_id = normalize_arxiv_id(str(paper.get("arxiv_id", "")))
    title = normalize_title(str(paper.get("title", "")))

    if doi:
        return f"doi:{doi}"
    if arxiv_id:
        return f"arxiv:{arxiv_id.lower()}"
    if title:
        return f"title:{hashlib.sha1(title.encode('utf-8')).hexdigest()[:16]}"
    return f"unknown:{hashlib.sha1(json.dumps(paper, sort_keys=True).encode('utf-8')).hexdigest()[:16]}"


def paper_id(paper: dict[str, Any]) -> str:
    doi = normalize_doi(str(paper.get("doi", "")))
    arxiv_id = normalize_arxiv_id(str(paper.get("arxiv_id", "")))
    title = normalize_title(str(paper.get("title", "")))

    if doi:
        return doi
    if arxiv_id:
        return arxiv_id
    return hashlib.sha1(title.encode("utf-8")).hexdigest()[:16]


def parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def first(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else ""
    return value


def request_text(
    url: str,
    config: dict[str, Any],
    source: str,
    headers: dict[str, str] | None = None,
    cache_dir: Path | None = None,
) -> str | None:
    source_config = config["sources"].get(source, {})
    cache_root = cache_dir or ROOT / config["cache_dir"]
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_days = int(config.get("cache_days", 14))
    cache_file = cache_root / f"{hashlib.sha1(url.encode('utf-8')).hexdigest()}.cache"

    if cache_file.exists():
        age = datetime.now(timezone.utc) - datetime.fromtimestamp(cache_file.stat().st_mtime, timezone.utc)
        if age <= timedelta(days=cache_days):
            return cache_file.read_text(encoding="utf-8")

    merged_headers = {
        "User-Agent": config.get("public_api_user_agent", "InfluenceTracingPapers/0.1")
    }
    if headers:
        merged_headers.update(headers)

    retries = 3
    for attempt in range(retries):
        try:
            response = SESSION.get(url, headers=merged_headers, timeout=40)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < retries - 1:
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    sleep_for = float(retry_after)
                else:
                    sleep_for = (2 ** (attempt + 1)) + float(source_config.get("rate_limit_seconds", 0))
                logging.warning("%s returned %s; retrying in %.1fs", source, response.status_code, sleep_for)
                time.sleep(sleep_for)
                continue
            response.raise_for_status()
            text = response.text
            cache_file.write_text(text, encoding="utf-8")
            time.sleep(float(source_config.get("rate_limit_seconds", 0)))
            return text
        except requests.RequestException as exc:
            if attempt == retries - 1:
                logging.warning("Request failed for %s: %s", source, exc)
                return None
            time.sleep(2**attempt)
    return None


def request_json(
    url: str,
    config: dict[str, Any],
    source: str,
    headers: dict[str, str] | None = None,
    cache_dir: Path | None = None,
) -> dict[str, Any] | None:
    text = request_text(url, config, source, headers=headers, cache_dir=cache_dir)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        logging.warning("Invalid JSON from %s: %s", source, exc)
        return None


def source_limit(config: dict[str, Any], source: str, override: int | None) -> int:
    if override is not None:
        return max(0, override)
    return int(config["sources"][source].get("max_results_per_query", 100))


def empty_paper(source: str) -> dict[str, Any]:
    return {
        "paper_id": "",
        "title": "",
        "author": "",
        "venue_name": "",
        "publish_date": "",
        "year": "",
        "url": "",
        "code": "",
        "code_confidence": "none",
        "abstract": "",
        "doi": "",
        "arxiv_id": "",
        "source": source,
        "sources": source,
        "citations": "",
        "tags": "",
        "relevance_score": "0",
        "ranking_score": "0",
        "crawl_timestamp": "",
    }


def reconstruct_openalex_abstract(index: dict[str, list[int]] | None) -> str:
    if not index:
        return ""
    words: list[tuple[int, str]] = []
    for word, positions in index.items():
        for position in positions:
            words.append((position, word))
    return " ".join(word for _, word in sorted(words))


def fetch_openalex(query: str, config: dict[str, Any], max_results: int | None) -> list[dict[str, Any]]:
    source = "openalex"
    if not config["sources"][source].get("enabled", True):
        return []

    per_page = int(config["sources"][source].get("per_page", 200))
    limit = source_limit(config, source, max_results)
    if limit <= 0:
        return []

    rows: list[dict[str, Any]] = []
    mailto = os.getenv("OPENALEX_EMAIL", "").strip()

    for page in range(1, math.ceil(limit / per_page) + 1):
        params: dict[str, Any] = {
            "search": query,
            "per-page": per_page,
            "page": page,
        }
        if mailto:
            params["mailto"] = mailto
        url = f"https://api.openalex.org/works?{urlencode(params)}"
        payload = request_json(url, config, source)
        if not payload:
            break

        results = payload.get("results", [])
        if not results:
            break

        for item in results:
            if len(rows) >= limit:
                break
            ids = item.get("ids") or {}
            location = item.get("primary_location") or {}
            venue_source = location.get("source") or {}
            doi = normalize_doi(item.get("doi") or ids.get("doi"))
            arxiv_id = normalize_arxiv_id(ids.get("arxiv"))
            authors = [
                (authorship.get("author") or {}).get("display_name", "")
                for authorship in item.get("authorships", [])
            ]
            paper = empty_paper(source)
            paper.update(
                {
                    "title": clean_text(item.get("display_name") or item.get("title")),
                    "author": ", ".join(author for author in authors if author),
                    "venue_name": clean_text(venue_source.get("display_name")) or "OpenAlex",
                    "publish_date": item.get("publication_date") or str(item.get("publication_year") or ""),
                    "year": str(item.get("publication_year") or ""),
                    "url": (f"https://doi.org/{doi}" if doi else "")
                    or location.get("landing_page_url")
                    or ids.get("openalex")
                    or "",
                    "abstract": reconstruct_openalex_abstract(item.get("abstract_inverted_index")),
                    "doi": doi,
                    "arxiv_id": arxiv_id,
                    "citations": str(item.get("cited_by_count") or ""),
                }
            )
            rows.append(paper)

    logging.info("OpenAlex query %r returned %d rows", query, len(rows))
    return rows


def fetch_semantic_scholar(query: str, config: dict[str, Any], max_results: int | None) -> list[dict[str, Any]]:
    source = "semantic_scholar"
    if not config["sources"][source].get("enabled", True):
        return []

    per_page = int(config["sources"][source].get("per_page", 100))
    limit = source_limit(config, source, max_results)
    if limit <= 0:
        return []

    fields = ",".join(
        [
            "title",
            "abstract",
            "authors",
            "venue",
            "year",
            "publicationDate",
            "url",
            "externalIds",
            "citationCount",
            "publicationVenue",
            "openAccessPdf",
        ]
    )
    rows: list[dict[str, Any]] = []
    headers = {}
    api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if api_key:
        headers["x-api-key"] = api_key

    for offset in range(0, limit, per_page):
        params = {
            "query": query,
            "limit": min(per_page, limit - offset),
            "offset": offset,
            "fields": fields,
        }
        url = f"https://api.semanticscholar.org/graph/v1/paper/search?{urlencode(params)}"
        payload = request_json(url, config, source, headers=headers)
        if not payload:
            break

        results = payload.get("data", [])
        if not results:
            break

        for item in results:
            external_ids = item.get("externalIds") or {}
            publication_venue = item.get("publicationVenue") or {}
            doi = normalize_doi(external_ids.get("DOI"))
            arxiv_id = normalize_arxiv_id(external_ids.get("ArXiv"))
            authors = [author.get("name", "") for author in item.get("authors", [])]
            paper = empty_paper(source)
            paper.update(
                {
                    "title": clean_text(item.get("title")),
                    "author": ", ".join(author for author in authors if author),
                    "venue_name": clean_text(item.get("venue") or publication_venue.get("name")) or "Semantic Scholar",
                    "publish_date": item.get("publicationDate") or str(item.get("year") or ""),
                    "year": str(item.get("year") or ""),
                    "url": (f"https://doi.org/{doi}" if doi else "")
                    or (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else "")
                    or item.get("url")
                    or "",
                    "abstract": clean_text(item.get("abstract")),
                    "doi": doi,
                    "arxiv_id": arxiv_id,
                    "citations": str(item.get("citationCount") or ""),
                }
            )
            rows.append(paper)

        if len(results) < per_page:
            break

    logging.info("Semantic Scholar query %r returned %d rows", query, len(rows))
    return rows


def arxiv_query(query: str) -> str:
    phrases = re.findall(r'"([^"]+)"|(\S+)', query)
    terms = [phrase or word for phrase, word in phrases]
    terms = [term for term in terms if term.lower() not in {"machine", "learning", "deep"}]
    if not terms:
        terms = [query]
    return " AND ".join(f'all:"{term}"' if " " in term else f"all:{term}" for term in terms)


def fetch_arxiv(query: str, config: dict[str, Any], max_results: int | None) -> list[dict[str, Any]]:
    source = "arxiv"
    if not config["sources"][source].get("enabled", True):
        return []

    per_page = int(config["sources"][source].get("per_page", 100))
    limit = source_limit(config, source, max_results)
    if limit <= 0:
        return []

    rows: list[dict[str, Any]] = []
    ns = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

    for start in range(0, limit, per_page):
        params = {
            "search_query": arxiv_query(query),
            "start": start,
            "max_results": min(per_page, limit - start),
            "sortBy": "relevance",
            "sortOrder": "descending",
        }
        url = f"https://export.arxiv.org/api/query?{urlencode(params)}"
        text = request_text(url, config, source)
        if not text:
            break

        try:
            root = ET.fromstring(text)
        except ET.ParseError as exc:
            logging.warning("Could not parse arXiv XML: %s", exc)
            break

        entries = root.findall("atom:entry", ns)
        if not entries:
            break

        for entry in entries:
            entry_id = clean_text(entry.findtext("atom:id", default="", namespaces=ns))
            arxiv_id = normalize_arxiv_id(entry_id)
            published = clean_text(entry.findtext("atom:published", default="", namespaces=ns))
            year_match = re.match(r"(\d{4})", published)
            authors = [
                clean_text(author.findtext("atom:name", default="", namespaces=ns))
                for author in entry.findall("atom:author", ns)
            ]
            doi = normalize_doi(entry.findtext("arxiv:doi", default="", namespaces=ns))
            paper = empty_paper(source)
            paper.update(
                {
                    "title": clean_text(entry.findtext("atom:title", default="", namespaces=ns)),
                    "author": ", ".join(author for author in authors if author),
                    "venue_name": clean_text(entry.findtext("arxiv:journal_ref", default="", namespaces=ns))
                    or "arXiv",
                    "publish_date": published[:10] if published else "",
                    "year": year_match.group(1) if year_match else "",
                    "url": f"https://doi.org/{doi}" if doi else entry_id,
                    "abstract": clean_text(entry.findtext("atom:summary", default="", namespaces=ns)),
                    "doi": doi,
                    "arxiv_id": arxiv_id,
                }
            )
            rows.append(paper)

        if len(entries) < per_page:
            break

    logging.info("arXiv query %r returned %d rows", query, len(rows))
    return rows


def fetch_dblp(query: str, config: dict[str, Any], max_results: int | None) -> list[dict[str, Any]]:
    source = "dblp"
    if not config["sources"][source].get("enabled", True):
        return []

    per_page = int(config["sources"][source].get("per_page", 100))
    limit = source_limit(config, source, max_results)
    if limit <= 0:
        return []

    rows: list[dict[str, Any]] = []
    for offset in range(0, limit, per_page):
        params = {"q": query, "format": "json", "h": min(per_page, limit - offset), "f": offset}
        url = f"https://dblp.org/search/publ/api?{urlencode(params)}"
        payload = request_json(url, config, source)
        if not payload:
            break

        hits = (((payload.get("result") or {}).get("hits") or {}).get("hit")) or []
        if not hits:
            break

        for hit in hits:
            info = hit.get("info") or {}
            authors_value = (info.get("authors") or {}).get("author", [])
            if isinstance(authors_value, dict):
                authors = [authors_value.get("text") or authors_value.get("@pid") or ""]
            elif isinstance(authors_value, list):
                authors = [
                    author.get("text") if isinstance(author, dict) else str(author)
                    for author in authors_value
                ]
            else:
                authors = [str(authors_value)] if authors_value else []

            doi = normalize_doi(info.get("doi"))
            paper = empty_paper(source)
            paper.update(
                {
                    "title": clean_text(info.get("title")),
                    "author": ", ".join(author for author in authors if author),
                    "venue_name": clean_text(info.get("venue")) or "DBLP",
                    "publish_date": str(info.get("year") or ""),
                    "year": str(info.get("year") or ""),
                    "url": (f"https://doi.org/{doi}" if doi else "") or first(info.get("ee")) or info.get("url") or "",
                    "doi": doi,
                }
            )
            rows.append(paper)

        if len(hits) < per_page:
            break

    logging.info("DBLP query %r returned %d rows", query, len(rows))
    return rows


def merge_sources(existing: str, incoming: str) -> str:
    merged = []
    for source in [*existing.split(","), *incoming.split(",")]:
        source = source.strip()
        if source and source not in merged:
            merged.append(source)
    return ", ".join(merged)


def better_url(existing: str, incoming: str) -> str:
    if not incoming:
        return existing
    if not existing:
        return incoming
    priorities = ["doi.org", "arxiv.org", "semanticscholar.org", "openalex.org", "dblp.org"]
    existing_score = next((index for index, term in enumerate(priorities) if term in existing), len(priorities))
    incoming_score = next((index for index, term in enumerate(priorities) if term in incoming), len(priorities))
    return incoming if incoming_score < existing_score else existing


def merge_paper(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    for field in ["title", "author", "venue_name", "year", "doi", "arxiv_id"]:
        if not merged.get(field) and incoming.get(field):
            merged[field] = incoming[field]

    if incoming.get("publish_date") and (
        not merged.get("publish_date") or len(str(incoming["publish_date"])) > len(str(merged["publish_date"]))
    ):
        merged["publish_date"] = incoming["publish_date"]

    if len(str(incoming.get("abstract", ""))) > len(str(merged.get("abstract", ""))):
        merged["abstract"] = incoming.get("abstract", "")

    merged["url"] = better_url(str(merged.get("url", "")), str(incoming.get("url", "")))
    merged["sources"] = merge_sources(str(merged.get("sources", "")), str(incoming.get("sources", "")))

    existing_citations = parse_int(merged.get("citations"))
    incoming_citations = parse_int(incoming.get("citations"))
    if incoming_citations is not None and (
        existing_citations is None or incoming_citations > existing_citations
    ):
        merged["citations"] = str(incoming_citations)

    return merged


def dedupe_papers(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}

    for row in rows:
        if not row.get("title"):
            continue
        key = paper_key(row)
        if key in by_key:
            by_key[key] = merge_paper(by_key[key], row)
        else:
            by_key[key] = dict(row)

    return list(by_key.values())


def text_for_scoring(paper: dict[str, Any]) -> tuple[str, str, str]:
    return (
        normalize_title(str(paper.get("title", ""))),
        normalize_title(str(paper.get("abstract", ""))),
        normalize_title(str(paper.get("venue_name", ""))),
    )


def has_group(text: str, group_terms: list[str]) -> bool:
    return any(contains_term(text, term) for term in group_terms)


def contains_term(text: str, term: str) -> bool:
    term = normalize_title(term)
    if not term:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def infer_tags(paper: dict[str, Any], config: dict[str, Any]) -> list[str]:
    title, abstract, venue = text_for_scoring(paper)
    text = f"{title} {abstract} {venue}"
    tags = []
    for tag, terms in config.get("tag_terms", {}).items():
        if any(contains_term(text, term) for term in terms):
            tags.append(tag)
    return tags


def score_relevance(paper: dict[str, Any], topic_config: dict[str, Any], config: dict[str, Any]) -> int:
    title, abstract, venue = text_for_scoring(paper)
    score = 0
    keyword_groups = config["keyword_groups"]

    influence_terms = [normalize_title(term) for term in keyword_groups["influence"]]
    all_required_terms = [
        normalize_title(term)
        for group in topic_config.get("required_groups", [])
        for term in keyword_groups.get(group, [])
    ]

    for term in set(all_required_terms):
        if not term:
            continue
        if contains_term(title, term):
            score += 5 if term in influence_terms else 2
        if contains_term(abstract, term):
            score += 3 if term in influence_terms else 1

    present_groups = {
        group: has_group(f"{title} {abstract}", keyword_groups.get(group, []))
        for group in topic_config.get("required_groups", [])
    }
    missing_groups = [group for group, present in present_groups.items() if not present]
    if missing_groups:
        score -= 3 * len(missing_groups)
    else:
        score += 3

    if not has_group(f"{title} {abstract}", keyword_groups.get("ml_context", [])):
        score -= 4

    if any(contains_term(venue, term) for term in config.get("venue_bonus_terms", [])):
        score += 1

    text = f"{title} {abstract}"
    has_influence_signal = present_groups.get("influence") or has_group(text, keyword_groups["influence"])
    if any(contains_term(text, term) for term in config.get("negative_terms", [])) and not has_influence_signal:
        score -= 4

    return score


def metadata_quality_score(paper: dict[str, Any]) -> float:
    checks = [
        bool(paper.get("abstract")),
        bool(paper.get("doi") or paper.get("arxiv_id")),
        bool(paper.get("venue_name")),
        bool(paper.get("author")),
        bool(paper.get("year")),
    ]
    return sum(1 for passed in checks if passed) / len(checks)


def code_score(confidence: str) -> float:
    return {"high": 1.0, "medium": 0.7, "low": 0.3}.get(confidence.lower(), 0.0)


def recency_score(year: int | None) -> float:
    if not year:
        return 0.5
    age = max(0, datetime.now(timezone.utc).year - year)
    return max(0.15, 1 - (age / 12))


def apply_scores(rows: list[dict[str, Any]], topic_config: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    scored = []
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    threshold = int(topic_config.get("threshold", 0))

    for row in rows:
        relevance = score_relevance(row, topic_config, config)
        if relevance < threshold:
            continue
        tags = infer_tags(row, config)
        row["tags"] = ", ".join(tags)
        row["relevance_score"] = str(relevance)
        row["paper_id"] = paper_id(row)
        row["crawl_timestamp"] = timestamp
        scored.append(row)

    max_relevance = max([int(row["relevance_score"]) for row in scored], default=1)
    citation_values = [math.log1p(parse_int(row.get("citations")) or 0) for row in scored]
    max_citations = max(citation_values, default=1)

    for row in scored:
        relevance_norm = int(row["relevance_score"]) / max_relevance if max_relevance else 0.5
        citations = parse_int(row.get("citations"))
        citation_norm = math.log1p(citations) / max_citations if citations is not None and max_citations else 0.5
        year = parse_int(row.get("year"))
        ranking = (
            0.40 * relevance_norm
            + 0.25 * citation_norm
            + 0.15 * recency_score(year)
            + 0.10 * code_score(str(row.get("code_confidence", "none")))
            + 0.10 * metadata_quality_score(row)
        )
        row["ranking_score"] = f"{ranking * 100:.2f}"

    return sorted(scored, key=lambda item: float(item.get("ranking_score", 0)), reverse=True)


def title_tokens(title: str) -> set[str]:
    return {token for token in normalize_title(title).split() if len(token) >= 5}


def github_queries(paper: dict[str, Any]) -> list[str]:
    title = str(paper.get("title", ""))
    arxiv_id = str(paper.get("arxiv_id", ""))
    first_author = str(paper.get("author", "")).split(",")[0].strip().split(" ")[-1]
    tags = str(paper.get("tags", ""))
    queries = [f'"{title}" in:name,description,readme']
    if first_author:
        queries.append(f'"{title}" {first_author} in:name,description,readme')
    if arxiv_id:
        queries.append(f'"{arxiv_id}" in:readme')
    for method in ["tracin", "trak", "datainf"]:
        if method in tags.lower() or method in title.lower():
            queries.append(f"{method} {first_author} in:name,description,readme")
    return [query for query in queries if len(query) < 240]


def github_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json"}
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_github_readme(full_name: str, config: dict[str, Any]) -> str:
    url = f"https://api.github.com/repos/{full_name}/readme"
    headers = github_headers()
    headers["Accept"] = "application/vnd.github.raw"
    return request_text(url, config, "github", headers=headers) or ""


def score_github_candidate(paper: dict[str, Any], repo: dict[str, Any], readme: str) -> tuple[int, str]:
    title = str(paper.get("title", ""))
    normalized_title = normalize_title(title)
    doi = normalize_doi(str(paper.get("doi", "")))
    arxiv_id = normalize_arxiv_id(str(paper.get("arxiv_id", "")))
    first_author = str(paper.get("author", "")).split(",")[0].strip().split(" ")[-1].lower()
    haystack = normalize_title(
        " ".join(
            [
                str(repo.get("full_name", "")),
                str(repo.get("description", "")),
                str(repo.get("homepage", "")),
                readme,
            ]
        )
    )
    raw_haystack = f"{repo.get('html_url', '')} {repo.get('description', '')} {readme}".lower()

    if normalized_title and normalized_title in haystack:
        return 100, "high"
    if doi and doi in raw_haystack:
        return 95, "high"
    if arxiv_id and arxiv_id.lower() in raw_haystack:
        return 95, "high"

    overlap = len(title_tokens(title).intersection(set(haystack.split())))
    if first_author and first_author in haystack and overlap >= 3:
        return 72, "medium"
    if overlap >= 5:
        return 68, "medium"
    if overlap >= 3:
        return 40, "low"
    return 0, "none"


def find_code_for_paper(paper: dict[str, Any], config: dict[str, Any]) -> tuple[str, str]:
    best: tuple[int, str, str] = (0, "", "none")
    headers = github_headers()

    for query in github_queries(paper):
        params = {"q": query, "sort": "stars", "order": "desc", "per_page": 5}
        url = f"https://api.github.com/search/repositories?{urlencode(params)}"
        payload = request_json(url, config, "github", headers=headers)
        if not payload:
            continue
        for repo in payload.get("items", []):
            full_name = repo.get("full_name")
            if not full_name:
                continue
            readme = fetch_github_readme(full_name, config)
            score, confidence = score_github_candidate(paper, repo, readme)
            if score > best[0]:
                best = (score, repo.get("html_url", ""), confidence)

    if best[2] in {"high", "medium"}:
        return best[1], best[2]
    if best[2] == "low":
        return "", "low"
    return "", "none"


def enrich_code_links(rows: list[dict[str, Any]], config: dict[str, Any], skip: bool) -> None:
    github_config = config["sources"].get("github", {})
    if skip or not github_config.get("enabled", True):
        return
    if not os.getenv("GITHUB_TOKEN") and not github_config.get("enabled_without_token", False):
        logging.info("Skipping GitHub code discovery because GITHUB_TOKEN is not set.")
        return

    limit = int(github_config.get("max_code_searches_per_topic", 80))
    candidates = sorted(rows, key=lambda row: int(row.get("relevance_score", 0)), reverse=True)[:limit]
    for index, paper in enumerate(candidates, start=1):
        if paper.get("code"):
            continue
        logging.info("Searching code link %d/%d: %s", index, len(candidates), paper.get("title"))
        code_url, confidence = find_code_for_paper(paper, config)
        paper["code"] = code_url
        paper["code_confidence"] = confidence


def write_csv(rows: list[dict[str, Any]], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in CSV_COLUMNS})


def read_csv(csv_path: Path) -> list[dict[str, Any]]:
    if not csv_path.exists():
        return []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def enrich_existing_csv(topic_key: str, config: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    topic_config = config["topics"][topic_key]
    csv_path = ROOT / config["output_dir"] / topic_config["csv_file"]
    rows = read_csv(csv_path)
    logging.info("Enriching code links for %s from %d existing rows", topic_key, len(rows))
    enrich_code_links(rows, config, skip=False)
    scored = apply_scores(rows, topic_config, config)
    if not args.dry_run:
        write_csv(scored, csv_path)
        logging.info("Updated %s", csv_path)
    return scored


def crawl_topic(topic_key: str, config: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    topic_config = config["topics"][topic_key]
    logging.info("Crawling %s", topic_config["display_name"])

    raw_rows: list[dict[str, Any]] = []
    queries = topic_config["queries"]
    if args.max_queries_per_topic is not None:
        queries = queries[: max(0, args.max_queries_per_topic)]

    for query in queries:
        raw_rows.extend(fetch_openalex(query, config, args.max_results_per_query))
        raw_rows.extend(fetch_semantic_scholar(query, config, args.max_results_per_query))
        raw_rows.extend(fetch_arxiv(query, config, args.max_results_per_query))
        raw_rows.extend(fetch_dblp(query, config, args.max_results_per_query))

    merged = dedupe_papers(raw_rows)
    scored = apply_scores(merged, topic_config, config)
    enrich_code_links(scored, config, args.skip_github_code)
    scored = apply_scores(scored, topic_config, config)
    logging.info("%s: %d raw rows, %d deduped, %d relevant", topic_key, len(raw_rows), len(merged), len(scored))

    if not args.dry_run:
        output_path = ROOT / config["output_dir"] / topic_config["csv_file"]
        write_csv(scored, output_path)
        logging.info("Wrote %s", output_path)

    return scored


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl influence tracing paper metadata.")
    topic_choices = list(load_config()["topics"].keys())
    parser.add_argument("--all", action="store_true", help="Crawl all configured topics.")
    parser.add_argument("--topic", choices=topic_choices, help="Crawl a single topic.")
    parser.add_argument("--dry-run", action="store_true", help="Run without writing CSV files.")
    parser.add_argument("--init-only", action="store_true", help="Only create empty CSV files with headers.")
    parser.add_argument(
        "--enrich-code-existing",
        action="store_true",
        help="Read existing CSV files and enrich code links without re-crawling paper APIs.",
    )
    parser.add_argument(
        "--max-results-per-query",
        type=int,
        default=None,
        help="Override configured per-source results per query for smoke tests.",
    )
    parser.add_argument(
        "--max-queries-per-topic",
        type=int,
        default=None,
        help="Override configured query count per topic for smoke tests.",
    )
    parser.add_argument("--skip-github-code", action="store_true", help="Skip GitHub code-link discovery.")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser.parse_args()


def init_csv_files(config: dict[str, Any]) -> None:
    output_dir = ROOT / config["output_dir"]
    for topic_config in config["topics"].values():
        write_csv([], output_dir / topic_config["csv_file"])
    logging.info("Initialized CSV headers in %s", output_dir)


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level), format="%(levelname)s %(message)s")
    config = load_config()

    if args.init_only:
        init_csv_files(config)
        return 0

    if args.enrich_code_existing:
        topics = list(config["topics"].keys()) if args.all else [args.topic]
        if not args.all and not args.topic:
            logging.error("Use --all or --topic with --enrich-code-existing.")
            return 2
        assert all(topics)
        for topic_key in topics:
            enrich_existing_csv(topic_key, config, args)
        return 0

    if not args.all and not args.topic:
        logging.error("Use --all or --topic.")
        return 2

    topics = list(config["topics"].keys()) if args.all else [args.topic]
    assert all(topics)

    for topic_key in topics:
        try:
            crawl_topic(topic_key, config, args)
        except Exception as exc:  # noqa: BLE001 - topic failures should still leave valid CSV headers.
            logging.exception("Crawler failed for %s: %s", topic_key, exc)
            if not args.dry_run:
                output_path = ROOT / config["output_dir"] / config["topics"][topic_key]["csv_file"]
                if not output_path.exists():
                    write_csv([], output_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
