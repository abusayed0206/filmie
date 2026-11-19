# Nanocrowd API & Relevancy Engine Specification

> **Checked against the live API on 2026-11-19. Where this differs from the sections below, this is right.**
>
> - `GET /api/init/token` → `{ token }`: an opaque 100-character string, not a JWT, with no expiry field and no cache headers. The same token came back 13 minutes apart and the older copy kept working, so it is a long-lived guest token. A bad token gets 401.
> - `GET /api/titlesearch/` (no query) returns the whole catalog: about 32,000 `{ title: "Lucy (2014)", ncTitleId }`, 1.7 MB. Titles are ASCII only ("Amelie (2001)"), and alternative titles appear as extra entries with the same id. **`/api/titlesearch/<query>` answers `{"response":"nope"}` with status 200**, as does any unknown path. The web app (`app.nanocrowd.com/js/app.*.js`, `getTitles`) downloads the catalog and searches it locally.
> - `GET /api/titles/<ncTitleId>` → a one-element array: `imdbId`, `title`, `releaseYear`, `type` (`"01-Movie"`), `crowdRating` (0 to 5), `keywords` (15 `{ term, fpm }`), `mostLikeTitles` (80 `{ ncTitleId, title, year, crowdRating }`, no IMDb id), `directorList`, `starringActorList`, `mpaa`, `youTubeTrailerId`.
> - `GET /api/fundamentals` → 25 `{ tierKey }` genres.
> - `GET /api/tiers/<tierKey>` → a one-element array `{ tierKey, subtierList: [{ subtier }], titleList }`, with up to 1000 titles carrying `imdbId`, `year`, `crowdRating` and `providers`. Only the 25 genres work: any other word, such as a keyword, returns `[]`, and `/api/tiers/<genre>/<subtier>` is "nope". There is no search by mood or keyword.


## 1. Executive Summary

This document details the reverse-engineered network architecture, authentication mechanism, data contracts, and semantic recommendation models powering **Nanocrowd** (`https://app.nanocrowd.com`). 

Nanocrowd is the underlying technology provider responsible for the *"Similar Films"*, *"Themes"*, and *"Nanogenres"* modules on platforms like Letterboxd. Rather than relying on simple metadata overlap (e.g., shared directors or broad genres), Nanocrowd applies natural language processing to viewer reviews and audience sentiment, mapping films into micro-thematic descriptors (**Nanogenres**) and computing emotional/tonal proximity vectors (**Relevancy Model**).

---

## 2. Network & Infrastructure Architecture

```mermaid
graph TD
    UserClient["Client (Filmie / WebApp)"]
    
    subgraph Frontend["Frontend Layer"]
        AppDomain["app.nanocrowd.com (Vue.js SPA)"]
    end
    
    subgraph API["API Gateway Layer"]
        ApiHost["bananastreampie.com (Production API)"]
        AuthService["/api/init/token (Anonymous JWT)"]
        TitleService["/api/titles/:id (Relevancy & Keywords)"]
        SearchService["/api/titlesearch/:query"]
        StreamService["/api/streams/:imdbId (JustWatch)"]
    end
    
    subgraph CDN["Static Asset CDN"]
        MediaCDN["nccdn.sfo3.cdn.digitaloceanspaces.com"]
        PosterLarge["/images/large/{ncTitleId}.jpg"]
        PosterMedium["/images/medium/{ncTitleId}.jpg"]
    end
    
    UserClient --> AppDomain
    UserClient -->|Authorization: Bearer <JWT>| ApiHost
    ApiHost --> AuthService
    ApiHost --> TitleService
    ApiHost --> SearchService
    ApiHost --> StreamService
    UserClient -->|Fetch Images| MediaCDN
```

### Domain Mapping
| Component | Host / Base URL | Purpose |
|---|---|---|
| **Web Interface** | `https://app.nanocrowd.com` | Vue 2/3 Single-Page Application |
| **API Gateway** | `https://bananastreampie.com` | Production REST API backend |
| **Media CDN** | `https://nccdn.sfo3.cdn.digitaloceanspaces.com` | High-res & medium movie poster storage (DigitalOcean SFO3) |
| **Partner CDN** | `https://images.justwatch.com` | Streaming provider icons (Netflix, Amazon, Apple TV, etc.) |

---

## 3. Authentication & Security Flow

Nanocrowd exposes a public, unauthenticated guest token generation endpoint. No user account, credentials, or private API keys are required.

