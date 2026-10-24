"""Offline CPU similarity service. HTTP is accepted only over a Unix socket."""
import argparse
import functools
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--socket", default="/run/relink-semantic/score.sock")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if not args.download:
        os.environ["HF_HUB_OFFLINE"] = "1"
        manifest = json.loads((Path(args.cache) / "sha256.json").read_text())
        for name, expected in manifest.items():
            if hashlib.sha256((Path(args.cache) / name).read_bytes()).hexdigest() != expected:
                raise RuntimeError("Model artifact checksum mismatch")
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from fastembed import TextEmbedding
    import numpy as np
    model = TextEmbedding(model_name=MODEL, cache_dir=args.cache, threads=2,
                          providers=["CPUExecutionProvider"], local_files_only=not args.download)
    if args.download:
        list(model.embed(["Model initialization."]))
        root = Path(args.cache)
        manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in root.rglob("*") if p.is_file() and "snapshots" in p.parts}
        (root / "sha256.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"model": MODEL, "files": len(manifest)}), flush=True)
        return

    @functools.lru_cache(maxsize=1024)
    def embedding(text):
        # Short windows avoid silently losing most of an introduction to the
        # model's 128-token limit. Average normalized window vectors.
        words = text.split()
        chunks = [" ".join(words[i:i + 55]) for i in range(0, len(words), 55)] or [""]
        vectors = list(model.embed(chunks, batch_size=8))
        vector = np.mean(vectors, axis=0)
        norm = np.linalg.norm(vector)
        return vector / max(float(norm), 1e-9)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log article text or requests.

        def do_POST(self):
            try:
                self.connection.settimeout(20)
                size = int(self.headers.get("Content-Length", "0"))
                if self.path != "/score" or not 0 < size <= 100000:
                    raise ValueError("Invalid request")
                data = json.loads(self.rfile.read(size))
                source, candidates = data["source"], data["candidates"]
                if not isinstance(candidates, list) or not 1 <= len(candidates) <= 8:
                    raise ValueError("Invalid candidates")
                if any(not isinstance(t, str) or len(t) > 2500 for t in [source, *candidates]):
                    raise ValueError("Invalid text")
                a = embedding(source)
                scores = [max(-1, min(1, float(np.dot(a, embedding(t))))) for t in candidates]
                body = json.dumps({"model": MODEL, "scores": scores}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, KeyError, TypeError, TimeoutError):
                self.send_error(400, "Invalid request")

    path = Path(args.socket)
    if path.exists():
        path.unlink()
    with UnixStreamServer(str(path), Handler) as server:
        os.chmod(path, 0o660)
        print(json.dumps({"event": "ready", "model": MODEL, "transport": "unix"}), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
