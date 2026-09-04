"""Run the daily review and publish a small static API for GitHub Pages."""

import argparse
import json
import shutil
import sys
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from quant_system.scheduler.engine import quant_scheduler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Trading date in YYYY-MM-DD format")
    parser.add_argument("--output", default="public", help="Static output directory")
    args = parser.parse_args()

    result = quant_scheduler.trigger_manual_review(args.date)
    effective_date = result.get("trade_date", args.date)
    data_dir = PROJECT_ROOT / "quant_system" / "data"
    output_dir = Path(args.output)
    date_dir = output_dir / "snapshots" / effective_date
    date_dir.mkdir(parents=True, exist_ok=True)

    for prefix in ("candidates", "sentiment", "limitup", "snapshot_status"):
        source = data_dir / f"{prefix}_{args.date}.json"
        if source.exists():
            shutil.copyfile(source, date_dir / f"{prefix}.json")

    for source in data_dir.glob("candidates_*.json"):
        match = re.fullmatch(r"candidates_(\d{4}-\d{2}-\d{2})\.json", source.name)
        if not match:
            continue
        history_dir = output_dir / "snapshots" / match.group(1)
        history_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, history_dir / "candidates.json")
        for prefix in ("sentiment", "limitup", "snapshot_status"):
            history_source = data_dir / f"{prefix}_{match.group(1)}.json"
            if history_source.exists():
                shutil.copyfile(history_source, history_dir / f"{prefix}.json")

    scoring = result["scoring"]
    manifest = {
        "trade_date": effective_date,
        "snapshot_status": "FINAL",
        "published_at": result["sentiment"].get("snapshot_generated_at"),
        "candidate_count": scoring.get("candidates_count", 0),
        "data_sources": sorted({
            item.get("data_source", "unknown")
            for item in scoring.get("candidates", [])
        }),
    }
    (date_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "snapshot.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    dates = sorted({
        match.group(1)
        for path in (output_dir / "snapshots").glob("*/candidates.json")
        if (match := re.fullmatch(r"(\d{4}-\d{2}-\d{2})", path.parent.name))
    }, reverse=True)
    (output_dir / "snapshots" / "index.json").write_text(json.dumps({"dates": dates}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()