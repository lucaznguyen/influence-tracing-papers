# Influence Tracing Research Papers

Influence Tracing Research Papers is a static research paper browser for **TrustFed** by **Lucaz**. It focuses on influence tracing, training data attribution, continual learning, federated learning, and federated continual learning.

## Features

- Paper browser with topic selection, global search, per-column filters, sorting, pagination, and CSV export.
- Ranking views for top ranked, most relevant, recent, most cited, foundational papers, papers with code, and topic tags.
- Python crawler that collects metadata from public APIs and writes CSV files to `public/data/`.
- GitHub Pages static export through Next.js.
- Daily GitHub Actions data refresh with a pull request when CSV files change.

## Topics

- `influence_tracing`
- `influence_tracing_continual_learning`
- `influence_tracing_federated_learning`
- `influence_tracing_federated_continual_learning`

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

The local app runs at the root path. For GitHub Pages project sites, the workflow sets `NEXT_PUBLIC_BASE_PATH=/${{ github.event.repository.name }}` during build.

## Python Environment

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Crawl Data

Crawl all topics:

```bash
python scripts/crawl_papers.py --all
```

Crawl one topic:

```bash
python scripts/crawl_papers.py --topic influence_tracing
python scripts/crawl_papers.py --topic influence_tracing_continual_learning
python scripts/crawl_papers.py --topic influence_tracing_federated_learning
python scripts/crawl_papers.py --topic influence_tracing_federated_continual_learning
```

Smoke test with a small API budget:

```bash
python scripts/crawl_papers.py --topic influence_tracing --max-queries-per-topic 1 --max-results-per-query 1 --skip-github-code
```

Enrich code links after metadata has already been crawled:

```bash
python scripts/crawl_papers.py --all --enrich-code-existing
```

Initialize empty CSV files with headers only:

```bash
python scripts/crawl_papers.py --init-only
```

The site handles empty CSV files and shows:

```text
Run python scripts/crawl_papers.py --all to generate paper data.
```

## Build

```bash
npm run build
```

For GitHub Pages project-site output:

```bash
NEXT_PUBLIC_BASE_PATH=/influence-tracing-papers npm run build
```

## Deploy

`.github/workflows/deploy.yml` builds the static Next.js site and deploys `out/` to GitHub Pages on pushes to `main`. Configure Pages in the repository settings to use GitHub Actions.

The expected project-site URL is:

```text
https://<username>.github.io/influence-tracing-papers/
```

## Scheduled Updates

`.github/workflows/update-papers.yml` runs daily at 03:00 UTC and can also be started with `workflow_dispatch`. It:

1. Installs Python dependencies.
2. Runs `python scripts/crawl_papers.py --all`.
3. Runs `npm run build`.
4. Opens a pull request with changed CSV files.

Cache directories are ignored and are not committed.

## Environment Variables

- `SEMANTIC_SCHOLAR_API_KEY`: optional Semantic Scholar Graph API key.
- `GITHUB_TOKEN`: optional GitHub API token for stronger code-link discovery.
- `OPENALEX_EMAIL`: optional contact email for the OpenAlex polite pool.

The crawler still runs without optional keys, using public API limits. GitHub code discovery is skipped unless `GITHUB_TOKEN` is available by default.

## Data Source Policy

The crawler uses public, legal metadata APIs:

- OpenAlex API
- Semantic Scholar Graph API
- arXiv API
- DBLP API
- GitHub REST API for code repository discovery when allowed

It does not scrape Google Scholar, bypass CAPTCHA, bypass paywalls, ignore anti-bot systems, bypass robots.txt or Terms of Service, or bulk-download PDFs.

## CSV Schema

Each topic writes one CSV file in `public/data/`:

- `papers_influence_tracing.csv`
- `papers_influence_tracing_continual_learning.csv`
- `papers_influence_tracing_federated_learning.csv`
- `papers_influence_tracing_federated_continual_learning.csv`

Columns:

```text
paper_id,title,author,venue_name,publish_date,year,url,code,code_confidence,abstract,doi,arxiv_id,source,sources,citations,tags,relevance_score,ranking_score,crawl_timestamp
```

`paper_id` is stable and prefers DOI, then arXiv ID, then a hash of the normalized title. Metadata is deduplicated in that same order.

## Relevance And Ranking

Relevance scoring is configured in `scripts/config.json`. Compound topics require influence/data-attribution signals plus the required continual and/or federated keyword groups. Weak social or non-ML uses of "influence" are penalized.

Ranking uses:

```text
0.40 * normalized_relevance_score
+ 0.25 * normalized_citations
+ 0.15 * recency_score
+ 0.10 * has_code_score
+ 0.10 * metadata_quality_score
```

Citations use log scaling, missing citation counts get a neutral fallback, and foundational papers are computed in the frontend from citations, relevance, and age.

## Add A Topic

1. Add a topic entry, query list, required keyword groups, threshold, and CSV filename to `scripts/config.json`.
2. Add the matching topic definition and CSV filename to `lib/topics.ts`.
3. Create the header-only CSV file in `public/data/`.
4. Run `python scripts/crawl_papers.py --topic <topic_key>`.
5. Run `npm run build`.
