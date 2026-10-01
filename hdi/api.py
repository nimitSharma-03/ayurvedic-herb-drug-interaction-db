"""Read-only JSON HTTP API over the medicine and interaction database.

    python -m hdi.seed          # build the database first
    python -m hdi.api           # serve on 127.0.0.1:8000

Routing is a pure function -- handle(method, path, params, body) returns
(status_code, payload) -- with http.server as a thin adapter over it. Tests
exercise handle() directly, and one end-to-end test drives a real socket.

Routes only validate input, call a service in hdi.catalog / hdi.interactions /
hdi.topics, and shape the response; no medical logic lives here. Every lookup
is a database read: no model, network call or LLM is on the request path.
"""

import argparse
import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from hdi import catalog, db, interactions, topics

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

_VALID_CATEGORIES = set(catalog.CATEGORY_FILTERS)
_VALID_STATUSES = {
    db.STATUS_INTERACTION_FOUND,
    db.STATUS_NO_DOCUMENTED_INTERACTION,
    db.STATUS_INSUFFICIENT_EVIDENCE,
}
_VALID_PAIR_KINDS = {"ayurvedic_allopathic", "ayurvedic_ayurvedic", "allopathic_allopathic"}
_TRUTHY = {"1", "true", "yes", "on"}


class _HttpError(Exception):
    """A validated client-side failure, carrying the status and machine-readable code."""

    def __init__(self, status, code, message, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def payload(self):
        body = {"error": {"code": self.code, "message": self.message}}
        body["error"].update(self.extra)
        return body


def _one(params, name, default=None):
    """Last value for a query parameter, or default when absent or blank."""
    values = params.get(name)
    if not values:
        return default
    value = values[-1] if isinstance(values, (list, tuple)) else values
    value = (value or "").strip()
    return value or default


def _require(params, name):
    value = _one(params, name)
    if not value:
        raise _HttpError(400, "missing_parameter", f"Query parameter '{name}' is required.")
    return value


def _int_param(params, name, default, minimum, maximum):
    raw = _one(params, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise _HttpError(
            400, "invalid_parameter", f"Parameter '{name}' must be an integer, got {raw!r}."
        )
    if value < minimum or value > maximum:
        raise _HttpError(
            400,
            "invalid_parameter",
            f"Parameter '{name}' must be between {minimum} and {maximum}, got {value}.",
        )
    return value


def _category_param(params, name="category"):
    value = (_one(params, name, "all") or "all").lower()
    if value not in _VALID_CATEGORIES:
        raise _HttpError(
            400,
            "invalid_parameter",
            f"Parameter '{name}' must be one of {sorted(_VALID_CATEGORIES)}, got {value!r}.",
        )
    return value


def _bool_param(params, name):
    raw = _one(params, name)
    return raw is not None and raw.lower() in _TRUTHY


def _check_error_response(error):
    """Translate a check_pair error tuple into an HTTP status and body.

    medicine_not_found carries the documented state in the body as well as the
    404, so a client reading `status` handles all four result states uniformly.
    """
    kind, side, detail = error
    if kind == "empty_query":
        raise _HttpError(
            400, "invalid_parameter", f"Medicine name for '{side}' must not be empty."
        )
    if kind == "identical_medicine":
        raise _HttpError(
            400,
            "identical_medicine",
            "medicine_a and medicine_b resolve to the same medicine; "
            "an interaction requires two different medicines.",
            medicine_id=detail,
        )
    if kind == "ambiguous":
        raise _HttpError(
            409,
            "ambiguous_medicine",
            f"The name given for '{side}' matches more than one medicine; "
            f"use a medicine id instead.",
            side=side,
            candidates=detail,
        )
    return 404, {
        "status": db.STATUS_MEDICINE_NOT_FOUND,
        "error": {
            "code": db.STATUS_MEDICINE_NOT_FOUND,
            "message": f"No medicine matched {detail!r}.",
            "side": side,
            "query": detail,
        },
        "disclaimer": interactions.DISCLAIMER,
    }


def _route(method, path, params, body, conn):
    segments = [s for s in path.strip("/").split("/") if s]

    if not segments:
        return 200, {
            "service": "ayurveda-hdi",
            "endpoints": [
                "GET /health",
                "GET /medicines",
                "GET /medicines/search?q=",
                "GET /medicines/{id}",
                "GET /medicines/{id}/interactions",
                "GET /interactions/check?medicine_a=&medicine_b=",
                "POST /interactions/check",
                "GET /interactions/documented",
                "GET /health-topics",
                "GET /health-topics/lookup?topic=",
            ],
        }

    head = segments[0]

    if head == "health" and len(segments) == 1:
        _allow(method, "GET")
        meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM seed_metadata")}
        return 200, {"status": "ok", "database": meta}

    if head == "medicines":
        return _route_medicines(method, segments, params, conn)

    if head == "interactions":
        return _route_interactions(method, segments, params, body, conn)

    if head == "health-topics":
        return _route_topics(method, segments, params, conn)

    raise _HttpError(404, "not_found", f"No route for {path!r}.")


def _allow(method, *allowed):
    if method not in allowed:
        raise _HttpError(
            405, "method_not_allowed", f"{method} is not allowed here; use {', '.join(allowed)}."
        )


def _route_medicines(method, segments, params, conn):
    if len(segments) == 1:
        _allow(method, "GET")
        category = _category_param(params)
        limit = _int_param(params, "limit", catalog.MAX_SEARCH_LIMIT, 1, catalog.MAX_SEARCH_LIMIT)
        offset = _int_param(params, "offset", 0, 0, 100000)
        return 200, {
            "count": catalog.total_medicines(conn, category),
            "category": category,
            "limit": limit,
            "offset": offset,
            "results": catalog.list_medicines(conn, category, limit, offset),
        }

    if segments[1] == "search" and len(segments) == 2:
        _allow(method, "GET")
        query = _require(params, "q")
        category = _category_param(params)
        limit = _int_param(
            params, "limit", catalog.DEFAULT_SEARCH_LIMIT, 1, catalog.MAX_SEARCH_LIMIT
        )
        results = catalog.search_medicines(conn, query, category, limit)
        return 200, {
            "query": query,
            "category": category,
            "count": len(results),
            "results": results,
        }

    medicine_id = segments[1]

    if len(segments) == 2:
        _allow(method, "GET")
        detail = catalog.medicine_detail(conn, medicine_id)
        if detail is None:
            raise _HttpError(
                404, db.STATUS_MEDICINE_NOT_FOUND, f"No medicine with id {medicine_id!r}."
            )
        return 200, detail

    if len(segments) == 3 and segments[2] == "interactions":
        _allow(method, "GET")
        category = _category_param(params)
        status = _one(params, "status")
        if status and status not in _VALID_STATUSES:
            raise _HttpError(
                400,
                "invalid_parameter",
                f"Parameter 'status' must be one of {sorted(_VALID_STATUSES)}, got {status!r}.",
            )
        include_evidence = _bool_param(params, "include_evidence")
        limit = _int_param(params, "limit", None, 1, 1000)
        offset = _int_param(params, "offset", 0, 0, 100000)

        results = interactions.interactions_for_medicine(
            conn, medicine_id, category, status, include_evidence, limit, offset
        )
        if results is None:
            raise _HttpError(
                404, db.STATUS_MEDICINE_NOT_FOUND, f"No medicine with id {medicine_id!r}."
            )
        return 200, {
            "medicine": catalog.medicine_summary(conn, medicine_id),
            "category": category,
            "status_filter": status,
            "counts": interactions.interaction_counts(conn, medicine_id),
            "count": len(results),
            "results": results,
            "disclaimer": interactions.DISCLAIMER,
        }

    raise _HttpError(404, "not_found", "No such medicines route.")


def _route_interactions(method, segments, params, body, conn):
    if len(segments) == 2 and segments[1] == "check":
        _allow(method, "GET", "POST")
        if method == "POST":
            if not isinstance(body, dict):
                raise _HttpError(
                    400, "invalid_body", "Request body must be a JSON object."
                )
            source = {k: [v] for k, v in body.items() if isinstance(v, (str, int, float))}
        else:
            source = params
        query_a = _require(source, "medicine_a")
        query_b = _require(source, "medicine_b")

        payload, error = interactions.check_pair(conn, query_a, query_b)
        if error is not None:
            return _check_error_response(error)
        return 200, payload

    if len(segments) == 2 and segments[1] == "documented":
        _allow(method, "GET")
        pair_kind = _one(params, "pair_kind")
        if pair_kind and pair_kind not in _VALID_PAIR_KINDS:
            raise _HttpError(
                400,
                "invalid_parameter",
                f"Parameter 'pair_kind' must be one of {sorted(_VALID_PAIR_KINDS)}, "
                f"got {pair_kind!r}.",
            )
        limit = _int_param(params, "limit", 100, 1, 1000)
        results = interactions.documented_interactions(conn, pair_kind, limit)
        return 200, {
            "pair_kind": pair_kind,
            "count": len(results),
            "results": results,
            "disclaimer": interactions.DISCLAIMER,
        }

    raise _HttpError(404, "not_found", "No such interactions route.")


def _route_topics(method, segments, params, conn):
    if len(segments) == 1:
        _allow(method, "GET")
        return 200, {
            "has_topic_data": topics.has_topic_data(conn),
            "topics": topics.list_topics(conn),
            "disclaimer": topics.DISCLAIMER,
        }

    if len(segments) == 2 and segments[1] == "lookup":
        _allow(method, "GET")
        topic = _require(params, "topic")
        payload, error = topics.lookup_topic(conn, topic)
        if error == "empty_query":
            raise _HttpError(400, "invalid_parameter", "Parameter 'topic' must not be empty.")
        return 200, payload

    raise _HttpError(404, "not_found", "No such health-topics route.")


def handle(method, path, params=None, body=None, db_path=None):
    """Dispatch one request. Returns (status_code, payload).

    Unexpected exceptions are logged server-side and reported as a generic 500:
    no traceback, SQL or file path reaches the client.
    """
    try:
        conn = db.connect(db_path or db.DB_PATH, read_only=True)
    except FileNotFoundError:
        return 503, {
            "error": {
                "code": "database_unavailable",
                "message": "The medicine database has not been built. Run `python -m hdi.seed`.",
            }
        }

    try:
        return _route(method, path, params or {}, body, conn)
    except _HttpError as exc:
        return exc.status, exc.payload()
    except Exception:  # noqa: BLE001 -- nothing internal may reach the client
        traceback.print_exc(file=sys.stderr)
        return 500, {
            "error": {"code": "internal_error", "message": "An internal error occurred."}
        }
    finally:
        conn.close()


class _Handler(BaseHTTPRequestHandler):
    server_version = "ayurveda-hdi"
    db_path = None
    quiet = False

    def _respond(self, method, body=None):
        parsed = urlsplit(self.path)
        status, payload = handle(
            method, parsed.path, parse_qs(parsed.query), body, self.db_path
        )
        encoded = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        self._respond("GET")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            encoded = json.dumps(
                {"error": {"code": "invalid_body", "message": "Request body must be valid JSON."}}
            ).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return
        self._respond("POST", body)

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)


def make_server(host=DEFAULT_HOST, port=DEFAULT_PORT, db_path=None, quiet=False):
    handler = type("_BoundHandler", (_Handler,), {"db_path": db_path, "quiet": quiet})
    return ThreadingHTTPServer((host, port), handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--db", default=None, help="Database path (default: data/processed/hdi.db)")
    args = parser.parse_args()

    if not Path(args.db or db.DB_PATH).exists():
        print(
            f"Database not found at {args.db or db.DB_PATH}. Run `python -m hdi.seed` first.",
            file=sys.stderr,
        )
        return 1

    server = make_server(args.host, args.port, args.db)
    print(f"Serving on http://{args.host}:{args.port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
