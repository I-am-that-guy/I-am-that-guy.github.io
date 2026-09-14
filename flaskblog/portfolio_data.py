"""
portfolio_data.py — Automated data pipeline for the dual-mode portfolio.

Sources (all fail-soft: the homepage must never break):
  - GitHub REST API        -> projects (stars, forks, commit counts, languages/topics)
  - content/config.json    -> github username, exclusions, pins, cache TTL
  - content/resume.json    -> work experience, education, skills
  - content/poems/*.md     -> notepad cards (frontmatter + poem lines)
  - content/art/*          -> polaroid cards (directory scan + optional manifest captions)
  - content/github_fallback.json -> offline/rate-limit fallback for projects

No new dependencies: stdlib only (urllib, json, os, re, time).
A short in-memory cache keeps us well inside GitHub's 60 req/hr unauthenticated limit.
"""

import json
import os
import re
import time
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root
CONTENT_DIR = os.path.join(BASE_DIR, "content")

DEFAULT_CONFIG = {
    "github_username": "the-jola-amodu",
    "github_excluded_repos": ["the-jola-amodu.github.io"],
    "pinned_repos": [],
    "max_projects": 8,
    "commit_count_repos": 6,
    "cache_minutes": 30,
}

GITHUB_API_REPOS = "https://api.github.com/users/{user}/repos?per_page=100&sort=updated"
GITHUB_API_COMMITS = "https://api.github.com/repos/{user}/{repo}/commits?per_page=1"

_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp")

