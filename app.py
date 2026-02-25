import json
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from flask import Flask, jsonify, request, send_from_directory
from cryptography.fernet import Fernet, InvalidToken
import requests

app = Flask(__name__, static_folder="dist", static_url_path="")

API = "https://mediathekviewweb.de/api/query"
CHANNELS_API = "https://mediathekviewweb.de/api/channels"
DIST_DIR = Path(app.root_path) / "dist"
DATA_DIR = Path(app.root_path) / "data"
PYLOAD_SETTINGS_FILE = DATA_DIR / "pyload_settings.json"
PYLOAD_KEY_FILE = DATA_DIR / "pyload_secret.key"
DEFAULT_RESULTS_PER_PAGE = 8
VIDEO_SIZE_CACHE = {}
CONTENT_RANGE_SIZE_RE = re.compile(r"/(\d+)$")


def fetch_channels():
    try:
        response = requests.get(CHANNELS_API, timeout=30)
        response.raise_for_status()
        data = response.json()
        channels = data.get("channels") if isinstance(data, dict) else None

        if isinstance(channels, list):
            clean_channels = sorted({
                str(channel).strip()
                for channel in channels
                if str(channel).strip()
            })
            if clean_channels:
                return clean_channels
    except (requests.RequestException, ValueError):
        pass

    # Fallback for compatibility in case /api/channels is temporarily unavailable.
    payload = {"queries": [], "size": 5000}
    response = requests.post(API, json=payload, timeout=30)
    response.raise_for_status()

    return sorted({
        e.get("channel")
        for e in response.json()["result"]["results"]
        if e.get("channel")
    })