```mermaid
sequenceDiagram
    autonumber
    participant App as Filmie / Client
    participant Auth as bananastreampie.com (/api/init/token)
    participant API as bananastreampie.com (/api/titles/...)
    
    App->>Auth: GET /api/init/token
    Auth-->>App: 200 OK {"token": "<JWT_STRING>"}
    Note over App: Store JWT in memory or SQLite cache
    
    App->>API: GET /api/titles/27320<br/>Header: Authorization: Bearer <token>
    API-->>App: 200 OK [Title JSON + Nanogenres + Recommendations]
    
    Note over API: If token expires or omitted:
    API-->>App: 401 Unauthorized {"error": "Unauthorized"}
```

### 3.1 Token Minting
* **Endpoint**: `GET https://bananastreampie.com/api/init/token`
* **Headers**: Standard browser headers (CORS allowed from web, no origin restrictions enforced on raw HTTP requests).
* **Response Status**: `200 OK`
* **Response Schema**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

### 3.2 Request Requirements
All core endpoints require the Bearer token in the request headers:
```http
Authorization: Bearer <token>
Accept: application/json
```
If the token is missing or invalid, the API returns:
```json
{
  "error": "Unauthorized"
}
```

---

## 4. API Endpoints Specification

### 4.1 Token Initialization
* **URL**: `GET /api/init/token`
* **Authentication**: None.
* **Description**: Returns an ephemeral JWT token for guest access.

### 4.2 Title Details & Relevancy Engine
* **URL**: `GET /api/titles/:ncTitleId`
* **Authentication**: Required (`Bearer <token>`).
* **Path Parameter**: `ncTitleId` (integer, e.g. `27320`).
* **Description**: Returns title metadata, crowd rating, YouTube trailer ID, weighted nanogenres, and the semantic recommendations list.

#### Example Request:
```http
GET /api/titles/27320 HTTP/1.1
Host: bananastreampie.com
Authorization: Bearer eyJhbGciOiJIUzI1Ni...
```

#### Example Response (`200 OK`):
```json
[
  {
    "imdbId": "tt2872732",
    "title": "Lucy",
    "releaseYear": 2014,
    "crowdRating": 64,
    "type": "Movie",
    "youTubeTrailerId": "MVt32qoyhi0",
    "keywords": [
      { "term": "scientific", "fpm": 85.4 },
      { "term": "drugs", "fpm": 72.1 },
      { "term": "action", "fpm": 68.3 },
      { "term": "sci-fi", "fpm": 65.0 },
      { "term": "killing", "fpm": 54.2 },
      { "term": "gangster", "fpm": 48.7 },
      { "term": "car", "fpm": 45.1 },
      { "term": "violence", "fpm": 42.9 },
      { "term": "cops", "fpm": 40.0 },
      { "term": "thriller", "fpm": 38.5 },
      { "term": "cool", "fpm": 35.2 },
      { "term": "philosophical", "fpm": 33.8 },
      { "term": "myth", "fpm": 31.0 },
      { "term": "space", "fpm": 29.4 },
      { "term": "guns", "fpm": 27.6 }
    ],
    "mostLikeTitles": [
      {
        "ncTitleId": 1807,
        "title": "Limitless",
        "year": 2011,
        "crowdRating": 74
      },
      {
        "ncTitleId": 25776,
        "title": "Ex Machina",
        "year": 2015,
        "crowdRating": 77
      },
      {
        "ncTitleId": 13783,
        "title": "Inception",
        "year": 2010,
        "crowdRating": 88
      },
      {
        "ncTitleId": 19430,
        "title": "Source Code",
        "year": 2011,
        "crowdRating": 75
      },
      {
        "ncTitleId": 603,
        "title": "The Matrix",
        "year": 1999,
        "crowdRating": 87
      },
      {
        "ncTitleId": 137113,
        "title": "Edge of Tomorrow",
        "year": 2014,
        "crowdRating": 79
      }
    ]
  }
]
```

### 4.3 Title Search & Resolution
* **URL**: `GET /api/titlesearch/:query`
* **Authentication**: Required (`Bearer <token>`).
* **Path Parameter**: `query` (URL-encoded string, e.g., `Lucy%202014` or `Inception`).
* **Description**: Resolves search strings into Nanocrowd title records to discover their `ncTitleId`.

### 4.4 Streaming Providers (JustWatch Integration)
* **URL**: `GET /api/streams/:imdbId`
* **Authentication**: Required (`Bearer <token>`).
* **Path Parameter**: `imdbId` (e.g. `tt2872732`).
* **Description**: Returns streaming, rental, and purchase availability with direct deep-links.