# Simple process-wide cache for the projects payload.
_projects_cache = {"ts": 0.0, "data": None}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _read_json(path, default):
    """Read a JSON file, returning `default` if missing/invalid. Never raises."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _http_get_json(url, timeout=8):
    """GET a JSON URL with a proper User-Agent (required by GitHub API)."""
    request = urllib.request.Request(url, headers={
        "User-Agent": "jola-amodu-portfolio/1.0",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8")), response.headers


def load_config():
    """Merge content/config.json over the defaults. Never raises."""
    config = dict(DEFAULT_CONFIG)
    config.update(_read_json(os.path.join(CONTENT_DIR, "config.json"), {}))
    return config


# ---------------------------------------------------------------------------
# Projects (GitHub API with cache + offline fallback)
# ---------------------------------------------------------------------------

def _count_commits(user, repo, timeout=6):
    """Total commit count via the Link header trick (per_page=1 -> last page N)."""
    url = GITHUB_API_COMMITS.format(user=user, repo=repo)
    request = urllib.request.Request(url, headers={
        "User-Agent": "jola-amodu-portfolio/1.0",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        link = response.headers.get("Link", "")
        match = re.search(r'[?&]page=(\d+)>;\s*rel="last"', link)
        if match:
            return int(match.group(1))
        # No Link header => exactly one commit.
        return 1


def _map_repo(repo, user):
    language = repo.get("language") or ""
    topics = repo.get("topics") or []
    tags = []
    if language:
        tags.append(language.strip().lower())
    for topic in topics:
        topic = str(topic).strip().lower()
        if topic and topic not in tags:
            tags.append(topic)
    return {
        "name": repo.get("name") or "",
        "repo": repo.get("name") or "",
        "description": (repo.get("description") or "").strip(),
        "html_url": repo.get("html_url") or "",
        "homepage": (repo.get("homepage") or "").strip(),
        "stars": int(repo.get("stargazers_count") or 0),
        "forks": int(repo.get("forks_count") or 0),
        "commits": "",
        "language": language,
        "topics": topics,
        "tags": tags,
        "pushed_at": repo.get("pushed_at") or "",
        "image": "",
    }


def _fetch_projects_from_github(config):
    """Live fetch. Raises on any network/API problem (caller falls back)."""
    user = config["github_username"]
    repos, _headers = _http_get_json(GITHUB_API_REPOS.format(user=user))

    excluded = set(config.get("github_excluded_repos") or [])
    pinned = list(config.get("pinned_repos") or [])

    mapped = []
    for repo in repos:
        if repo.get("fork"):
            continue
        name = repo.get("name") or ""
        if name in excluded:
            continue
        mapped.append(_map_repo(repo, user))

    # Commit counts only for the top N repos (rate-limit friendly).
    by_prominence = sorted(mapped, key=lambda p: (-p["stars"], p["name"].lower()))
    for project in by_prominence[: int(config.get("commit_count_repos", 6))]:
        try:
            project["commits"] = _count_commits(user, project["repo"])
        except (OSError, ValueError, urllib.error.URLError):
            project["commits"] = ""

    # Pin first (in config order), then stars desc, then recency.
    def sort_key(project):
        pin_index = (
            pinned.index(project["repo"]) if project["repo"] in pinned else len(pinned)
        )
        return (pin_index, -project["stars"], project["pushed_at"], project["name"].lower())

    mapped.sort(key=sort_key)
    return mapped[: int(config.get("max_projects", 8))]


def get_projects(force=False):
    """Public: projects for the terminal cards. Fails soft to the fallback file."""
    now = time.time()
    ttl = max(5, int(load_config().get("cache_minutes", 30))) * 60
    if (
        not force
        and _projects_cache["data"] is not None
        and (now - _projects_cache["ts"]) < ttl
    ):
        return _projects_cache["data"]

    config = load_config()
    try:
        projects = _fetch_projects_from_github(config)
        source = "github"
        if not projects:  # API answered but nothing usable -> fallback
            raise ValueError("empty repository list")
    except Exception:  # noqa: BLE001 - deliberate: homepage must never break
        fallback = _read_json(os.path.join(CONTENT_DIR, "github_fallback.json"), {})
        projects = fallback.get("projects") or []
        source = "fallback"

    payload = {"source": source, "projects": projects}
    _projects_cache["ts"] = now
    _projects_cache["data"] = payload
    return payload


# ---------------------------------------------------------------------------
# Resume (work, education, skills)
# ---------------------------------------------------------------------------

def get_resume():
    """Public: parsed content/resume.json (empty dict if missing/invalid)."""
    return _read_json(os.path.join(CONTENT_DIR, "resume.json"), {})


# ---------------------------------------------------------------------------
# Poems (markdown with frontmatter -> notepad cards)
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_KEY_VALUE_RE = re.compile(r"^\s*(\w+)\s*:\s*(.*?)\s*$")


def _parse_poem(path):
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()

    meta = {}
    body = raw
    match = _FRONTMATTER_RE.match(raw)
    if match:
        for line in match.group(1).splitlines():
            kv = _KEY_VALUE_RE.match(line)
            if kv:
                meta[kv.group(1).lower()] = kv.group(2).strip('"').strip("'")
        body = raw[match.end():]

    # Lines: keep stanza breaks as empty spacer lines.
    lines = [line.strip() for line in body.strip().splitlines()]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()

    slug = os.path.splitext(os.path.basename(path))[0]
    return {
        "slug": slug,
        "title": meta.get("title") or slug.replace("-", " ").title(),
        "date": meta.get("date") or "",
        "caption": meta.get("caption") or "",
        "lines": lines,
    }


def get_poems():
    """Public: all content/poems/*.md, newest frontmatter date first. Fails soft."""
    poems = []
    try:
        poems_dir = os.path.join(CONTENT_DIR, "poems")
        for filename in sorted(os.listdir(poems_dir)):
            if not filename.lower().endswith(".md"):
                continue
            try:
                poems.append(_parse_poem(os.path.join(poems_dir, filename)))
            except OSError:
                continue
    except OSError:
        return []
    poems.sort(key=lambda p: str(p.get("date") or ""), reverse=True)
    return poems


# ---------------------------------------------------------------------------
# Art / photos (directory scan -> polaroid cards)
# ---------------------------------------------------------------------------

def get_art():
    """Public: every image in content/art/, captions from manifest.json. Fails soft."""
    art_dir = os.path.join(CONTENT_DIR, "art")
    manifest = _read_json(os.path.join(art_dir, "manifest.json"), {})

    try:
        entries = sorted(os.listdir(art_dir))
    except OSError:
        return []

    art = []
    for filename in entries:
        lowered = filename.lower()
        if not lowered.endswith(_IMAGE_EXTENSIONS):
            continue
        meta = manifest.get(filename) or {}
        art.append({
            "filename": filename,
            "caption": meta.get("caption") or os.path.splitext(filename)[0].replace("-", " "),
            "story": meta.get("story") or "",
        })
    return art


# ---------------------------------------------------------------------------
# Aggregate for the route
# ---------------------------------------------------------------------------

def get_all_portfolio_data():
    """Everything index.html needs. Each piece is isolated so one failure
    never takes down the page."""
    data = {
        "projects": [],
        "projects_source": "fallback",
        "resume": {},
        "poems": [],
        "art": [],
    }
    try:
        projects_payload = get_projects()
        data["projects"] = projects_payload.get("projects") or []
        data["projects_source"] = projects_payload.get("source") or "fallback"
    except Exception:  # noqa: BLE001
        pass
    try:
        data["resume"] = get_resume()
    except Exception:  # noqa: BLE001
        pass
    try:
        data["poems"] = get_poems()
    except Exception:  # noqa: BLE001
        pass
    try:
        data["art"] = get_art()
    except Exception:  # noqa: BLE001
        pass
    return data