def search(term, channels):
    offset = 0
    size = 50
    results = []

    queries = [{"fields": ["title", "topic"], "query": term}]

    for ch in channels:
        queries.append({"fields": ["channel"], "query": ch})

    while True:
        payload = {
            "queries": queries,
            "offset": offset,
            "size": size
        }

        r = requests.post(API, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()["result"]["results"]

        if not data:
            break

        for e in data:
            title = e.get("title") or ""
            if "originalversion" in title.lower():
                continue

            qualities = []
            seen_urls = set()
            quality_candidates = [
                ("hd", "HD", e.get("url_video_hd"), e.get("size_hd")),
                ("standard", "Standard", e.get("url_video"), e.get("size")),
                ("low", "Niedrig", e.get("url_video_low"), e.get("size_low")),
            ]
            for qid, label, url, quality_size in quality_candidates:
                if not url:
                    continue
                clean_url = str(url).strip()
                if not clean_url or clean_url in seen_urls:
                    continue
                seen_urls.add(clean_url)
                qualities.append({
                    "id": qid,
                    "label": label,
                    "url": clean_url,
                    "size": int(quality_size) if isinstance(quality_size, (int, float)) else None,
                })

            default_quality = qualities[0]["id"] if qualities else ""

            results.append({
                "id": f"{title}_{e.get('timestamp')}",
                "title": title,
                "topic": e.get("topic"),
                "channel": e.get("channel"),
                "timestamp": e.get("timestamp"),
                "duration": e.get("duration"),
                "size": e.get("size"),
                "description": e.get("description"),
                "qualities": qualities,
                "default_quality": default_quality,
                "subtitle": e.get("url_subtitle"),
                "url": e.get("url_website")
            })

        offset += size

    return results


def parse_positive_int(value):
    if value is None:
        return None

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    if parsed <= 0:
        return None

    return parsed


def size_from_response_headers(response):
    content_length = parse_positive_int(response.headers.get("Content-Length"))
    if content_length:
        return content_length

    content_range = (response.headers.get("Content-Range") or "").strip()
    if not content_range:
        return None

    match = CONTENT_RANGE_SIZE_RE.search(content_range)
    if not match:
        return None

    return parse_positive_int(match.group(1))


def resolve_video_size(url):
    value = str(url or "").strip()
    if not value:
        return None

    if value in VIDEO_SIZE_CACHE:
        return VIDEO_SIZE_CACHE[value]

    size = None

    try:
        response = requests.head(value, allow_redirects=True, timeout=12)
        if response.ok:
            size = size_from_response_headers(response)
    except requests.RequestException:
        pass

    if size is None:
        try:
            response = requests.get(
                value,
                allow_redirects=True,
                timeout=15,
                stream=True,
                headers={"Range": "bytes=0-0"},
            )
            if response.ok or response.status_code == 206:
                size = size_from_response_headers(response)
        except requests.RequestException:
            pass

    VIDEO_SIZE_CACHE[value] = size
    return size


def normalize_pyload_api_base(server):
    value = (server or "").strip()
    if not value:
        raise ValueError("pyLoad-Server fehlt.")

    if not value.startswith(("http://", "https://")):
        value = f"http://{value}"

    parts = urlsplit(value)
    if not parts.netloc:
        raise ValueError("pyLoad-Server ist ungueltig.")

    path = parts.path.rstrip("/")
    if not path:
        path = "/api"
    elif not path.endswith("/api"):
        path = f"{path}/api"

    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def response_data(response):
    try:
        return response.json()
    except ValueError:
        return response.text.strip()


def request_error_message(exc):
    if getattr(exc, "response", None) is None:
        return str(exc)

    response = exc.response
    text = (response.text or "").strip().replace("\n", " ")
    if len(text) > 220:
        text = f"{text[:220]}..."

    if text:
        return f"HTTP {response.status_code}: {text}"

    return f"HTTP {response.status_code}"


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_cipher():
    ensure_data_dir()

    if PYLOAD_KEY_FILE.exists():
        key = PYLOAD_KEY_FILE.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        PYLOAD_KEY_FILE.write_bytes(key)
        try:
            PYLOAD_KEY_FILE.chmod(0o600)
        except OSError:
            pass

    return Fernet(key)


def encrypt_password(password):
    if not password:
        return ""

    return get_cipher().encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_password(token):
    if not token:
        return ""

    try:
        return get_cipher().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


def load_pyload_settings():
    if not PYLOAD_SETTINGS_FILE.exists():
        return {
            "server": "",
            "username": "",
            "password": "",
            "results_per_page": DEFAULT_RESULTS_PER_PAGE,
        }

    try:
        content = json.loads(PYLOAD_SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {
            "server": "",
            "username": "",
            "password": "",
            "results_per_page": DEFAULT_RESULTS_PER_PAGE,
        }

    encrypted_password = content.get("password_encrypted") or ""
    results_per_page = content.get("results_per_page", DEFAULT_RESULTS_PER_PAGE)
    try:
        results_per_page = int(results_per_page)
    except (TypeError, ValueError):
        results_per_page = DEFAULT_RESULTS_PER_PAGE
    if results_per_page < 1 or results_per_page > 200:
        results_per_page = DEFAULT_RESULTS_PER_PAGE

    return {
        "server": str(content.get("server") or "").strip(),
        "username": str(content.get("username") or "").strip(),
        "password": decrypt_password(str(encrypted_password)),
        "results_per_page": results_per_page,
    }


def save_pyload_settings(server, username, password, results_per_page):
    try:
        rows = int(results_per_page)
    except (TypeError, ValueError):
        rows = DEFAULT_RESULTS_PER_PAGE
    if rows < 1 or rows > 200:
        rows = DEFAULT_RESULTS_PER_PAGE

    ensure_data_dir()
    data = {
        "server": (server or "").strip(),
        "username": (username or "").strip(),
        "password_encrypted": encrypt_password(password or ""),
        "results_per_page": rows,
    }
    PYLOAD_SETTINGS_FILE.write_text(
        json.dumps(data, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    try:
        PYLOAD_SETTINGS_FILE.chmod(0o600)
    except OSError:
        pass


def pyload_add_package(session, api_base, username, password, name, links):
    payload = {
        "name": name,
        "links": links,
        "dest": 1,
    }
    response = session.post(
        f"{api_base}/add_package",
        json=payload,
        auth=(username, password),
        timeout=30,
    )
    response.raise_for_status()
    return response_data(response)


@app.route("/channels")
def channels():
    return jsonify(fetch_channels())


@app.route("/search")
def do_search():
    term = request.args.get("q", "")
    channels = request.args.getlist("channels[]")
    return jsonify(search(term, channels))


@app.route("/quality-sizes", methods=["POST"])
def quality_sizes():
    body = request.get_json(silent=True) or {}
    urls = body.get("urls")

    if not isinstance(urls, list):
        return jsonify({"error": "urls muss ein Array sein."}), 400

    resolved = {}
    for raw_url in urls[:18]:
        url = str(raw_url or "").strip()
        if not url:
            continue

        size = resolve_video_size(url)
        if isinstance(size, int) and size > 0:
            resolved[url] = size

    return jsonify({"sizes": resolved})


@app.route("/pyload/settings", methods=["GET"])
def get_pyload_settings():
    return jsonify(load_pyload_settings())


@app.route("/pyload/settings", methods=["POST"])
def set_pyload_settings():
    body = request.get_json(silent=True) or {}

    existing = load_pyload_settings()

    if "server" in body:
        server = str(body.get("server") or "")
    else:
        server = existing.get("server") or ""

    if "username" in body:
        username = str(body.get("username") or "")
    else:
        username = existing.get("username") or ""

    if "password" in body:
        password = str(body.get("password") or "")
    else:
        password = existing.get("password") or ""

    if "results_per_page" in body:
        results_per_page = body.get("results_per_page")
    else:
        results_per_page = existing.get("results_per_page", DEFAULT_RESULTS_PER_PAGE)

    save_pyload_settings(server, username, password, results_per_page)
    return jsonify({"saved": True})


@app.route("/pyload/add", methods=["POST"])
def pyload_add():
    body = request.get_json(silent=True) or {}

    stored = load_pyload_settings()
    server = str(body.get("server") or stored.get("server") or "").strip()
    username = str(body.get("username") or stored.get("username") or "").strip()
    password = body.get("password")
    if password is None or password == "":
        password = stored.get("password") or ""
    else:
        password = str(password)
    packages = body.get("packages")

    if not server:
        return jsonify({"error": "pyLoad-Server fehlt."}), 400
    if not username:
        return jsonify({"error": "pyLoad-Benutzer fehlt."}), 400
    if not password:
        return jsonify({"error": "pyLoad-Passwort fehlt."}), 400
    if not isinstance(packages, list) or not packages:
        return jsonify({"error": "Keine Pakete zum Hinzufuegen."}), 400

    clean_packages = []
    for package in packages:
        if not isinstance(package, dict):
            continue

        name = (package.get("name") or "").strip()
        links = package.get("links") or []
        if not isinstance(links, list):
            continue

        clean_links = [str(link).strip() for link in links if str(link).strip()]
        if name and clean_links:
            clean_packages.append({"name": name, "links": clean_links})

    if not clean_packages:
        return jsonify({"error": "Keine gueltigen Pakete enthalten."}), 400

    try:
        api_base = normalize_pyload_api_base(server)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    session = requests.Session()
    added = []
    failed = []

    for package in clean_packages:
        try:
            package_id = pyload_add_package(
                session,
                api_base,
                username,
                password,
                package["name"],
                package["links"],
            )
            added.append({"name": package["name"], "pid": package_id})
        except requests.RequestException as exc:
            message = request_error_message(exc)
            response = getattr(exc, "response", None)
            if response is not None and response.status_code == 404:
                body = (response.text or "").strip()
                if "obsolete api" in body.lower():
                    message = (
                        "HTTP 404: Obsolete API. Bitte pyLoad REST API mit "
                        "Basic Auth verwenden."
                    )
            failed.append({
                "name": package["name"],
                "error": message,
            })

    status_code = 200 if added else 502
    return jsonify({
        "added": added,
        "failed": failed,
        "added_count": len(added),
        "failed_count": len(failed),
    }), status_code


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if not DIST_DIR.exists():
        return "Frontend not built. Run 'npm run build'.", 503

    requested_file = DIST_DIR / path
    if path and requested_file.exists() and requested_file.is_file():
        return send_from_directory(DIST_DIR, path)

    return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