#### Response Schema:
```json
[
  {
    "jwProviderId": 8,
    "providerName": "Netflix",
    "iconUrl": "https://images.justwatch.com/icon/4344471/s100",
    "streamType": "stream",
    "playUrl": "https://www.netflix.com/title/..."
  }
]
```

### 4.5 Fundamentals / Genre Categories
* **URL**: `GET /api/fundamentals`
* **Authentication**: Required (`Bearer <token>`).
* **Description**: Returns Nanocrowd's canonical 25 genre categories:
  `comedy`, `romance`, `action`, `adventure`, `kids`, `horror`, `drama`, `sci-fi`, `superhero`, `romantic-comedy`, `biography`, `relationships`, `thriller`, `historical`, `quest`, `cops`, `mystery`, `animation`, `fantasy`, `war`, `spy`, `sports`, `musical`, `documentary`, `western`.

---

## 5. Detailed Analysis of Data Fields

### 5.1 `keywords` (The Nanogenres)
* **`term`**: A normalized semantic concept or emotional vibe (e.g., `"philosophical"`, `"drugs"`, `"cops"`, `"mind-bending"`).
* **`fpm`**: **Frequency Per Million**. Measures the statistical density of this concept appearing in verified viewer reactions and reviews relative to the general film corpus. A higher `fpm` indicates a dominant thematic pillar of the film.
* **Usage**: On `app.nanocrowd.com`, `fpm` directly determines font-size scaling in the tag cloud component.

### 5.2 `mostLikeTitles` (The Relevancy Model)
* Represents the primary output of Nanocrowd's ViewerVoice engine.
* Instead of matching basic film industry metadata (actor, director, release country), it computes a cosine similarity distance over the `keywords` vector space.
* **Case Study (`Lucy`, ID `27320`)**:
  * *Lucy* deals with cognitive enhancement via synthetic substances, existential identity, and cybernetic action.
  * *Top Recommendations*:
    1. **Limitless (2011)** (`ncTitleId: 1807`): Direct thematic twin (pharmaceutical cognitive enhancement).
    2. **Ex Machina (2015)** (`ncTitleId: 25776`): Artificial intelligence, philosophical transcendence.
    3. **Inception (2010)** (`ncTitleId: 13783`): Mind manipulation, cerebral action.
    4. **The Matrix (1999)** (`ncTitleId: 603`): Transcending human physical constraints.

### 5.3 Cross-Referencing ID Graphs
Nanocrowd inherently bridges external catalogs:
* **IMDb**: Directly keyed via `imdbId` (e.g. `tt2872732`).
* **TMDB**: Readily resolved by converting TMDB's `external_ids.imdb_id` into Nanocrowd's `imdbId`.

---

## 6. Filmie Integration Architecture

Filmie can ingest this data natively without running external servers or web scrapers.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Filmie UI (pages-title.js)
    participant Rust as Tauri Core (nanocrowd.rs)
    participant SQLite as filmie.sqlite3
    participant NC as bananastreampie.com
    
    UI->>Rust: invoke('nanocrowd_similar', { imdbId, title })
    Rust->>SQLite: Check cache (table: cache, key: "nc ...")
    alt Cached & Fresh (< 30 days)
        SQLite-->>Rust: Return cached JSON
    else Cache Miss
        Rust->>NC: GET /api/init/token (if token expired/missing)
        NC-->>Rust: {"token": "..."}
        Rust->>NC: GET /api/titlesearch/:title -> find ncTitleId
        NC-->>Rust: [{ "ncTitleId": 27320 }]
        Rust->>NC: GET /api/titles/27320 (Bearer auth)
        NC-->>Rust: Title JSON with mostLikeTitles & keywords
        Rust->>SQLite: Store in cache (30-day TTL)
    end
    Rust-->>UI: Return { keywords, mostLikeTitles }
    Note over UI: Render "Nanocrowd Similar" row<br/>and "Vibes / Nanogenres" tag cloud
```

### Advantages of Direct Integration
1. **Zero VPS / Server Cost**: Direct HTTP requests from the local client to `bananastreampie.com`.
2. **High Speed & Low Latency**: Fast JSON endpoints (typically <150ms) compared to 10s+ browser scrapers.
3. **No Account Restrictions**: No login credentials or passwords required.
4. **Offline First**: All responses cached in `filmie.sqlite3` with a 30-day TTL.
